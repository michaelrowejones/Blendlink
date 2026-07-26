import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BakeSettings, ExportSettings } from './invoke.js'

export interface SceneConfig {
  /** Path to the .blend, relative to the config file. */
  file: string
  /** Module/export name; defaults to the file basename, camelised. */
  name?: string
  /** Export only this collection (Blender's own export unit). */
  collection?: string
  /** Skip image export for fast dev loops ('NONE'); default 'AUTO'. */
  imageFormat?: 'AUTO' | 'NONE'
  /**
   * @deprecated Artistic presentation is scene-owned. Configure Hybrid,
   * Realtime, or Fully Baked in Blender's Scene Publishing panel instead.
   * This remains readable for pre-1.0 projects.
   */
  mode?: 'standard' | 'baked'
  /**
   * @deprecated Bake quality, atlases, density, and lighting states are
   * scene-owned. Migrate them to Blender's Scene Publishing panel before
   * removing this compatibility setting.
   */
  bake?: BakeSettings
  /** Raw exporter kwargs, RNA-filtered in Blender (escape hatch). */
  exporterOverrides?: Record<string, unknown>
  /** GLB produced by an external pipeline (overrides the derived path). */
  glb?: string
  /** Public URL override matching `glb`. */
  url?: string
  /**
   * Artifacts are owned by an external pipeline: `sync` never exports this
   * scene, but `verify` still drift-checks the manifest, GLB, and .blend.
   * Stamp the manifest via `blendlink typegen <glb> --blend <file>`.
   */
  external?: boolean
  /**
   * Shell command that rebuilds an external scene's artifacts (must end by
   * re-stamping the manifest, e.g. via `typegen --blend`). When set, `sync`
   * runs it whenever the .blend drifted — so `sync --watch` covers bespoke
   * pipelines too. Runs from the config root.
   */
  build?: string
  /**
   * Extra compiler inputs (relative to the config root), such as an external
   * pipeline's bake settings. Their bytes participate in drift detection and
   * `compile --watch` subscribes to them alongside the .blend.
   */
  inputs?: string[]
  /** Explicit website-owned recovery for an intentionally payload-free GLB.
   * Blendlink still reports the collapse; verify accepts it only when the
   * application names the adapter and acknowledges that browser proof owns
   * the material result. */
  applicationMaterialAdapter?: ApplicationMaterialAdapterConfig
}

export interface ApplicationMaterialAdapterConfig {
  acknowledgePayloadCollapse: true
  /** Human-readable module/strategy shown by verify and publish. */
  description: string
}

export interface BlendlinkConfig {
  /** Explicit Blender executable; otherwise auto-discovered. */
  blenderPath?: string
  /** Where GLBs land (served statically). Default: public/models. */
  outDir?: string
  /** Where generated modules/manifests land. Default: src/generated. */
  genDir?: string
  /** Public URL prefix matching outDir. Default: /models. */
  urlPrefix?: string
  /**
   * Connection to the website that consumes the compiled scenes. This is
   * integration state (and therefore belongs beside paths/URLs here), while
   * artistic publishing intent remains embedded in the .blend recipe.
   */
  website?: WebsiteConfig
  scenes: SceneConfig[]
}

export interface WebsiteConfig {
  /** Website directory, relative to this config. Default: the config root. */
  root?: string
  /** Local development-server command. Auto-detected from package.json when omitted. */
  devCommand?: string
  /** Browser URL. Auto-detected from server output/common frameworks when omitted. */
  url?: string
  /** Optional application-owned production browser gate run by `publish`
   * after the website build and second artifact verification. */
  browserSmoke?: WebsiteBrowserSmokeConfig
}

export interface WebsiteBrowserSmokeConfig {
  command: string
  /** Optional environment variable that receives a fresh loopback port for
   * this publish attempt. The application still owns server startup. */
  portEnv?: string
}

export interface ResolvedWebsite {
  root: string
  devCommand?: string
  url?: string
  browserSmoke?: WebsiteBrowserSmokeConfig
}

/** Byte-exact identity of the config module whose resolved settings are in
 * use. Waiting publishers must never combine an old object graph with newer
 * config bytes. */
export interface ConfigSourceRevision {
  path: string
  hash: string
}

export interface ResolvedScene {
  name: string
  blendPath: string
  glbPath: string
  url: string
  manifestPath: string
  modulePath: string
  settings: ExportSettings
  external: boolean
  build?: string
  inputs?: string[]
  applicationMaterialAdapter?: ApplicationMaterialAdapterConfig
  /** Config root — cwd for external build commands. */
  root: string
  /** Present for scenes loaded from a config module; absent for deliberately
   * constructed embedding/test configs. */
  configSource?: ConfigSourceRevision
}

