import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  type Animation,
  type AnimationSampler,
  type Accessor,
  type Document,
  NodeIO,
  type Primitive,
  type Property,
  PropertyType,
  type Texture,
  type TypedArray,
} from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, inspect, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from './sharpSecurity.js'

export interface ResourceCountReport {
  accessors: number
  materials: number
  textures: number
  buffers: number
}

export interface OptimizationPassReport {
  /** Exact animation keys removed with tolerance=0. */
  animationKeyframesRemoved: number
  /** Bit-identical vertex records removed by welding. */
  weldedVertices: number
  /** Root resources merged only when their authored metadata permits it. */
  deduplicated: Omit<ResourceCountReport, 'buffers'>
  /** Compiler-generated per-channel textures merged because their payloads are
   * byte-identical. Reported apart from `deduplicated` because this pass alone
   * discards a name, which the general pass is forbidden to do. */
  mergedGeneratedTextures: {
    textures: number
    /** Uncompressed RGBA8 upload bytes, mip chain included, no longer resident. */
    gpuBytesReclaimed: number
    /** Every merge performed, so a lost name is always traceable. */
    merges: Array<{ kept: string; dropped: string[] }>
  }
  /** Unreferenced resources removed while retaining attributes, extras, and solid textures. */
  pruned: ResourceCountReport
  /** Optional passes refused for this asset, with an actionable reason for each refusal. */
  skipped: string[]
}

export interface OptimizationReport {
  geometry: 'meshopt'
  inputBytes: number
  outputBytes: number
  savedBytes: number
  ratio: number
  /** Largest absolute scene/world-bounds delta introduced by quantization. */
  maxBoundsError: number
  /** Scale-relative refusal threshold used for every scene. */
  boundsTolerance: number
  /** Evidence from each semantics-preserving compiler pass. Optional only for
   * schema-v3 manifests generated before this additive field existed. */
  passes?: OptimizationPassReport
}

export function verifySceneBounds(
  beforeMin: readonly number[],
  beforeMax: readonly number[],
  afterMin: readonly number[],
  afterMax: readonly number[],
  label = 'scene',
): { maxError: number; tolerance: number } {
  if ([beforeMin, beforeMax, afterMin, afterMax].some((values) =>
    values.length !== 3 || values.some((value) => !Number.isFinite(value)))) {
    throw new Error(`Meshopt verification received invalid ${label} bounds.`)
  }
  const diagonal = Math.hypot(
    beforeMax[0]! - beforeMin[0]!,
    beforeMax[1]! - beforeMin[1]!,
    beforeMax[2]! - beforeMin[2]!,
  )
  const tolerance = Math.max(1e-6, diagonal * 1e-4)
  const before = [...beforeMin, ...beforeMax]
  const after = [...afterMin, ...afterMax]
  const maxError = Math.max(...before.map((value, index) => Math.abs(value - after[index]!)))
  if (maxError > tolerance) {
    throw new Error(
      `Meshopt verification changed ${label} bounds by ${maxError.toPrecision(4)}, ` +
        `above the scale-relative tolerance ${tolerance.toPrecision(4)}.`,
    )
  }
  return { maxError, tolerance }
}

type NumericArray = TypedArray

interface AnimationSamplerEvidence {
  animation: number
  sampler: number
  interpolation: string
  targetPath: string | null
  times: number[]
  values: number[]
  elementSize: number
}

interface TexcoordEvidence {
  label: string
  type: string
  componentType: number
  normalized: boolean
  renderedValues: number
  digest: string
}

interface AccessorMetadata {
  name: string
  extras: Record<string, unknown>
}

interface PrimitiveAccessorMetadata {
  indices: AccessorMetadata | null
  attributes: Record<string, AccessorMetadata>
  targets: Array<Record<string, AccessorMetadata>>
}

interface DocumentAccessorMetadata {
  primitives: PrimitiveAccessorMetadata[]
  animations: Array<{ input: AccessorMetadata | null; output: AccessorMetadata | null }>
  skins: Array<AccessorMetadata | null>
}

const isEmptyObject = (value: Record<string, unknown>): boolean => Object.keys(value).length === 0

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    )
  }
  return value
}

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value))

function describeStringDifference(before: string, after: string): string {
  let index = 0
  while (index < before.length && index < after.length && before[index] === after[index]) index += 1
  const start = Math.max(0, index - 60)
  const end = index + 100
  return `first difference at ${index}; before=${JSON.stringify(before.slice(start, end))}, `
    + `after=${JSON.stringify(after.slice(start, end))}`
}

function listGraphProperties(document: Document): Property[] {
  const properties = new Set<Property>([document.getRoot()])
  for (const edge of document.getGraph().listEdges()) {
    properties.add(edge.getParent())
    properties.add(edge.getChild())
  }
  return [...properties]
}

/** Extras can carry components, probes, state identity, or data from another add-on. The
 * optimizer does not need to understand those contracts to prove that every authored payload
 * survived. Paths are intentionally omitted: safe de-duplication can share two identical
 * resources, but it must never erase the last copy of an extras payload. */
function captureExtrasEvidence(document: Document): string[] {
  return listGraphProperties(document)
    .filter((property) => !isEmptyObject(property.getExtras()))
    .map((property) => [
      property.propertyType,
      property.getName(),
      canonicalJson(property.getExtras()),
    ].join('\u0000'))
    .sort()
}

const accessorMetadata = (accessor: Accessor | null): AccessorMetadata | null => accessor
  ? { name: accessor.getName(), extras: structuredClone(accessor.getExtras()) }
  : null

