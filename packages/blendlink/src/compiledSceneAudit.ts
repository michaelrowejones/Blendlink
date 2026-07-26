import { createHash } from 'node:crypto'
import {
  type Accessor,
  type Material,
  type Mesh,
  NodeIO,
  Primitive,
  type Scene,
} from '@gltf-transform/core'
import { ALL_EXTENSIONS, type InstancedMesh } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import {
  assertGltfRuntimeCompatibility,
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  readGlbJson,
} from './gltfRuntimeCompatibility.js'
import type { MaterialPortabilityDiagnostic } from './sceneDiagnostics.js'
import type { SceneManifest } from './typegen.js'

type RawRecord = Record<string, unknown>

interface RawGltf {
  scene?: unknown
  bufferViews?: unknown
  images?: unknown
  materials?: unknown
}

type MaterialDiagnosticRecord = Pick<
  MaterialPortabilityDiagnostic,
  'material' | 'status' | 'reasons' | 'cyclesAppearance'
>

export interface CompiledSceneMeshContributor {
  index: number
  name: string
  /** Default-scene nodes that render this mesh, sorted for stable output. */
  nodes: readonly string[]
  instances: number
  primitives: number
  triangles: number
  renderedTriangles: number
  /** Unique decoded accessors referenced by this mesh. An accessor shared by
   * another mesh appears in both contributors, but only once in the audit's
   * global decodedAccessorBytes total. */
  referencedDecodedAccessorBytes: number
  materials: readonly string[]
}

export interface CompiledMaterialPayloadEvidence {
  pbr: 'omitted' | 'defaults-only' | 'meaningful'
  textureSlots: readonly string[]
  emissive: 'omitted' | 'defaults-only' | 'meaningful'
  unlit: boolean
  extensions: readonly string[]
  meaningful: boolean
}

export interface CompiledMaterialBindingEvidence {
  index: number
  name: string
  primitiveDefinitions: number
  renderedPrimitiveInstances: number
  renderedTriangles: number
  diagnostic: MaterialDiagnosticRecord | null
  payload: CompiledMaterialPayloadEvidence
}

export interface MaterialPayloadCollapseFamily {
  reasons: readonly string[]
  materials: readonly string[]
  affectedTriangles: number
}

export interface MaterialPayloadCollapseEvidence {
  detected: boolean
  affectedTriangles: number
  totalRenderedTriangles: number
  dominantAffectedTriangles: number
  checks: {
    materialDiagnosticsPresent: boolean
    everyUsedMaterialNeedsBake: boolean
    allRenderedTrianglesAffected: boolean
    usedMaterialsLackMeaningfulPayload: boolean
  }
  /** Families share the exact same normalized Needs Bake reasons and are
   * ordered by affected triangle count, largest first. */
  families: readonly MaterialPayloadCollapseFamily[]
}

export interface CompiledMaterialPortabilityCoverage {
  diagnosticsPresent: boolean
  totalRenderedTriangles: number
  unboundRenderedTriangles: number
  usedMaterials: number
  diagnosedUsedMaterials: number
  needsBakeUsedMaterials: number
  needsBakeRenderedTriangles: number
  /** Needs Bake triangles whose compiled material still contains some
   * meaningful glTF payload. This is not visual-parity proof; it only
   * distinguishes review-required output from complete payload collapse. */
  needsBakeMeaningfulPayloadTriangles: number
  cyclesAppearanceBlockedUsedMaterials: number
}

