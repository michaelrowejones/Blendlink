import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExportSettings } from './invoke.js'

export interface SceneConfig {
  /** Path to the .blend, relative to the config file. */
  file: string
  /** Module/export name; defaults to the file basename, camelised. */
  name?: string
  /** Export only this collection (Blender's own export unit). */
  collection?: string
  /** Skip image export for fast dev loops ('NONE'); default 'AUTO'. */
  imageFormat?: 'AUTO' | 'NONE'
  /** Raw exporter kwargs, RNA-filtered in Blender (escape hatch). */
  exporterOverrides?: Record<string, unknown>
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

export function resolveConfig(config: BlendlinkConfig, root: string): ResolvedConfig {
  const outDir = resolve(root, config.outDir ?? 'public/models')
  const genDir = resolve(root, config.genDir ?? 'src/generated')
  const urlPrefix = config.urlPrefix ?? '/models'
  const scenes = config.scenes.map((scene) => {
    const name = scene.name ?? camel(basename(scene.file).replace(/\.blend$/i, ''))
    return {
      name,
      blendPath: resolve(root, scene.file),
      glbPath: join(outDir, `${name}.glb`),
      url: `${urlPrefix}/${name}.glb`,
      manifestPath: join(genDir, `${name}.manifest.json`),
      modulePath: join(genDir, `${name}.gen.ts`),
      settings: {
        ...(scene.collection ? { collection: scene.collection } : {}),
        imageFormat: scene.imageFormat ?? 'AUTO',
        ...(scene.exporterOverrides ? { exporterOverrides: scene.exporterOverrides } : {}),
      },
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
    'No blendlink.config.mjs found. Create one with defineConfig({ scenes: [defineScene({ file: "assets/scene.blend" })] }).',
  )
}

function camel(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(\w)/g, (_, letter: string) => letter.toUpperCase())
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `scene${cleaned}`
}
