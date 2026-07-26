import {
  InterpolateDiscrete,
  InterpolateLinear,
  Material,
  Texture,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  inspectGltfRuntimeCompatibility,
  loadedThreeRuntimeProfile,
  readGlbJson,
} from '../../packages/blendlink/dist/gltfRuntimeCompatibility.js'

type BrowserInput = {
  assets: Array<{
    id: string
    entryUrl: string
    outcome: string
    expect: {
      browser?: Record<string, unknown>
      browserBypassProbe?: {
        loadsOptimistically: boolean
        animationTracks: number
      }
    }
  }>
}

type BrowserAssetEvidence = {
  id: string
  outcome: string
  meshCount: number
  skinnedMeshCount: number
  morphMeshCount: number
  tangentGeometryCount: number
  uvGeometryCount: number
  negativeDeterminantCount: number
  animationCount: number
  animationTrackCount: number
  interpolations: string[]
  materialTypes: string[]
  materialProperties: Record<string, Array<number | boolean | string | null>>
  nonIdentityTextureTransforms: number
  compatibility: {
    profile: string
    compatible: boolean
    issueCodes: string[]
  }
  loadedCompatibility: {
    profile: string
    compatible: boolean
    issueCodes: string[]
    noOpPointerPluginStillRefused: boolean | null
  }
}

declare global {
  interface Window {
    __khronosRuntimeCorpus?: {
      ready: boolean
      evidence?: BrowserAssetEvidence[]
      error?: string
    }
  }
}

function interpolationName(track: {
  getInterpolation(): number
  createInterpolant: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean }
}): string {
  if (track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline) {
    return 'CubicSpline'
  }
  const interpolation = track.getInterpolation()
  if (interpolation === InterpolateDiscrete) return 'Discrete'
  if (interpolation === InterpolateLinear) return 'Linear'
  return `Other:${interpolation}`
}

function valuesForProperty(materials: Material[], property: string): Array<number | boolean | string | null> {
  return materials
    .filter((material) => property in material)
    .map((material) => {
      const value = (material as unknown as Record<string, unknown>)[property]
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        return value
      }
      return value === null ? null : typeof value
    })
}

function collectTextures(material: Material): Texture[] {
  const textures = new Set<Texture>()
  for (const value of Object.values(material)) {
    if (value instanceof Texture) textures.add(value)
  }
  return [...textures]
}

function isIdentityTextureTransform(texture: Texture): boolean {
  if (
    Math.abs(texture.offset.x) > 1e-7
    || Math.abs(texture.offset.y) > 1e-7
    || Math.abs(texture.repeat.x - 1) > 1e-7
    || Math.abs(texture.repeat.y - 1) > 1e-7
    || Math.abs(texture.rotation) > 1e-7
    || Math.abs(texture.center.x) > 1e-7
    || Math.abs(texture.center.y) > 1e-7
  ) {
    return false
  }
  const elements = texture.matrix.elements
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  return elements.every((value, index) => Math.abs(value - identity[index]) <= 1e-7)
}

