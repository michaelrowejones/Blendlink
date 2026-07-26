import type { BakeSettings, ExportSettings } from './invoke.js'
import { parsePortableComponents, type PortableComponentRecord } from './components.js'
import type {
  AnimationSequenceEasing,
  AnimationSequenceRecipe,
  AnimationSequenceStrip,
} from './animationSequence.js'

export const SCENE_RECIPE_SCHEMA_VERSION = 1 as const

export type PresentationMode = 'hybrid' | 'realtime' | 'baked'
export type AtlasFitPolicy = 'block' | 'scale'
export type AtlasBakeOutput = 'lighting' | 'appearance'
export type CameraBehavior = 'fixed' | 'orbit' | 'free'
export type CameraFraming = 'authored' | 'fit-scene' | 'fit-target'
export type GeometryOptimization = 'none' | 'meshopt'
export type TextureOptimization = 'none' | 'ktx2'
export type AnimationStart = 'manual' | 'first' | 'named' | 'all'
export type AnimationLoop = 'once' | 'repeat' | 'pingpong'
export type ToneMappingIntent = 'application' | 'agx' | 'neutral' | 'aces' | 'none'
export type BackgroundIntent = 'application' | 'transparent' | 'color'
export type ShadowPreset = 'application' | 'off' | 'performance' | 'balanced' | 'soft' | 'crisp' | 'custom'
export type ShadowFilter = 'basic' | 'pcf' | 'vsm'
export type EnvironmentSource = 'application' | 'image'
export type EnvironmentLighting = 'application' | 'image' | 'none'
export type EnvironmentBackground = 'application' | 'image' | 'grounded' | 'none'
export type ReflectionProbeShape = 'box' | 'sphere'
export type ReflectionProbeSource = 'runtime' | 'baked' | 'custom'
export type FogMode = 'application' | 'none' | 'linear' | 'exponential'

export interface AtlasRecipe {
  /** Stable, URL-safe identifier written to blendlink_atlas on objects. */
  id: string
  /** Artist-facing label. Main is always id=main and cannot be removed. */
  name: string
  size: number
  targetDensity: number
  margin: number
  fitPolicy: AtlasFitPolicy
  /** Lighting preserves PBR materials and captures indirect GI. Appearance
   * flattens the final authored look for intentionally stylized surfaces. */
  bakeOutput: AtlasBakeOutput
}

export interface QualityRecipe {
  samples: number
  supersample: number
  denoise: boolean
  /** Preview only: linear atlas-size multiplier. Final is always 1. */
  resolutionScale: number
}

export interface LightingStateRecipe {
  name: string
  hideCollections?: string[]
}

export interface CompositionFrameRecipe {
  name: string
  width: number
  height: number
  /** Fraction of each edge reserved for page copy/controls (0..0.45). */
  safeMargin: number
}

export interface PresentationCameraRecipe {
  /** Rename-stable Blendlink ID; objectName remains a human-readable diagnostic. */
  objectId: string
  objectName: string
  behavior: CameraBehavior
  /** Orbit/constrained cameras may target another rename-stable scene object. */
  targetId?: string
  targetName?: string
  /** Authored is the safe default. Fit modes explicitly permit the runtime
   * adapter to move this camera once while preserving its authored angle. */
  framing: CameraFraming
  compositions: readonly CompositionFrameRecipe[]
}

export interface OptimizationRecipe {
  geometry: GeometryOptimization
  /** Semantic GPU texture policy. Per-image overrides remain authoritative. */
  textures: TextureOptimization
}

export interface PlaybackRecipe {
  start: AnimationStart
  /** Required only when start=named; exact exported glTF clip name. */
  clip?: string
  loop: AnimationLoop
  speed: number
}

export interface LookRecipe {
  toneMapping: ToneMappingIntent
  /** Exposure in photographic stops; the runtime multiplier is 2^stops. */
  exposure: number
  background: BackgroundIntent
  /** Linear-sRGB values, present only for background=color. */
  backgroundColor?: [number, number, number]
}

export interface FogRecipe {
  /** Application leaves scene.fog untouched; none explicitly clears it. */
  mode: FogMode
  /** Linear-sRGB, used only by linear/exponential fog. */
  color: readonly [number, number, number]
  /** World-unit transition for linear fog. */
  near: number
  far: number
  /** World-unit exponential density for exponential fog. */
  density: number
}

export interface ShadowRecipe {
  /** Presets are recorded alongside their resolved values so generated files
   * remain self-describing and a runtime never has to duplicate Blender UI logic. */
  preset: ShadowPreset
  filter: ShadowFilter
  mapSize: number
  maxDistance: number
  bias: number
  normalBias: number
  radius: number
  autoUpdate: boolean
}

export interface EnvironmentRecipe {
  /** Application means Blendlink neither publishes nor assigns an HDR asset. */
  source: EnvironmentSource
  /** Blender image datablock used as the source diagnostic; runtime uses the
   * separately published environment asset URL in the manifest. */
  imageName?: string
  lighting: EnvironmentLighting
  background: EnvironmentBackground
  lightingIntensity: number
  lightingRotation: number
  backgroundIntensity: number
  backgroundRotation: number
  backgroundBlur: number
  groundHeight: number
  groundRadius: number
}

export interface ReflectionProbeRecipe {
  /** Artist-readable, URL-safe key used by generated types and supplied
   * runtime texture maps. objectId remains the rename-stable scene identity. */
  id: string
  name: string
  objectId: string
  objectName: string
  shape: ReflectionProbeShape
  /** Runtime captures once after load. Baked/custom sources are ordinary
   * published equirectangular assets with byte identity in the manifest. */
  source: ReflectionProbeSource
  /** Cubemap face resolution used by an optional runtime capture adapter. */
  resolution: number
  /** Cycles samples for Blender Bake. Retained for transparent source/status
   * evidence; runtime/custom modes do not spend this budget. */
  samples: number
  /** Radius for spheres; half-extent on every axis for box previews. */
  influence: number
  /** Multiplier applied by the default material assignment adapter. */
  intensity: number
  /** Optional rename-stable capture/parallax origin. The probe object is the
   * origin when absent. */
  anchorId?: string
  anchorName?: string
  /** Blender image identity and authoring evidence. URLs and exact published
   * bytes belong to the manifest/compiled descriptor, never the recipe. */
  texture?: {
    imageName: string
    width: number
    height: number
    format: 'hdr' | 'exr' | 'png' | 'jpeg' | 'webp'
    colorSpace: 'linear' | 'srgb'
    /** Baked only: conservative scene dependency identity. */
    sourceHash?: string
    /** Baked only: exact derived image bytes. */
    contentHash?: string
  }
}

