import * as THREE from 'three'

export type ThreeTextureAnisotropy = 'authored' | 'renderer-max' | number

export type ThreeTextureSamplingRenderer = Readonly<{
  /** Absent on the WebGPU renderer family, which exposes no capabilities
   * object — its samplers accept anisotropy 1..16 by specification. */
  capabilities?: Readonly<{
    getMaxAnisotropy(): number
  }>
}>

/** WebGPU samplers accept maxAnisotropy 1..16 by specification. */
const WEBGPU_MAX_ANISOTROPY = 16

function rendererMaxAnisotropy(renderer: ThreeTextureSamplingRenderer): number {
  return renderer.capabilities
    ? renderer.capabilities.getMaxAnisotropy()
    : WEBGPU_MAX_ANISOTROPY
}

export type ThreeTextureSamplingReport = Readonly<{
  policy: ThreeTextureAnisotropy
  requestedAnisotropy: number | null
  appliedAnisotropy: number | null
  materialTextures: number
  eligibleTextures: number
  changedTextures: number
}>

export type InstalledThreeTextureSampling = Readonly<{
  report: ThreeTextureSamplingReport
  dispose(): void
}>

type TextureSamplingLeaseState = {
  authoredAnisotropy: number
  appliedAnisotropy: number
  externallyModified: boolean
  leases: Map<symbol, number>
}

const textureSamplingLeases = new WeakMap<THREE.Texture, TextureSamplingLeaseState>()

function updateTextureAnisotropy(texture: THREE.Texture, anisotropy: number): boolean {
  if (texture.anisotropy === anisotropy) return false
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return true
}

function activeAnisotropy(state: TextureSamplingLeaseState): number {
  return Math.max(...state.leases.values())
}

function acquireTextureSamplingLease(
  texture: THREE.Texture,
  anisotropy: number,
): { changed: boolean; dispose(): void } {
  const id = Symbol('Blendlink texture-sampling lease')
  let state = textureSamplingLeases.get(texture)
  if (!state) {
    state = {
      authoredAnisotropy: texture.anisotropy,
      appliedAnisotropy: texture.anisotropy,
      externallyModified: false,
      leases: new Map(),
    }
    textureSamplingLeases.set(texture, state)
  } else if (texture.anisotropy !== state.appliedAnisotropy) {
    state.externallyModified = true
  }

  state.leases.set(id, anisotropy)
  const target = activeAnisotropy(state)
  const changed = state.externallyModified
    ? false
    : updateTextureAnisotropy(texture, target)
  state.appliedAnisotropy = texture.anisotropy

  let disposed = false
  return {
    changed,
    dispose() {
      if (disposed) return
      disposed = true
      const current = textureSamplingLeases.get(texture)
      if (!current || !current.leases.delete(id)) return
      if (texture.anisotropy !== current.appliedAnisotropy) {
        current.externallyModified = true
      }
      if (!current.externallyModified) {
        const next = current.leases.size > 0
          ? activeAnisotropy(current)
          : current.authoredAnisotropy
        updateTextureAnisotropy(texture, next)
        current.appliedAnisotropy = texture.anisotropy
      }
      if (current.leases.size === 0) textureSamplingLeases.delete(texture)
    },
  }
}

function collectMaterialTextures(root: THREE.Object3D): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>()
  const collect = (value: unknown): void => {
    if ((value as THREE.Texture | null)?.isTexture) {
      textures.add(value as THREE.Texture)
      return
    }
    if (Array.isArray(value)) value.forEach(collect)
  }
  const collectMaterial = (material: THREE.Material): void => {
    for (const [key, value] of Object.entries(material)) {
      if (key === 'userData' || key === '_listeners' || key === 'uniforms') continue
      collect(value)
    }
    const uniforms = (material as THREE.ShaderMaterial).uniforms
    if (uniforms) {
      for (const uniform of Object.values(uniforms)) collect(uniform?.value)
    }
  }
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (Array.isArray(material)) material.forEach(collectMaterial)
    else if (material?.isMaterial) collectMaterial(material)
  })
  return textures
}

function supportsAnisotropicSampling(texture: THREE.Texture): boolean {
  return !texture.isRenderTargetTexture
    && !(texture as THREE.Texture & { isVideoTexture?: boolean }).isVideoTexture
    && texture.magFilter !== THREE.NearestFilter
    && (
      texture.minFilter === THREE.NearestMipmapLinearFilter
      || texture.minFilter === THREE.LinearMipmapLinearFilter
    )
}

function resolveAnisotropy(
  renderer: ThreeTextureSamplingRenderer,
  policy: ThreeTextureAnisotropy,
): number | null {
  if (policy === 'authored') return null
  const maximum = rendererMaxAnisotropy(renderer)
  if (!Number.isFinite(maximum) || maximum < 1) {
    throw new Error(
      `Blendlink needs a finite renderer maximum anisotropy of at least 1; got ${maximum}.`,
    )
  }
  if (policy === 'renderer-max') return maximum
  if (!Number.isFinite(policy) || policy < 1) {
    throw new Error(
      `Blendlink texture anisotropy must be "authored", "renderer-max", or a finite number of at least 1; got ${policy}.`,
    )
  }
  return Math.min(policy, maximum)
}

export function installThreeTextureSampling(
  root: THREE.Object3D,
  renderer: ThreeTextureSamplingRenderer,
  policy: ThreeTextureAnisotropy,
): InstalledThreeTextureSampling {
  const requestedAnisotropy = policy === 'renderer-max'
    ? rendererMaxAnisotropy(renderer)
    : typeof policy === 'number'
      ? policy
      : null
  const appliedAnisotropy = resolveAnisotropy(renderer, policy)
  const textures = collectMaterialTextures(root)
  const eligible = [...textures].filter(supportsAnisotropicSampling)
  const leases: Array<{ changed: boolean; dispose(): void }> = []

  if (appliedAnisotropy !== null) {
    for (const texture of eligible) {
      leases.push(acquireTextureSamplingLease(texture, appliedAnisotropy))
    }
  }

  let disposed = false
  return {
    report: Object.freeze({
      policy,
      requestedAnisotropy,
      appliedAnisotropy,
      materialTextures: textures.size,
      eligibleTextures: eligible.length,
      changedTextures: leases.filter((lease) => lease.changed).length,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      for (const lease of leases.reverse()) lease.dispose()
    },
  }
}