function captureAccessorMetadata(document: Document): DocumentAccessorMetadata {
  return {
    primitives: document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives().map((primitive) => ({
      indices: accessorMetadata(primitive.getIndices()),
      attributes: Object.fromEntries(primitive.listSemantics().map((semantic) => [
        semantic,
        accessorMetadata(primitive.getAttribute(semantic))!,
      ])),
      targets: primitive.listTargets().map((target) => Object.fromEntries(
        target.listSemantics().map((semantic) => [semantic, accessorMetadata(target.getAttribute(semantic))!]),
      )),
    }))),
    animations: document.getRoot().listAnimations().flatMap((animation) => animation.listSamplers().map((sampler) => ({
      input: accessorMetadata(sampler.getInput()),
      output: accessorMetadata(sampler.getOutput()),
    }))),
    skins: document.getRoot().listSkins().map((skin) => accessorMetadata(skin.getInverseBindMatrices())),
  }
}

function listCoreReferencedAccessors(document: Document): Set<Accessor> {
  const accessors = new Set<Accessor>()
  const add = (accessor: Accessor | null): void => {
    if (accessor) accessors.add(accessor)
  }
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      add(primitive.getIndices())
      primitive.listAttributes().forEach(add)
      primitive.listTargets().forEach((target) => target.listAttributes().forEach(add))
    }
  }
  for (const animation of document.getRoot().listAnimations()) {
    for (const sampler of animation.listSamplers()) {
      add(sampler.getInput())
      add(sampler.getOutput())
    }
  }
  for (const skin of document.getRoot().listSkins()) add(skin.getInverseBindMatrices())
  return accessors
}

function restoreAccessorMetadata(document: Document, evidence: DocumentAccessorMetadata): void {
  const assignments = new Map<Accessor, string>()
  const restore = (
    sourceAccessor: Accessor | null,
    metadata: AccessorMetadata | null,
    label: string,
    attach: (accessor: Accessor) => void,
  ): void => {
    if (!metadata) return
    if (!sourceAccessor) throw new Error(`Optimization removed the authored accessor at ${label}.`)
    let accessor = sourceAccessor
    const signature = canonicalJson(metadata)
    const previous = assignments.get(accessor)
    if (previous && previous !== signature) {
      // Reorder may share bit-identical streams even when its generic cleanup
      // is disabled. Split that internal alias so both authored identities
      // remain addressable after publication.
      accessor = accessor.clone()
      attach(accessor)
    }
    assignments.set(accessor, signature)
    accessor.setName(metadata.name).setExtras(structuredClone(metadata.extras))
  }

  const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())
  if (primitives.length !== evidence.primitives.length) {
    throw new Error(
      `Optimization changed primitive count from ${evidence.primitives.length} to ${primitives.length}.`,
    )
  }
  primitives.forEach((primitive, primitiveIndex) => {
    const source = evidence.primitives[primitiveIndex]!
    restore(
      primitive.getIndices(),
      source.indices,
      `primitive ${primitiveIndex} indices`,
      (accessor) => primitive.setIndices(accessor),
    )
    for (const [semantic, metadata] of Object.entries(source.attributes)) {
      restore(
        primitive.getAttribute(semantic),
        metadata,
        `primitive ${primitiveIndex} ${semantic}`,
        (accessor) => primitive.setAttribute(semantic, accessor),
      )
    }
    if (primitive.listTargets().length !== source.targets.length) {
      throw new Error(`Optimization changed morph-target count on primitive ${primitiveIndex}.`)
    }
    source.targets.forEach((target, targetIndex) => {
      for (const [semantic, metadata] of Object.entries(target)) {
        restore(
          primitive.listTargets()[targetIndex]!.getAttribute(semantic),
          metadata,
          `primitive ${primitiveIndex} target ${targetIndex} ${semantic}`,
          (accessor) => primitive.listTargets()[targetIndex]!.setAttribute(semantic, accessor),
        )
      }
    })
  })

  const samplers = document.getRoot().listAnimations().flatMap((animation) => animation.listSamplers())
  if (samplers.length !== evidence.animations.length) {
    throw new Error(`Optimization changed animation sampler count from ${evidence.animations.length} to ${samplers.length}.`)
  }
  samplers.forEach((sampler, index) => {
    restore(
      sampler.getInput(),
      evidence.animations[index]!.input,
      `animation sampler ${index} input`,
      (accessor) => sampler.setInput(accessor),
    )
    restore(
      sampler.getOutput(),
      evidence.animations[index]!.output,
      `animation sampler ${index} output`,
      (accessor) => sampler.setOutput(accessor),
    )
  })

  const skins = document.getRoot().listSkins()
  if (skins.length !== evidence.skins.length) {
    throw new Error(`Optimization changed skin count from ${evidence.skins.length} to ${skins.length}.`)
  }
  skins.forEach((skin, index) => restore(
    skin.getInverseBindMatrices(),
    evidence.skins[index]!,
    `skin ${index} inverse bind matrices`,
    (accessor) => skin.setInverseBindMatrices(accessor),
  ))
}

