import * as THREE from 'three'

const HASH_PATTERN = /^[0-9a-f]{64}$/
const MATRIX_EPSILON = 1e-5
const ASPECT_EPSILON = 1e-6
const RECEIVER_ID = 'blendlink_id'
const SOURCE_MATERIAL_ID = 'blendlink_source_material_id'

export interface ThreeFixedCameraAppearanceContract {
  schemaVersion: 1
  /** Hash of the exact GLB whose retained geometry receives this capture. */
  sceneHash: string
  /** Hash of the complete compiler input closure, including the source .blend. */
  sourceHash: string
  /** Blender timeline frame evaluated by the authoritative Eevee capture. */
  frame: number
  capture: {
    hash: string
    width: number
    height: number
    aspect: number
    /** Display-referred sRGB; the projected material bypasses site tone mapping. */
    colorSpace: 'srgb-display'
  }
  camera: {
    objectId: string
    matrixWorld: number[]
    projectionMatrix: number[]
  }
  /** Explicit selected bindings. Complete-scene replacement is refused. */
  surfaces: Array<{
    receiverId: string
    sourceMaterialId: string
    /** Final glTF primitive/material binding count, attested after transforms. */
    primitiveCount: number
  }>
}

export interface ThreeFixedCameraAppearanceEvidence {
  sceneHash: string
  sourceHash: string
  captureHash: string
  frame: number
}

export interface InstallThreeFixedCameraAppearanceOptions {
  root: THREE.Object3D
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  /** Already-loaded application/private-manager asset. Ownership stays with the caller. */
  texture: THREE.Texture
  contract: ThreeFixedCameraAppearanceContract
  evidence: ThreeFixedCameraAppearanceEvidence
  viewport: Readonly<{ width: number; height: number }>
}

export interface ThreeFixedCameraAppearanceHandle {
  readonly bindingCount: number
  readonly materialCount: number
  /** Call before a host-controlled resize or render outside the standard Three callback. */
  assertCompatible(viewport: Readonly<{ width: number; height: number }>): void
  dispose(): void
}

interface PlannedBinding {
  mesh: THREE.Mesh
  slot: number
  source: THREE.Material
}

interface InstalledMeshMaterials {
  mesh: THREE.Mesh
  bindings: Array<PlannedBinding & { projected: THREE.MeshBasicMaterial }>
}

interface InstalledRenderGuard {
  mesh: THREE.Mesh
  original: THREE.Object3D['onBeforeRender']
  installed: THREE.Object3D['onBeforeRender']
}

/**
 * Install a bounded display-referred capture on selected retained geometry.
 *
 * This module deliberately does not load URLs, mutate the renderer, infer
 * surfaces from names, or accept a whole-scene beauty plate. The compiler must
 * first attest stable receiver/material IDs, source and artifact hashes, the
 * authored camera matrices, frame, and final primitive count.
 */
export function installThreeFixedCameraAppearance(
  options: InstallThreeFixedCameraAppearanceOptions,
): ThreeFixedCameraAppearanceHandle {
  validateContract(options)
  const plan = planBindings(options.root, options.contract)
  const allBindingCount = countRenderableMaterialBindings(options.root)
  if (plan.length >= allBindingCount) {
    throw new Error(
      'Fixed Camera Appearance would replace the complete scene. This surface-scoped ' +
        'transport requires at least one unrelated realtime or portable material binding; ' +
        'use an explicit application-owned plate for a complete-frame fallback.',
    )
  }

  const captureTexture = options.texture.clone()
  captureTexture.name = `${options.texture.name || 'Eevee capture'}.BLENDLINK_FIXED_CAMERA`
  captureTexture.colorSpace = THREE.SRGBColorSpace
  captureTexture.wrapS = THREE.ClampToEdgeWrapping
  captureTexture.wrapT = THREE.ClampToEdgeWrapping
  captureTexture.minFilter = THREE.LinearFilter
  captureTexture.magFilter = THREE.LinearFilter
  captureTexture.generateMipmaps = false
  captureTexture.needsUpdate = true

  const authoredProjector = projectorFromContract(options.contract)
  const materialBySource = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  try {
    for (const binding of plan) {
      if (!materialBySource.has(binding.source)) {
        materialBySource.set(
          binding.source,
          createProjectedMaterial(binding.source, captureTexture, authoredProjector),
        )
      }
    }
  } catch (error) {
    for (const material of materialBySource.values()) material.dispose()
    captureTexture.dispose()
    throw error
  }

  const installedMeshes = installMaterials(plan, materialBySource)
  const renderGuards = installRenderGuards(
    installedMeshes.map((entry) => entry.mesh),
    options,
  )
  let disposed = false

  return Object.freeze({
    bindingCount: plan.length,
    materialCount: materialBySource.size,
    assertCompatible(viewport: Readonly<{ width: number; height: number }>) {
      if (disposed) {
        throw new Error('Fixed Camera Appearance has already been disposed.')
      }
      assertCameraAndViewport(options.camera, viewport, options.contract)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const guard of renderGuards) {
        if (guard.mesh.onBeforeRender === guard.installed) {
          guard.mesh.onBeforeRender = guard.original
        }
      }
      restoreMaterials(installedMeshes)
      for (const material of materialBySource.values()) material.dispose()
      captureTexture.dispose()
    },
  })
}