export interface SceneRecipe {
  schemaVersion: typeof SCENE_RECIPE_SCHEMA_VERSION
  presentation: PresentationMode
  atlases: AtlasRecipe[]
  preview: QualityRecipe
  final: QualityRecipe
  states: LightingStateRecipe[]
  camera?: PresentationCameraRecipe
  playback: PlaybackRecipe
  /** Optional single-track NLA schedule composed from ordinary exported clips. */
  animationSequence?: AnimationSequenceRecipe
  look: LookRecipe
  fog: FogRecipe
  shadows: ShadowRecipe
  environment: EnvironmentRecipe
  reflectionProbes: ReflectionProbeRecipe[]
  /** Portable website behaviours. They are authored in Blender but do not
   * imply a particular runtime; adapters decide how to install them. */
  components: PortableComponentRecord[]
  optimization: OptimizationRecipe
}

export const DEFAULT_SCENE_RECIPE: SceneRecipe = {
  schemaVersion: SCENE_RECIPE_SCHEMA_VERSION,
  presentation: 'hybrid',
  atlases: [
    {
      id: 'main',
      name: 'Main',
      size: 2048,
      targetDensity: 256,
      margin: 48,
      fitPolicy: 'block',
      bakeOutput: 'lighting',
    },
  ],
  preview: { samples: 16, supersample: 1, denoise: false, resolutionScale: 0.25 },
  final: { samples: 128, supersample: 2, denoise: true, resolutionScale: 1 },
  states: [{ name: 'default' }],
  playback: { start: 'manual', loop: 'repeat', speed: 1 },
  look: { toneMapping: 'application', exposure: 0, background: 'application' },
  fog: { mode: 'application', color: [0.05, 0.05, 0.05], near: 10, far: 100, density: 0.02 },
  shadows: {
    preset: 'application', filter: 'pcf', mapSize: 1024, maxDistance: 50,
    bias: -0.0005, normalBias: 0.02, radius: 1, autoUpdate: true,
  },
  environment: {
    source: 'application', lighting: 'application', background: 'application',
    lightingIntensity: 1, lightingRotation: 0, backgroundIntensity: 1,
    backgroundRotation: 0, backgroundBlur: 0, groundHeight: 2, groundRadius: 100,
  },
  reflectionProbes: [],
  components: [],
  optimization: { geometry: 'none', textures: 'none' },
}

export interface RecipeDiagnostic {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export function parseSceneRecipe(value: unknown): {
  recipe: SceneRecipe | null
  diagnostics: RecipeDiagnostic[]
} {
  const diagnostics: RecipeDiagnostic[] = []
  if (!value || typeof value !== 'object') {
    return {
      recipe: null,
      diagnostics: [{ severity: 'error', path: 'recipe', message: 'scene recipe must be an object' }],
    }
  }
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== SCENE_RECIPE_SCHEMA_VERSION) {
    diagnostics.push({
      severity: 'error',
      path: 'schemaVersion',
      message: `recipe schemaVersion ${String(input.schemaVersion)} is not supported; expected ${SCENE_RECIPE_SCHEMA_VERSION}`,
    })
  }
  const presentation = input.presentation
  if (presentation !== 'hybrid' && presentation !== 'realtime' && presentation !== 'baked') {
    diagnostics.push({
      severity: 'error',
      path: 'presentation',
      message: 'presentation must be hybrid, realtime, or baked',
    })
  }

