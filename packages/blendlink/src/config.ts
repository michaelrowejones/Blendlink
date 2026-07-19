import { existsSync } from 'node:fs'
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
  /** 'baked': Cycles Combined atlas + unlit export ("the bake is the painting"). */
  mode?: 'standard' | 'baked'
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
   * Extra files (relative to the config root) whose changes should also
   * trigger an external rebuild — e.g. the pipeline config that carries
   * bake sizes. Without this, only the .blend gates drift.
   */
  inputs?: string[]
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
  scenes: SceneConfig[]
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
  /** Config root — cwd for external build commands. */
  root: string
}

export interface ResolvedConfig {
  root: string
  blenderPath?: string
  scenes: ResolvedScene[]
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
])
const CONFIG_KEYS = new Set(['outDir', 'genDir', 'urlPrefix', 'blenderPath', 'scenes'])

/** Config-file tools live or die on validation quality (Content Collections
 * beat Contentlayer on exactly this): a typo'd key or a bad mode string
 * must fail with a fix, never silently produce a lit export. */
function validateConfig(config: BlendlinkConfig, root: string): void {
  const problems: string[] = []
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) problems.push(`unknown config key "${key}" — known: ${[...CONFIG_KEYS].join(', ')}`)
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
        for (const key of Object.keys(atlas)) {
          if (key !== 'size' && key !== 'maxCameraDistance') {
            problems.push(`scene ${label}: atlas "${name}": unknown key "${key}" — known: size, maxCameraDistance`)
          }
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error('blendlink config problems:\n  - ' + problems.join('\n  - '))
  }
}

export function resolveConfig(config: BlendlinkConfig, root: string): ResolvedConfig {
  validateConfig(config, root)
  const outDir = resolve(root, config.outDir ?? 'public/models')
  const genDir = resolve(root, config.genDir ?? 'src/generated')
  const urlPrefix = config.urlPrefix ?? '/models'
  const seenNames = new Map<string, string>()
  const scenes = config.scenes.map((scene) => {
    const name = scene.name ?? camel(basename(scene.file).replace(/\.blend$/i, ''))
    const previous = seenNames.get(name)
    if (previous !== undefined) {
      // Two files camelizing to one name silently share every output path —
      // the second sync overwrites the first, last-writer-wins.
      throw new Error(
        `scenes "${previous}" and "${scene.file}" both resolve to the name ` +
          `"${name}" and would overwrite each other's outputs — set an ` +
          `explicit name on one of them.`,
      )
    }
    seenNames.set(name, scene.file)
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
      root,
    } satisfies ResolvedScene
  })
  return { root, blenderPath: config.blenderPath, scenes }
}

export async function loadConfig(root: string): Promise<ResolvedConfig> {
  for (const candidate of ['blendlink.config.mjs', 'blendlink.config.js']) {
    const path = join(root, candidate)
    if (!existsSync(path)) continue
    const module = (await import(pathToFileURL(path).href)) as {
      default?: BlendlinkConfig
    }
    if (!module.default?.scenes) {
      throw new Error(`${candidate} must default-export defineConfig({ scenes: [...] }).`)
    }
    return resolveConfig(module.default, root)
  }
  throw new Error(
    'No blendlink.config.mjs found — run `blendlink init` to scaffold one ' +
      '(it finds your .blend files and writes the config for you).',
  )
}

function camel(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(\w)/g, (_, letter: string) => letter.toUpperCase())
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `scene${cleaned}`
}