function validateContract(options: InstallThreeFixedCameraAppearanceOptions): void {
  const { contract, evidence, texture, camera, viewport } = options
  if (contract.schemaVersion !== 1) {
    throw new Error(
      `Fixed Camera Appearance contract schema ${String(contract.schemaVersion)} is unsupported; expected 1.`,
    )
  }
  validateHash(contract.sceneHash, 'scene hash')
  validateHash(contract.sourceHash, 'source hash')
  validateHash(contract.capture.hash, 'capture hash')
  validateHash(evidence.sceneHash, 'loaded scene hash')
  validateHash(evidence.sourceHash, 'loaded source hash')
  validateHash(evidence.captureHash, 'loaded capture hash')
  if (contract.sceneHash !== evidence.sceneHash) {
    throw new Error('Fixed Camera Appearance scene hash does not match the loaded GLB.')
  }
  if (contract.sourceHash !== evidence.sourceHash) {
    throw new Error('Fixed Camera Appearance source hash does not match the compiled input closure.')
  }
  if (contract.capture.hash !== evidence.captureHash) {
    throw new Error('Fixed Camera Appearance capture hash does not match the loaded image bytes.')
  }
  if (!Number.isInteger(contract.frame) || !Number.isInteger(evidence.frame)
      || contract.frame !== evidence.frame) {
    throw new Error(
      `Fixed Camera Appearance capture frame ${String(contract.frame)} does not match ` +
        `the compiled frame ${String(evidence.frame)}.`,
    )
  }
  if (!positiveInteger(contract.capture.width) || !positiveInteger(contract.capture.height)) {
    throw new Error('Fixed Camera Appearance capture dimensions must be positive integers.')
  }
  const encodedAspect = contract.capture.width / contract.capture.height
  if (!positiveFinite(contract.capture.aspect)
      || !approximately(contract.capture.aspect, encodedAspect, ASPECT_EPSILON)) {
    throw new Error(
      `Fixed Camera Appearance capture aspect ${String(contract.capture.aspect)} does not ` +
        `match its ${contract.capture.width}x${contract.capture.height} image.`,
    )
  }
  if (contract.capture.colorSpace !== 'srgb-display') {
    throw new Error('Fixed Camera Appearance requires an attested display-referred sRGB capture.')
  }
  const image = texture.image as { width?: unknown; height?: unknown } | null | undefined
  if (image?.width !== contract.capture.width || image?.height !== contract.capture.height) {
    throw new Error(
      `Fixed Camera Appearance loaded texture dimensions ${String(image?.width)}x` +
        `${String(image?.height)} do not match the attested ` +
        `${contract.capture.width}x${contract.capture.height} capture.`,
    )
  }
  if (!contract.camera.objectId) {
    throw new Error('Fixed Camera Appearance needs a stable authored camera ID.')
  }
  validateMatrix(contract.camera.matrixWorld, 'camera world matrix')
  validateMatrix(contract.camera.projectionMatrix, 'camera projection matrix')
  if (!Array.isArray(contract.surfaces) || contract.surfaces.length === 0) {
    throw new Error('Fixed Camera Appearance needs at least one explicit surface binding.')
  }
  const keys = new Set<string>()
  for (const [index, surface] of contract.surfaces.entries()) {
    if (!surface.receiverId || !surface.sourceMaterialId) {
      throw new Error(
        `Fixed Camera Appearance surface ${index} needs stable receiver and source-material IDs.`,
      )
    }
    if (!positiveInteger(surface.primitiveCount)) {
      throw new Error(
        `Fixed Camera Appearance surface ${index} needs a positive attested primitive count.`,
      )
    }
    const key = `${surface.receiverId}\u0000${surface.sourceMaterialId}`
    if (keys.has(key)) {
      throw new Error(
        `Fixed Camera Appearance repeats surface binding ${surface.receiverId}/${surface.sourceMaterialId}.`,
      )
    }
    keys.add(key)
  }
  assertCameraAndViewport(camera, viewport, contract)
}