  const rawAtlases = Array.isArray(input.atlases) ? input.atlases : []
  if (rawAtlases.length === 0) {
    diagnostics.push({ severity: 'error', path: 'atlases', message: 'recipe must contain the Main atlas' })
  }
  const ids = new Set<string>()
  const atlases: AtlasRecipe[] = []
  for (const [index, raw] of rawAtlases.entries()) {
    const path = `atlases[${index}]`
    if (!raw || typeof raw !== 'object') {
      diagnostics.push({ severity: 'error', path, message: 'atlas must be an object' })
      continue
    }
    const atlas = raw as Record<string, unknown>
    const id = typeof atlas.id === 'string' ? atlas.id.trim() : ''
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      diagnostics.push({ severity: 'error', path: `${path}.id`, message: 'atlas id must be a lowercase URL-safe slug' })
    } else if (ids.has(id)) {
      diagnostics.push({ severity: 'error', path: `${path}.id`, message: `duplicate atlas id "${id}"` })
    }
    ids.add(id)
    const size = numberInRange(atlas.size, 128, 8192, `${path}.size`, diagnostics)
    const targetDensity = numberInRange(atlas.targetDensity, 1, 8192, `${path}.targetDensity`, diagnostics)
    const margin = numberInRange(atlas.margin, 0, 256, `${path}.margin`, diagnostics)
    const fitPolicy = atlas.fitPolicy
    if (fitPolicy !== 'block' && fitPolicy !== 'scale') {
      diagnostics.push({ severity: 'error', path: `${path}.fitPolicy`, message: 'fitPolicy must be block or scale' })
    }
    const bakeOutput = atlas.bakeOutput
    if (bakeOutput !== undefined && bakeOutput !== 'lighting' && bakeOutput !== 'appearance') {
      diagnostics.push({
        severity: 'error', path: `${path}.bakeOutput`,
        message: 'bakeOutput must be lighting or appearance',
      })
    }
    atlases.push({
      id,
      name: typeof atlas.name === 'string' && atlas.name.trim() ? atlas.name.trim() : id,
      size,
      targetDensity,
      margin,
      fitPolicy: fitPolicy === 'scale' ? 'scale' : 'block',
      // Recipes written before bakeOutput existed produced flattened Combined
      // atlases. Preserve that appearance instead of silently changing them.
      bakeOutput: bakeOutput === 'lighting' ? 'lighting' : 'appearance',
    })
  }
  if (atlases[0]?.id !== 'main') {
    diagnostics.push({ severity: 'error', path: 'atlases[0]', message: 'the first atlas must be the undeletable main atlas' })
  }

  const preview = parseQuality(input.preview, 'preview', diagnostics, DEFAULT_SCENE_RECIPE.preview)
  const final = parseQuality(input.final, 'final', diagnostics, DEFAULT_SCENE_RECIPE.final)
  const states = parseStates(input.states, diagnostics)
  const camera = parseCamera(input.camera, diagnostics)
  const playback = parsePlayback(input.playback, diagnostics)
  const animationSequence = parseAnimationSequence(input.animationSequence, diagnostics)
  const look = parseLook(input.look, diagnostics)
  const fog = parseFog(input.fog, diagnostics)
  const shadows = parseShadows(input.shadows, diagnostics)
  const environment = parseEnvironment(input.environment, diagnostics)
  const reflectionProbes = parseReflectionProbes(input.reflectionProbes, diagnostics)
  const parsedComponents = parsePortableComponents(input.components)
  diagnostics.push(...parsedComponents.diagnostics)
  if (look.background !== 'application' && (environment.background === 'image' || environment.background === 'grounded')) {
    diagnostics.push({
      severity: 'error', path: 'environment.background',
      message: 'visible HDR background conflicts with the explicit Website Look background',
    })
  }
  const optimization = parseOptimization(input.optimization, diagnostics)
  const errors = diagnostics.some((entry) => entry.severity === 'error')
  return {
    recipe: errors
      ? null
      : {
          schemaVersion: SCENE_RECIPE_SCHEMA_VERSION,
          presentation: presentation as PresentationMode,
          atlases,
          preview,
          final,
          states,
          ...(camera ? { camera } : {}),
          playback,
          ...(animationSequence ? { animationSequence } : {}),
          look,
          fog,
          shadows,
          environment,
          reflectionProbes,
          components: parsedComponents.components,
          optimization,
        },
    diagnostics,
  }
}

function parseReflectionProbes(
  value: unknown,
  diagnostics: RecipeDiagnostic[],
): ReflectionProbeRecipe[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    diagnostics.push({ severity: 'error', path: 'reflectionProbes', message: 'reflection probes must be a list' })
    return []
  }
  const ids = new Set<string>()
  const objectIds = new Set<string>()
  const probes: ReflectionProbeRecipe[] = []
  for (const [index, raw] of value.entries()) {
    const path = `reflectionProbes[${index}]`
    if (!raw || typeof raw !== 'object') {
      diagnostics.push({ severity: 'error', path, message: 'reflection probe must be an object' })
      continue
    }
    const input = raw as Record<string, unknown>
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const objectId = typeof input.objectId === 'string' ? input.objectId.trim() : ''
    const objectName = typeof input.objectName === 'string' ? input.objectName.trim() : ''
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      diagnostics.push({ severity: 'error', path: `${path}.id`, message: 'probe id must be a lowercase URL-safe slug' })
    } else if (ids.has(id)) {
      diagnostics.push({ severity: 'error', path: `${path}.id`, message: `duplicate reflection probe id "${id}"` })
    }
    ids.add(id)
    if (!name) diagnostics.push({ severity: 'error', path: `${path}.name`, message: 'reflection probe needs a name' })
    if (!objectId) {
      diagnostics.push({ severity: 'error', path: `${path}.objectId`, message: 'reflection probe needs a stable object ID' })
    } else if (objectIds.has(objectId)) {
      diagnostics.push({ severity: 'error', path: `${path}.objectId`, message: `duplicate reflection probe object ID "${objectId}"` })
    }
    objectIds.add(objectId)
    if (!objectName) {
      diagnostics.push({ severity: 'error', path: `${path}.objectName`, message: 'reflection probe needs a Blender object name' })
    }
    const shape = input.shape
    if (shape !== 'box' && shape !== 'sphere') {
      diagnostics.push({ severity: 'error', path: `${path}.shape`, message: 'probe shape must be box or sphere' })
    }
    const resolution = numberInRange(input.resolution, 64, 2048, `${path}.resolution`, diagnostics, 256)
    if (!Number.isInteger(Math.log2(resolution))) {
      diagnostics.push({ severity: 'error', path: `${path}.resolution`, message: 'probe resolution must be a power of two' })
    }
    const source = input.source === undefined ? 'runtime' : input.source
    if (source !== 'runtime' && source !== 'baked' && source !== 'custom') {
      diagnostics.push({ severity: 'error', path: `${path}.source`, message: 'probe source must be runtime, baked, or custom' })
    }
    const samples = numberInRange(input.samples ?? 128, 1, 16384, `${path}.samples`, diagnostics, 128)
    if (!Number.isInteger(samples)) {
      diagnostics.push({ severity: 'error', path: `${path}.samples`, message: 'probe samples must be an integer' })
    }
    const textureInput = input.texture
    let texture: ReflectionProbeRecipe['texture']
    if (source === 'runtime') {
      if (textureInput !== undefined) {
        diagnostics.push({ severity: 'error', path: `${path}.texture`, message: 'runtime probes must not declare a texture' })
      }
    } else if (!textureInput || typeof textureInput !== 'object' || Array.isArray(textureInput)) {
      diagnostics.push({ severity: 'error', path: `${path}.texture`, message: `${String(source)} probes need texture evidence` })
    } else {
      const rawTexture = textureInput as Record<string, unknown>
      const imageName = typeof rawTexture.imageName === 'string' ? rawTexture.imageName.trim() : ''
      if (!imageName) {
        diagnostics.push({ severity: 'error', path: `${path}.texture.imageName`, message: 'probe texture needs a Blender image name' })
      }
      const width = numberInRange(rawTexture.width, 32, 8192, `${path}.texture.width`, diagnostics, 32)
      const height = numberInRange(rawTexture.height, 16, 4096, `${path}.texture.height`, diagnostics, 16)
      if (!Number.isInteger(width) || !Number.isInteger(height)) {
        diagnostics.push({ severity: 'error', path: `${path}.texture`, message: 'probe texture dimensions must be integers' })
      } else if (width !== height * 2) {
        diagnostics.push({ severity: 'error', path: `${path}.texture`, message: 'probe texture must be 2:1 equirectangular' })
      }
      const format = rawTexture.format
      const formats = ['hdr', 'exr', 'png', 'jpeg', 'webp'] as const
      if (!formats.includes(format as typeof formats[number])) {
        diagnostics.push({ severity: 'error', path: `${path}.texture.format`, message: 'probe texture format must be hdr, exr, png, jpeg, or webp' })
      }
      const colorSpace = rawTexture.colorSpace
      if (colorSpace !== 'linear' && colorSpace !== 'srgb') {
        diagnostics.push({ severity: 'error', path: `${path}.texture.colorSpace`, message: 'probe texture colorSpace must be linear or srgb' })
      }
      const sourceHash = typeof rawTexture.sourceHash === 'string' ? rawTexture.sourceHash : undefined
      const contentHash = typeof rawTexture.contentHash === 'string' ? rawTexture.contentHash : undefined
      if (source === 'baked') {
        if (!sourceHash || !/^[0-9a-f]{16,64}$/.test(sourceHash)) {
          diagnostics.push({ severity: 'error', path: `${path}.texture.sourceHash`, message: 'baked probe needs a valid source hash' })
        }
        if (!contentHash || !/^[0-9a-f]{16,64}$/.test(contentHash)) {
          diagnostics.push({ severity: 'error', path: `${path}.texture.contentHash`, message: 'baked probe needs a valid content hash' })
        }
      } else if (sourceHash !== undefined || contentHash !== undefined) {
        diagnostics.push({ severity: 'error', path: `${path}.texture`, message: 'custom probe hashes are derived at publish time, not authored' })
      }
      texture = {
        imageName,
        width,
        height,
        format: formats.includes(format as typeof formats[number])
          ? format as typeof formats[number]
          : 'hdr',
        colorSpace: colorSpace === 'srgb' ? 'srgb' : 'linear',
        ...(sourceHash ? { sourceHash } : {}),
        ...(contentHash ? { contentHash } : {}),
      }
    }
    const anchorId = typeof input.anchorId === 'string' && input.anchorId.trim() ? input.anchorId.trim() : undefined
    const anchorName = typeof input.anchorName === 'string' && input.anchorName.trim() ? input.anchorName.trim() : undefined
    if (anchorName && !anchorId) {
      diagnostics.push({ severity: 'error', path: `${path}.anchorId`, message: 'probe anchor name needs a stable anchor ID' })
    }
    probes.push({
      id,
      name,
      objectId,
      objectName,
      shape: shape === 'sphere' ? 'sphere' : 'box',
      source: source === 'baked' || source === 'custom' ? source : 'runtime',
      resolution,
      samples,
      influence: numberInRange(input.influence, 0.01, 1000000, `${path}.influence`, diagnostics, 5),
      intensity: numberInRange(input.intensity, 0, 100, `${path}.intensity`, diagnostics, 1),
      ...(anchorId ? { anchorId } : {}),
      ...(anchorName ? { anchorName } : {}),
      ...(texture ? { texture } : {}),
    })
  }
  return probes
}