export interface CompiledSceneAudit {
  glb: {
    bytes: number
    /** Complete SHA-256. The manifest stores its first sixteen hex digits. */
    sha256: string
    manifestHash: string
  }
  counts: {
    meshes: number
    materials: number
    primitives: number
    /** Draw-capable primitive instances reachable from the GLB's default
     * scene. Unlike renderedTriangles, this includes valid point and line
     * primitives. */
    renderedPrimitiveInstances: number
    renderedTriangles: number
    decodedAccessors: number
    /** Exact typed-array bytes for every accessor after required Meshopt
     * streams are decoded, including animation, skin, instancing, and mesh
     * accessors. */
    decodedAccessorBytes: number
    decodedGeometryAccessors: number
    /** Unique accessors referenced by mesh primitives, including morph
     * targets. Animation, skin, and instance-transform accessors are excluded. */
    decodedGeometryAccessorBytes: number
    embeddedImages: number
    embeddedImageBytes: number
  }
  /** All meshes ordered by referenced decoded bytes, then triangles. */
  meshContributors: readonly CompiledSceneMeshContributor[]
  materialBindings: readonly CompiledMaterialBindingEvidence[]
  materialPortability: CompiledMaterialPortabilityCoverage
  materialPayloadCollapse: MaterialPayloadCollapseEvidence
}

export interface AuditCompiledSceneArtifactInput {
  manifest: SceneManifest
  glbBytes: Uint8Array
}

/**
 * Decode and audit one exact compiled scene artifact. File-system discovery,
 * CLI formatting, and budget policy stay outside this seam; callers and tests
 * supply the same manifest and bytes that a website would publish.
 */
