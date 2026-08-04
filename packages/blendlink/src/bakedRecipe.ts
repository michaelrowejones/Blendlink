import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** The owned baked-composition recipe (shadcn model): written ONCE into the
 * user's genDir beside the generated module, then it is THEIRS â€” sync never
 * overwrites it. */

export const BAKED_RECIPE_TEMPLATE_VERSION = 11
export const BAKED_RECIPE_TEMPLATE_MARKER = 'blendlink-baked-recipe-template-version'

export type BakedRecipeTemplateStatus =
  | { kind: 'current'; version: number }
  | { kind: 'legacy'; version: null }
  | { kind: 'outdated'; version: number }
  | { kind: 'future'; version: number }

/** Inspect only Blendlink's explicit marker. An unmarked recipe may contain
 * artist edits, so callers must treat it as legacy and never overwrite it
 * without an explicit backed-up migration action. */
export function inspectBakedRecipeTemplate(source: string): BakedRecipeTemplateStatus {
  const match = source.match(/^\/\/ blendlink-baked-recipe-template-version:\s*(\d+)\s*$/m)
  if (!match) return { kind: 'legacy', version: null }
  const version = Number(match[1])
  if (version === BAKED_RECIPE_TEMPLATE_VERSION) return { kind: 'current', version }
  if (version < BAKED_RECIPE_TEMPLATE_VERSION) return { kind: 'outdated', version }
  return { kind: 'future', version }
}

export function bakedRecipeBackupPath(
  recipePath: string,
  status: BakedRecipeTemplateStatus,
): string {
  const label = status.version === null ? 'legacy' : `v${status.version}`
  return `${recipePath}.blendlink-${label}.bak`
}

export function updateBakedRecipeTemplateFile(
  recipePath: string,
  sceneName: string,
): { action: 'created' | 'current' | 'updated'; backupPath: string | null } {
  if (!existsSync(recipePath)) {
    writeFileSync(recipePath, renderBakedRecipe(sceneName))
    return { action: 'created', backupPath: null }
  }
  const current = readFileSync(recipePath, 'utf8')
  const status = inspectBakedRecipeTemplate(current)
  if (status.kind === 'current') return { action: 'current', backupPath: null }
  if (status.kind === 'future') {
    throw new Error(
      `${recipePath} uses baked recipe template v${status.version}, newer than this release supports ` +
        `(v${BAKED_RECIPE_TEMPLATE_VERSION}); install the matching newer Blendlink release.`,
    )
  }
  const backupPath = bakedRecipeBackupPath(recipePath, status)
  if (existsSync(backupPath)) {
    if (readFileSync(backupPath, 'utf8') !== current) {
      throw new Error(
        `Refusing to update ${recipePath}: deterministic backup ${backupPath} already exists ` +
          'with different bytes. Move or rename that backup, then retry.',
      )
    }
  } else {
    writeFileSync(backupPath, current, { flag: 'wx' })
  }
  writeFileSync(recipePath, renderBakedRecipe(sceneName))
  return { action: 'updated', backupPath }
}