function parseShadows(value: unknown, diagnostics: RecipeDiagnostic[]): ShadowRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.shadows
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'shadows', message: 'shadows must be an object' })
    return DEFAULT_SCENE_RECIPE.shadows
  }
  const input = value as Record<string, unknown>
  const preset = input.preset
  const presets: ShadowPreset[] = ['application', 'off', 'performance', 'balanced', 'soft', 'crisp', 'custom']
  if (!presets.includes(preset as ShadowPreset)) {
    diagnostics.push({ severity: 'error', path: 'shadows.preset', message: `shadow preset must be ${presets.join(', ')}` })
  }
  const filter = input.filter
  if (filter !== 'basic' && filter !== 'pcf' && filter !== 'vsm') {
    diagnostics.push({ severity: 'error', path: 'shadows.filter', message: 'shadow filter must be basic, pcf, or vsm' })
  }
  if (typeof input.autoUpdate !== 'boolean') {
    diagnostics.push({ severity: 'error', path: 'shadows.autoUpdate', message: 'shadow autoUpdate must be true or false' })
  }
  return {
    preset: presets.includes(preset as ShadowPreset) ? preset as ShadowPreset : 'application',
    filter: filter === 'basic' || filter === 'vsm' ? filter : 'pcf',
    mapSize: numberInRange(input.mapSize, 128, 8192, 'shadows.mapSize', diagnostics, 1024),
    maxDistance: numberInRange(input.maxDistance, 0.1, 100000, 'shadows.maxDistance', diagnostics, 50),
    bias: numberInRange(input.bias, -0.1, 0.1, 'shadows.bias', diagnostics, -0.0005),
    normalBias: numberInRange(input.normalBias, 0, 10, 'shadows.normalBias', diagnostics, 0.02),
    radius: numberInRange(input.radius, 0, 32, 'shadows.radius', diagnostics, 1),
    autoUpdate: typeof input.autoUpdate === 'boolean' ? input.autoUpdate : true,
  }
}