export async function auditCompiledSceneArtifact(
  input: AuditCompiledSceneArtifactInput,
): Promise<CompiledSceneAudit> {
  const { manifest, glbBytes } = input
  if (!(glbBytes instanceof Uint8Array)) {
    throw new Error('Compiled scene audit requires GLB bytes as a Uint8Array.')
  }
  if (!/^[0-9a-f]{16}$/.test(manifest.hash)) {
    throw new Error(
      `Compiled scene manifest hash must be the first 16 lowercase SHA-256 hex digits; received ${String(manifest.hash)}.`,
    )
  }
  if (!Number.isSafeInteger(manifest.stats?.bytes) || manifest.stats.bytes < 0) {
    throw new Error('Compiled scene manifest stats.bytes must be a non-negative safe integer.')
  }
  if (manifest.stats.bytes !== glbBytes.byteLength) {
    throw new Error(
      `Compiled scene byte count does not match the manifest: expected ${manifest.stats.bytes}, received ${glbBytes.byteLength}.`,
    )
  }

  const sha256 = createHash('sha256').update(glbBytes).digest('hex')
  if (sha256.slice(0, 16) !== manifest.hash) {
    throw new Error(
      `Compiled scene SHA-256 does not match the manifest: expected ${manifest.hash}, received ${sha256.slice(0, 16)}.`,
    )
  }

  const raw = readGlbJson(glbBytes, 'Compiled scene') as RawGltf
  assertGltfRuntimeCompatibility(raw, BLENDLINK_THREE_R184_COMPILED_PROFILE)
  await MeshoptDecoder.ready
  const document = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(glbBytes)
  const root = document.getRoot()
  const meshes = root.listMeshes()
  const materials = root.listMaterials()
  const rawMaterials = rawArray(raw.materials, 'materials')
  if (rawMaterials.length !== materials.length) {
    throw new Error(
      `Compiled scene material evidence drifted while decoding: raw GLB has ${rawMaterials.length}, decoder has ${materials.length}.`,
    )
  }

  const decodedAccessors = root.listAccessors()
  const decodedAccessorBytes = sumAccessorBytes(decodedAccessors, 'compiled scene')
  const embeddedImages = embeddedImageEvidence(raw)
  const usage = renderedMeshUsage(meshes, document.getRoot().listScenes(), raw.scene)
  const materialIndex = new Map<Material, number>(materials.map((material, index) => [material, index]))
  const materialDiagnostics = readMaterialDiagnostics(manifest)
  const materialDiagnosticByName = unambiguousDiagnosticsByName(materialDiagnostics, materials)
  const bindingCounters = materials.map(() => ({
    primitiveDefinitions: 0,
    renderedPrimitiveInstances: 0,
    renderedTriangles: 0,
  }))
  let primitives = 0
  let renderedPrimitiveInstances = 0
  let totalRenderedTriangles = 0
  let unboundRenderedTriangles = 0
  const geometryAccessors = new Set<Accessor>()

  const meshContributors = meshes.map((mesh, index): CompiledSceneMeshContributor => {
    const meshUsage = usage.get(mesh)
    const meshInstances = meshUsage?.instances ?? 0
    const accessors = new Set<Accessor>()
    const materialNames = new Set<string>()
    let triangles = 0
    const meshPrimitives = mesh.listPrimitives()
    primitives += meshPrimitives.length
    for (const primitive of meshPrimitives) {
      collectPrimitiveAccessors(primitive, accessors)
      const primitiveInstances = primitiveHasRenderableElements(primitive)
        ? meshInstances
        : 0
      renderedPrimitiveInstances = safeAdd(
        renderedPrimitiveInstances,
        primitiveInstances,
        'compiled scene rendered primitive instances',
      )
      const primitiveTriangles = triangleCount(primitive)
      triangles = safeAdd(triangles, primitiveTriangles, `triangle count for mesh ${meshLabel(mesh, index)}`)
      const renderedTriangles = safeMultiply(
        primitiveTriangles,
        meshInstances,
        `rendered triangle count for mesh ${meshLabel(mesh, index)}`,
      )
      totalRenderedTriangles = safeAdd(
        totalRenderedTriangles,
        renderedTriangles,
        'compiled scene rendered triangle count',
      )
      const material = primitive.getMaterial()
      if (material === null) {
        unboundRenderedTriangles = safeAdd(
          unboundRenderedTriangles,
          renderedTriangles,
          'unbound rendered triangle count',
        )
        continue
      }
      const materialPosition = materialIndex.get(material)
      if (materialPosition === undefined) {
        throw new Error(`Compiled scene primitive refers to a material missing from the decoded root.`)
      }
      const counter = bindingCounters[materialPosition]!
      counter.primitiveDefinitions = safeAdd(
        counter.primitiveDefinitions,
        1,
        `primitive bindings for material ${materialLabel(material, materialPosition)}`,
      )
      counter.renderedPrimitiveInstances = safeAdd(
        counter.renderedPrimitiveInstances,
        primitiveInstances,
        `rendered primitive bindings for material ${materialLabel(material, materialPosition)}`,
      )
      counter.renderedTriangles = safeAdd(
        counter.renderedTriangles,
        renderedTriangles,
        `rendered triangles for material ${materialLabel(material, materialPosition)}`,
      )
      materialNames.add(materialLabel(material, materialPosition))
    }
    for (const accessor of accessors) geometryAccessors.add(accessor)
    return {
      index,
      name: meshLabel(mesh, index),
      nodes: Object.freeze([...(meshUsage?.nodes ?? [])].sort()),
      instances: meshInstances,
      primitives: meshPrimitives.length,
      triangles,
      renderedTriangles: safeMultiply(
        triangles,
        meshInstances,
        `rendered triangle count for mesh ${meshLabel(mesh, index)}`,
      ),
      referencedDecodedAccessorBytes: sumAccessorBytes(
        accessors,
        `mesh ${meshLabel(mesh, index)}`,
      ),
      materials: Object.freeze([...materialNames].sort()),
    }
  }).sort((left, right) =>
    right.referencedDecodedAccessorBytes - left.referencedDecodedAccessorBytes
      || right.triangles - left.triangles
      || left.index - right.index,
  )

  if (renderedPrimitiveInstances === 0) {
    throw new Error(
      'Compiled scene artifact has no renderable mesh primitives in its default scene. ' +
      'Cameras, lights, Worlds, and helper/library data do not create visible Three.js geometry. ' +
      'Make at least one mesh with non-empty evaluated geometry render-visible in the exported ' +
      'Scene or Collection (and not excluded by -noimp), then rebuild. If this .blend is ' +
      'intentionally a helper or asset library, inspect it with `blendlink plan` instead of publishing it.',
    )
  }

  const materialBindings = materials.map((material, index): CompiledMaterialBindingEvidence => {
    const name = materialLabel(material, index)
    const counter = bindingCounters[index]!
    return {
      index,
      name,
      ...counter,
      diagnostic: materialDiagnosticByName.get(name) ?? null,
      payload: inspectRawMaterial(rawMaterials[index], index),
    }
  })
  const materialPayloadCollapse = classifyMaterialPayloadCollapse({
    materialBindings,
    diagnosticsPresent: materialDiagnostics !== null,
    totalRenderedTriangles,
    unboundRenderedTriangles,
  })
  const materialPortability = summarizeMaterialPortability({
    materialBindings,
    diagnosticsPresent: materialDiagnostics !== null,
    totalRenderedTriangles,
    unboundRenderedTriangles,
  })

  return {
    glb: {
      bytes: glbBytes.byteLength,
      sha256,
      manifestHash: manifest.hash,
    },
    counts: {
      meshes: meshes.length,
      materials: materials.length,
      primitives,
      renderedPrimitiveInstances,
      renderedTriangles: totalRenderedTriangles,
      decodedAccessors: decodedAccessors.length,
      decodedAccessorBytes,
      decodedGeometryAccessors: geometryAccessors.size,
      decodedGeometryAccessorBytes: sumAccessorBytes(
        geometryAccessors, 'compiled scene geometry',
      ),
      embeddedImages: embeddedImages.count,
      embeddedImageBytes: embeddedImages.bytes,
    },
    meshContributors: Object.freeze(meshContributors),
    materialBindings: Object.freeze(materialBindings),
    materialPortability,
    materialPayloadCollapse,
  }
}