function captureSemanticIdentity(document: Document): string {
  const root = document.getRoot()
  const nodes = root.listNodes()
  const meshes = root.listMeshes()
  const skins = root.listSkins()
  const cameras = root.listCameras()
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]))
  const meshIndex = new Map(meshes.map((mesh, index) => [mesh, index]))
  const skinIndex = new Map(skins.map((skin, index) => [skin, index]))
  const cameraIndex = new Map(cameras.map((camera, index) => [camera, index]))

  const uniqueNames = (properties: Property[]): string[] => [...new Set(properties
    .filter((property) => property.getName())
    .map((property) => property.getName()))].sort()

  // Compiler-generated channel texture names are deliberately outside the
  // identity contract. `material_compiler.py:6262` derives the token as
  // sha256(_variant_key(decision, binding))[:12], so the name rotates whenever
  // the material plan does — it was never an identity application code could
  // hold onto, and treating it as one would forbid
  // `mergeGeneratedChannelTextures` from collapsing byte-identical payloads.
  // Every other resource name stays strictly pinned, and each merge is listed
  // in `passes.mergedGeneratedTextures.merges` so a dropped name is traceable.
  const stableTextureNames = (textures: Property[]): string[] =>
    uniqueNames(textures).filter((name) => !GENERATED_CHANNEL_TEXTURE.test(name))

  return canonicalJson({
    rootExtras: root.getExtras(),
    defaultScene: root.getDefaultScene() ? root.listScenes().indexOf(root.getDefaultScene()!) : -1,
    scenes: root.listScenes().map((scene) => ({
      name: scene.getName(),
      extras: scene.getExtras(),
      children: scene.listChildren().map((node) => nodeIndex.get(node)),
    })),
    nodes: nodes.map((node) => ({
      name: node.getName(),
      extras: node.getExtras(),
      weights: [...node.getWeights()],
      children: node.listChildren().map((child) => nodeIndex.get(child)),
      mesh: node.getMesh() ? meshIndex.get(node.getMesh()!) : -1,
      skin: node.getSkin() ? skinIndex.get(node.getSkin()!) : -1,
      camera: node.getCamera() ? cameraIndex.get(node.getCamera()!) : -1,
    })),
    meshes: meshes.map((mesh) => ({
      name: mesh.getName(),
      extras: mesh.getExtras(),
      weights: [...mesh.getWeights()],
      primitives: mesh.listPrimitives().map((primitive) => ({
        name: primitive.getName(),
        extras: primitive.getExtras(),
        targets: primitive.listTargets().map((target) => ({
          name: target.getName(),
          extras: target.getExtras(),
        })),
      })),
    })),
    skins: skins.map((skin) => ({ name: skin.getName(), extras: skin.getExtras() })),
    cameras: cameras.map((camera) => ({ name: camera.getName(), extras: camera.getExtras() })),
    animations: root.listAnimations().map((animation) => {
      const samplers = animation.listSamplers()
      return {
        name: animation.getName(),
        extras: animation.getExtras(),
        samplers: samplers.map((sampler) => ({
          name: sampler.getName(),
          extras: sampler.getExtras(),
          interpolation: sampler.getInterpolation(),
        })),
        channels: animation.listChannels().map((channel) => ({
          name: channel.getName(),
          extras: channel.getExtras(),
          targetNode: channel.getTargetNode() ? nodeIndex.get(channel.getTargetNode()!) : -1,
          targetPath: channel.getTargetPath(),
          sampler: channel.getSampler() ? samplers.indexOf(channel.getSampler()!) : -1,
        })),
      }
    }),
    resourceNames: {
      accessors: uniqueNames(root.listAccessors()),
      materials: uniqueNames(root.listMaterials()),
      textures: stableTextureNames(root.listTextures()),
      buffers: uniqueNames(root.listBuffers()),
    },
  })
}

function countAnimationKeys(document: Document): number {
  let count = 0
  for (const animation of document.getRoot().listAnimations()) {
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput()
      if (!input) throw new Error(`Animation "${animation.getName()}" has a sampler without input times.`)
      count += input.getCount()
    }
  }
  return count
}

function targetPathsForAnimation(animation: Animation): Map<AnimationSampler, Set<string>> {
  const paths = new Map<AnimationSampler, Set<string>>()
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler()
    const path = channel.getTargetPath()
    if (!sampler || !path) {
      throw new Error(`Animation "${animation.getName()}" contains an incomplete channel.`)
    }
    const samplerPaths = paths.get(sampler) ?? new Set<string>()
    samplerPaths.add(path)
    paths.set(sampler, samplerPaths)
  }
  return paths
}

function captureAnimationEvidence(document: Document): AnimationSamplerEvidence[] {
  const evidence: AnimationSamplerEvidence[] = []
  document.getRoot().listAnimations().forEach((animation, animationIndex) => {
    const paths = targetPathsForAnimation(animation)
    animation.listSamplers().forEach((sampler, samplerIndex) => {
      const input = sampler.getInput()
      const output = sampler.getOutput()
      if (!input || !output || !input.getArray() || !output.getArray()) {
        throw new Error(
          `Animation "${animation.getName()}" sampler ${samplerIndex} has no decodable input/output data.`,
        )
      }
      const times = Array.from(input.getArray() as NumericArray)
      const values = Array.from(output.getArray() as NumericArray)
      const interpolation = sampler.getInterpolation()
      const divisor = interpolation === 'CUBICSPLINE' ? times.length * 3 : times.length
      if (divisor === 0 || values.length % divisor !== 0) {
        throw new Error(
          `Animation "${animation.getName()}" sampler ${samplerIndex} has incompatible input/output counts.`,
        )
      }
      evidence.push({
        animation: animationIndex,
        sampler: samplerIndex,
        interpolation,
        targetPath: [...(paths.get(sampler) ?? [])][0] ?? null,
        times,
        values,
        elementSize: values.length / divisor,
      })
    })
  })
  return evidence
}