function parseEnvironment(value: unknown, diagnostics: RecipeDiagnostic[]): EnvironmentRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.environment
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'environment', message: 'environment must be an object' })
    return DEFAULT_SCENE_RECIPE.environment
  }
  const input = value as Record<string, unknown>
  const source = input.source
  if (source !== 'application' && source !== 'image') {
    diagnostics.push({ severity: 'error', path: 'environment.source', message: 'environment source must be application or image' })
  }
  const imageName = typeof input.imageName === 'string' && input.imageName.trim() ? input.imageName.trim() : undefined
  if (source === 'image' && !imageName) {
    diagnostics.push({ severity: 'error', path: 'environment.imageName', message: 'published environment needs a Blender image' })
  }
  const lighting = input.lighting
  if (lighting !== 'application' && lighting !== 'image' && lighting !== 'none') {
    diagnostics.push({ severity: 'error', path: 'environment.lighting', message: 'environment lighting must be application, image, or none' })
  }
  const background = input.background
  if (background !== 'application' && background !== 'image' && background !== 'grounded' && background !== 'none') {
    diagnostics.push({ severity: 'error', path: 'environment.background', message: 'environment background must be application, image, grounded, or none' })
  }
  if (source !== 'image' && (lighting === 'image' || background === 'image' || background === 'grounded')) {
    diagnostics.push({
      severity: 'error', path: 'environment.source',
      message: 'choose a published HDR image before using it for lighting or background',
    })
  }
  return {
    source: source === 'image' ? 'image' : 'application',
    ...(imageName ? { imageName } : {}),
    lighting: lighting === 'image' || lighting === 'none' ? lighting : 'application',
    background: background === 'image' || background === 'grounded' || background === 'none'
      ? background
      : 'application',
    lightingIntensity: numberInRange(input.lightingIntensity, 0, 100, 'environment.lightingIntensity', diagnostics, 1),
    lightingRotation: numberInRange(input.lightingRotation, -360, 360, 'environment.lightingRotation', diagnostics, 0),
    backgroundIntensity: numberInRange(input.backgroundIntensity, 0, 100, 'environment.backgroundIntensity', diagnostics, 1),
    backgroundRotation: numberInRange(input.backgroundRotation, -360, 360, 'environment.backgroundRotation', diagnostics, 0),
    backgroundBlur: numberInRange(input.backgroundBlur, 0, 1, 'environment.backgroundBlur', diagnostics, 0),
    groundHeight: numberInRange(input.groundHeight, 0.01, 100000, 'environment.groundHeight', diagnostics, 2),
    groundRadius: numberInRange(input.groundRadius, 0.01, 1000000, 'environment.groundRadius', diagnostics, 100),
  }
}

function parseLook(value: unknown, diagnostics: RecipeDiagnostic[]): LookRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.look
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'look', message: 'look must be an object' })
    return DEFAULT_SCENE_RECIPE.look
  }
  const input = value as Record<string, unknown>
  const toneMapping = input.toneMapping
  if (toneMapping !== 'application' && toneMapping !== 'agx' && toneMapping !== 'neutral' && toneMapping !== 'aces' && toneMapping !== 'none') {
    diagnostics.push({ severity: 'error', path: 'look.toneMapping', message: 'tone mapping must be application, agx, neutral, aces, or none' })
  }
  const background = input.background
  if (background !== 'application' && background !== 'transparent' && background !== 'color') {
    diagnostics.push({ severity: 'error', path: 'look.background', message: 'background must be application, transparent, or color' })
  }
  let backgroundColor: [number, number, number] | undefined
  if (background === 'color') {
    if (!Array.isArray(input.backgroundColor) || input.backgroundColor.length !== 3) {
      diagnostics.push({ severity: 'error', path: 'look.backgroundColor', message: 'color background needs three linear RGB values' })
    } else {
      backgroundColor = input.backgroundColor.map((channel, index) =>
        numberInRange(channel, 0, 1, `look.backgroundColor[${index}]`, diagnostics, 0),
      ) as [number, number, number]
    }
  }
  return {
    toneMapping: toneMapping === 'agx' || toneMapping === 'neutral' || toneMapping === 'aces' || toneMapping === 'none'
      ? toneMapping
      : 'application',
    exposure: numberInRange(input.exposure, -10, 10, 'look.exposure', diagnostics, 0),
    background: background === 'transparent' || background === 'color' ? background : 'application',
    ...(backgroundColor ? { backgroundColor } : {}),
  }
}

function parseFog(value: unknown, diagnostics: RecipeDiagnostic[]): FogRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.fog
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'fog', message: 'fog must be an object' })
    return DEFAULT_SCENE_RECIPE.fog
  }
  const input = value as Record<string, unknown>
  const mode = input.mode
  if (mode !== 'application' && mode !== 'none' && mode !== 'linear' && mode !== 'exponential') {
    diagnostics.push({
      severity: 'error', path: 'fog.mode',
      message: 'fog mode must be application, none, linear, or exponential',
    })
  }
  let color: [number, number, number] = [...DEFAULT_SCENE_RECIPE.fog.color]
  if (!Array.isArray(input.color) || input.color.length !== 3) {
    diagnostics.push({ severity: 'error', path: 'fog.color', message: 'fog color needs three linear RGB values' })
  } else {
    color = input.color.map((channel, index) =>
      numberInRange(channel, 0, 1, `fog.color[${index}]`, diagnostics, 0),
    ) as [number, number, number]
  }
  const near = numberInRange(input.near, 0, 1000000, 'fog.near', diagnostics, 10)
  const far = numberInRange(input.far, 0.001, 1000000, 'fog.far', diagnostics, 100)
  if (far <= near) {
    diagnostics.push({ severity: 'error', path: 'fog.far', message: 'linear fog far distance must exceed near distance' })
  }
  return {
    mode: mode === 'none' || mode === 'linear' || mode === 'exponential' ? mode : 'application',
    color,
    near,
    far,
    density: numberInRange(input.density, 0.000001, 100, 'fog.density', diagnostics, 0.02),
  }
}