export interface ResolvedConfig {
  root: string
  blenderPath?: string
  website: ResolvedWebsite
  scenes: ResolvedScene[]
  configSource?: ConfigSourceRevision
}

export function defineConfig(config: BlendlinkConfig): BlendlinkConfig {
  return config
}

export function defineScene(scene: SceneConfig): SceneConfig {
  return scene
}

const SCENE_KEYS = new Set([
  'file', 'name', 'glb', 'url', 'collection', 'imageFormat', 'mode', 'bake',
  'curveSamples', 'exporterOverrides', 'external', 'build', 'inputs',
  'applicationMaterialAdapter',
])
const CONFIG_KEYS = new Set(['outDir', 'genDir', 'urlPrefix', 'blenderPath', 'website', 'scenes'])
const WEBSITE_KEYS = new Set(['root', 'devCommand', 'url', 'browserSmoke'])
const BROWSER_SMOKE_KEYS = new Set(['command', 'portEnv'])
const APPLICATION_MATERIAL_ADAPTER_KEYS = new Set([
  'acknowledgePayloadCollapse', 'description',
])
const warnedLegacyArtSettings = new Set<string>()

function warnForLegacyArtSettings(config: BlendlinkConfig, root: string): void {
  const uses = config.scenes.flatMap((scene) => {
    const keys = [
      ...(scene.mode !== undefined ? ['mode'] : []),
      ...(scene.bake !== undefined ? ['bake'] : []),
    ]
    return keys.length > 0
      ? [`${scene.name ?? scene.file} (${keys.join(' + ')})`]
      : []
  })
  const key = resolve(root)
  if (uses.length === 0 || warnedLegacyArtSettings.has(key)) return
  warnedLegacyArtSettings.add(key)
  console.warn(
    '! blendlink config: legacy `mode`/`bake` artistic settings are still honored ' +
      `for ${uses.join(', ')}, but are deprecated. Migrate them to Blender > ` +
      'Blendlink > Scene Publishing before removing the config fields.',
  )
}

/** Config-file tools live or die on validation quality (Content Collections
 * beat Contentlayer on exactly this): a typo'd key or a bad mode string
 * must fail with a fix, never silently produce a lit export. */