function rawArray(value: unknown, label: string): RawRecord[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`Compiled scene GLB ${label} must be an array of objects.`)
  }
  return value as RawRecord[]
}

function embeddedImageEvidence(raw: RawGltf): { count: number; bytes: number } {
  const images = rawArray(raw.images, 'images')
  const views = rawArray(raw.bufferViews, 'bufferViews')
  let count = 0
  let bytes = 0
  for (const [index, image] of images.entries()) {
    if (image.bufferView !== undefined) {
      if (!Number.isSafeInteger(image.bufferView) || (image.bufferView as number) < 0) {
        throw new Error(`Compiled scene image ${index} has an invalid bufferView.`)
      }
      const bufferView = views[image.bufferView as number]
      if (!bufferView || !Number.isSafeInteger(bufferView.byteLength)
          || (bufferView.byteLength as number) < 0) {
        throw new Error(`Compiled scene image ${index} refers to an invalid bufferView.`)
      }
      count += 1
      bytes = safeAdd(bytes, bufferView.byteLength as number, 'embedded image bytes')
      continue
    }
    if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
      count += 1
      bytes = safeAdd(bytes, dataUriBytes(image.uri, index), 'embedded image bytes')
    }
  }
  return { count, bytes }
}

function dataUriBytes(uri: string, imageIndex: number): number {
  const comma = uri.indexOf(',')
  if (comma < 0) throw new Error(`Compiled scene image ${imageIndex} has an invalid data URI.`)
  const metadata = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  try {
    return metadata.endsWith(';base64')
      ? Buffer.from(payload, 'base64').byteLength
      : new TextEncoder().encode(decodeURIComponent(payload)).byteLength
  } catch (error) {
    throw new Error(`Compiled scene image ${imageIndex} data URI is invalid: ${errorMessage(error)}`)
  }
}

interface MutableRenderedMeshUsage {
  instances: number
  nodes: Set<string>
}