function parsePlayback(value: unknown, diagnostics: RecipeDiagnostic[]): PlaybackRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.playback
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'playback', message: 'playback must be an object' })
    return DEFAULT_SCENE_RECIPE.playback
  }
  const input = value as Record<string, unknown>
  const start = input.start
  if (start !== 'manual' && start !== 'first' && start !== 'named' && start !== 'all') {
    diagnostics.push({ severity: 'error', path: 'playback.start', message: 'animation start must be manual, first, named, or all' })
  }
  const clip = typeof input.clip === 'string' && input.clip.trim() ? input.clip.trim() : undefined
  if (start === 'named' && !clip) {
    diagnostics.push({ severity: 'error', path: 'playback.clip', message: 'named animation playback needs a clip name' })
  }
  const loop = input.loop
  if (loop !== 'once' && loop !== 'repeat' && loop !== 'pingpong') {
    diagnostics.push({ severity: 'error', path: 'playback.loop', message: 'animation loop must be once, repeat, or pingpong' })
  }
  return {
    start: start === 'first' || start === 'named' || start === 'all' ? start : 'manual',
    ...(clip ? { clip } : {}),
    loop: loop === 'once' || loop === 'pingpong' ? loop : 'repeat',
    speed: numberInRange(input.speed, 0.05, 4, 'playback.speed', diagnostics, 1),
  }
}

function parseAnimationSequence(
  value: unknown,
  diagnostics: RecipeDiagnostic[],
): AnimationSequenceRecipe | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'animationSequence', message: 'animation sequence must be an object' })
    return undefined
  }
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) diagnostics.push({ severity: 'error', path: 'animationSequence.name', message: 'animation sequence needs a name' })
  const sourceInput = input.source && typeof input.source === 'object'
    ? input.source as Record<string, unknown>
    : {}
  if (!input.source || typeof input.source !== 'object') {
    diagnostics.push({ severity: 'error', path: 'animationSequence.source', message: 'animation sequence needs its Blender NLA source' })
  }
  const objectId = typeof sourceInput.objectId === 'string' ? sourceInput.objectId.trim() : ''
  const objectName = typeof sourceInput.objectName === 'string' ? sourceInput.objectName.trim() : ''
  const track = typeof sourceInput.track === 'string' ? sourceInput.track.trim() : ''
  if (!objectId) diagnostics.push({ severity: 'error', path: 'animationSequence.source.objectId', message: 'NLA source needs a stable object ID' })
  if (!objectName) diagnostics.push({ severity: 'error', path: 'animationSequence.source.objectName', message: 'NLA source needs an object name' })
  if (!track) diagnostics.push({ severity: 'error', path: 'animationSequence.source.track', message: 'choose one NLA track' })
  const loop = input.loop
  if (typeof loop !== 'boolean') {
    diagnostics.push({ severity: 'error', path: 'animationSequence.loop', message: 'animation sequence loop must be true or false' })
  }
  const speed = numberInRange(input.speed, 0.05, 4, 'animationSequence.speed', diagnostics, 1)
  const duration = numberInRange(input.duration, 0.000001, 86400, 'animationSequence.duration', diagnostics, 1)
  const rawStrips = Array.isArray(input.strips) ? input.strips : []
  if (rawStrips.length === 0) {
    diagnostics.push({ severity: 'error', path: 'animationSequence.strips', message: 'selected NLA track needs at least one clip strip' })
  }
  const orders = new Set<number>()
  const strips: AnimationSequenceStrip[] = []
  for (const [index, raw] of rawStrips.entries()) {
    const path = `animationSequence.strips[${index}]`
    if (!raw || typeof raw !== 'object') {
      diagnostics.push({ severity: 'error', path, message: 'NLA strip must be an object' })
      continue
    }
    const strip = raw as Record<string, unknown>
    const order = numberInRange(strip.order, 0, 100000, `${path}.order`, diagnostics, index)
    if (!Number.isInteger(order)) diagnostics.push({ severity: 'error', path: `${path}.order`, message: 'strip order must be an integer' })
    if (orders.has(order)) diagnostics.push({ severity: 'error', path: `${path}.order`, message: `duplicate strip order ${order}` })
    orders.add(order)
    const stripName = typeof strip.name === 'string' ? strip.name.trim() : ''
    const clip = typeof strip.clip === 'string' ? strip.clip.trim() : ''
    if (!stripName) diagnostics.push({ severity: 'error', path: `${path}.name`, message: 'NLA strip needs a name' })
    if (!clip) diagnostics.push({ severity: 'error', path: `${path}.clip`, message: 'NLA strip needs an exported Action clip' })
    const at = numberInRange(strip.at, 0, 86400, `${path}.at`, diagnostics, 0)
    const stripDuration = numberInRange(strip.duration, 0.000001, 86400, `${path}.duration`, diagnostics, 1)
    const clipStart = numberInRange(strip.clipStart, 0, 86400, `${path}.clipStart`, diagnostics, 0)
    const clipEnd = numberInRange(strip.clipEnd, 0.000001, 86400, `${path}.clipEnd`, diagnostics, 1)
    if (clipEnd <= clipStart) diagnostics.push({ severity: 'error', path: `${path}.clipEnd`, message: 'clip trim end must exceed trim start' })
    const scale = numberInRange(strip.scale, 0.01, 100, `${path}.scale`, diagnostics, 1)
    const stripSpeed = numberInRange(strip.speed, 0.01, 100, `${path}.speed`, diagnostics, 1)
    if (Math.abs(stripSpeed - 1 / scale) > Math.max(1e-5, stripSpeed * 1e-4)) {
      diagnostics.push({ severity: 'error', path: `${path}.speed`, message: 'strip speed must be the reciprocal of NLA scale' })
    }
    const repeat = numberInRange(strip.repeat, 0.01, 1000, `${path}.repeat`, diagnostics, 1)
    const expectedDuration = Math.max(0, clipEnd - clipStart) * scale * repeat
    if (Math.abs(stripDuration - expectedDuration) > Math.max(1e-4, expectedDuration * 1e-4)) {
      diagnostics.push({
        severity: 'error', path: `${path}.duration`,
        message: 'strip duration must agree with trim, scale, and repeat; save the NLA edit again',
      })
    }
    const blend = strip.blend
    if (blend !== 'replace' && blend !== 'add') {
      diagnostics.push({ severity: 'error', path: `${path}.blend`, message: 'portable NLA blend must be replace or add' })
    }
    const blendIn = numberInRange(strip.blendIn, 0, stripDuration, `${path}.blendIn`, diagnostics, 0)
    const blendOut = numberInRange(strip.blendOut, 0, stripDuration, `${path}.blendOut`, diagnostics, 0)
    const weight = numberInRange(strip.weight, 0, 1, `${path}.weight`, diagnostics, 1)
    const easing = strip.easing
    if (easing !== 'linear' && easing !== 'ease-in' && easing !== 'ease-out' && easing !== 'ease-in-out') {
      diagnostics.push({ severity: 'error', path: `${path}.easing`, message: 'blend easing must be linear, ease-in, ease-out, or ease-in-out' })
    }
    const extrapolation = strip.extrapolation
    if (extrapolation !== 'nothing' && extrapolation !== 'hold-forward' && extrapolation !== 'hold') {
      diagnostics.push({ severity: 'error', path: `${path}.extrapolation`, message: 'portable NLA extrapolation must be nothing, hold-forward, or hold' })
    }
    if (typeof strip.reverse !== 'boolean') diagnostics.push({ severity: 'error', path: `${path}.reverse`, message: 'reverse must be true or false' })
    if (typeof strip.muted !== 'boolean') diagnostics.push({ severity: 'error', path: `${path}.muted`, message: 'muted must be true or false' })
    strips.push({
      order,
      name: stripName,
      clip,
      at,
      duration: stripDuration,
      clipStart,
      clipEnd,
      scale,
      speed: stripSpeed,
      repeat,
      blend: blend === 'add' ? 'add' : 'replace',
      blendIn,
      blendOut,
      weight,
      easing: (
        easing === 'ease-in' || easing === 'ease-out' || easing === 'ease-in-out'
          ? easing
          : 'linear'
      ) as AnimationSequenceEasing,
      extrapolation: extrapolation === 'hold' || extrapolation === 'hold-forward'
        ? extrapolation
        : 'nothing',
      reverse: strip.reverse === true,
      muted: strip.muted === true,
    })
  }
  strips.sort((left, right) => left.order - right.order)
  for (let index = 1; index < strips.length; index += 1) {
    const previous = strips[index - 1]!
    const current = strips[index]!
    if (current.at < previous.at + previous.duration - 1e-4) {
      diagnostics.push({
        severity: 'error', path: `animationSequence.strips[${index}].at`,
        message: `strip overlaps "${previous.name}"; choose one non-overlapping NLA track`,
      })
    }
  }
  const derivedDuration = strips.reduce((maximum, strip) => Math.max(maximum, strip.at + strip.duration), 0)
  if (strips.length > 0 && Math.abs(duration - derivedDuration) > Math.max(1e-4, duration * 1e-4)) {
    diagnostics.push({
      severity: 'error', path: 'animationSequence.duration',
      message: 'sequence duration must end with its last NLA strip; save the NLA edit again',
    })
  }
  return {
    name,
    source: { objectId, objectName, track },
    duration,
    loop: loop === true,
    speed,
    strips,
  }
}