function validateHash(value: string, label: string): void {
  if (!HASH_PATTERN.test(value)) {
    throw new Error(`Fixed Camera Appearance ${label} must be a lowercase SHA-256 digest.`)
  }
}

function validateMatrix(elements: number[], label: string): void {
  if (!Array.isArray(elements) || elements.length !== 16
      || elements.some((value) => !Number.isFinite(value))) {
    throw new Error(`Fixed Camera Appearance ${label} must contain 16 finite numbers.`)
  }
}

function assertCameraAndViewport(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  viewport: Readonly<{ width: number; height: number }>,
  contract: ThreeFixedCameraAppearanceContract,
): void {
  if (camera.userData?.[RECEIVER_ID] !== contract.camera.objectId) {
    throw new Error(
      `Fixed Camera Appearance expected authored camera ${contract.camera.objectId}, but the ` +
        `installed camera has ${String(camera.userData?.[RECEIVER_ID] ?? 'no stable ID')}.`,
    )
  }
  if (!positiveFinite(viewport.width) || !positiveFinite(viewport.height)) {
    throw new Error('Fixed Camera Appearance viewport dimensions must be positive and finite.')
  }
  const aspect = viewport.width / viewport.height
  if (!approximately(aspect, contract.capture.aspect, ASPECT_EPSILON)) {
    throw new Error(
      `Fixed Camera Appearance viewport aspect ${aspect} does not match the authored ` +
        `capture aspect ${contract.capture.aspect}.`,
    )
  }
  camera.updateWorldMatrix(true, false)
  const worldDifference = matrixDifference(camera.matrixWorld.elements, contract.camera.matrixWorld)
  const projectionDifference = matrixDifference(
    camera.projectionMatrix.elements,
    contract.camera.projectionMatrix,
  )
  if (worldDifference > MATRIX_EPSILON || projectionDifference > MATRIX_EPSILON) {
    throw new Error(
      `Fixed Camera Appearance camera matrix changed from the authored capture ` +
        `(world max delta ${worldDifference}, projection max delta ${projectionDifference}).`,
    )
  }
}

function planBindings(
  root: THREE.Object3D,
  contract: ThreeFixedCameraAppearanceContract,
): PlannedBinding[] {
  const planned: PlannedBinding[] = []
  const occupied = new Set<string>()
  for (const surface of contract.surfaces) {
    const receivers: THREE.Object3D[] = []
    root.traverse((object) => {
      if (object.userData?.[RECEIVER_ID] === surface.receiverId) receivers.push(object)
    })
    if (receivers.length !== 1) {
      throw new Error(
        `Fixed Camera Appearance receiver ${surface.receiverId} resolved to ` +
          `${receivers.length} objects; expected exactly one stable binding.`,
      )
    }
    const matched: PlannedBinding[] = []
    traverseReceiverPrimitives(receivers[0]!, (mesh) => {
      assertStaticOpaqueMesh(mesh)
      for (const [slot, material] of materialSlots(mesh).entries()) {
        if (material.userData?.[SOURCE_MATERIAL_ID] !== surface.sourceMaterialId) continue
        const key = `${mesh.uuid}:${slot}`
        if (occupied.has(key)) {
          throw new Error(
            `Fixed Camera Appearance material binding ${surface.receiverId}/` +
              `${surface.sourceMaterialId} overlaps another selected surface.`,
          )
        }
        occupied.add(key)
        matched.push({ mesh, slot, source: material })
      }
    })
    if (matched.length !== surface.primitiveCount) {
      throw new Error(
        `Fixed Camera Appearance material binding ${surface.receiverId}/` +
          `${surface.sourceMaterialId} resolved to ${matched.length} final primitives; ` +
          `the compiled contract attests ${surface.primitiveCount}.`,
      )
    }
    planned.push(...matched)
  }
  return planned
}