function renderedMeshUsage(
  meshes: readonly Mesh[],
  scenes: readonly Scene[],
  rawScene: unknown,
): Map<Mesh, MutableRenderedMeshUsage> {
  const result = new Map<Mesh, MutableRenderedMeshUsage>(meshes.map((mesh) => [
    mesh,
    { instances: 0, nodes: new Set<string>() },
  ]))
  if (scenes.length === 0) return result
  const sceneIndex = rawScene === undefined ? 0 : rawScene
  if (!Number.isSafeInteger(sceneIndex) || (sceneIndex as number) < 0
      || (sceneIndex as number) >= scenes.length) {
    throw new Error(`Compiled scene GLB declares an invalid default scene index: ${String(rawScene)}.`)
  }
  scenes[sceneIndex as number]!.traverse((node) => {
    const mesh = node.getMesh()
    if (mesh === null) return
    if (!result.has(mesh)) {
      throw new Error('Compiled scene node refers to a mesh missing from the decoded root.')
    }
    const instancing = node.getExtension<InstancedMesh>('EXT_mesh_gpu_instancing')
    let nodeInstances = 1
    if (instancing !== null) {
      const attributes = instancing.listAttributes()
      if (attributes.length === 0) {
        throw new Error(`Compiled scene node ${node.getName() || '<unnamed>'} has empty GPU instancing data.`)
      }
      nodeInstances = attributes[0]!.getCount()
      if (attributes.some((attribute) => attribute.getCount() !== nodeInstances)) {
        throw new Error(
          `Compiled scene node ${node.getName() || '<unnamed>'} has inconsistent GPU instance attribute counts.`,
        )
      }
    }
    const meshUsage = result.get(mesh)!
    meshUsage.instances = safeAdd(
      meshUsage.instances,
      nodeInstances,
      `instances of mesh ${mesh.getName() || '<unnamed>'}`,
    )
    meshUsage.nodes.add(node.getName() || '<unnamed>')
  })
  return result
}

function collectPrimitiveAccessors(
  primitive: ReturnType<Mesh['listPrimitives']>[number],
  output: Set<Accessor>,
): void {
  for (const accessor of primitive.listAttributes()) output.add(accessor)
  const indices = primitive.getIndices()
  if (indices !== null) output.add(indices)
  for (const target of primitive.listTargets()) {
    for (const accessor of target.listAttributes()) output.add(accessor)
  }
}

function sumAccessorBytes(accessors: Iterable<Accessor>, label: string): number {
  let total = 0
  const unique = new Set(accessors)
  for (const accessor of unique) {
    const array = accessor.getArray()
    if (array === null) {
      throw new Error(`Decoded accessor ${accessor.getName() || '<unnamed>'} in ${label} has no array.`)
    }
    total = safeAdd(total, array.byteLength, `decoded accessor bytes for ${label}`)
  }
  return total
}

function triangleCount(primitive: ReturnType<Mesh['listPrimitives']>[number]): number {
  const elements = primitive.getIndices()?.getCount()
    ?? primitive.getAttribute('POSITION')?.getCount()
    ?? 0
  switch (primitive.getMode()) {
    case Primitive.Mode.TRIANGLES: return Math.floor(elements / 3)
    case Primitive.Mode.TRIANGLE_STRIP:
    case Primitive.Mode.TRIANGLE_FAN: return Math.max(0, elements - 2)
    default: return 0
  }
}

/** A published scene needs at least one draw-capable primitive in its default
 * scene. Triangle totals are insufficient evidence because glTF points and
 * lines are valid visible content. Conversely, merely defining a mesh is not
 * enough when it is unreachable from the default scene or has no elements. */