function parseOptimization(
  value: unknown,
  diagnostics: RecipeDiagnostic[],
): OptimizationRecipe {
  if (value === undefined) return DEFAULT_SCENE_RECIPE.optimization
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'optimization', message: 'optimization must be an object' })
    return DEFAULT_SCENE_RECIPE.optimization
  }
  const geometry = (value as Record<string, unknown>).geometry
  const textures = (value as Record<string, unknown>).textures
  if (geometry !== 'none' && geometry !== 'meshopt') {
    diagnostics.push({ severity: 'error', path: 'optimization.geometry', message: 'geometry optimization must be none or meshopt' })
  }
  if (textures !== undefined && textures !== 'none' && textures !== 'ktx2') {
    diagnostics.push({ severity: 'error', path: 'optimization.textures', message: 'texture optimization must be none or ktx2' })
  }
  return {
    geometry: geometry === 'meshopt' ? 'meshopt' : 'none',
    textures: textures === 'ktx2' ? 'ktx2' : 'none',
  }
}

function parseCamera(
  value: unknown,
  diagnostics: RecipeDiagnostic[],
): PresentationCameraRecipe | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path: 'camera', message: 'camera must be an object' })
    return undefined
  }
  const input = value as Record<string, unknown>
  const objectId = typeof input.objectId === 'string' ? input.objectId.trim() : ''
  const objectName = typeof input.objectName === 'string' ? input.objectName.trim() : ''
  if (!objectId) diagnostics.push({ severity: 'error', path: 'camera.objectId', message: 'camera needs a stable object ID' })
  if (!objectName) diagnostics.push({ severity: 'error', path: 'camera.objectName', message: 'camera needs an object name' })
  const behavior = input.behavior
  if (behavior !== 'fixed' && behavior !== 'orbit' && behavior !== 'free') {
    diagnostics.push({ severity: 'error', path: 'camera.behavior', message: 'camera behavior must be fixed, orbit, or free' })
  }
  const targetId = typeof input.targetId === 'string' && input.targetId.trim() ? input.targetId.trim() : undefined
  const targetName = typeof input.targetName === 'string' && input.targetName.trim() ? input.targetName.trim() : undefined
  const framing = input.framing ?? 'authored'
  if (framing !== 'authored' && framing !== 'fit-scene' && framing !== 'fit-target') {
    diagnostics.push({
      severity: 'error', path: 'camera.framing',
      message: 'camera framing must be authored, fit-scene, or fit-target',
    })
  }
  if (behavior === 'orbit' && !targetId) {
    diagnostics.push({ severity: 'error', path: 'camera.targetId', message: 'orbit camera needs a target object' })
  }
  if (framing === 'fit-target' && !targetId) {
    diagnostics.push({ severity: 'error', path: 'camera.targetId', message: 'fit-target framing needs a target object' })
  }
  const rawFrames = Array.isArray(input.compositions) ? input.compositions : []
  if (rawFrames.length === 0) {
    diagnostics.push({ severity: 'error', path: 'camera.compositions', message: 'camera needs at least one composition frame' })
  }
  const names = new Set<string>()
  const compositions: CompositionFrameRecipe[] = []
  for (const [index, raw] of rawFrames.entries()) {
    const path = `camera.compositions[${index}]`
    if (!raw || typeof raw !== 'object') {
      diagnostics.push({ severity: 'error', path, message: 'composition frame must be an object' })
      continue
    }
    const frame = raw as Record<string, unknown>
    const name = typeof frame.name === 'string' ? frame.name.trim() : ''
    if (!name) diagnostics.push({ severity: 'error', path: `${path}.name`, message: 'composition name is required' })
    else if (names.has(name)) diagnostics.push({ severity: 'error', path: `${path}.name`, message: `duplicate composition "${name}"` })
    names.add(name)
    compositions.push({
      name,
      width: numberInRange(frame.width, 1, 16384, `${path}.width`, diagnostics, 1920),
      height: numberInRange(frame.height, 1, 16384, `${path}.height`, diagnostics, 1080),
      safeMargin: numberInRange(frame.safeMargin, 0, 0.45, `${path}.safeMargin`, diagnostics, 0.08),
    })
  }
  return {
    objectId,
    objectName,
    behavior: behavior === 'orbit' || behavior === 'free' ? behavior : 'fixed',
    ...(targetId ? { targetId } : {}),
    ...(targetName ? { targetName } : {}),
    framing: framing === 'fit-scene' || framing === 'fit-target' ? framing : 'authored',
    compositions,
  }
}

