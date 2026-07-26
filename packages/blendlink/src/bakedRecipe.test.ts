import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  BAKED_RECIPE_TEMPLATE_VERSION,
  bakedRecipeBackupPath,
  inspectBakedRecipeTemplate,
  renderBakedRecipe,
  updateBakedRecipeTemplateFile,
} from './bakedRecipe.js'

const threeTypes = `
export type ColorRepresentation = string | number | Color
export interface Shader { fragmentShader: string; uniforms: Record<string, unknown> }
export class Object3D {
  name: string; visible: boolean; parent: Object3D | null
  userData: Record<string, unknown>; traverse(visitor: (object: Object3D) => void): void
}
export class Material {
  name: string; needsUpdate: boolean
  onBeforeCompile(shader: Shader, renderer: unknown): void
  customProgramCacheKey(): string
}
export class Texture {
  image: unknown; colorSpace: unknown; flipY: boolean; wrapS: unknown; wrapT: unknown; channel: number; anisotropy: number; needsUpdate: boolean; dispose(): void
}
export class WebGLRenderer {
  capabilities: { getMaxAnisotropy(): number }
  initTexture(texture: Texture): void
}
export class LoadingManager {}
export class MeshBasicMaterial extends Material { readonly isMeshBasicMaterial: true; map: Texture | null }
export class MeshStandardMaterial extends Material {
  readonly isMeshStandardMaterial: true
  map: Texture | null; lightMap: Texture | null; lightMapIntensity: number
}
export class Mesh extends Object3D { readonly isMesh: true; material: Material | Material[] }
export class TextureLoader {
  constructor(manager?: LoadingManager)
  load(
    url: string,
    onLoad?: (texture: Texture) => void,
    onProgress?: (event: unknown) => void,
    onError?: (error: unknown) => void,
  ): Texture
}
export class Color {
  constructor(r?: number, g?: number, b?: number)
  set(value: ColorRepresentation): this; multiplyScalar(value: number): this
}
export const SRGBColorSpace: unknown
export const ClampToEdgeWrapping: unknown
`

function detachConstructorIdentity<T extends object>(value: T): T {
  const originalPrototype = Object.getPrototypeOf(value) as object
  const detachedPrototype = Object.create(Object.getPrototypeOf(originalPrototype)) as object
  Object.defineProperties(detachedPrototype, Object.getOwnPropertyDescriptors(originalPrototype))
  Object.setPrototypeOf(value, detachedPrototype)
  return value
}