function primitiveHasRenderableElements(
  primitive: ReturnType<Mesh['listPrimitives']>[number],
): boolean {
  const position = primitive.getAttribute('POSITION')
  if (position === null || position.getCount() === 0) return false
  const elements = primitive.getIndices()?.getCount() ?? position.getCount()
  switch (primitive.getMode()) {
    case Primitive.Mode.POINTS: return elements >= 1
    case Primitive.Mode.LINES:
    case Primitive.Mode.LINE_LOOP:
    case Primitive.Mode.LINE_STRIP: return elements >= 2
    case Primitive.Mode.TRIANGLES:
    case Primitive.Mode.TRIANGLE_STRIP:
    case Primitive.Mode.TRIANGLE_FAN: return elements >= 3
    default: return false
  }
}

function readMaterialDiagnostics(manifest: SceneManifest): MaterialDiagnosticRecord[] | null {
  const candidate = (manifest.sceneDiagnostics as unknown as { materials?: unknown } | undefined)
    ?.materials
  if (candidate === undefined) return null
  if (!isRecord(candidate) || !Array.isArray(candidate.records)) {
    throw new Error('Compiled scene material diagnostics must contain a records array when present.')
  }
  return candidate.records.map((entry, index): MaterialDiagnosticRecord => {
    if (!isRecord(entry) || typeof entry.material !== 'string'
        || (entry.status !== 'exact' && entry.status !== 'approximated' && entry.status !== 'needsBake')
        || !Array.isArray(entry.reasons)
        || entry.reasons.some((reason) => typeof reason !== 'string')) {
      throw new Error(`Compiled scene material diagnostic ${index} is malformed.`)
    }
    const cyclesAppearance = entry.cyclesAppearance
    if (cyclesAppearance !== undefined
        && (!isRecord(cyclesAppearance)
          || (cyclesAppearance.status !== 'compatible' && cyclesAppearance.status !== 'blocked')
          || !Array.isArray(cyclesAppearance.blockers)
          || cyclesAppearance.blockers.some((blocker) => typeof blocker !== 'string'))) {
      throw new Error(`Compiled scene material diagnostic ${index} has malformed Cycles Appearance evidence.`)
    }
    return {
      material: entry.material,
      status: entry.status,
      reasons: [...new Set(entry.reasons as string[])],
      ...(cyclesAppearance
        ? {
            cyclesAppearance: {
              status: cyclesAppearance.status as 'compatible' | 'blocked',
              blockers: [...new Set(cyclesAppearance.blockers as string[])],
            },
          }
        : {}),
    }
  })
}

function summarizeMaterialPortability(input: {
  materialBindings: readonly CompiledMaterialBindingEvidence[]
  diagnosticsPresent: boolean
  totalRenderedTriangles: number
  unboundRenderedTriangles: number
}): CompiledMaterialPortabilityCoverage {
  const used = input.materialBindings.filter((binding) => binding.renderedTriangles > 0)
  const diagnosed = used.filter((binding) => binding.diagnostic !== null)
  const needsBake = diagnosed.filter((binding) => binding.diagnostic?.status === 'needsBake')
  return {
    diagnosticsPresent: input.diagnosticsPresent,
    totalRenderedTriangles: input.totalRenderedTriangles,
    unboundRenderedTriangles: input.unboundRenderedTriangles,
    usedMaterials: used.length,
    diagnosedUsedMaterials: diagnosed.length,
    needsBakeUsedMaterials: needsBake.length,
    needsBakeRenderedTriangles: needsBake.reduce(
      (sum, binding) => safeAdd(sum, binding.renderedTriangles, 'Needs Bake rendered triangles'),
      0,
    ),
    needsBakeMeaningfulPayloadTriangles: needsBake.reduce(
      (sum, binding) => binding.payload.meaningful
        ? safeAdd(sum, binding.renderedTriangles, 'Needs Bake meaningful-payload triangles')
        : sum,
      0,
    ),
    cyclesAppearanceBlockedUsedMaterials: diagnosed.filter(
      (binding) => binding.diagnostic?.cyclesAppearance?.status === 'blocked',
    ).length,
  }
}