function traverseReceiverPrimitives(
  receiver: THREE.Object3D,
  visitor: (mesh: THREE.Mesh) => void,
): void {
  const visit = (object: THREE.Object3D, root: boolean): void => {
    if (!root && typeof object.userData?.[RECEIVER_ID] === 'string') return
    if ((object as THREE.Mesh).isMesh === true) visitor(object as THREE.Mesh)
    for (const child of object.children) visit(child, false)
  }
  visit(receiver, true)
}

function assertStaticOpaqueMesh(mesh: THREE.Mesh): void {
  const flags = mesh as THREE.Mesh & {
    isSkinnedMesh?: boolean
    isInstancedMesh?: boolean
    isBatchedMesh?: boolean
  }
  if (flags.isSkinnedMesh) {
    throw new Error(`Fixed Camera Appearance receiver ${mesh.name || mesh.uuid} is skinned.`)
  }
  if (flags.isInstancedMesh || flags.isBatchedMesh) {
    throw new Error(
      `Fixed Camera Appearance receiver ${mesh.name || mesh.uuid} uses runtime instances or batching.`,
    )
  }
  if ((mesh.morphTargetInfluences?.length ?? 0) > 0
      || Object.values(mesh.geometry.morphAttributes).some((values) => values.length > 0)) {
    throw new Error(`Fixed Camera Appearance receiver ${mesh.name || mesh.uuid} has morph targets.`)
  }
  for (const material of materialSlots(mesh)) {
    const physical = material as THREE.Material & { transmission?: number; alphaHash?: boolean }
    if (material.transparent || material.opacity < 1 - 1e-6 || material.alphaTest > 0
        || physical.alphaHash === true || (physical.transmission ?? 0) > 1e-6
        || material.blending !== THREE.NormalBlending) {
      throw new Error(
        `Fixed Camera Appearance receiver ${mesh.name || mesh.uuid} must be completely opaque; ` +
          `material ${material.name || material.uuid} needs realtime alpha/compositing.`,
      )
    }
  }
}

function countRenderableMaterialBindings(root: THREE.Object3D): number {
  let count = 0
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh !== true) return
    count += materialSlots(object as THREE.Mesh).length
  })
  return count
}

function materialSlots(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function projectorFromContract(contract: ThreeFixedCameraAppearanceContract): THREE.Matrix4 {
  const cameraWorld = new THREE.Matrix4().fromArray(contract.camera.matrixWorld)
  const view = cameraWorld.clone().invert()
  return new THREE.Matrix4()
    .fromArray(contract.camera.projectionMatrix)
    .multiply(view)
}

function createProjectedMaterial(
  source: THREE.Material,
  texture: THREE.Texture,
  projector: THREE.Matrix4,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: texture,
    side: source.side,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    colorWrite: source.colorWrite,
    transparent: false,
    opacity: 1,
    toneMapped: false,
    fog: false,
  })
  material.name = `${source.name || source.uuid}.BLENDLINK_FIXED_CAMERA`
  material.visible = source.visible
  material.shadowSide = source.shadowSide
  material.depthFunc = source.depthFunc
  material.clippingPlanes = source.clippingPlanes
  material.clipIntersection = source.clipIntersection
  material.clipShadows = source.clipShadows
  material.polygonOffset = source.polygonOffset
  material.polygonOffsetFactor = source.polygonOffsetFactor
  material.polygonOffsetUnits = source.polygonOffsetUnits
  material.stencilWrite = source.stencilWrite
  material.stencilWriteMask = source.stencilWriteMask
  material.stencilFunc = source.stencilFunc
  material.stencilRef = source.stencilRef
  material.stencilFuncMask = source.stencilFuncMask
  material.stencilFail = source.stencilFail
  material.stencilZFail = source.stencilZFail
  material.stencilZPass = source.stencilZPass
  material.forceSinglePass = source.forceSinglePass
  material.dithering = false
  material.userData = {
    ...source.userData,
    blendlink_fixed_camera_appearance: true,
  }

  const defaultCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    defaultCompile.call(material, shader, renderer)
    const vertexAnchor = '#include <project_vertex>'
    const fragmentAnchor = '#include <map_fragment>'
    if (!shader.vertexShader.includes(vertexAnchor)
        || !shader.fragmentShader.includes(fragmentAnchor)) {
      throw new Error(
        'Fixed Camera Appearance cannot patch this Three shader revision: ' +
          'the required project/map chunks are missing.',
      )
    }
    shader.uniforms.blendlinkFixedCameraProjector = { value: projector }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 blendlinkFixedCameraCoord;