function slerpQuaternion(a: number[], b: number[], t: number): number[] {
  let [ax, ay, az, aw] = a as [number, number, number, number]
  let [bx, by, bz, bw] = b as [number, number, number, number]
  let cosine = ax * bx + ay * by + az * bz + aw * bw
  if (cosine < 0) {
    cosine = -cosine
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }
  let scale0: number
  let scale1: number
  if (1 - cosine > 1e-6) {
    const omega = Math.acos(cosine)
    const sine = Math.sin(omega)
    scale0 = Math.sin((1 - t) * omega) / sine
    scale1 = Math.sin(t * omega) / sine
  } else {
    scale0 = 1 - t
    scale1 = t
  }
  return [
    scale0 * ax + scale1 * bx,
    scale0 * ay + scale1 * by,
    scale0 * az + scale1 * bz,
    scale0 * aw + scale1 * bw,
  ]
}

function sampleAnimationEvidence(
  times: number[],
  values: number[],
  elementSize: number,
  time: number,
  interpolation: string,
  targetPath: string | null,
): number[] {
  const exact = times.indexOf(time)
  if (exact >= 0) return values.slice(exact * elementSize, (exact + 1) * elementSize)
  if (time <= times[0]!) return values.slice(0, elementSize)
  if (time >= times[times.length - 1]!) {
    return values.slice(values.length - elementSize)
  }
  let next = 1
  while (times[next]! < time) next += 1
  const previous = next - 1
  const a = values.slice(previous * elementSize, (previous + 1) * elementSize)
  if (interpolation === 'STEP') return a
  const b = values.slice(next * elementSize, (next + 1) * elementSize)
  const t = (time - times[previous]!) / (times[next]! - times[previous]!)
  if (targetPath === 'rotation') return slerpQuaternion(a, b, t)
  return a.map((value, index) => value * (1 - t) + b[index]! * t)
}

function verifyResampledAnimations(before: AnimationSamplerEvidence[], document: Document): void {
  const after = captureAnimationEvidence(document)
  if (before.length !== after.length) {
    throw new Error(
      `Lossless animation verification changed sampler count from ${before.length} to ${after.length}.`,
    )
  }
  for (let index = 0; index < before.length; index += 1) {
    const source = before[index]!
    const result = after[index]!
    if (
      source.animation !== result.animation
      || source.sampler !== result.sampler
      || source.interpolation !== result.interpolation
      || source.targetPath !== result.targetPath
      || source.elementSize !== result.elementSize
    ) {
      throw new Error(`Lossless animation verification changed sampler ${index} metadata.`)
    }
    if (source.interpolation === 'CUBICSPLINE') {
      if (canonicalJson(source.times) !== canonicalJson(result.times)
        || canonicalJson(source.values) !== canonicalJson(result.values)) {
        throw new Error(`Lossless animation verification changed CUBICSPLINE sampler ${index}.`)
      }
      continue
    }
    source.times.forEach((time, keyframe) => {
      const sampled = sampleAnimationEvidence(
        result.times,
        result.values,
        result.elementSize,
        time,
        result.interpolation,
        result.targetPath,
      )
      const expected = source.values.slice(
        keyframe * source.elementSize,
        (keyframe + 1) * source.elementSize,
      )
      for (let component = 0; component < expected.length; component += 1) {
        // glTF stores float32; interpolation here runs in float64, so a
        // reconstruction may differ from the stored value by a double ULP
        // while rounding to the identical float32 bits. Lossless means
        // lossless at the precision the file can carry.
        if (Math.fround(sampled[component]!) !== Math.fround(expected[component]!)) {
          throw new Error(
            `Lossless animation verification changed sampler ${index}, key ${keyframe}, `
              + `component ${component} from ${expected[component]} to ${sampled[component]}.`,
          )
        }
      }
    })
  }
}

function updateNumberStream(
  hash: ReturnType<typeof createHash>,
  values: Iterable<number>,
): void {
  const chunk = Buffer.allocUnsafe(64 * 1024)
  let offset = 0
  for (const value of values) {
    if (offset + 8 > chunk.byteLength) {
      hash.update(chunk.subarray(0, offset))
      offset = 0
    }
    chunk.writeDoubleLE(value, offset)
    offset += 8
  }
  if (offset > 0) hash.update(chunk.subarray(0, offset))
}

function renderedIndices(primitive: Primitive): number[] | Uint32Array {
  const indices = primitive.getIndices()?.getArray()
  if (indices) return Array.from(indices as NumericArray)
  const position = primitive.getAttribute('POSITION')
  if (!position) throw new Error(`Primitive "${primitive.getName()}" has no POSITION attribute.`)
  return Uint32Array.from({ length: position.getCount() }, (_, index) => index)
}

function primitiveSemanticDigest(primitive: Primitive): string {
  const hash = createHash('sha256')
  const indices = renderedIndices(primitive)
  hash.update(`${primitive.getMode()}\u0000${canonicalJson(primitive.getExtras())}\u0000${indices.length}\u0000`)
  const updateAttributes = (label: string, semantics: string[], getAttribute: (semantic: string) => ReturnType<Primitive['getAttribute']>) => {
    for (const semantic of semantics.sort()) {
      const accessor = getAttribute(semantic)
      const array = accessor?.getArray()
      if (!accessor || !array) throw new Error(`${label} ${semantic} has no decodable accessor data.`)
      const size = accessor.getElementSize()
      hash.update(
        `${label}\u0000${semantic}\u0000${accessor.getType()}\u0000${accessor.getComponentType()}`
          + `\u0000${accessor.getNormalized()}\u0000`,
      )
      updateNumberStream(hash, (function* values() {
        for (const vertex of indices) {
          for (let component = 0; component < size; component += 1) {
            yield array[vertex * size + component]!
          }
        }
      })())
    }
  }
  updateAttributes('attribute', primitive.listSemantics(), (semantic) => primitive.getAttribute(semantic))
  primitive.listTargets().forEach((target, targetIndex) => {
    updateAttributes(
      `target:${targetIndex}`,
      target.listSemantics(),
      (semantic) => target.getAttribute(semantic),
    )
  })
  return hash.digest('hex')
}