function unambiguousDiagnosticsByName(
  diagnostics: readonly MaterialDiagnosticRecord[] | null,
  materials: readonly Material[],
): Map<string, MaterialDiagnosticRecord> {
  const result = new Map<string, MaterialDiagnosticRecord>()
  if (diagnostics === null) return result
  const ambiguous = new Set<string>()
  const exportedNameCounts = new Map<string, number>()
  materials.forEach((material, index) => {
    const name = materialLabel(material, index)
    exportedNameCounts.set(name, (exportedNameCounts.get(name) ?? 0) + 1)
  })
  for (const diagnostic of diagnostics) {
    if ((exportedNameCounts.get(diagnostic.material) ?? 0) !== 1) {
      ambiguous.add(diagnostic.material)
    } else if (result.has(diagnostic.material)) {
      result.delete(diagnostic.material)
      ambiguous.add(diagnostic.material)
    } else if (!ambiguous.has(diagnostic.material)) {
      result.set(diagnostic.material, diagnostic)
    }
  }
  return result
}

function inspectRawMaterial(value: RawRecord | undefined, index: number): CompiledMaterialPayloadEvidence {
  if (value === undefined) throw new Error(`Compiled scene material ${index} is missing from raw JSON.`)
  const pbrValue = value.pbrMetallicRoughness
  if (pbrValue !== undefined && !isRecord(pbrValue)) {
    throw new Error(`Compiled scene material ${index} has invalid pbrMetallicRoughness data.`)
  }
  const pbr = pbrValue as RawRecord | undefined
  const textureSlots: string[] = []
  if (isRecord(pbr?.baseColorTexture)) textureSlots.push('baseColor')
  else if (pbr?.baseColorTexture !== undefined) invalidMaterialField(index, 'baseColorTexture')
  if (isRecord(pbr?.metallicRoughnessTexture)) textureSlots.push('metallicRoughness')
  else if (pbr?.metallicRoughnessTexture !== undefined) invalidMaterialField(index, 'metallicRoughnessTexture')
  for (const [field, label] of [
    ['normalTexture', 'normal'],
    ['occlusionTexture', 'occlusion'],
    ['emissiveTexture', 'emissive'],
  ] as const) {
    if (isRecord(value[field])) textureSlots.push(label)
    else if (value[field] !== undefined) invalidMaterialField(index, field)
  }

  const pbrMeaningful = textureSlots.includes('baseColor')
    || textureSlots.includes('metallicRoughness')
    || nonDefaultNumber(pbr?.metallicFactor, 1, index, 'metallicFactor')
    || nonDefaultNumber(pbr?.roughnessFactor, 1, index, 'roughnessFactor')
    || nonDefaultVector(pbr?.baseColorFactor, [1, 1, 1, 1], index, 'baseColorFactor')
  const pbrState = pbr === undefined ? 'omitted' : pbrMeaningful ? 'meaningful' : 'defaults-only'

  const emissivePresent = value.emissiveFactor !== undefined
  const emissiveMeaningful = textureSlots.includes('emissive')
    || nonDefaultVector(value.emissiveFactor, [0, 0, 0], index, 'emissiveFactor')
  const emissiveState = !emissivePresent && !textureSlots.includes('emissive')
    ? 'omitted'
    : emissiveMeaningful ? 'meaningful' : 'defaults-only'

  if (value.extensions !== undefined && !isRecord(value.extensions)) {
    throw new Error(`Compiled scene material ${index} has invalid extension data.`)
  }
  const extensions = Object.keys((value.extensions as RawRecord | undefined) ?? {}).sort()
  const unlit = extensions.includes('KHR_materials_unlit')
  return {
    pbr: pbrState,
    textureSlots: Object.freeze(textureSlots),
    emissive: emissiveState,
    unlit,
    extensions: Object.freeze(extensions),
    meaningful: pbrMeaningful
      || textureSlots.length > 0
      || emissiveMeaningful
      || extensions.length > 0,
  }
}

function invalidMaterialField(index: number, field: string): never {
  throw new Error(`Compiled scene material ${index} has invalid ${field} data.`)
}