describe('owned baked-scene recipe', () => {
  it('marks the current composition template and treats unmarked artist files as migration candidates', () => {
    const current = renderBakedRecipe('hero')
    expect(inspectBakedRecipeTemplate(current)).toEqual({
      kind: 'current', version: BAKED_RECIPE_TEMPLATE_VERSION,
    })
    expect(current).toContain('preferredTexture')
    expect(current).toContain("options.atlasDeliveryQuality ?? 'authored'")
    expect(current).toContain('Every atlas delivery alternative failed')
    expect(current).toContain('qualityReady')
    const legacy = inspectBakedRecipeTemplate('// artist customization\nexport const keep = true\n')
    expect(legacy).toEqual({ kind: 'legacy', version: null })
    expect(bakedRecipeBackupPath('hero.baked.ts', legacy))
      .toBe('hero.baked.ts.blendlink-legacy.bak')
    expect(inspectBakedRecipeTemplate(
      '// blendlink-baked-recipe-template-version: 999\n',
    )).toEqual({ kind: 'future', version: 999 })
  })

  it('backs up artist bytes deterministically before an explicit template update', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-recipe-update-'))
    try {
      const recipePath = join(directory, 'hero.baked.ts')
      const original = '// artist-owned pre-Lighting edits\nexport const grading = 0.7\n'
      writeFileSync(recipePath, original)
      const updated = updateBakedRecipeTemplateFile(recipePath, 'hero')
      expect(updated).toEqual({
        action: 'updated',
        backupPath: `${recipePath}.blendlink-legacy.bak`,
      })
      expect(readFileSync(updated.backupPath!, 'utf8')).toBe(original)
      expect(inspectBakedRecipeTemplate(readFileSync(recipePath, 'utf8')).kind).toBe('current')
      expect(updateBakedRecipeTemplateFile(recipePath, 'hero').action).toBe('current')

      writeFileSync(recipePath, '// different old artist bytes\n')
      expect(() => updateBakedRecipeTemplateFile(recipePath, 'hero'))
        .toThrow(/backup .* already exists with different bytes/)
      expect(readFileSync(recipePath, 'utf8')).toBe('// different old artist bytes\n')
      expect(readFileSync(updated.backupPath!, 'utf8')).toBe(original)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('passes strict semantic TypeScript checking with deduplicated ownership and visibility states', () => {
    const recipe = renderBakedRecipe('hero')
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-baked-recipe-'))
    try {
      const recipePath = join(directory, 'hero.baked.ts')
      const generatedPath = join(directory, 'hero.gen.ts')
      const threePath = join(directory, 'three.d.ts')
      writeFileSync(recipePath, recipe)
      writeFileSync(generatedPath, `export const hero = {
        states: {} as Record<string, string | Record<string, string>>,
        bakeOutputs: {} as Record<string, 'appearance' | 'lighting'>,
        stateScales: {} as Record<string, Record<string, number>>,
        lightGroups: {} as Record<string, { url: string; maxValue: number } | Record<string, { url: string; maxValue: number }>>,
        stateVisibility: {} as Record<string, { hiddenObjectIds: readonly string[]; hiddenObjectNames: readonly string[] }>,
        defaultState: null as string | null,
      }`)
      writeFileSync(threePath, threeTypes)
      const program = ts.createProgram({
        rootNames: [recipePath, generatedPath, threePath],
        options: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: directory,
          paths: { three: ['./three.d.ts'] },
        },
      })
      const errors = ts.getPreEmitDiagnostics(program)
        .filter((item) => item.category === ts.DiagnosticCategory.Error)
        .map((item) => {
          const location = item.file && item.start !== undefined
            ? item.file.getLineAndCharacterOfPosition(item.start)
            : null
          return `${location ? `${item.file!.fileName}:${location.line + 1}:${location.character + 1}: ` : ''}` +
            ts.flattenDiagnosticMessageText(item.messageText, '\n')
        })
      expect(errors).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    expect(recipe).toContain('const ownedTextures = new Map<string, THREE.Texture>()')
    expect(recipe).toContain('materialBindings = new Map<THREE.Material, BakeBinding>()')
    expect(recipe).toContain('installedOnBeforeCompile')
    expect(recipe).toContain('installedVisibility')
    expect(recipe).toContain('dispose()')
  })

  it('owns only explicitly atlas-tagged materials at runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-baked-runtime-'))
    try {
      const threeDirectory = join(directory, 'node_modules', 'three')
      mkdirSync(threeDirectory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(
        join(threeDirectory, 'package.json'),
        JSON.stringify({ name: 'three', type: 'module', exports: './index.js' }),
      )
      writeFileSync(join(threeDirectory, 'index.js'), `
export class Object3D {
  constructor(name = '') { this.name = name; this.visible = true; this.parent = null; this.children = []; this.userData = {} }
  add(child) { child.parent = this; this.children.push(child) }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse(visitor) }
}
export class Material {
  constructor() { this.name = ''; this.needsUpdate = false; this.onBeforeCompile = () => {}; this.customProgramCacheKey = () => '' }
}
export class Texture { constructor(url = '') { this.url = url; this.channel = 0; this.anisotropy = 1 } dispose() { this.disposed = true } }
export class MeshBasicMaterial extends Material { constructor() { super(); this.isMeshBasicMaterial = true; this.map = null } }
export class MeshStandardMaterial extends Material { constructor() { super(); this.isMeshStandardMaterial = true; this.map = null; this.lightMap = null; this.lightMapIntensity = 1 } }
export class Mesh extends Object3D { constructor(material) { super(); this.isMesh = true; this.material = material } }
export const textureLoads = []
export class TextureLoader {
  load(url, onLoad) {
    textureLoads.push(url)
    const texture = new Texture(url)
    queueMicrotask(() => onLoad?.(texture))
    return texture
  }
}
export class Color { set() { return this } multiplyScalar() { return this } }
export const SRGBColorSpace = 'srgb'
export const ClampToEdgeWrapping = 'clamp'
`)
      writeFileSync(join(directory, 'hero.gen.js'), `export const hero = {
        states: {
          day: '/day.png?v=day', night: '/night.png?v=night',
          legacy: '/legacy.png?v=legacy',
        },
        bakeOutputs: { main: 'appearance' },
        stateScales: { day: { main: 2 }, night: { main: 0.5 } },
        textureVariants: {
          '/night.png': [
            { url: '/night.256.webp', format: 'webp', width: 256, height: 256, bytes: 100, hash: 'small', lossless: true },
            { url: '/night.2048.webp', format: 'webp', width: 2048, height: 2048, bytes: 200, hash: 'large', lossless: true },
          ],
        },
        lightGroups: { lamp: { url: '/lamp.png?v=lamp', maxValue: 3 } },
        stateVisibility: {}, defaultState: 'day',
      }`)
      const source = renderBakedRecipe('hero')
        .replace("from './hero.gen'", "from './hero.gen.js'")
      const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText
      const recipePath = join(directory, 'hero.baked.js')
      writeFileSync(recipePath, output)

      const THREE = await import(pathToFileURL(join(threeDirectory, 'index.js')).href)
      const { createBakedScene } = await import(`${pathToFileURL(recipePath).href}?test=${Date.now()}`)
      const root = new THREE.Object3D('Root')
      const bakedOriginal = new THREE.Texture('baked-original')
      const bakedMaterial = new THREE.MeshBasicMaterial()
      bakedMaterial.name = 'Baked'
      bakedMaterial.map = bakedOriginal
      const baked = new THREE.Mesh(bakedMaterial)
      baked.name = 'Baked Mesh'
      baked.userData = { blendlink_id: 'baked-id', blendlink_atlas: 'main' }
      detachConstructorIdentity(bakedMaterial)
      detachConstructorIdentity(baked)
      expect(bakedMaterial).not.toBeInstanceOf(THREE.MeshBasicMaterial)
      expect(baked).not.toBeInstanceOf(THREE.Mesh)
      root.add(baked)

      const realtimeOriginal = new THREE.Texture('realtime-original')
      const realtimeMaterial = new THREE.MeshBasicMaterial()
      realtimeMaterial.name = 'Realtime Unlit'
      realtimeMaterial.map = realtimeOriginal
      const realtime = new THREE.Mesh(realtimeMaterial)
      realtime.name = 'Realtime Unlit Mesh'
      realtime.userData = { blendlink_id: 'realtime-id' }
      // Parent beneath a baked object to prove an authored stable-ID boundary
      // does not inherit the ancestor's atlas tag. Anonymous loader-created
      // primitive children still inherit it.
      baked.add(realtime)

      const handle = createBakedScene(root)
      await handle.ready
      const initialized = []
      await handle.prepare({
        capabilities: { getMaxAnisotropy: () => 8 },
        initTexture: (texture) => initialized.push(texture),
      })
      expect(bakedOriginal.anisotropy).toBe(8)
      expect(initialized).toContain(bakedOriginal)
      // GLTFLoader has already decoded the Appearance atlas embedded in the
      // GLB. The declared default state must reuse that loader-owned texture,
      // not request the same PNG a second time.
      expect(bakedMaterial.map).toBe(bakedOriginal)
      // An authored but inactive light group must not become a startup
      // request. It is decoded only when its contribution becomes visible.
      expect(THREE.textureLoads).toEqual([])
      await expect(handle.setLightGroupAsync('lamp', { strength: 1 })).resolves.toBe(true)
      expect(THREE.textureLoads).toEqual(['/lamp.png?v=lamp'])
      expect(realtimeMaterial.map).toBe(realtimeOriginal)
      await expect(handle.setStateAsync('day')).resolves.toBe(true)
      expect(bakedMaterial.map).toBe(bakedOriginal)
      expect(THREE.textureLoads).toEqual(['/lamp.png?v=lamp'])

      const shader = {
        fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>',
        uniforms: {},
      }
      bakedMaterial.onBeforeCompile(shader, null)
      expect(shader.uniforms.blStateScale.value).toBe(2)
      expect(shader.fragmentShader.indexOf('#include <map_fragment>'))
        .toBeLessThan(shader.fragmentShader.indexOf('diffuseColor.rgb *= blStateScale'))
      expect(shader.fragmentShader.indexOf('diffuseColor.rgb *= blStateScale'))
        .toBeLessThan(shader.fragmentShader.indexOf('texture2D(blLayerMap0'))

      await expect(handle.setStateAsync('night')).resolves.toBe(true)
      const night = bakedMaterial.map
      expect(night.url).toBe('/night.2048.webp')
      expect(shader.uniforms.blStateScale.value).toBe(0.5)
      expect(THREE.textureLoads).toEqual(['/lamp.png?v=lamp', '/night.2048.webp'])

      // A clone made while an alternate state is active still follows the
      // loader-owned default map when the composition returns to day.
      const adoptedClone = new THREE.MeshBasicMaterial()
      adoptedClone.map = night
      const releaseClone = handle.trackMaterialClone(bakedMaterial, adoptedClone)
      const cloneShader = {
        fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>',
        uniforms: {},
      }
      adoptedClone.onBeforeCompile(cloneShader, null)
      expect(cloneShader.uniforms.blStateScale.value).toBe(0.5)
      expect(handle.setState('day')).toBe(true)
      expect(bakedMaterial.map).toBe(bakedOriginal)
      expect(adoptedClone.map).toBe(bakedOriginal)
      expect(shader.uniforms.blStateScale.value).toBe(2)
      expect(cloneShader.uniforms.blStateScale.value).toBe(2)
      expect(THREE.textureLoads).toEqual(['/lamp.png?v=lamp', '/night.2048.webp'])

      await expect(handle.setStateAsync('legacy')).resolves.toBe(true)
      const legacy = bakedMaterial.map
      expect(shader.uniforms.blStateScale.value).toBe(1)
      expect(cloneShader.uniforms.blStateScale.value).toBe(1)
      expect(handle.setState('night')).toBe(true)
      expect(adoptedClone.map).toBe(night)

      // An application-adopted clone transfers only the handle-owned texture
      // it still references. The GLB/default texture was never ours to free.
      releaseClone(true)
      expect(handle.setState('day')).toBe(true)
      expect(adoptedClone.map).toBe(night)
      handle.dispose()
      expect(bakedMaterial.map).toBe(bakedOriginal)
      expect(realtimeMaterial.map).toBe(realtimeOriginal)
      expect(bakedOriginal.disposed).toBeUndefined()
      expect(night.disposed).toBeUndefined()
      expect(legacy.disposed).toBe(true)

      // A tiny explicit cache proves inactive known-size variants are evicted
      // and loaded again on demand, while the active state is never freed.
      THREE.textureLoads.length = 0
      const bounded = createBakedScene(root, { textureCacheBytes: 1 })
      await expect(bounded.setStateAsync('night')).resolves.toBe(true)
      const boundedNight = bakedMaterial.map
      expect(boundedNight.disposed).toBeUndefined()
      await expect(bounded.setStateAsync('legacy')).resolves.toBe(true)
      expect(boundedNight.disposed).toBe(true)
      await expect(bounded.setStateAsync('night')).resolves.toBe(true)
      expect(bakedMaterial.map).not.toBe(boundedNight)
      expect(THREE.textureLoads.filter((url) => url === '/night.2048.webp')).toHaveLength(2)
      bounded.dispose()

      // The default is artist-predictable full quality. An explicit request
      // instead chooses the smallest advertised tier that satisfies it.
      THREE.textureLoads.length = 0
      const requested = createBakedScene(root, { atlasDeliveryQuality: 128 })
      await expect(requested.setStateAsync('night')).resolves.toBe(true)
      expect(bakedMaterial.map.url).toBe('/night.256.webp')
      expect(THREE.textureLoads).toEqual(['/night.256.webp'])
      requested.dispose()

      THREE.textureLoads.length = 0
      const requestedBetweenTiers = createBakedScene(root, { atlasDeliveryQuality: 512 })
      await expect(requestedBetweenTiers.setStateAsync('night')).resolves.toBe(true)
      expect(bakedMaterial.map.url).toBe('/night.2048.webp')
      expect(THREE.textureLoads).toEqual(['/night.2048.webp'])
      requestedBetweenTiers.dispose()

      // Adaptive delivery is an explicit opt-in and retains the former
      // viewport/device heuristic. A tiny viewport floors the request at 256.
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { innerWidth: 128, innerHeight: 96, devicePixelRatio: 1 },
      })
      try {
        THREE.textureLoads.length = 0
        const authored = createBakedScene(root)
        await expect(authored.setStateAsync('night')).resolves.toBe(true)
        expect(bakedMaterial.map.url).toBe('/night.2048.webp')
        expect(THREE.textureLoads).toEqual(['/night.2048.webp'])
        authored.dispose()

        THREE.textureLoads.length = 0
        const adaptive = createBakedScene(root, { atlasDeliveryQuality: 'adaptive' })
        await expect(adaptive.setStateAsync('night')).resolves.toBe(true)
        expect(bakedMaterial.map.url).toBe('/night.256.webp')
        expect(THREE.textureLoads).toEqual(['/night.256.webp'])
        adaptive.dispose()
      } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
        else delete (globalThis as { window?: unknown }).window
      }

      expect(() => createBakedScene(root, { atlasDeliveryQuality: 0 })).toThrow(
        /atlasDeliveryQuality must be 'authored', 'adaptive', or a positive finite resolution/,
      )

      bakedMaterial.map = null
      expect(() => createBakedScene(root)).toThrow(
        /expected the GLB to embed default state "day".*has no map.*Re-sync the scene/s,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('installs lighting states as scaled light maps without replacing PBR appearance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-lightmap-runtime-'))
    try {
      const threeDirectory = join(directory, 'node_modules', 'three')
      mkdirSync(threeDirectory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(
        join(threeDirectory, 'package.json'),
        JSON.stringify({ name: 'three', type: 'module', exports: './index.js' }),
      )
      writeFileSync(join(threeDirectory, 'index.js'), `
export class Object3D {
  constructor(name = '') { this.name = name; this.visible = true; this.parent = null; this.children = []; this.userData = {} }
  add(child) { child.parent = this; this.children.push(child) }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse(visitor) }
}
export class Material {
  constructor() { this.name = ''; this.needsUpdate = false; this.onBeforeCompile = () => {}; this.customProgramCacheKey = () => '' }
}
export class Texture { constructor(url = '') { this.url = url; this.channel = 0 } dispose() { this.disposed = true } }
export class MeshBasicMaterial extends Material { constructor() { super(); this.isMeshBasicMaterial = true; this.map = null } }
export class MeshStandardMaterial extends Material {
  constructor() { super(); this.isMeshStandardMaterial = true; this.map = null; this.lightMap = null; this.lightMapIntensity = 1 }
}
export class Mesh extends Object3D { constructor(material) { super(); this.isMesh = true; this.material = material } }
export class TextureLoader {
  load(url, onLoad, _onProgress, onError) {
    const texture = new Texture(url)
    queueMicrotask(() => url.includes('missing') ? onError?.(new Error('HTTP 404')) : onLoad?.(texture))
    return texture
  }
}
export class Color { set() { return this } multiplyScalar() { return this } }
export const SRGBColorSpace = 'srgb'
export const ClampToEdgeWrapping = 'clamp'
`)
      writeFileSync(join(directory, 'hero.gen.js'), `export const hero = {
        states: {
          day: '/day.png?v=day', night: '/night.png?v=night',
          broken: '/missing.png?v=missing',
        },
        bakeOutputs: { main: 'lighting' },
        stateScales: {
          day: { main: 2.5 }, night: { main: 0.4 }, broken: { main: 1 },
        },
        lightGroups: {}, stateVisibility: {}, defaultState: 'day',
      }`)
      const output = ts.transpileModule(
        renderBakedRecipe('hero').replace("from './hero.gen'", "from './hero.gen.js'"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      ).outputText
      const recipePath = join(directory, 'hero.baked.js')
      writeFileSync(recipePath, output)

      const THREE = await import(pathToFileURL(join(threeDirectory, 'index.js')).href)
      const { createBakedScene } = await import(`${pathToFileURL(recipePath).href}?test=${Date.now()}`)
      const root = new THREE.Object3D('Root')
      const material = new THREE.MeshStandardMaterial()
      material.name = 'Painted PBR'
      const albedo = new THREE.Texture('albedo')
      const originalLightMap = new THREE.Texture('original-light')
      material.map = albedo
      material.lightMap = originalLightMap
      material.lightMapIntensity = 0.75
      const mesh = new THREE.Mesh(material)
      mesh.name = 'Lighting Mesh'
      mesh.userData = {
        blendlink_id: 'lighting-id', blendlink_atlas: 'main',
        blendlink_bake_output: 'lighting', blendlink_lightmap_uv: 2,
      }
      root.add(mesh)

      const handle = createBakedScene(root)
      await handle.ready
      const day = material.lightMap
      expect(material.map).toBe(albedo)
      expect(day.url).toBe('/day.png?v=day')
      expect(day.channel).toBe(2)
      expect(day.colorSpace).toBe('srgb')
      expect(material.lightMapIntensity).toBe(2.5)
      expect(handle.setState('night')).toBe(true)
      const night = material.lightMap
      expect(night.url).toBe('/night.png?v=night')
      expect(night.channel).toBe(2)
      expect(material.lightMapIntensity).toBe(0.4)
      await expect(handle.setStateAsync('broken')).rejects.toThrow(
        /baked state "broken", atlas "main" at "\/missing\.png\?v=missing".*HTTP 404/,
      )
      expect(material.lightMap).toBe(night)
      expect(material.lightMapIntensity).toBe(0.4)
      expect(await handle.setStateAsync('missing-state')).toBe(false)

      handle.dispose()
      expect(material.map).toBe(albedo)
      expect(material.lightMap).toBe(originalLightMap)
      expect(material.lightMapIntensity).toBe(0.75)
      expect(day.disposed).toBe(true)
      expect(night.disposed).toBe(true)

      const generated = await import(pathToFileURL(join(directory, 'hero.gen.js')).href)
      delete generated.hero.stateScales.night.main
      expect(() => createBakedScene(root)).toThrow(/no finite positive state scale/)
      generated.hero.stateScales.night.main = 0.4
      generated.hero.lightGroups.lamp = { url: '/lamp.png', maxValue: 1 }
      expect(() => createBakedScene(root)).toThrow(/refuses to fake.*PBR lighting/s)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('is a harmless no-op for a Realtime descriptor with no baked assets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-realtime-recipe-runtime-'))
    try {
      const threeDirectory = join(directory, 'node_modules', 'three')
      mkdirSync(threeDirectory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(
        join(threeDirectory, 'package.json'),
        JSON.stringify({ name: 'three', type: 'module', exports: './index.js' }),
      )
      writeFileSync(join(threeDirectory, 'index.js'), `
export class Object3D {
  constructor(name = '') { this.name = name; this.visible = true; this.parent = null; this.children = []; this.userData = {} }
  add(child) { child.parent = this; this.children.push(child) }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse(visitor) }
}
export class Material {
  constructor() { this.name = ''; this.needsUpdate = false; this.onBeforeCompile = () => {}; this.customProgramCacheKey = () => '' }
}
export class Texture { dispose() { this.disposed = true } }
export class MeshBasicMaterial extends Material { constructor() { super(); this.isMeshBasicMaterial = true; this.map = null } }
export class MeshStandardMaterial extends Material { constructor() { super(); this.isMeshStandardMaterial = true; this.map = null; this.lightMap = null; this.lightMapIntensity = 1 } }
export class Mesh extends Object3D { constructor(material) { super(); this.isMesh = true; this.material = material } }
export class TextureLoader { constructor() { throw new Error('Realtime recipe must not create an atlas loader') } }
export class Color { set() { return this } multiplyScalar() { return this } }
export const SRGBColorSpace = 'srgb'
export const ClampToEdgeWrapping = 'clamp'
`)
      writeFileSync(join(directory, 'hero.gen.js'), `export const hero = {
        states: {}, bakeOutputs: {}, stateScales: {}, lightGroups: {}, stateVisibility: {}, defaultState: null,
      }`)
      const output = ts.transpileModule(
        renderBakedRecipe('hero').replace("from './hero.gen'", "from './hero.gen.js'"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      ).outputText
      const recipePath = join(directory, 'hero.baked.js')
      writeFileSync(recipePath, output)

      const THREE = await import(pathToFileURL(join(threeDirectory, 'index.js')).href)
      const { createBakedScene } = await import(`${pathToFileURL(recipePath).href}?test=${Date.now()}`)
      const root = new THREE.Object3D('Root')
      const originalMaterial = new THREE.MeshBasicMaterial()
      const realtimeMesh = new THREE.Mesh(originalMaterial)
      // A stale atlas tag from an older Hybrid export must still be harmless
      // when the current descriptor has no baked assets.
      realtimeMesh.userData = { blendlink_id: 'realtime-id', blendlink_atlas: 'main' }
      root.add(realtimeMesh)

      const handle = createBakedScene(root)
      expect(handle.lightGroupNames).toEqual([])
      await expect(handle.ready).resolves.toBeUndefined()
      expect(handle.setState('anything')).toBe(false)
      expect(handle.setLightGroup('anything')).toBe(false)
      expect(realtimeMesh.material).toBe(originalMaterial)
      expect(realtimeMesh.visible).toBe(true)
      handle.dispose()
      handle.dispose()
      expect(realtimeMesh.material).toBe(originalMaterial)
      expect(realtimeMesh.visible).toBe(true)
      expect(originalMaterial.needsUpdate).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