uniform mat4 blendlinkFixedCameraProjector;`,
      )
      .replace(
        vertexAnchor,
        `${vertexAnchor}
blendlinkFixedCameraCoord =
  blendlinkFixedCameraProjector * modelMatrix * vec4( transformed, 1.0 );`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 blendlinkFixedCameraCoord;`,
      )
      .replace(
        fragmentAnchor,
        `#ifdef USE_MAP
vec2 blendlinkFixedCameraUv =
  ( blendlinkFixedCameraCoord.xy / blendlinkFixedCameraCoord.w ) * 0.5 + 0.5;
if (
  blendlinkFixedCameraCoord.w <= 0.0 ||
  any( lessThan( blendlinkFixedCameraUv, vec2( 0.0 ) ) ) ||
  any( greaterThan( blendlinkFixedCameraUv, vec2( 1.0 ) ) )
) {
  discard;
}
diffuseColor *= texture2D( map, blendlinkFixedCameraUv );
#endif`,
      )
  }
  material.customProgramCacheKey = () => 'blendlink-fixed-camera-appearance-v1'
  return material
}

function installMaterials(
  plan: PlannedBinding[],
  materialBySource: Map<THREE.Material, THREE.MeshBasicMaterial>,
): InstalledMeshMaterials[] {
  const byMesh = new Map<THREE.Mesh, InstalledMeshMaterials>()
  for (const binding of plan) {
    const projected = materialBySource.get(binding.source)
    if (!projected) throw new Error('Fixed Camera Appearance lost a prepared projected material.')
    const entry = byMesh.get(binding.mesh) ?? { mesh: binding.mesh, bindings: [] }
    entry.bindings.push({ ...binding, projected })
    byMesh.set(binding.mesh, entry)
  }
  for (const entry of byMesh.values()) {
    if (Array.isArray(entry.mesh.material)) {
      const installed = [...entry.mesh.material]
      for (const binding of entry.bindings) installed[binding.slot] = binding.projected
      entry.mesh.material = installed
    } else {
      if (entry.bindings.length !== 1 || entry.bindings[0]!.slot !== 0) {
        throw new Error('Fixed Camera Appearance found an invalid scalar material binding plan.')
      }
      entry.mesh.material = entry.bindings[0]!.projected
    }
  }
  return [...byMesh.values()]
}

function restoreMaterials(entries: InstalledMeshMaterials[]): void {
  for (const entry of entries) {
    const current = entry.mesh.material
    if (Array.isArray(current)) {
      let changed = false
      const restored = [...current]
      for (const binding of entry.bindings) {
        if (current[binding.slot] !== binding.projected) continue
        restored[binding.slot] = binding.source
        changed = true
      }
      if (changed) entry.mesh.material = restored
    } else {
      const binding = entry.bindings[0]
      if (entry.bindings.length === 1 && binding?.slot === 0 && current === binding.projected) {
        entry.mesh.material = binding.source
      }
    }
  }
}

function installRenderGuards(
  meshes: THREE.Mesh[],
  options: InstallThreeFixedCameraAppearanceOptions,
): InstalledRenderGuard[] {
  const currentViewport = new THREE.Vector4()
  return [...new Set(meshes)].map((mesh) => {
    const original = mesh.onBeforeRender
    const installed: THREE.Object3D['onBeforeRender'] = function (
      renderer,
      scene,
      renderCamera,
      geometry,
      material,
      group,
    ) {
      if (renderCamera !== options.camera) {
        throw new Error(
          'Fixed Camera Appearance was rendered through a different camera than its authored capture.',
        )
      }
      if (renderer.outputColorSpace !== THREE.SRGBColorSpace) {
        throw new Error(
          `Fixed Camera Appearance requires an sRGB renderer output; got ` +
            `${String(renderer.outputColorSpace)}.`,
        )
      }
      renderer.getCurrentViewport(currentViewport)
      assertCameraAndViewport(
        options.camera,
        { width: currentViewport.z, height: currentViewport.w },
        options.contract,
      )
      original.call(mesh, renderer, scene, renderCamera, geometry, material, group)
    }
    mesh.onBeforeRender = installed
    return { mesh, original, installed }
  })
}

function matrixDifference(actual: readonly number[], expected: readonly number[]): number {
  let maximum = 0
  for (let index = 0; index < 16; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index]! - expected[index]!))
  }
  return maximum
}

function approximately(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right))
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