function capturePrimitiveEvidence(document: Document): string[] {
  return document.getRoot().listMeshes().flatMap((mesh, meshIndex) =>
    mesh.listPrimitives().map((primitive, primitiveIndex) =>
      `${meshIndex}:${primitiveIndex}:${primitiveSemanticDigest(primitive)}`))
}

function countPrimitiveVertices(document: Document): number {
  return document.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives()
    .reduce((meshTotal, primitive) => meshTotal + (primitive.getAttribute('POSITION')?.getCount() ?? 0), 0), 0)
}

function numberKey(value: number): string {
  if (Object.is(value, -0)) return '-0'
  if (!Number.isFinite(value)) return String(value)
  return value.toString()
}

function captureTexcoordEvidence(document: Document): TexcoordEvidence[] {
  const result: TexcoordEvidence[] = []
  document.getRoot().listMeshes().forEach((mesh, meshIndex) => {
    mesh.listPrimitives().forEach((primitive, primitiveIndex) => {
      const indices = renderedIndices(primitive)
      for (const semantic of primitive.listSemantics().filter((entry) => /^TEXCOORD_\d+$/.test(entry)).sort()) {
        const accessor = primitive.getAttribute(semantic)
        const array = accessor?.getArray()
        if (!accessor || !array) throw new Error(`${semantic} has no decodable accessor data.`)
        const size = accessor.getElementSize()
        const frequencies = new Map<string, number>()
        for (const vertex of indices) {
          const key = Array.from({ length: size }, (_, component) =>
            numberKey(array[vertex * size + component]!)).join(',')
          frequencies.set(key, (frequencies.get(key) ?? 0) + 1)
        }
        const hash = createHash('sha256')
        for (const [key, count] of [...frequencies].sort(([a], [b]) => a.localeCompare(b))) {
          hash.update(`${key}:${count}\u0000`)
        }
        result.push({
          label: `${meshIndex}:${primitiveIndex}:${semantic}`,
          type: accessor.getType(),
          componentType: accessor.getComponentType(),
          normalized: accessor.getNormalized(),
          renderedValues: indices.length,
          digest: hash.digest('hex'),
        })
      }
    })
  })
  return result
}

function resourceCounts(document: Document): ResourceCountReport {
  const root = document.getRoot()
  return {
    accessors: root.listAccessors().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    buffers: root.listBuffers().length,
  }
}

function subtractCounts(before: ResourceCountReport, after: ResourceCountReport): ResourceCountReport {
  return {
    accessors: Math.max(0, before.accessors - after.accessors),
    materials: Math.max(0, before.materials - after.materials),
    textures: Math.max(0, before.textures - after.textures),
    buffers: Math.max(0, before.buffers - after.buffers),
  }
}

function protectNamedResourcesForPrune(document: Document): Map<Property, Record<string, unknown>> {
  const root = document.getRoot()
  const protectedExtras = new Map<Property, Record<string, unknown>>()
  const candidates: Property[] = [
    ...root.listAccessors(),
    ...root.listMaterials(),
    ...root.listTextures(),
    ...root.listBuffers(),
  ]
  for (const property of candidates) {
    if (!property.getName() || !isEmptyObject(property.getExtras())) continue
    protectedExtras.set(property, property.getExtras())
    property.setExtras({ blendlink_optimizer_preserve_name: true })
  }
  return protectedExtras
}

/** Names minted by the per-channel material bake, and only those.
 * `material_compiler.py:6454-6543` writes `channel-<token>-<slot>.png` for the
 * base, orm, emissive and normal slots; the token is the variant hash (or,
 * for `page-` names, the shared-surface-page content hash). Nothing
 * else in a Blendlink asset carries this shape, and an artist cannot author it
 * from Blender, so matching on it can never claim a hand-named texture. */
const GENERATED_CHANNEL_TEXTURE = /^(?:channel|page)-[0-9a-f]+-(?:base|orm|emissive|normal)$/

/** Merge compiler-generated channel textures whose payloads are byte-identical.
 *
 * The general `dedup` pass runs with `keepUniqueNames: true` and every texture
 * in a Blendlink asset has a unique name, so it merges none of them. That is
 * deliberate — the policy below `prune` refuses to "discard a named resource
 * that may be addressed by application code", and `TextureResizePolicy`
 * (:746) really does address textures by name and throws when one is missing.
 *
 * That rationale does not reach these names. They are minted by the bake from
 * a variant hash, they are not stable across a recompile, and no artist can
 * author one. The resize policy is also already resolved by this point, so a
 * name dropped here cannot break a lookup in the same run.
 *
 * Byte-identical is the whole test: same image bytes, same MIME type. Sampler
 * state is deliberately absent from the key because glTF-Transform models it
 * on `TextureInfo` — the per-slot binding — not on `Texture`, so every slot
 * keeps the wrap and filter it already had and merging cannot change how
 * anything samples. Two textures whose bytes differ are left alone even when
 * they render the same, because proving that is a different claim.
 */