function validateConfig(config: BlendlinkConfig, root: string): void {
  const problems: string[] = []
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) problems.push(`unknown config key "${key}" — known: ${[...CONFIG_KEYS].join(', ')}`)
  }
  if (config.website) {
    for (const key of Object.keys(config.website)) {
      if (!WEBSITE_KEYS.has(key)) {
        problems.push(`website: unknown key "${key}" — known: ${[...WEBSITE_KEYS].join(', ')}`)
      }
    }
    if (config.website.url) {
      try {
        const url = new URL(config.website.url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          problems.push('website.url must use http:// or https://')
        }
      } catch {
        problems.push(`website.url is not a valid URL: ${config.website.url}`)
      }
    }
    if (config.website.browserSmoke) {
      for (const key of Object.keys(config.website.browserSmoke)) {
        if (!BROWSER_SMOKE_KEYS.has(key)) {
          problems.push(
            `website.browserSmoke: unknown key "${key}" — known: command`,
          )
        }
      }
      if (typeof config.website.browserSmoke.command !== 'string'
          || !config.website.browserSmoke.command.trim()) {
        problems.push('website.browserSmoke.command must be a non-empty string')
      }
      if (config.website.browserSmoke.portEnv !== undefined
          && (typeof config.website.browserSmoke.portEnv !== 'string'
            || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.website.browserSmoke.portEnv))) {
        problems.push('website.browserSmoke.portEnv must be a valid environment variable name')
      }
    }
  }
  for (const scene of config.scenes) {
    const label = scene.name ?? scene.file ?? '(unnamed scene)'
    for (const key of Object.keys(scene)) {
      if (!SCENE_KEYS.has(key)) problems.push(`scene ${label}: unknown key "${key}" — known: ${[...SCENE_KEYS].join(', ')}`)
    }
    if (!scene.file) problems.push(`scene ${label}: "file" is required`)
    else if (!scene.external && !existsSync(resolve(root, scene.file))) {
      problems.push(`scene ${label}: file not found: ${scene.file}`)
    }
    if (scene.mode !== undefined && scene.mode !== 'standard' && scene.mode !== 'baked') {
      problems.push(`scene ${label}: mode "${String(scene.mode)}" is not 'standard' | 'baked'`)
    }
    if (scene.name !== undefined && (typeof scene.name !== 'string' || !scene.name.trim())) {
      problems.push(`scene ${label}: name must be a non-empty string`)
    }
    if (scene.applicationMaterialAdapter) {
      for (const key of Object.keys(scene.applicationMaterialAdapter)) {
        if (!APPLICATION_MATERIAL_ADAPTER_KEYS.has(key)) {
          problems.push(
            `scene ${label}: applicationMaterialAdapter unknown key "${key}" — known: ` +
              [...APPLICATION_MATERIAL_ADAPTER_KEYS].join(', '),
          )
        }
      }
      if (scene.applicationMaterialAdapter.acknowledgePayloadCollapse !== true) {
        problems.push(
          `scene ${label}: applicationMaterialAdapter.acknowledgePayloadCollapse must be true`,
        )
      }
      if (typeof scene.applicationMaterialAdapter.description !== 'string'
          || !scene.applicationMaterialAdapter.description.trim()) {
        problems.push(
          `scene ${label}: applicationMaterialAdapter.description must name the website-owned adapter or strategy`,
        )
      }
    }
    if (scene.bake && scene.mode !== 'baked') {
      problems.push(`scene ${label}: has bake settings but mode is not 'baked' — the bake would silently not run; add mode: 'baked'`)
    }
    if (scene.bake?.atlases) {
      const entries = Object.entries(scene.bake.atlases)
      if (entries.length === 0) {
        problems.push(`scene ${label}: bake.atlases is empty — omit it for the single implicit atlas`)
      } else if (!entries.some(([, atlas]) => atlas.maxCameraDistance === undefined)) {
        problems.push(
          `scene ${label}: every atlas declares maxCameraDistance — declare one ` +
            `catch-all atlas without it, or distant objects have nowhere to go`,
        )
      }
      for (const [name, atlas] of entries) {
        const atlasKeys = ['size', 'maxCameraDistance', 'targetDensity', 'margin', 'fitPolicy']
        for (const key of Object.keys(atlas)) {
          if (!atlasKeys.includes(key)) {
            problems.push(`scene ${label}: atlas "${name}": unknown key "${key}" — known: ${atlasKeys.join(', ')}`)
          }
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error('blendlink config problems:\n  - ' + problems.join('\n  - '))
  }
}

export function resolveConfig(
  config: BlendlinkConfig,
  root: string,
  configSource?: ConfigSourceRevision,
): ResolvedConfig {
  validateConfig(config, root)
  warnForLegacyArtSettings(config, root)
  const outDir = resolve(root, config.outDir ?? 'public/models')
  const genDir = resolve(root, config.genDir ?? 'src/generated')
  const urlPrefix = config.urlPrefix ?? '/models'
  const seenNames = new Map<string, { file: string; name: string }>()
  const scenes = config.scenes.map((scene) => {
    const authoredName = scene.name ?? basename(scene.file).replace(/\.blend$/i, '')
    const name = sceneIdentifier(authoredName)
    // These identifiers are filenames too. Windows and default macOS
    // volumes collapse case even though JavaScript's Map does not.
    const previous = seenNames.get(name.toLowerCase())
    if (previous !== undefined) {
      // Two files camelizing to one name silently share every output path —
      // the second sync overwrites the first, last-writer-wins.
      if (previous.name !== name) {
        throw new Error(
          `scenes "${previous.file}" and "${scene.file}" resolve to names ` +
            `"${previous.name}" and "${name}", which share the same output ` +
            'paths on case-insensitive filesystems — rename one scene.',
        )
      }
      throw new Error(
        `scenes "${previous.file}" and "${scene.file}" both resolve to the name ` +
          `"${name}" and would overwrite each other's outputs — set an ` +
          `explicit name on one of them.`,
      )
    }
    seenNames.set(name.toLowerCase(), { file: scene.file, name })
    return {
      name,
      blendPath: resolve(root, scene.file),
      glbPath: scene.glb ? resolve(root, scene.glb) : join(outDir, `${name}.glb`),
      url: scene.url ?? `${urlPrefix}/${name}.glb`,
      manifestPath: join(genDir, `${name}.manifest.json`),
      modulePath: join(genDir, `${name}.gen.ts`),
      settings: {
        ...(scene.collection ? { collection: scene.collection } : {}),
        imageFormat: scene.imageFormat ?? 'AUTO',
        ...(scene.mode ? { mode: scene.mode } : {}),
        ...(scene.bake ? { bake: scene.bake } : {}),
        ...(scene.exporterOverrides ? { exporterOverrides: scene.exporterOverrides } : {}),
      },
      external: scene.external ?? false,
      ...(scene.build ? { build: scene.build } : {}),
      ...(scene.inputs
        ? { inputs: scene.inputs.map((input) => resolve(root, input)) }
        : {}),
      ...(scene.applicationMaterialAdapter
        ? {
            applicationMaterialAdapter: {
              acknowledgePayloadCollapse: true as const,
              description: scene.applicationMaterialAdapter.description.trim(),
            },
          }
        : {}),
      root,
      ...(configSource ? { configSource } : {}),
    } satisfies ResolvedScene
  })
  const website: ResolvedWebsite = {
    root: resolve(root, config.website?.root ?? '.'),
    ...(config.website?.devCommand ? { devCommand: config.website.devCommand } : {}),
    ...(config.website?.url ? { url: config.website.url } : {}),
    ...(config.website?.browserSmoke
      ? { browserSmoke: {
          command: config.website.browserSmoke.command.trim(),
          ...(config.website.browserSmoke.portEnv
            ? { portEnv: config.website.browserSmoke.portEnv }
            : {}),
        } }
      : {}),
  }
  return {
    root,
    blenderPath: config.blenderPath,
    website,
    scenes,
    ...(configSource ? { configSource } : {}),
  }
}

export function configSourceRevisionProblem(
  revision: ConfigSourceRevision | undefined,
): string | undefined {
  if (!revision) return undefined
  if (!existsSync(revision.path)) {
    return `Blendlink config ${revision.path} was removed or renamed since this project configuration was loaded.`
  }
  let currentHash: string
  try {
    currentHash = createHash('sha256')
      .update(readFileSync(revision.path))
      .digest('hex')
  } catch (error) {
    return `Blendlink config ${revision.path} could not be re-read after this project configuration was loaded: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
  return currentHash === revision.hash
    ? undefined
    : `Blendlink config ${revision.path} changed since this project configuration was loaded.`
}

export function assertConfigSourceRevisionCurrent(
  revision: ConfigSourceRevision | undefined,
): void {
  const problem = configSourceRevisionProblem(revision)
  if (!problem) return
  throw new Error(
    `${problem} The stale resolved settings were not published; rerun the command ` +
      'so Blendlink loads the newest config revision.',
  )
}

export async function loadConfig(root: string): Promise<ResolvedConfig> {
  for (const candidate of ['blendlink.config.mjs', 'blendlink.config.js']) {
    const path = join(root, candidate)
    if (!existsSync(path)) continue
    // Node caches ESM modules by URL for the life of the process. Watch mode
    // intentionally calls this repeatedly, so a plain file URL would keep
    // returning the first config forever. A content identity is stable while
    // unchanged and produces a fresh module as soon as the authored bytes do.
    const sourceHash = createHash('sha256')
      .update(readFileSync(path))
      .digest('hex')
    const url = pathToFileURL(path)
    url.searchParams.set('blendlinkConfig', sourceHash)
    const module = (await import(url.href)) as {
      default?: BlendlinkConfig
    }
    if (!module.default?.scenes) {
      throw new Error(`${candidate} must default-export defineConfig({ scenes: [...] }).`)
    }
    return resolveConfig(module.default, root, Object.freeze({
      path,
      hash: sourceHash,
    }))
  }
  throw new Error(
    'No blendlink.config.mjs found — run `blendlink init` to scaffold one ' +
      '(it finds your .blend files and writes the config for you).',
  )
}

const RESERVED_BINDINGS = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
])

/** One canonical value is both a safe JavaScript binding and a single safe
 * filename/URL segment. Natural artist labels remain convenient without ever
 * becoming generated syntax or path traversal. */
export function sceneIdentifier(label: string): string {
  const ascii = label.normalize('NFKD').replace(/\p{M}/gu, '')
  const words = ascii.match(/[A-Za-z0-9]+/g) ?? []
  let identifier = words.map((word, index) =>
    index === 0 ? word : word[0]!.toUpperCase() + word.slice(1),
  ).join('') || 'scene'
  if (/^[0-9]/.test(identifier)) identifier = `scene${identifier}`
  if (RESERVED_BINDINGS.has(identifier)) {
    identifier = `scene${identifier[0]!.toUpperCase()}${identifier.slice(1)}`
  }
  return identifier
}