export function renderBakedRecipe(exportName: string): string {
  return `/* Generated once by blendlink â€” this file is YOURS to edit and will not
 * be overwritten. Runtime contract: blendlink docs/MANIFEST.md.
 *
 * Composes a baked scene: base state atlas + additive light-group layers in
 * linear space, plus the exact object/light visibility of Blender states.
 * The returned handle owns every patch and texture it installs; call dispose().
 */
// ${BAKED_RECIPE_TEMPLATE_MARKER}: ${BAKED_RECIPE_TEMPLATE_VERSION}
import * as THREE from 'three'
import { ${exportName} } from './${exportName}.gen'

type GroupedUrl = Record<string, string>
type GroupedLayer = Record<string, { url: string; maxValue: number }>
type BakeOutput = 'appearance' | 'lighting'
type BakeOutputs = Record<string, BakeOutput>
type StateScales = Record<string, Record<string, number>>
type StateVisibility = Record<string, {
  hiddenObjectIds: readonly string[]
  hiddenObjectNames: readonly string[]
}>
type TextureVariant = {
  url: string
  format: 'png' | 'webp'
  width: number
  height: number
  bytes: number
  hash: string
  lossless: true
}

function statesByGroup(entry: string | GroupedUrl): GroupedUrl {
  return typeof entry === 'string' ? { main: entry } : entry
}

function layersByGroup(
  entry: { url: string; maxValue: number } | GroupedLayer,
): GroupedLayer {
  return 'url' in entry && typeof entry.url === 'string'
    ? { main: entry as { url: string; maxValue: number } }
    : (entry as GroupedLayer)
}

function loadedName(name: string): string {
  return name.replace(/\\s/g, '_').replace(/[\\[\\]%$.:/]/g, '')
}

interface BakeBinding {
  group: string
  output: BakeOutput
  lightmapUv: number | null
}

// Loader-owned objects may come from another evaluated copy of Three. Three's
// canonical is* brands are stable across that boundary; constructor identity
// is not (notably with linked packages, custom loaders, and R3F caches).
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

function isMeshBasicMaterial(material: THREE.Material): material is THREE.MeshBasicMaterial {
  return (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true
}

function isMeshStandardMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
}

function bindingOf(object: THREE.Object3D, bakeOutputs: BakeOutputs): BakeBinding | null {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const tagged = current.userData?.blendlink_atlas
    if (typeof tagged === 'string' && tagged.length > 0) {
      const authoredOutput = current.userData?.blendlink_bake_output
      if (authoredOutput !== undefined &&
          authoredOutput !== 'appearance' && authoredOutput !== 'lighting') {
        throw new Error(
          'Baked object "' + current.name + '" has unsupported blendlink_bake_output "' +
          String(authoredOutput) + '".',
        )
      }
      const atlasOutput = bakeOutputs[tagged]
      if (authoredOutput !== undefined && atlasOutput !== undefined && authoredOutput !== atlasOutput) {
        throw new Error(
          'Baked object "' + current.name + '" declares ' + authoredOutput +
          ' output, but atlas "' + tagged + '" is declared ' + atlasOutput + '.',
        )
      }
      if (authoredOutput === 'lighting' && atlasOutput === undefined) {
        throw new Error(
          'Lighting object "' + current.name + '" belongs to atlas "' + tagged +
          '", but the generated bakeOutputs contract has no Lighting entry. Re-sync the scene.',
        )
      }
      const output = authoredOutput ?? atlasOutput ?? 'appearance'
      const lightmapUv = current.userData?.blendlink_lightmap_uv
      if (lightmapUv !== undefined &&
          (typeof lightmapUv !== 'number' || !Number.isInteger(lightmapUv) ||
           lightmapUv < 1 || lightmapUv > 3)) {
        throw new Error(
          'Baked object "' + current.name + '" has invalid blendlink_lightmap_uv ' +
          String(lightmapUv) + '; expected glTF TEXCOORD channel 1, 2, or 3.',
        )
      }
      if (output === 'lighting' && lightmapUv === undefined) {
        throw new Error(
          'Lighting object "' + current.name + '" has no blendlink_lightmap_uv. Re-sync the scene.',
        )
      }
      return { group: tagged, output, lightmapUv: output === 'lighting' ? lightmapUv as number : null }
    }
    // Multi-primitive glTF nodes create anonymous Mesh children, so they may
    // inherit the authored parent's atlas. An authored node has a stable ID:
    // crossing one without an atlas tag would incorrectly capture a Realtime
    // unlit mesh parented beneath a baked object.
    if (typeof current.userData?.blendlink_id === 'string') {
      if (current.userData?.blendlink_bake_output === 'lighting' ||
          current.userData?.blendlink_lightmap_uv !== undefined) {
        throw new Error('Lighting object "' + current.name + '" has no blendlink_atlas assignment.')
      }
      return null
    }
  }
  return null
}

interface LayerUniforms {
  map: { value: THREE.Texture | null }
  tint: { value: THREE.Color }
  strength: { value: number }
}

interface AppearanceEntry {
  output: 'appearance'
  material: THREE.MeshBasicMaterial
  group: string
  /** The default Appearance atlas is already decoded by GLTFLoader because
   * the exporter embeds it in the GLB. It remains loader/application-owned. */
  defaultMap: THREE.Texture | null
  originalMap: THREE.Texture | null
  installedMap: THREE.Texture | null
  stateScale: { value: number }
  originalOnBeforeCompile: THREE.Material['onBeforeCompile']
  installedOnBeforeCompile?: THREE.Material['onBeforeCompile']
  originalProgramCacheKey: () => string
  installedProgramCacheKey?: () => string
  layerUniforms: Map<string, LayerUniforms>
}

interface LightingEntry {
  output: 'lighting'
  material: THREE.MeshStandardMaterial
  group: string
  lightmapUv: number
  originalLightMap: THREE.Texture | null
  installedLightMap: THREE.Texture | null
  originalLightMapIntensity: number
  installedLightMapIntensity: number
}

type PatchedEntry = AppearanceEntry | LightingEntry

// A renderer able to prewarm baked textures, in either family. The two
// families expose the same fact through different shapes: the WebGL
// renderer carries a capabilities object, while the WebGPU renderer
// exposes getMaxAnisotropy() directly and has NO capabilities property at
// all (three r184 renderers/common/Renderer.js). Typing this seam as
// WebGL-only threw on every WebGPU scene carrying baked states, because
// prewarm is the default.
export type BakedPrewarmRenderer = Readonly<{
  initTexture(texture: THREE.Texture): void
  getMaxAnisotropy?: () => number
  capabilities?: Readonly<{ getMaxAnisotropy(): number }>
}>

function prewarmMaxAnisotropy(renderer: BakedPrewarmRenderer): number {
  if (renderer.capabilities) return renderer.capabilities.getMaxAnisotropy()
  return typeof renderer.getMaxAnisotropy === 'function'
    ? renderer.getMaxAnisotropy()
    : Number.NaN
}

export interface BakedSceneHandle {
  /** Resolves after the default state. Inactive light groups are deliberately
   * lazy so authored options do not become startup requests or GPU residency. */
  readonly ready: Promise<void>
  /** Resolves when an embedded bootstrap has been promoted to the selected
   * delivery tier. First paint deliberately does not wait for it. */
  readonly qualityReady: Promise<void>
  prepare(renderer: BakedPrewarmRenderer): Promise<void>
  setState(name: string): boolean
  setStateAsync(name: string): Promise<boolean>
  setLightGroup(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): boolean
  setLightGroupAsync(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): Promise<boolean>
  /** Keep a later material clone connected to this composition's states and
   * shader layers. Reflection probes use this seam rather than replacing a
   * state-owned material behind the composition's back. */
  trackMaterialClone(
    source: THREE.Material,
    clone: THREE.Material,
  ): (transferred: boolean) => void
  readonly lightGroupNames: readonly string[]
  dispose(): void
}

export type BakedAtlasDeliveryQuality = 'authored' | 'adaptive' | number

export interface BakedSceneOptions {
  /** Approximate GPU bytes retained by inactive, loader-owned state and light
   * textures. Active, loading, and application-transferred textures are never
   * evicted, so a single active atlas may exceed this cache budget safely. */
  textureCacheBytes?: number
  /** Shared attempt manager for package-owned atlas requests, progress, URL
   * modification, and manager-supported abort. */
  loadingManager?: THREE.LoadingManager
  /** Atlas tier policy. 'authored' (default) selects the highest advertised
   * resolution, 'adaptive' uses viewport/device hints, and a positive finite
   * number selects the smallest advertised tier at or above that resolution. */
  atlasDeliveryQuality?: BakedAtlasDeliveryQuality
}

/** Wire one loaded baked scene. Shared materials and repeated URLs are each
 * patched/loaded once. Any ambiguous cross-atlas material is rejected before
 * mutation because one material cannot safely sample two atlas groups. */
export function createBakedScene(
  root: THREE.Object3D,
  options: BakedSceneOptions = {},
): BakedSceneHandle {
  const states = (${exportName}.states ?? {}) as Record<string, string | GroupedUrl>
  const defaultState = ${exportName}.defaultState as string | null
  const bakeOutputs = (${exportName}.bakeOutputs ?? {}) as BakeOutputs
  const stateScales = (${exportName}.stateScales ?? {}) as StateScales
  const lightGroups = (${exportName}.lightGroups ?? {}) as Record<
    string,
    { url: string; maxValue: number } | GroupedLayer
  >
  const visibility = (${exportName}.stateVisibility ?? {}) as StateVisibility
  const textureVariants = ((${exportName} as typeof ${exportName} & {
    textureVariants?: Record<string, readonly TextureVariant[]>
  }).textureVariants ?? {})
  const lightGroupNames = Object.keys(lightGroups)
  for (const [group, output] of Object.entries(bakeOutputs)) {
    if (output !== 'appearance' && output !== 'lighting') {
      throw new Error(
        'Atlas "' + group + '" has unsupported bake output "' + String(output) + '".',
      )
    }
  }
  for (const [stateName, scales] of Object.entries(stateScales)) {
    const state = states[stateName]
    if (state === undefined) {
      throw new Error('State scales reference missing baked state "' + stateName + '".')
    }
    const groups = statesByGroup(state)
    for (const [group, scale] of Object.entries(scales)) {
      if (!(group in groups)) {
        throw new Error(
          'State scale for state "' + stateName + '" references missing atlas "' + group + '".',
        )
      }
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        throw new Error(
          'State scale for state "' + stateName + '", atlas "' + group +
          '" must be finite and greater than zero.',
        )
      }
    }
  }
  for (const [stateName, state] of Object.entries(states)) {
    for (const group of Object.keys(statesByGroup(state))) {
      if (bakeOutputs[group] !== 'lighting') continue
      const scale = stateScales[stateName]?.[group]
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        throw new Error(
          'Lighting atlas "' + group + '" in state "' + stateName +
          '" has no finite positive state scale. Re-sync the scene.',
        )
      }
    }
  }
  if (defaultState !== null && states[defaultState] === undefined) {
    throw new Error('Declared default baked state "' + defaultState + '" is missing.')
  }
  // Realtime descriptors deliberately publish this same stable module so
  // setup-generated consumers never need a conditional import. Avoid even
  // constructing a loader or traversing/mutating stale atlas-tagged objects
  // when the descriptor has no baked composition data.
  if (
    Object.keys(states).length === 0 &&
    lightGroupNames.length === 0 &&
    Object.keys(visibility).length === 0
  ) {
    let disposed = false
    return {
      ready: Promise.resolve(),
      qualityReady: Promise.resolve(),
      async prepare() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
      },
      setState() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
        return false
      },
      async setStateAsync() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
        return false
      },
      setLightGroup() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
        return false
      },
      async setLightGroupAsync() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
        return false
      },
      trackMaterialClone() {
        if (disposed) throw new Error('This baked scene handle has been disposed.')
        return () => {}
      },
      lightGroupNames,
      dispose() { disposed = true },
    }
  }
  const materialBindings = new Map<THREE.Material, BakeBinding>()
  const objectsById = new Map<string, THREE.Object3D>()
  const objectsByName = new Map<string, THREE.Object3D>()

  root.traverse((object) => {
    const id = object.userData?.blendlink_id
    if (typeof id === 'string') objectsById.set(id, object)
    objectsByName.set(object.name, object)
    if (!isMesh(object)) return
    const binding = bindingOf(object, bakeOutputs)
    // MeshBasicMaterial is also the correct Three type for an artist-authored
    // realtime KHR_materials_unlit mesh. Only an explicit baked atlas tag (or
    // its anonymous multi-primitive child) authorizes state-map ownership.
    if (binding === null) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (binding.output === 'appearance' && !isMeshBasicMaterial(material)) {
        throw new Error(
          'Appearance atlas "' + binding.group + '" expected MeshBasicMaterial, but object "' +
          object.name + '" uses "' + material.name + '". Re-sync the baked scene.',
        )
      }
      if (binding.output === 'lighting' && !isMeshStandardMaterial(material)) {
        throw new Error(
          'Lighting atlas "' + binding.group + '" requires a PBR MeshStandardMaterial, but object "' +
          object.name + '" uses "' + material.name + '". Re-sync or choose Bake Appearance.',
        )
      }
      const prior = materialBindings.get(material)
      if (prior !== undefined &&
          (prior.group !== binding.group || prior.output !== binding.output ||
           prior.lightmapUv !== binding.lightmapUv)) {
        throw new Error(
          'Baked material "' + material.name + '" is shared by atlas groups "' +
          prior.group + '" and "' + binding.group + '" or incompatible output/UV modes. ' +
          'Re-sync so Blendlink can fork it per atlas.',
        )
      }
      materialBindings.set(material, binding)
    }
  })

  for (const binding of materialBindings.values()) {
    if (binding.output !== 'lighting') continue
    const unsupported = lightGroupNames.filter(
      (name) => layersByGroup(lightGroups[name]!)[binding.group] !== undefined,
    )
    if (unsupported.length > 0) {
      throw new Error(
        'Lighting atlas "' + binding.group + '" has interactive light groups (' +
        unsupported.join(', ') + '). Blendlink refuses to fake these through the appearance-map ' +
        'shader path because that would bypass PBR lighting. Use Bake Appearance for that atlas ' +
        'until a dedicated PBR light-map layer adapter is available.',
      )
    }
  }

  // Bake Appearance deliberately embeds the declared default atlas in each
  // unlit GLB material. Reusing that already-decoded map avoids a duplicate
  // request, duplicate GPU allocation, and a needless first-frame handoff.
  // A missing map is a broken GLB/descriptor pair, not permission to hide the
  // mismatch behind an external fallback.
  if (defaultState !== null) {
    for (const [material, binding] of materialBindings) {
      if (binding.output === 'appearance' &&
          (material as THREE.MeshBasicMaterial).map === null) {
        throw new Error(
          'Appearance atlas "' + binding.group + '" expected the GLB to embed default state "' +
          defaultState + '", but material "' + material.name + '" has no map. Re-sync the scene.',
        )
      }
    }
  }

  const hiddenByState = new Map<string, Set<THREE.Object3D>>()
  const controlledVisibility = new Set<THREE.Object3D>()
  const unresolved: string[] = []
  for (const [state, membership] of Object.entries(visibility)) {
    const hidden = new Set<THREE.Object3D>()
    for (const id of membership.hiddenObjectIds) {
      const object = objectsById.get(id)
      if (object) hidden.add(object)
      else unresolved.push(state + ': object id ' + id)
    }
    for (const name of membership.hiddenObjectNames) {
      const object = objectsByName.get(name) ?? objectsByName.get(loadedName(name))
      if (object) hidden.add(object)
      else unresolved.push(state + ': object ' + name)
    }
    hiddenByState.set(state, hidden)
    for (const object of hidden) controlledVisibility.add(object)
  }
  if (unresolved.length > 0) {
    throw new Error('Baked state visibility references missing GLB nodes:\\n  - ' + unresolved.join('\\n  - '))
  }

  const originalVisibility = new Map(
    [...controlledVisibility].map((object) => [object, object.visible] as const),
  )
  const installedVisibility = new Map<THREE.Object3D, boolean>()
  const loader = new THREE.TextureLoader(options.loadingManager)
  const ownedTextures = new Map<string, THREE.Texture>()
  const textureReadiness = new Map<THREE.Texture, Promise<void>>()
  type TextureCacheEntry = {
    key: string
    texture: THREE.Texture
    estimatedBytes: number | null
    lastUsed: number
    loading: boolean
  }
  const textureCacheEntries = new Map<THREE.Texture, TextureCacheEntry>()
  const textureWaiters = new Map<THREE.Texture, number>()
  let textureUseClock = 0
  // TextureLoader callbacks are normally asynchronous, but this indirection
  // also keeps cache bookkeeping safe for custom/cached loaders that complete
  // synchronously before the eviction function is installed below.
  let requestTextureCacheEviction = (): void => {}
  const defaultTextureCacheBytes = (): number => {
    if (typeof window === 'undefined') return 256 * 1024 * 1024
    const hints = navigator as Navigator & {
      deviceMemory?: number
      connection?: { saveData?: boolean }
    }
    if (hints.connection?.saveData || (hints.deviceMemory ?? 8) <= 2) return 64 * 1024 * 1024
    if ((hints.deviceMemory ?? 8) <= 4) return 128 * 1024 * 1024
    return 256 * 1024 * 1024
  }
  const textureCacheBytes = options.textureCacheBytes ?? defaultTextureCacheBytes()
  if (!(textureCacheBytes === Number.POSITIVE_INFINITY ||
      (Number.isFinite(textureCacheBytes) && textureCacheBytes >= 0))) {
    throw new Error('textureCacheBytes must be a non-negative finite byte count or Infinity.')
  }
  const atlasDeliveryQuality = options.atlasDeliveryQuality ?? 'authored'
  let prewarmRenderer: BakedPrewarmRenderer | null = null
  const prepareTexture = (
    renderer: BakedPrewarmRenderer,
    texture: THREE.Texture,
  ): void => {
    const anisotropy = prewarmMaxAnisotropy(renderer)
    if (Number.isFinite(anisotropy) && anisotropy > 0 && texture.anisotropy !== anisotropy) {
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
    }
    renderer.initTexture(texture)
  }
  if (!(atlasDeliveryQuality === 'authored' || atlasDeliveryQuality === 'adaptive' ||
      (typeof atlasDeliveryQuality === 'number' && Number.isFinite(atlasDeliveryQuality) &&
       atlasDeliveryQuality > 0))) {
    throw new Error(
      "atlasDeliveryQuality must be 'authored', 'adaptive', or a positive finite resolution.",
    )
  }
  const estimatedTextureBytes = (width: number, height: number): number | null => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
    let total = 0
    let levelWidth = width
    let levelHeight = height
    while (true) {
      total += levelWidth * levelHeight * 4
      if (levelWidth === 1 && levelHeight === 1) return total
      levelWidth = Math.max(1, Math.floor(levelWidth / 2))
      levelHeight = Math.max(1, Math.floor(levelHeight / 2))
    }
  }
  const textureDimensions = (texture: THREE.Texture): { width: number; height: number } | null => {
    const image = texture.image as {
      width?: number; height?: number; naturalWidth?: number; naturalHeight?: number
      videoWidth?: number; videoHeight?: number
    } | undefined
    if (!image) return null
    const width = Number(image.width ?? image.naturalWidth ?? image.videoWidth ?? 0)
    const height = Number(image.height ?? image.naturalHeight ?? image.videoHeight ?? 0)
    return width > 0 && height > 0 ? { width, height } : null
  }
  const touchTexture = (texture: THREE.Texture): void => {
    const entry = textureCacheEntries.get(texture)
    if (entry) entry.lastUsed = ++textureUseClock
  }
  const canonicalAssetUrl = (url: string): string => url.replace(/[?#].*$/, '')
  const adaptiveAtlasResolution = (): number => {
    if (typeof window === 'undefined') return Number.POSITIVE_INFINITY
    const viewport = Math.max(window.innerWidth || 1, window.innerHeight || 1)
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
    let desired = viewport * ratio
    const navigatorHints = navigator as Navigator & {
      deviceMemory?: number
      connection?: { saveData?: boolean }
    }
    if (navigatorHints.connection?.saveData) desired = Math.min(desired, 512)
    else if ((navigatorHints.deviceMemory ?? 8) <= 2) desired = Math.min(desired, 512)
    else if ((navigatorHints.deviceMemory ?? 8) <= 4) desired = Math.min(desired, 1024)
    return Math.max(256, desired)
  }
  const desiredAtlasResolution = (): number => {
    if (atlasDeliveryQuality === 'authored') return Number.POSITIVE_INFINITY
    if (atlasDeliveryQuality === 'adaptive') return adaptiveAtlasResolution()
    return atlasDeliveryQuality
  }
  const preferredTexture = (url: string): {
    preferred: string; fallbacks: string[]; resolution: number; width: number; height: number
  } => {
    const candidates = textureVariants[canonicalAssetUrl(url)] ?? []
    if (candidates.length === 0) {
      return {
        preferred: url, fallbacks: [], resolution: Number.POSITIVE_INFINITY,
        width: 0, height: 0,
      }
    }
    const desired = desiredAtlasResolution()
    const resolutions = [...new Set(candidates.map((candidate) => Math.max(
      candidate.width, candidate.height,
    )))].sort((a, b) => a - b)
    const selected = resolutions.find((resolution) => resolution >= desired)
      ?? resolutions[resolutions.length - 1]!
    const tier = candidates.filter(
      (candidate) => Math.max(candidate.width, candidate.height) === selected,
    )
    // Lossless WebP normally transfers less; the same-resolution bakelib PNG
    // is the first fallback, followed by the canonical full-resolution PNG.
    const preferred = tier.find((candidate) => candidate.format === 'webp')
      ?? tier.find((candidate) => candidate.format === 'png')
    if (!preferred) {
      return { preferred: url, fallbacks: [], resolution: selected, width: 0, height: 0 }
    }
    const fallbacks = [
      ...tier.filter((candidate) => candidate.url !== preferred.url).map((candidate) => candidate.url),
      url,
    ].filter((candidate, index, values) =>
      candidate !== preferred.url && values.indexOf(candidate) === index,
    )
    return {
      preferred: preferred.url, fallbacks, resolution: selected,
      width: preferred.width, height: preferred.height,
    }
  }
  const textureFor = (url: string, channel?: number): THREE.Texture => {
    const cacheKey = channel === undefined ? url : channel + '\\u0000' + url
    const cached = ownedTextures.get(cacheKey)
    if (cached) {
      touchTexture(cached)
      return cached
    }
    let resolveReady!: () => void
    let rejectReady!: (error: unknown) => void
    const readiness = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Keep a rejection observable through ready/setStateAsync without letting
    // a caller that deliberately uses only setState() trigger an unhandled
    // promise rejection before its application-level error boundary runs.
    void readiness.catch(() => {})
    const selection = preferredTexture(url)
    const preferred = selection.preferred
    let texture!: THREE.Texture
    const loaded = (loadedTexture: THREE.Texture): void => {
      const cacheEntry = textureCacheEntries.get(texture)
      if (cacheEntry) {
        cacheEntry.loading = false
        const dimensions = textureDimensions(loadedTexture)
        if (dimensions) {
          cacheEntry.estimatedBytes = estimatedTextureBytes(dimensions.width, dimensions.height)
        }
      }
      resolveReady()
      requestTextureCacheEviction()
    }
    const failed = (error: unknown) => {
      const failures = ['"' + preferred + '": ' + errorMessage(error)]
      const tryFallback = (index: number): void => {
        const fallbackUrl = selection.fallbacks[index]
        if (!fallbackUrl) {
          const cacheEntry = textureCacheEntries.get(texture)
          if (cacheEntry) cacheEntry.loading = false
          rejectReady(new Error(
            'Every atlas delivery alternative failed: ' + failures.join('; '),
          ))
          return
        }
        loader.load(fallbackUrl, (fallback) => {
          texture.image = fallback.image
          texture.needsUpdate = true
          const cacheEntry = textureCacheEntries.get(texture)
          if (cacheEntry) {
            cacheEntry.loading = false
            const dimensions = textureDimensions(fallback)
            if (dimensions) {
              cacheEntry.estimatedBytes = estimatedTextureBytes(dimensions.width, dimensions.height)
            }
          }
          fallback.dispose()
          resolveReady()
          requestTextureCacheEviction()
        }, undefined, (fallbackError) => {
          failures.push('"' + fallbackUrl + '": ' + errorMessage(fallbackError))
          tryFallback(index + 1)
        })
      }
      tryFallback(0)
    }
    texture = loader.load(preferred, loaded, undefined, failed)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    if (channel !== undefined) texture.channel = channel
    ownedTextures.set(cacheKey, texture)
    textureReadiness.set(texture, readiness)
    textureCacheEntries.set(texture, {
      key: cacheKey,
      texture,
      estimatedBytes: estimatedTextureBytes(selection.width, selection.height),
      lastUsed: ++textureUseClock,
      loading: true,
    })
    return texture
  }
  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)
  const waitForTexture = (
    texture: THREE.Texture,
    context: string,
  ): Promise<void> => {
    const readiness = textureReadiness.get(texture)
    if (!readiness) return Promise.resolve()
    textureWaiters.set(texture, (textureWaiters.get(texture) ?? 0) + 1)
    const release = (): void => {
      const remaining = (textureWaiters.get(texture) ?? 1) - 1
      if (remaining > 0) textureWaiters.set(texture, remaining)
      else textureWaiters.delete(texture)
    }
    return readiness.then(() => {
      if (prewarmRenderer) prepareTexture(prewarmRenderer, texture)
      release()
    }, (error) => {
      release()
      // A failed texture cannot become active, so it is safe to reclaim it as
      // soon as the last waiter has received the contextual error.
      requestTextureCacheEviction()
      throw new Error('Could not load ' + context + ': ' + errorMessage(error))
    })
  }

  const installAppearanceHooks = (
    material: THREE.MeshBasicMaterial,
    stateScale: { value: number },
    layerUniforms: Map<string, LayerUniforms>,
  ): Pick<
    AppearanceEntry,
    'originalOnBeforeCompile' | 'installedOnBeforeCompile' |
    'originalProgramCacheKey' | 'installedProgramCacheKey'
  > => {
    const originalOnBeforeCompile = material.onBeforeCompile
    const originalProgramCacheKey = material.customProgramCacheKey
    const entries = [...layerUniforms.entries()]
    const installedOnBeforeCompile: THREE.Material['onBeforeCompile'] = (shader, renderer) => {
      originalOnBeforeCompile.call(material, shader, renderer)
      if (!shader.fragmentShader.includes('#include <map_pars_fragment>') ||
          !shader.fragmentShader.includes('#include <map_fragment>')) {
        throw new Error(
          'Three MeshBasicMaterial shader chunks changed; Blendlink Appearance composition refused.',
        )
      }
      shader.uniforms.blStateScale = stateScale
      let samplers = 'uniform float blStateScale;\\n'
      let composition = '  diffuseColor.rgb *= blStateScale;\\n'
      entries.forEach(([, uniforms], index) => {
        shader.uniforms['blLayerMap' + index] = uniforms.map
        shader.uniforms['blLayerTint' + index] = uniforms.tint
        shader.uniforms['blLayerStrength' + index] = uniforms.strength
        samplers += 'uniform sampler2D blLayerMap' + index + ';\\n' +
          'uniform vec3 blLayerTint' + index + ';\\n' +
          'uniform float blLayerStrength' + index + ';\\n'
        composition += '  diffuseColor.rgb += texture2D(blLayerMap' + index + ', vMapUv).rgb' +
          ' * blLayerTint' + index + ' * blLayerStrength' + index + ';\\n'
      })
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\\n' + samplers)
        .replace('#include <map_fragment>', '#include <map_fragment>\\n' + composition)
    }
    const signature = 'state-scale|' + entries.map(([name]) => name).join('|')
    const installedProgramCacheKey = () =>
      originalProgramCacheKey.call(material) + '|blendlink-baked:' + signature
    material.onBeforeCompile = installedOnBeforeCompile
    material.customProgramCacheKey = installedProgramCacheKey
    material.needsUpdate = true
    return {
      originalOnBeforeCompile,
      installedOnBeforeCompile,
      originalProgramCacheKey,
      installedProgramCacheKey,
    }
  }

  const patched: PatchedEntry[] = []
  let disposed = false
  try {
    for (const [untypedMaterial, binding] of materialBindings) {
      if (binding.output === 'lighting') {
        const material = untypedMaterial as THREE.MeshStandardMaterial
        patched.push({
          output: 'lighting',
          material,
          group: binding.group,
          lightmapUv: binding.lightmapUv!,
          originalLightMap: material.lightMap,
          installedLightMap: material.lightMap,
          originalLightMapIntensity: material.lightMapIntensity,
          installedLightMapIntensity: material.lightMapIntensity,
        })
        continue
      }
      const material = untypedMaterial as THREE.MeshBasicMaterial
      const group = binding.group
      const stateScale = { value: 1 }
      const layerUniforms = new Map<string, LayerUniforms>()
      for (const name of lightGroupNames) {
        const layer = layersByGroup(lightGroups[name]!)[group]
        if (!layer) continue
        layerUniforms.set(name, {
          map: { value: null },
          tint: { value: new THREE.Color(1, 1, 1).multiplyScalar(layer.maxValue) },
          strength: { value: 0 },
        })
      }
      const entry: PatchedEntry = {
        output: 'appearance',
        material,
        group,
        defaultMap: material.map,
        originalMap: material.map,
        installedMap: material.map,
        stateScale,
        layerUniforms,
        ...installAppearanceHooks(material, stateScale, layerUniforms),
      }
      patched.push(entry)
    }
  } catch (error) {
    for (const texture of ownedTextures.values()) texture.dispose()
    throw error
  }

  const stateCache = new Map<string, GroupedUrl>()
  let currentState: string | null = null
  const urlsFor = (stateName: string): GroupedUrl | null => {
    const entry = states[stateName]
    if (entry === undefined) return null
    let cached = stateCache.get(stateName)
    if (!cached) {
      cached = statesByGroup(entry)
      for (const patchedEntry of patched) {
        if (cached[patchedEntry.group] === undefined) {
          throw new Error(
            'State "' + stateName + '" has no atlas for group "' + patchedEntry.group + '".',
          )
        }
      }
      stateCache.set(stateName, cached)
    }
    return cached
  }

  const applyState = (name: string): boolean => {
    const urls = urlsFor(name)
    if (!urls) return false
    const hidden = hiddenByState.get(name) ?? new Set<THREE.Object3D>()
    for (const entry of patched) {
      const url = urls[entry.group]!
      if (entry.output === 'appearance') {
        const hadMap = entry.material.map !== null
        const texture = name === defaultState && entry.defaultMap !== null
          ? entry.defaultMap
          : textureFor(url)
        entry.material.map = texture
        entry.installedMap = texture
        entry.stateScale.value = stateScales[name]?.[entry.group] ?? 1
        if (hadMap !== (texture !== null)) entry.material.needsUpdate = true
      } else {
        const hadLightMap = entry.material.lightMap !== null
        const scale = stateScales[name]![entry.group]!
        const texture = textureFor(url, entry.lightmapUv)
        entry.material.lightMap = texture
        entry.material.lightMapIntensity = scale
        entry.installedLightMap = texture
        entry.installedLightMapIntensity = scale
        if (hadLightMap !== (texture !== null)) entry.material.needsUpdate = true
      }
    }
    for (const object of controlledVisibility) {
      const next = !hidden.has(object) && (originalVisibility.get(object) ?? true)
      object.visible = next
      installedVisibility.set(object, next)
    }
    currentState = name
    evictTextureCache()
    return true
  }

  const waitForState = async (name: string): Promise<boolean> => {
    const urls = urlsFor(name)
    if (!urls) return false
    await Promise.all(patched.map((entry) => {
      const url = urls[entry.group]!
      const texture = entry.output === 'appearance'
        ? (name === defaultState && entry.defaultMap !== null
            ? entry.defaultMap
            : textureFor(url))
        : textureFor(url, entry.lightmapUv)
      return waitForTexture(
        texture,
        'baked state "' + name + '", atlas "' + entry.group + '" at "' + url + '"',
      )
    }))
    return true
  }

  const transferredTextures = new Set<THREE.Texture>()
  const isOwnedTexture = (texture: THREE.Texture | null): texture is THREE.Texture =>
    texture !== null && [...ownedTextures.values()].includes(texture)
  const textureIsPinned = (texture: THREE.Texture): boolean => {
    const cacheEntry = textureCacheEntries.get(texture)
    if (cacheEntry?.loading || (textureWaiters.get(texture) ?? 0) > 0 ||
        transferredTextures.has(texture)) return true
    for (const entry of patched) {
      if (entry.output === 'appearance') {
        if (entry.material.map === texture || entry.defaultMap === texture) return true
        for (const uniforms of entry.layerUniforms.values()) {
          if (uniforms.strength.value !== 0 && uniforms.map.value === texture) return true
        }
      } else if (entry.material.lightMap === texture) return true
    }
    return false
  }
  const releaseInactiveReferences = (texture: THREE.Texture): void => {
    for (const entry of patched) {
      if (entry.output !== 'appearance') continue
      for (const uniforms of entry.layerUniforms.values()) {
        if (uniforms.strength.value === 0 && uniforms.map.value === texture) {
          uniforms.map.value = null
        }
      }
    }
  }
  const evictTextureCache = (): void => {
    if (textureCacheBytes === Number.POSITIVE_INFINITY) return
    let estimatedBytes = 0
    for (const entry of textureCacheEntries.values()) {
      estimatedBytes += entry.estimatedBytes ?? 0
    }
    if (estimatedBytes <= textureCacheBytes) return
    const candidates = [...textureCacheEntries.values()]
      .filter((entry) => entry.estimatedBytes !== null && !textureIsPinned(entry.texture))
      .sort((left, right) => left.lastUsed - right.lastUsed)
    for (const entry of candidates) {
      if (estimatedBytes <= textureCacheBytes) break
      if (textureIsPinned(entry.texture)) continue
      releaseInactiveReferences(entry.texture)
      if (ownedTextures.get(entry.key) === entry.texture) ownedTextures.delete(entry.key)
      textureReadiness.delete(entry.texture)
      textureCacheEntries.delete(entry.texture)
      entry.texture.dispose()
      estimatedBytes -= entry.estimatedBytes ?? 0
    }
  }
  requestTextureCacheEviction = evictTextureCache
  const markEntryTexturesTransferred = (entry: PatchedEntry): void => {
    if (entry.output === 'appearance') {
      if (isOwnedTexture(entry.material.map)) transferredTextures.add(entry.material.map)
      for (const uniforms of entry.layerUniforms.values()) {
        if (isOwnedTexture(uniforms.map.value)) transferredTextures.add(uniforms.map.value)
      }
    } else if (isOwnedTexture(entry.material.lightMap)) {
      transferredTextures.add(entry.material.lightMap)
    }
  }
  const restorePatchedEntry = (entry: PatchedEntry): void => {
    if (entry.output === 'appearance') {
      if (entry.material.map === entry.installedMap) {
        entry.material.map = entry.originalMap
      } else if (isOwnedTexture(entry.material.map)) {
        transferredTextures.add(entry.material.map)
      }
      if (entry.installedOnBeforeCompile &&
          entry.material.onBeforeCompile === entry.installedOnBeforeCompile) {
        entry.material.onBeforeCompile = entry.originalOnBeforeCompile
        for (const uniforms of entry.layerUniforms.values()) uniforms.map.value = null
      } else {
        for (const uniforms of entry.layerUniforms.values()) {
          if (isOwnedTexture(uniforms.map.value)) transferredTextures.add(uniforms.map.value)
        }
      }
      if (entry.installedProgramCacheKey &&
          entry.material.customProgramCacheKey === entry.installedProgramCacheKey) {
        entry.material.customProgramCacheKey = entry.originalProgramCacheKey
      }
    } else {
      if (entry.material.lightMap === entry.installedLightMap) {
        entry.material.lightMap = entry.originalLightMap
      } else if (isOwnedTexture(entry.material.lightMap)) {
        transferredTextures.add(entry.material.lightMap)
      }
      if (Object.is(entry.material.lightMapIntensity, entry.installedLightMapIntensity)) {
        entry.material.lightMapIntensity = entry.originalLightMapIntensity
      }
    }
    entry.material.needsUpdate = true
  }

  let initialReady: Promise<void> = Promise.resolve()
  let qualityReady: Promise<void> = Promise.resolve()
  const applyLightGroup = (
    name: string,
    options: { strength?: number; color?: THREE.ColorRepresentation },
  ): { found: boolean; ready: Promise<void> } => {
    if (options.strength !== undefined && !Number.isFinite(options.strength)) {
      throw new Error('Light-group strength must be finite.')
    }
    let found = false
    const readiness: Promise<void>[] = []
    for (const entry of patched) {
      if (entry.output !== 'appearance') continue
      const uniforms = entry.layerUniforms.get(name)
      if (!uniforms) continue
      found = true
      const nextStrength = options.strength ?? uniforms.strength.value
      const layer = layersByGroup(lightGroups[name]!)[entry.group]
      if (nextStrength !== 0 && uniforms.map.value === null && layer) {
        const texture = textureFor(layer.url)
        uniforms.map.value = texture
        readiness.push(waitForTexture(
          texture,
          'baked light group "' + name + '", atlas "' + entry.group + '" at "' + layer.url + '"',
        ))
      }
      uniforms.strength.value = nextStrength
      if (options.color !== undefined) {
        uniforms.tint.value.set(options.color).multiplyScalar(layer?.maxValue ?? 1)
      }
    }
    evictTextureCache()
    return { found, ready: Promise.all(readiness).then(() => {}) }
  }
  const handle: BakedSceneHandle = {
    get ready() { return initialReady },
    get qualityReady() { return qualityReady },
    async prepare(renderer) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      prewarmRenderer = renderer
      await initialReady
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      // Upload only textures that can contribute to the next frame. Uploading
      // every cached state would turn a CPU-side LRU back into eager GPU
      // residency and recreate the state-switch startup hitch this cache avoids.
      const textures = new Set<THREE.Texture>()
      for (const entry of patched) {
        if (entry.output === 'appearance') {
          if (entry.material.map) textures.add(entry.material.map)
          for (const uniforms of entry.layerUniforms.values()) {
            if (uniforms.strength.value !== 0 && uniforms.map.value) textures.add(uniforms.map.value)
          }
        } else if (entry.material.lightMap) textures.add(entry.material.lightMap)
      }
      for (const texture of textures) prepareTexture(renderer, texture)
    },
    setState(name) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      return applyState(name)
    },
    async setStateAsync(name) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      if (!(name in states)) return false
      // Decode first, then commit texture + visibility together. Unlike the
      // intentionally immediate setState(), this seam never exposes an empty
      // TextureLoader placeholder while the next state is in flight.
      await waitForState(name)
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      return applyState(name)
    },
    setLightGroup(name, options = {}) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      return applyLightGroup(name, options).found
    },
    async setLightGroupAsync(name, options = {}) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      const result = applyLightGroup(name, options)
      await result.ready
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      return result.found
    },
    trackMaterialClone(source, clone) {
      if (disposed) throw new Error('This baked scene handle has been disposed.')
      const sourceEntry = patched.find((entry) => entry.material === source)
      if (!sourceEntry) return () => {}
      if (patched.some((entry) => entry.material === clone)) {
        throw new Error('A baked material clone was registered more than once.')
      }
      let cloneEntry: PatchedEntry
      if (sourceEntry.output === 'appearance') {
        if (!isMeshBasicMaterial(clone)) {
          throw new Error('An Appearance material clone lost its MeshBasicMaterial type.')
        }
        const stateScale = { value: sourceEntry.stateScale.value }
        const layerUniforms = new Map<string, LayerUniforms>()
        for (const [name, uniforms] of sourceEntry.layerUniforms) {
          layerUniforms.set(name, {
            map: { value: uniforms.map.value },
            tint: { value: new THREE.Color().set(uniforms.tint.value) },
            strength: { value: uniforms.strength.value },
          })
        }
        cloneEntry = {
          output: 'appearance',
          material: clone,
          group: sourceEntry.group,
          defaultMap: sourceEntry.defaultMap,
          originalMap: clone.map,
          installedMap: clone.map,
          stateScale,
          layerUniforms,
          ...installAppearanceHooks(clone, stateScale, layerUniforms),
        }
      } else {
        if (!isMeshStandardMaterial(clone)) {
          throw new Error('A Lighting material clone lost its MeshStandardMaterial type.')
        }
        cloneEntry = {
          output: 'lighting',
          material: clone,
          group: sourceEntry.group,
          lightmapUv: sourceEntry.lightmapUv,
          originalLightMap: clone.lightMap,
          installedLightMap: clone.lightMap,
          originalLightMapIntensity: clone.lightMapIntensity,
          installedLightMapIntensity: clone.lightMapIntensity,
        }
      }
      patched.push(cloneEntry)
      let released = false
      return (transferred: boolean) => {
        if (released) return
        released = true
        const index = patched.indexOf(cloneEntry)
        if (index >= 0) patched.splice(index, 1)
        if (disposed) return
        if (transferred) markEntryTexturesTransferred(cloneEntry)
        else restorePatchedEntry(cloneEntry)
        evictTextureCache()
      }
    },
    lightGroupNames,
    dispose() {
      if (disposed) return
      disposed = true
      for (const entry of patched) {
        restorePatchedEntry(entry)
      }
      for (const [object, original] of originalVisibility) {
        if (object.visible === installedVisibility.get(object)) object.visible = original
      }
      for (const texture of ownedTextures.values()) {
        if (!transferredTextures.has(texture)) texture.dispose()
      }
      ownedTextures.clear()
      textureReadiness.clear()
      textureCacheEntries.clear()
      textureWaiters.clear()
      stateCache.clear()
    },
  }

  if (defaultState !== null) {
    try {
      if (!applyState(defaultState)) throw new Error('Default baked state is missing.')
      initialReady = Promise.all([initialReady, waitForState(defaultState)]).then(() => {})
      // Stage every promoted default atlas before mutating any material. A
      // multi-atlas scene must never reveal a half-promoted quality tier just
      // because one network/decode request completed before its siblings.
      qualityReady = Promise.all(patched.map(async (entry) => {
        if (entry.output !== 'appearance' || entry.defaultMap === null) return
        const url = urlsFor(defaultState)![entry.group]!
        const selection = preferredTexture(url)
        const embeddedWidth = Number(
          (entry.defaultMap.image as { width?: number } | undefined)?.width ?? 0,
        )
        if (embeddedWidth <= 0 || selection.resolution <= embeddedWidth) return
        const upgrade = textureFor(url)
        await waitForTexture(
          upgrade,
          'high-detail baked state "' + defaultState + '", atlas "' + entry.group + '"',
        )
        return { entry, upgrade }
      })).then((staged) => {
        if (disposed) return
        for (const promotion of staged) {
          if (!promotion) continue
          const { entry, upgrade } = promotion
          if (currentState === defaultState && entry.material.map === entry.defaultMap) {
            entry.material.map = upgrade
            entry.installedMap = upgrade
          }
          entry.defaultMap = upgrade
        }
        evictTextureCache()
      })
      // Applications can await qualityReady for screenshots or transitions;
      // ordinary first paint remains on the embedded bootstrap. Keep failure
      // observable there without creating an unhandled rejection otherwise.
      void qualityReady.catch(() => {})
    } catch (error) {
      handle.dispose()
      throw error
    }
  }
  return handle
}
`
}