function nonDefaultNumber(
  value: unknown,
  defaultValue: number,
  materialIndex: number,
  field: string,
): boolean {
  if (value === undefined) return false
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidMaterialField(materialIndex, field)
  return value !== defaultValue
}

function nonDefaultVector(
  value: unknown,
  defaultValue: readonly number[],
  materialIndex: number,
  field: string,
): boolean {
  if (value === undefined) return false
  if (!Array.isArray(value) || value.length !== defaultValue.length
      || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    invalidMaterialField(materialIndex, field)
  }
  return value.some((entry, index) => entry !== defaultValue[index])
}

function classifyMaterialPayloadCollapse(input: {
  materialBindings: readonly CompiledMaterialBindingEvidence[]
  diagnosticsPresent: boolean
  totalRenderedTriangles: number
  unboundRenderedTriangles: number
}): MaterialPayloadCollapseEvidence {
  const used = input.materialBindings.filter((binding) => binding.renderedTriangles > 0)
  const everyUsedMaterialNeedsBake = used.length > 0
    && used.every((binding) => binding.diagnostic?.status === 'needsBake')
  const affectedTriangles = used.reduce(
    (sum, binding) => binding.diagnostic?.status === 'needsBake'
      ? safeAdd(sum, binding.renderedTriangles, 'Needs Bake affected triangles')
      : sum,
    0,
  )
  const allRenderedTrianglesAffected = input.totalRenderedTriangles > 0
    && input.unboundRenderedTriangles === 0
    && affectedTriangles === input.totalRenderedTriangles
  const usedMaterialsLackMeaningfulPayload = used.length > 0
    && used.every((binding) => !binding.payload.meaningful)
  const families = collapseFamilies(used)
  const detected = input.diagnosticsPresent
    && everyUsedMaterialNeedsBake
    && allRenderedTrianglesAffected
    && usedMaterialsLackMeaningfulPayload
  return {
    detected,
    affectedTriangles,
    totalRenderedTriangles: input.totalRenderedTriangles,
    dominantAffectedTriangles: families[0]?.affectedTriangles ?? 0,
    checks: {
      materialDiagnosticsPresent: input.diagnosticsPresent,
      everyUsedMaterialNeedsBake,
      allRenderedTrianglesAffected,
      usedMaterialsLackMeaningfulPayload,
    },
    families: Object.freeze(families),
  }
}

function collapseFamilies(
  bindings: readonly CompiledMaterialBindingEvidence[],
): MaterialPayloadCollapseFamily[] {
  const groups = new Map<string, {
    reasons: string[]
    materials: string[]
    affectedTriangles: number
  }>()
  for (const binding of bindings) {
    if (binding.diagnostic?.status !== 'needsBake') continue
    const reasons = [...new Set(binding.diagnostic.reasons)].sort()
    const key = JSON.stringify(reasons)
    const group = groups.get(key) ?? { reasons, materials: [], affectedTriangles: 0 }
    group.materials.push(binding.name)
    group.affectedTriangles = safeAdd(
      group.affectedTriangles,
      binding.renderedTriangles,
      'material-collapse family triangles',
    )
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      reasons: Object.freeze(group.reasons),
      materials: Object.freeze(group.materials.sort()),
      affectedTriangles: group.affectedTriangles,
    }))
    .sort((left, right) => right.affectedTriangles - left.affectedTriangles
      || left.materials.join('\0').localeCompare(right.materials.join('\0')))
}

function meshLabel(mesh: Mesh, index: number): string {
  return mesh.getName() || `<mesh ${index}>`
}

function materialLabel(material: Material, index: number): string {
  return material.getName() || `<material ${index}>`
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0
      || !Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeds JavaScript's non-negative safe integer range.`)
  }
  return result
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0
      || !Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeds JavaScript's non-negative safe integer range.`)
  }
  return result
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