async function loadEvidence(asset: BrowserInput['assets'][number]): Promise<BrowserAssetEvidence> {
  const sourceResponse = await fetch(asset.entryUrl)
  if (!sourceResponse.ok) {
    throw new Error(`${asset.id} source returned HTTP ${sourceResponse.status}`)
  }
  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer())
  const document = asset.entryUrl.toLowerCase().endsWith('.gltf')
    ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes))
    : readGlbJson(sourceBytes, asset.id)
  const compatibility = inspectGltfRuntimeCompatibility(
    document,
    BLENDLINK_THREE_R184_COMPILED_PROFILE,
  )
  const expectedCompatible = asset.outcome === 'load'
  if (compatibility.compatible !== expectedCompatible) {
    throw new Error(
      `${asset.id} production compatibility gate returned ${compatibility.compatible}; `
      + `expected ${expectedCompatible}.`,
    )
  }

  // Refused cells load only as an explicit raw-Three bypass probe. The
  // production gate above has already established that Blendlink would stop
  // before invoking GLTFLoader for those assets.
  const gltf = await new GLTFLoader().loadAsync(asset.entryUrl)
  const loadedRuntime = loadedThreeRuntimeProfile(gltf.parser)
  const loadedCompatibility = inspectGltfRuntimeCompatibility(
    loadedRuntime.json,
    loadedRuntime.profile,
  )
  if (loadedCompatibility.compatible !== expectedCompatible) {
    throw new Error(
      `${asset.id} loaded-parser compatibility returned ${loadedCompatibility.compatible}; `
      + `expected ${expectedCompatible}.`,
    )
  }
  let noOpPointerPluginStillRefused: boolean | null = null
  if (loadedCompatibility.animationPointers.length > 0) {
    const parser = gltf.parser as unknown as {
      plugins: Record<string, unknown>
    }
    parser.plugins.KHR_animation_pointer = { name: 'KHR_animation_pointer' }
    const noOpProfile = loadedThreeRuntimeProfile(parser)
    const noOpReport = inspectGltfRuntimeCompatibility(
      noOpProfile.json,
      noOpProfile.profile,
    )
    noOpPointerPluginStillRefused = noOpReport.issues.some(
      (issue) => issue.code === 'runtime.animation-pointer-unsupported',
    )
    if (!noOpPointerPluginStillRefused) {
      throw new Error(`${asset.id} no-op pointer plugin name bypassed the semantic gate.`)
    }
  }
  const materials = new Set<Material>()
  let meshCount = 0
  let skinnedMeshCount = 0
  let morphMeshCount = 0
  let tangentGeometryCount = 0
  let uvGeometryCount = 0
  let negativeDeterminantCount = 0

  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((object) => {
    if (object.matrixWorld.determinant() < 0) negativeDeterminantCount += 1
    const candidate = object as unknown as {
      isMesh?: boolean
      isSkinnedMesh?: boolean
      morphTargetInfluences?: number[]
      geometry?: { attributes?: Record<string, unknown> }
      material?: Material | Material[]
    }
    if (!candidate.isMesh) return
    meshCount += 1
    if (candidate.isSkinnedMesh) skinnedMeshCount += 1
    if ((candidate.morphTargetInfluences?.length ?? 0) > 0) morphMeshCount += 1
    if (candidate.geometry?.attributes?.tangent) tangentGeometryCount += 1
    if (candidate.geometry?.attributes?.uv) uvGeometryCount += 1
    const objectMaterials = Array.isArray(candidate.material)
      ? candidate.material
      : candidate.material
        ? [candidate.material]
        : []
    for (const material of objectMaterials) materials.add(material)
  })

  const tracks = gltf.animations.flatMap((clip) => clip.tracks)
  const properties = [
    'anisotropy',
    'clearcoat',
    'dispersion',
    'emissiveIntensity',
    'ior',
    'iridescence',
    'sheen',
    'specularIntensity',
    'transmission',
    'thickness',
  ]
  const materialList = [...materials]
  const materialProperties = Object.fromEntries(
    properties.map((property) => [property, valuesForProperty(materialList, property)]),
  )
  const textures = new Set(materialList.flatMap(collectTextures))
  const nonIdentityTextureTransforms = [...textures]
    .filter((texture) => !isIdentityTextureTransform(texture))
    .length

  return {
    id: asset.id,
    outcome: asset.outcome,
    meshCount,
    skinnedMeshCount,
    morphMeshCount,
    tangentGeometryCount,
    uvGeometryCount,
    negativeDeterminantCount,
    animationCount: gltf.animations.length,
    animationTrackCount: tracks.length,
    interpolations: [...new Set(tracks.map((track) => interpolationName(track)))].sort(),
    materialTypes: [...new Set(materialList.map((material) => material.type))].sort(),
    materialProperties,
    nonIdentityTextureTransforms,
    compatibility: {
      profile: compatibility.profile,
      compatible: compatibility.compatible,
      issueCodes: compatibility.issues.map((issue) => issue.code),
    },
    loadedCompatibility: {
      profile: loadedCompatibility.profile,
      compatible: loadedCompatibility.compatible,
      issueCodes: loadedCompatibility.issues.map((issue) => issue.code),
      noOpPointerPluginStillRefused,
    },
  }
}

async function main(): Promise<void> {
  window.__khronosRuntimeCorpus = { ready: false }
  try {
    const response = await fetch('/output/browser-input.json')
    if (!response.ok) throw new Error(`browser input returned HTTP ${response.status}`)
    const input = await response.json() as BrowserInput
    const evidence: BrowserAssetEvidence[] = []
    for (const asset of input.assets) evidence.push(await loadEvidence(asset))
    window.__khronosRuntimeCorpus = { ready: true, evidence }
    const status = document.querySelector('#status')
    if (status) status.textContent = `${evidence.length} exact official assets loaded.`
  } catch (error) {
    window.__khronosRuntimeCorpus = {
      ready: true,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }
  }
}

void main()