/** Resolve artist-owned visual intent into the existing exporter interface.
 * Filesystem paths, URLs, collection selection, and exporter escape hatches
 * remain project-owned and are passed through from configSettings. */
export function exportSettingsFromRecipe(
  recipe: SceneRecipe,
  configSettings: ExportSettings = {},
  quality: 'preview' | 'final' = 'final',
): ExportSettings {
  const profile = recipe[quality]
  const main = recipe.atlases[0]!
  const scaledSize = (size: number) => Math.min(
    size,
    Math.max(Math.min(size, 256), clampPowerOfTwo(size * profile.resolutionScale)),
  )
  const atlasScale = (size: number) => scaledSize(size) / size
  const scaledMargin = (margin: number, scale: number) => margin === 0
    ? 0
    : Math.max(1, Math.round(margin * scale))
  const common: ExportSettings = {
    ...(configSettings.collection ? { collection: configSettings.collection } : {}),
    ...(configSettings.imageFormat ? { imageFormat: configSettings.imageFormat } : {}),
    ...(configSettings.curveSamples ? { curveSamples: configSettings.curveSamples } : {}),
    ...(configSettings.exporterOverrides ? { exporterOverrides: configSettings.exporterOverrides } : {}),
  }
  if (recipe.presentation === 'realtime') return { ...common, mode: 'standard' }
  const bake: BakeSettings = {
    size: scaledSize(main.size),
    samples: profile.samples,
    margin: scaledMargin(main.margin, atlasScale(main.size)),
    supersample: profile.supersample,
    denoise: profile.denoise,
    states: recipe.states,
    ...(quality === 'preview' && recipe.atlases.some((atlas) => atlas.fitPolicy === 'block')
      ? { previewScaleToFit: true }
      : {}),
    // Always declare Main as well as artist-created atlases. bakeOutput is
    // per-atlas intent, so an implicit single atlas would silently lose it.
    atlases: Object.fromEntries(
      recipe.atlases.map((atlas) => {
        const size = scaledSize(atlas.size)
        const scale = size / atlas.size
        return [atlas.id, {
          size,
          targetDensity: atlas.targetDensity * scale,
          // Padding is pixel-authored against the atlas resolution. Preview
          // scales both together so a 25% atlas does not spend 4x the intended
          // fraction on gutters (which can collapse every island to zero).
          margin: scaledMargin(atlas.margin, scale),
          fitPolicy: quality === 'preview' ? 'scale' : atlas.fitPolicy,
          bakeOutput: atlas.bakeOutput,
        }]
      }),
    ),
  }
  return { ...common, mode: 'baked', bake }
}

function parseQuality(
  value: unknown,
  path: string,
  diagnostics: RecipeDiagnostic[],
  fallback: QualityRecipe,
): QualityRecipe {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (!value || typeof value !== 'object') {
    diagnostics.push({ severity: 'error', path, message: 'quality profile must be an object' })
  }
  return {
    samples: numberInRange(input.samples, 1, 16384, `${path}.samples`, diagnostics, fallback.samples),
    supersample: numberInRange(input.supersample, 1, 4, `${path}.supersample`, diagnostics, fallback.supersample),
    denoise: typeof input.denoise === 'boolean' ? input.denoise : fallback.denoise,
    resolutionScale: numberInRange(input.resolutionScale, 0.0625, 1, `${path}.resolutionScale`, diagnostics, fallback.resolutionScale),
  }
}

function parseStates(value: unknown, diagnostics: RecipeDiagnostic[]): LightingStateRecipe[] {
  const input = Array.isArray(value) && value.length > 0 ? value : [{ name: 'default' }]
  const names = new Set<string>()
  const states: LightingStateRecipe[] = []
  for (const [index, raw] of input.entries()) {
    const path = `states[${index}]`
    if (!raw || typeof raw !== 'object') {
      diagnostics.push({ severity: 'error', path, message: 'state must be an object' })
      continue
    }
    const entry = raw as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) diagnostics.push({ severity: 'error', path: `${path}.name`, message: 'state name is required' })
    else if (names.has(name)) diagnostics.push({ severity: 'error', path: `${path}.name`, message: `duplicate state "${name}"` })
    names.add(name)
    const hidden = Array.isArray(entry.hideCollections)
      ? entry.hideCollections.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined
    states.push({ name, ...(hidden?.length ? { hideCollections: hidden } : {}) })
  }
  return states
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  path: string,
  diagnostics: RecipeDiagnostic[],
  fallback = min,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    diagnostics.push({ severity: 'error', path, message: `must be a number from ${min} to ${max}` })
    return fallback
  }
  return value
}

function clampPowerOfTwo(value: number): number {
  const exponent = Math.round(Math.log2(Math.max(128, Math.min(8192, value))))
  return 2 ** exponent
}