function mergeGeneratedChannelTextures(document: Document) {
  const merges: Array<{ kept: string; dropped: string[] }> = []
  const groups = new Map<string, Texture[]>()
  for (const texture of document.getRoot().listTextures()) {
    const name = texture.getName()
    const image = texture.getImage()
    if (!image || !GENERATED_CHANNEL_TEXTURE.test(name)) continue
    if (!isEmptyObject(texture.getExtras())) continue
    const key = [
      createHash('sha256').update(image).digest('hex'),
      texture.getMimeType(),
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), texture])
  }

  let gpuBytesReclaimed = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // Deterministic survivor: the asset must not depend on listTextures order.
    const ordered = [...group].sort((a, b) => a.getName().localeCompare(b.getName()))
    const [kept, ...duplicates] = ordered
    for (const duplicate of duplicates) {
      const size = duplicate.getSize()
      if (size) gpuBytesReclaimed += Math.round(size[0] * size[1] * 4 * (4 / 3))
      // swap() repoints every referencing slot, including extension slots, so
      // no enumeration of material fields can fall behind the spec.
      for (const parent of duplicate.listParents()) {
        if (parent.propertyType === PropertyType.ROOT) continue
        parent.swap(duplicate, kept!)
      }
      duplicate.dispose()
    }
    merges.push({ kept: kept!.getName(), dropped: duplicates.map((entry) => entry.getName()) })
  }
  merges.sort((a, b) => a.kept.localeCompare(b.kept))
  return {
    textures: merges.reduce((sum, entry) => sum + entry.dropped.length, 0),
    gpuBytesReclaimed,
    merges,
  }
}

export interface TextureResizePolicy {
  name: string
  maxSize: number
}

export interface TextureTransformReport {
  name: string
  originalWidth: number
  originalHeight: number
  publishedWidth: number
  publishedHeight: number
  inputBytes: number
  outputBytes: number
  maxSize: number
}

export interface TextureResizeResult {
  transforms: TextureTransformReport[]
  warnings: string[]
}

const textureKey = (name: string) => name.toLowerCase().replace(/\.(?:png|jpe?g|webp|avif|ktx2)$/i, '')

/** Enforce artist-authored maximum dimensions before geometry compression.
 * Encoding stays in the source texture format; KTX2 is a separate semantic
 * policy because its color/normal decisions cannot be inferred from size. */
export async function resizeTextures(
  glbPath: string,
  policies: TextureResizePolicy[],
): Promise<TextureResizeResult> {
  if (policies.length === 0) return { transforms: [], warnings: [] }
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  const input = readFileSync(glbPath)
  const document = await io.readBinary(new Uint8Array(input))
  const textures = document.getRoot().listTextures()
  const transforms: TextureTransformReport[] = []
  const warnings: string[] = []
  let changed = false
  for (const policy of policies) {
    const texture = textures.find((candidate) => candidate.getName() === policy.name)
      ?? textures.find((candidate) => textureKey(candidate.getName()) === textureKey(policy.name))
    if (!texture) {
      warnings.push(
        `Texture size override for "${policy.name}" did not match an exported image; ` +
          `available: ${textures.map((entry) => entry.getName() || '(unnamed)').join(', ') || 'none'}.`,
      )
      continue
    }
    const image = texture.getImage()
    const mimeType = texture.getMimeType()
    if (!image || !mimeType) {
      warnings.push(`Texture "${policy.name}" has no embedded image bytes; maximum size was not applied.`)
      continue
    }
    const metadata = await sharp(image).metadata()
    const originalWidth = metadata.width ?? 0
    const originalHeight = metadata.height ?? 0
    if (!originalWidth || !originalHeight) {
      warnings.push(`Texture "${policy.name}" dimensions could not be decoded; maximum size was not applied.`)
      continue
    }
    let output: Uint8Array = new Uint8Array(image)
    if (Math.max(originalWidth, originalHeight) > policy.maxSize) {
      let pipeline = sharp(image).resize({
        width: policy.maxSize,
        height: policy.maxSize,
        fit: 'inside',
        withoutEnlargement: true,
      })
      if (mimeType === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 })
      else if (mimeType === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true })
      else if (mimeType === 'image/webp') pipeline = pipeline.webp({ quality: 90 })
      else {
        warnings.push(
          `Texture "${policy.name}" uses ${mimeType}; only PNG, JPEG, and WebP resizing is supported.`,
        )
        continue
      }
      output = new Uint8Array(await pipeline.toBuffer())
      texture.setImage(output)
      changed = true
    }
    const published = await sharp(output).metadata()
    transforms.push({
      name: texture.getName() || policy.name,
      originalWidth,
      originalHeight,
      publishedWidth: published.width ?? originalWidth,
      publishedHeight: published.height ?? originalHeight,
      inputBytes: image.byteLength,
      outputBytes: output.byteLength,
      maxSize: policy.maxSize,
    })
  }
  if (changed) {
    const output = await io.writeBinary(document)
    const staging = `${glbPath}.textures-${process.pid}`
    writeFileSync(staging, output)
    renameSync(staging, glbPath)
  }
  return { transforms, warnings }
}

/** Deterministic, scene-local geometry optimization. Preview and Final call
 * this same stage; only bake quality differs between those modes. */
