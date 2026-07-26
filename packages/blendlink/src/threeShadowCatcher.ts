import * as THREE from 'three'

export type ThreeShadowCatcherMode = 'mask' | 'additive' | 'occluder'

export interface ThreeShadowCatcherValues {
  mode: ThreeShadowCatcherMode
  color: readonly [number, number, number]
  opacity: number
  lightStrength: number
  includeDescendants: boolean
}

export interface InstalledThreeShadowCatcher {
  readonly meshes: number
  dispose(): void
}

interface MeshLease {
  owner: symbol
  installedMaterial: THREE.Material | THREE.Material[]
  installedReceiveShadow: boolean
  installedRenderOrder: number
  ownedMaterials: THREE.Material[]
  released: boolean
}

interface SharedMeshState {
  mesh: THREE.Mesh
  baselineMaterial: THREE.Material | THREE.Material[]
  baselineReceiveShadow: boolean
  baselineRenderOrder: number
  leases: MeshLease[]
  superseded: boolean
}

interface MeshInstallation {
  state: SharedMeshState
  lease: MeshLease
}

interface GeneratedReceiverState {
  target: THREE.Object3D
  mesh: THREE.Mesh
  geometry: THREE.PlaneGeometry
  material: THREE.MeshStandardMaterial
  owners: number
}

const SHADOW_CATCHER_STATES = new WeakMap<THREE.Mesh, SharedMeshState>()
const GENERATED_RECEIVERS = new WeakMap<THREE.Object3D, GeneratedReceiverState>()
const GENERATED_RECEIVER_MESHES = new WeakMap<THREE.Mesh, GeneratedReceiverState>()

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function sourceMaterials(
  material: THREE.Material | THREE.Material[],
  mesh: THREE.Mesh,
): THREE.Material[] {
  const materials: unknown[] = Array.isArray(material) ? material : [material]
  for (const candidate of materials) {
    if (!(candidate as THREE.Material | undefined)?.isMaterial) {
      throw new Error(
        `Shadow Catcher target mesh "${mesh.name || '(unnamed)'}" has an invalid material slot.`,
      )
    }
  }
  return materials as THREE.Material[]
}

function shadowMaterial(
  source: THREE.Material,
  values: ThreeShadowCatcherValues,
): THREE.ShadowMaterial {
  const material = new THREE.ShadowMaterial({
    color: new THREE.Color().setRGB(...values.color),
    opacity: clamp(finite(values.opacity, 1), 0, 1),
  })
  material.name = 'Blendlink Shadow Catcher Mask'
  material.side = source.side
  material.depthWrite = false
  material.stencilWrite = false
  material.userData.blendlink_shadow_catcher = 'mask'
  return material
}

function additiveMaterial(
  source: THREE.Material,
  values: ThreeShadowCatcherValues,
): THREE.MeshStandardMaterial {
  if (!(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    throw new Error(
      `Additive Shadow Catcher needs a standard or physical source material; ` +
        `"${source.name || source.type}" is ${source.type}. ` +
        'Assign a Principled BSDF material in Blender or use Mask/Occluder.',
    )
  }
  // Needle clones the authored standard material, so maps, vertex colors,
  // roughness, and the artist's direct-light response remain authoritative.
  const material = source.clone() as THREE.MeshStandardMaterial
  material.transparent = true
  material.blending = THREE.AdditiveBlending
  material.depthWrite = false
  material.name = 'Blendlink Shadow Catcher Additive'
  material.stencilWrite = false
  material.userData.blendlink_shadow_catcher = 'additive'
  const strength = clamp(finite(values.lightStrength, 6.6), 0, 20)
  material.onBeforeCompile = (shader) => {
    const seam = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;'
    if (!shader.fragmentShader.includes(seam)) {
      throw new Error(
        'Blendlink additive Shadow Catcher could not find Three.js\' supported lighting seam. ' +
          'Use Mask/Occluder or a supported Three release instead of publishing an unverified shader.',
      )
    }
    shader.uniforms.blendlinkShadowStrength = { value: strength }
    shader.fragmentShader = `
uniform float blendlinkShadowStrength;
${shader.fragmentShader.replace(seam, `${seam}
  vec3 blendlinkDirect = (
    reflectedLight.directDiffuse + reflectedLight.directSpecular
  ) * blendlinkShadowStrength;
  float blendlinkDirectPeak = max(
    blendlinkDirect.r, max(blendlinkDirect.g, blendlinkDirect.b)
  );
  gl_FragColor = vec4(
    blendlinkDirect,
    clamp(blendlinkDirectPeak, 0.0, 1.0)
  );
  return;`)}
`
  }
  material.customProgramCacheKey = () =>
    `blendlink-shadow-catcher-additive-v1:${strength}:${source.customProgramCacheKey()}`
  return material
}

function occluderMaterial(source: THREE.Material): THREE.Material {
  // Preserve authored alpha/displacement/clipping coverage exactly as Needle
  // does. Color writes are disabled, so the source shading model is immaterial
  // while its geometry coverage still controls depth.
  const material = source.clone()
  material.depthWrite = true
  material.colorWrite = false
  material.stencilWrite = true
  material.name = 'Blendlink Shadow Catcher Occluder'
  material.userData.blendlink_shadow_catcher = 'occluder'
  return material
}

function catcherMaterial(
  source: THREE.Material,
  values: ThreeShadowCatcherValues,
): THREE.Material {
  switch (values.mode) {
    case 'mask': return shadowMaterial(source, values)
    case 'additive': return additiveMaterial(source, values)
    case 'occluder': return occluderMaterial(source)
  }
}

function currentLease(state: SharedMeshState): MeshLease | undefined {
  return state.leases.at(-1)
}

function stateIsOwned(state: SharedMeshState): boolean {
  const current = currentLease(state)
  return Boolean(
    current &&
    state.mesh.material === current.installedMaterial &&
    state.mesh.receiveShadow === current.installedReceiveShadow &&
    state.mesh.renderOrder === current.installedRenderOrder,
  )
}

function createOwnedMaterials(
  source: THREE.Material | THREE.Material[],
  mesh: THREE.Mesh,
  values: ThreeShadowCatcherValues,
): THREE.Material[] {
  const owned: THREE.Material[] = []
  try {
    for (const material of sourceMaterials(source, mesh)) {
      owned.push(catcherMaterial(material, values))
    }
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const material of owned) {
      try { material.dispose() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not create Shadow Catcher materials: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `Partial cleanup also failed: ${cleanupErrors.map(String).join('; ')}`,
      )
    }
    throw error
  }
  return owned
}