export async function optimizeMeshopt(glbPath: string): Promise<OptimizationReport> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  const input = readFileSync(glbPath)
  const document = await io.readBinary(new Uint8Array(input))
  const beforeInspection = inspect(document)
  const beforeIdentity = captureSemanticIdentity(document)
  const beforeExtras = captureExtrasEvidence(document)
  const beforeTexcoords = captureTexcoordEvidence(document)
  const beforeAccessorMetadata = captureAccessorMetadata(document)
  const originalReferencedAccessors = listCoreReferencedAccessors(document)
  const skipped: string[] = []
  const hasPrimitiveRestart = document.hasExtension('KHR_mesh_primitive_restart')
  const refusePass = (reason: string): void => {
    skipped.push(reason)
    console.warn(`[blendlink optimizer] ${reason}`)
  }

  // Blender frequently bakes constrained animation at every frame. A zero
  // tolerance removes only keys reproduced exactly by the remaining curve.
  // Cleanup is intentionally disabled: its generic accessor de-duplication
  // does not account for accessor names or extras.
  const animationEvidence = captureAnimationEvidence(document)
  const animationKeysBefore = countAnimationKeys(document)
  const sharedSamplerConflict = document.getRoot().listAnimations().find((animation) =>
    [...targetPathsForAnimation(animation).values()].some((paths) => paths.size > 1))
  if (sharedSamplerConflict) {
    refusePass(
      `Animation resampling was skipped because "${sharedSamplerConflict.getName()}" shares a `
        + `sampler across different target paths; preserving the authored keys is safer.`,
    )
  } else {
    await document.transform(resample({ tolerance: 0, cleanup: false }))
    verifyResampledAnimations(animationEvidence, document)
  }
  const animationKeyframesRemoved = Math.max(0, animationKeysBefore - countAnimationKeys(document))

  // weld() is bit-identical, but we still attest the fully expanded render
  // stream before accepting its new indices. Empty or malformed primitives
  // are preserved instead of being disposed as an incidental cleanup step.
  let weldedVertices = 0
  const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())
  const invalidWeldPrimitive = primitives.find((primitive) =>
    !primitive.getAttribute('POSITION') || renderedIndices(primitive).length === 0)
  if (hasPrimitiveRestart) {
    refusePass('Vertex welding was skipped because KHR_mesh_primitive_restart is not supported by the weld transform.')
  } else if (invalidWeldPrimitive) {
    refusePass(
      `Vertex welding was skipped because primitive "${invalidWeldPrimitive.getName() || '(unnamed)'}" `
        + `has no renderable POSITION stream.`,
    )
  } else if (primitives.length > 0) {
    const geometryBeforeWeld = capturePrimitiveEvidence(document)
    const verticesBeforeWeld = countPrimitiveVertices(document)
    await document.transform(weld({ overwrite: true }))
    const geometryAfterWeld = capturePrimitiveEvidence(document)
    if (canonicalJson(geometryBeforeWeld) !== canonicalJson(geometryAfterWeld)) {
      throw new Error('Lossless weld verification changed the expanded primitive render stream.')
    }
    weldedVertices = Math.max(0, verticesBeforeWeld - countPrimitiveVertices(document))
  }

  // glTF-Transform's mesh key omits mesh weights and authored primitive
  // metadata, so meshes are deliberately not merged here. Accessors are
  // merged only when they carry neither names nor extras; Material.equals()
  // is metadata-aware, while image de-duplication is guarded against extras.
  const dedupTypes: PropertyType[] = []
  const root = document.getRoot()
  if (root.listAccessors().every((accessor) =>
    !accessor.getName() && isEmptyObject(accessor.getExtras()))) {
    dedupTypes.push(PropertyType.ACCESSOR)
  } else {
    refusePass('Accessor de-duplication was skipped because at least one accessor has an authored name or extras.')
  }
  if (root.listMaterials().every((material) => isEmptyObject(material.getExtras()))) {
    dedupTypes.push(PropertyType.MATERIAL)
  } else {
    refusePass('Material de-duplication was skipped because at least one material has authored extras.')
  }
  if (root.listTextures().every((texture) => isEmptyObject(texture.getExtras()))) {
    dedupTypes.push(PropertyType.TEXTURE)
  } else {
    refusePass('Texture de-duplication was skipped because at least one texture has authored extras.')
  }
  // Runs before the general pass and is accounted separately: this is the one
  // place Blendlink drops a resource name, and it must never be hidden inside
  // the dedup delta.
  const mergedGeneratedTextures = mergeGeneratedChannelTextures(document)
  const beforeDedup = resourceCounts(document)
  if (dedupTypes.length > 0) {
    await document.transform(dedup({ keepUniqueNames: true, propertyTypes: dedupTypes }))
  }
  const afterDedup = resourceCounts(document)
  const dedupDelta = subtractCounts(beforeDedup, afterDedup)

  // Exclude every TEXCOORD accessor from quantization. Baked atlas UVs remain
  // exact Float32 values; externally-authored integer UV formats remain exact
  // as authored. Meshopt compression itself is lossless for these streams.
  const animatedMeshNode = document.getRoot().listAnimations().flatMap((animation) => animation.listChannels())
    .map((channel) => channel.getTargetNode())
    .find((node) => node?.getMesh())
  const hierarchySensitiveMeshNode = document.getRoot().listNodes().find((node) =>
    node.getMesh() && (
      node.listChildren().length > 0
      || node.getSkin()
      || node.getCamera()
      || !isEmptyObject(node.getExtras())
      || node.listExtensions().length > 0
      || node.getMesh()!.listPrimitives().some((primitive) =>
        primitive.getMaterial()?.getExtension('KHR_materials_volume'))
    ))
  const positionQuantizationRisk = hierarchySensitiveMeshNode ?? animatedMeshNode
  if (positionQuantizationRisk && !hasPrimitiveRestart) {
    refusePass(
      `POSITION quantization was skipped because mesh node `
        + `"${positionQuantizationRisk.getName() || '(unnamed)'}" has authored metadata or another `
        + `transform-sensitive attachment; `
        + `quantizing it would replace an authored attachment or insert a correction child.`,
    )
  }
  const quantizedSemantics = positionQuantizationRisk
    ? /^(?!(?:POSITION|TEXCOORD(?:_\d+)?)$).*$/
    : /^(?!TEXCOORD(?:_\d+)?$).*$/
  if (hasPrimitiveRestart) {
    refusePass(
      'Vertex reordering and quantization were skipped because glTF-Transform does not support '
        + 'KHR_mesh_primitive_restart; raw buffer views will still receive lossless Meshopt compression.',
    )
  } else {
    await document.transform(
      reorder({ encoder: MeshoptEncoder, target: 'size', cleanup: false }),
      quantize({
        pattern: quantizedSemantics,
        patternTargets: quantizedSemantics,
        cleanup: false,
      }),
    )
  }
  restoreAccessorMetadata(document, beforeAccessorMetadata)

  // Reorder, weld, and quantize may replace accessors. Authored metadata has
  // now been restored to each replacement, so the superseded source can be
  // unprotected and removed without touching unrelated orphan data carrying
  // extras from an extension or another add-on.
  for (const accessor of originalReferencedAccessors) {
    const remainsReferenced = accessor.listParents().some((parent) => parent.propertyType !== PropertyType.ROOT)
    if (!remainsReferenced) accessor.setName('').setExtras({})
  }

  // Restrict pruning to unreachable resources. Never infer that an authored
  // vertex attribute is unused, flatten a solid texture, remove a node, or
  // discard a named resource that may be addressed by application code.
  const beforePrune = resourceCounts(document)
  const namedResourceExtras = protectNamedResourcesForPrune(document)
  await document.transform(prune({
    propertyTypes: [
      PropertyType.ACCESSOR,
      PropertyType.MATERIAL,
      PropertyType.TEXTURE,
      PropertyType.BUFFER,
    ],
    keepLeaves: true,
    keepAttributes: true,
    keepSolidTextures: true,
    keepExtras: true,
  }))
  for (const [property, extras] of namedResourceExtras) property.setExtras(extras)
  const afterPrune = resourceCounts(document)
  const pruned = subtractCounts(beforePrune, afterPrune)
  document.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const output = await io.writeBinary(document)

  // Decode what will actually ship and measure quantization against source.
  const decoded = await io.readBinary(output)
  const afterInspection = inspect(decoded)
  const afterIdentity = captureSemanticIdentity(decoded)
  if (afterIdentity !== beforeIdentity) {
    throw new Error(
      'Optimization verification changed stable node, scene, animation, or named-resource identity: '
        + describeStringDifference(beforeIdentity, afterIdentity),
    )
  }
  const afterExtras = captureExtrasEvidence(decoded)
  if (canonicalJson(afterExtras) !== canonicalJson(beforeExtras)) {
    throw new Error('Optimization verification changed authored extras, components, states, or probe metadata.')
  }
  const afterTexcoords = captureTexcoordEvidence(decoded)
  if (canonicalJson(afterTexcoords) !== canonicalJson(beforeTexcoords)) {
    throw new Error('Optimization verification changed rendered TEXCOORD values or their component format.')
  }
  let maxBoundsError = 0
  let boundsTolerance = 0
  const beforeScenes = beforeInspection.scenes.properties
  const afterScenes = afterInspection.scenes.properties
  if (beforeScenes.length === afterScenes.length) {
    for (let scene = 0; scene < beforeScenes.length; scene += 1) {
      const before = beforeScenes[scene]!
      const after = afterScenes[scene]!
      if (before.renderVertexCount !== after.renderVertexCount) {
        throw new Error(
          `Meshopt verification changed scene ${scene} rendered vertex count from ` +
            `${before.renderVertexCount} to ${after.renderVertexCount}.`,
        )
      }
      const bounds = verifySceneBounds(
        before.bboxMin, before.bboxMax, after.bboxMin, after.bboxMax, `scene ${scene}`,
      )
      maxBoundsError = Math.max(maxBoundsError, bounds.maxError)
      boundsTolerance = Math.max(boundsTolerance, bounds.tolerance)
    }
  } else {
    throw new Error(
      `Meshopt verification changed scene count from ${beforeScenes.length} ` +
        `to ${afterScenes.length}; refusing to publish the optimized GLB.`,
    )
  }

  // This is a focused glTF-Transform mesh inspection, not a claim of full
  // Khronos semantic validation. Decode + counts + bounds are the gate here.
  if (afterInspection.meshes.errors?.length) {
    throw new Error(`Meshopt verification failed: ${afterInspection.meshes.errors.join('; ')}`)
  }
  const staging = `${glbPath}.optimize-${process.pid}`
  writeFileSync(staging, output)
  renameSync(staging, glbPath)
  return {
    geometry: 'meshopt',
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    savedBytes: input.byteLength - output.byteLength,
    ratio: output.byteLength / Math.max(1, input.byteLength),
    maxBoundsError,
    boundsTolerance,
    passes: {
      animationKeyframesRemoved,
      weldedVertices,
      deduplicated: {
        accessors: dedupDelta.accessors,
        materials: dedupDelta.materials,
        textures: dedupDelta.textures,
      },
      mergedGeneratedTextures,
      pruned,
      skipped,
    },
  }
}