function installMesh(
  mesh: THREE.Mesh,
  values: ThreeShadowCatcherValues,
  owner: symbol,
): MeshInstallation {
  const observedMaterial = mesh.material
  if (!observedMaterial ||
      (Array.isArray(observedMaterial) && observedMaterial.length === 0)) {
    throw new Error(`Shadow Catcher target mesh "${mesh.name || '(unnamed)'}" has no material slots.`)
  }

  let state = SHADOW_CATCHER_STATES.get(mesh)
  if (state && (!stateIsOwned(state) || state.superseded)) {
    // An application owner changed at least one leased field. Start a fresh
    // epoch from what is actually on the mesh; older handles become cleanup-
    // only and can no longer clobber this baseline.
    state.superseded = true
    state = undefined
  }
  if (!state) {
    state = {
      mesh,
      baselineMaterial: observedMaterial,
      baselineReceiveShadow: mesh.receiveShadow,
      baselineRenderOrder: mesh.renderOrder,
      leases: [],
      superseded: false,
    }
    SHADOW_CATCHER_STATES.set(mesh, state)
  }

  // Overlapping preview generations must compile from the authored baseline,
  // not from another Blendlink replacement material.
  const source = state.baselineMaterial
  const ownedMaterials = createOwnedMaterials(source, mesh, values)
  const installedMaterial = Array.isArray(source)
    // Keep a distinct slot array so later application slot replacement cannot
    // rewrite the ownership snapshot used during conditional restoration.
    ? [...ownedMaterials]
    : ownedMaterials[0]!
  const lease: MeshLease = {
    owner,
    installedMaterial,
    installedReceiveShadow: values.mode !== 'occluder',
    installedRenderOrder: values.mode === 'occluder' ? -100 : mesh.renderOrder,
    ownedMaterials,
    released: false,
  }
  state.leases.push(lease)
  try {
    mesh.material = lease.installedMaterial
    mesh.receiveShadow = lease.installedReceiveShadow
    mesh.renderOrder = lease.installedRenderOrder
  } catch (error) {
    state.leases.pop()
    if (state.leases.length === 0 && SHADOW_CATCHER_STATES.get(mesh) === state) {
      SHADOW_CATCHER_STATES.delete(mesh)
    }
    const cleanupErrors: unknown[] = []
    for (const material of lease.ownedMaterials) {
      try { material.dispose() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not take Shadow Catcher ownership: ${String(error)}. ` +
          `Material cleanup also failed: ${cleanupErrors.map(String).join('; ')}`,
      )
    }
    throw error
  }
  return { state, lease }
}

function restore(installation: MeshInstallation): unknown[] {
  const errors: unknown[] = []
  const { state, lease } = installation
  if (lease.released) return errors
  lease.released = true
  const { mesh } = state
  const index = state.leases.indexOf(lease)
  const wasCurrent = index === state.leases.length - 1
  if (index >= 0) state.leases.splice(index, 1)
  const next = currentLease(state)
  if (!state.superseded && wasCurrent) {
    try {
      if (mesh.material === lease.installedMaterial) {
        const replacement = next?.installedMaterial ?? state.baselineMaterial
        if (Array.isArray(lease.installedMaterial) && Array.isArray(replacement)) {
          const retained = lease.installedMaterial
          let applicationOwnsSlot = false
          for (let slot = 0; slot < retained.length; slot += 1) {
            if (retained[slot] === lease.ownedMaterials[slot]) {
              retained[slot] = replacement[slot]!
            } else {
              applicationOwnsSlot = true
            }
          }
          // Preserve the exact authored/previous array identity when no slot
          // was replaced independently by the application.
          if (!applicationOwnsSlot) mesh.material = replacement
        } else {
          mesh.material = replacement
        }
      }
    } catch (error) { errors.push(error) }
    try {
      if (mesh.receiveShadow === lease.installedReceiveShadow) {
        mesh.receiveShadow = next?.installedReceiveShadow ?? state.baselineReceiveShadow
      }
    } catch (error) { errors.push(error) }
    try {
      if (mesh.renderOrder === lease.installedRenderOrder) {
        mesh.renderOrder = next?.installedRenderOrder ?? state.baselineRenderOrder
      }
    } catch (error) { errors.push(error) }
  }
  if (state.leases.length === 0 && SHADOW_CATCHER_STATES.get(mesh) === state) {
    SHADOW_CATCHER_STATES.delete(mesh)
  }
  for (const material of lease.ownedMaterials) {
    try { material.dispose() } catch (error) { errors.push(error) }
  }
  return errors
}

function createGeneratedReceiver(target: THREE.Object3D): GeneratedReceiverState {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshStandardMaterial({
    color: 0x999999,
    roughness: 1,
    metalness: 0,
    transparent: true,
  })
  material.name = 'Blendlink Generated Shadow Catcher Source'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `${target.name || 'Object'} Shadow Catcher`
  mesh.userData.blendlink_generated_shadow_catcher = true
  target.add(mesh)
  const state = { target, mesh, geometry, material, owners: 0 }
  GENERATED_RECEIVERS.set(target, state)
  GENERATED_RECEIVER_MESHES.set(mesh, state)
  return state
}

function resolveReceiverMeshes(
  target: THREE.Object3D,
  includeDescendants: boolean,
): { meshes: THREE.Mesh[]; generated: GeneratedReceiverState[] } {
  const meshes: THREE.Mesh[] = []
  if ((target as THREE.Mesh).isMesh) meshes.push(target as THREE.Mesh)
  if (includeDescendants) {
    for (const child of target.children) {
      child.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
      })
    }
  }
  if (meshes.length === 0) {
    const existing = GENERATED_RECEIVERS.get(target)
    meshes.push(existing?.mesh ?? createGeneratedReceiver(target).mesh)
  }
  const generated = [...new Set(
    meshes.map((mesh) => GENERATED_RECEIVER_MESHES.get(mesh))
      .filter((state): state is GeneratedReceiverState => state !== undefined),
  )]
  for (const state of generated) state.owners += 1
  return { meshes, generated }
}

function releaseGeneratedReceiver(state: GeneratedReceiverState): unknown[] {
  const errors: unknown[] = []
  state.owners = Math.max(0, state.owners - 1)
  if (state.owners > 0) return errors
  GENERATED_RECEIVERS.delete(state.target)
  GENERATED_RECEIVER_MESHES.delete(state.mesh)
  delete state.mesh.userData.blendlink_generated_shadow_catcher
  const stillOwned = state.mesh.parent === state.target &&
    state.mesh.geometry === state.geometry &&
    state.mesh.material === state.material
  if (!stillOwned) return errors
  try { state.target.remove(state.mesh) } catch (error) { errors.push(error) }
  try { state.geometry.dispose() } catch (error) { errors.push(error) }
  try { state.material.dispose() } catch (error) { errors.push(error) }
  return errors
}

/** Install one portable Shadow Catcher without taking Canvas, render-loop, or
 * raycast-layer ownership. Object targets may be a Mesh or a group whose
 * descendant meshes form one authored receiver. */
export function installThreeShadowCatcher(
  target: THREE.Object3D,
  values: ThreeShadowCatcherValues,
): InstalledThreeShadowCatcher {
  if (values.mode !== 'mask' && values.mode !== 'additive' && values.mode !== 'occluder') {
    throw new Error(
      `Shadow Catcher target "${target.name || '(unnamed)'}" uses unsupported mode ` +
        `${JSON.stringify(values.mode)}.`,
    )
  }
  const { meshes, generated } = resolveReceiverMeshes(
    target, values.includeDescendants !== false,
  )
  const owner = Symbol(`shadow-catcher:${target.uuid}`)
  const installations: MeshInstallation[] = []
  try {
    for (const mesh of meshes) installations.push(installMesh(mesh, values, owner))
  } catch (error) {
    const cleanupErrors = installations.flatMap((installation) => restore(installation))
    cleanupErrors.push(...generated.flatMap((state) => releaseGeneratedReceiver(state)))
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not install Shadow Catcher: ${error instanceof Error ? error.message : String(error)}. ` +
          `Rollback also failed: ${cleanupErrors.map(String).join('; ')}`,
      )
    }
    throw error
  }
  let disposed = false
  return {
    meshes: installations.length,
    dispose() {
      if (disposed) return
      disposed = true
      const errors = installations.slice().reverse()
        .flatMap((installation) => restore(installation))
      errors.push(...generated.flatMap((state) => releaseGeneratedReceiver(state)))
      if (errors.length > 0) {
        throw new Error(
          `Blendlink Shadow Catcher cleanup failed: ${errors.map(String).join('; ')}`,
        )
      }
    },
  }
}
