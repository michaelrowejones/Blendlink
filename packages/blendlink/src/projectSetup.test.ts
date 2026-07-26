import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupWebsiteProject } from './projectSetup.js'

function project(name: string): string {
  return mkdtempSync(join(tmpdir(), `blendlink-setup-${name}-`))
}

describe('artist-first website setup', () => {
  it('creates a working, inspectable Three/Vite starter when no website exists', async () => {
    const root = project('new')
    const result = await setupWebsiteProject(root)
    expect(result.stack).toBe('new-three-vite')
    expect(result.sceneName).toBe('sample')
    expect(existsSync(join(root, 'assets', 'sample.blend'))).toBe(true)
    expect(existsSync(join(root, 'blendlink.config.mjs'))).toBe(true)
    const entry = readFileSync(join(root, 'src', 'main.ts'), 'utf8')
    expect(entry).toContain("import { installSampleScene } from './blendlink/SampleScene'")
    expect(entry).toContain('await installSampleScene({')
    expect(entry).toContain('installed.update(deltaSeconds)')
    expect(entry).toContain('installed.render(deltaSeconds)')
    expect(entry).toContain('width > 0 && height > 0')
    expect(entry).not.toContain('renderer.render(world, installed.camera)')
    expect(entry.indexOf('installed.update(deltaSeconds)'))
      .toBeLessThan(entry.indexOf('installed.render(deltaSeconds)'))
    const integration = readFileSync(join(root, 'src', 'blendlink', 'SampleScene.ts'), 'utf8')
    expect(integration).toContain("import { sample as compiledScene } from '../generated/sample.gen'")
    expect(integration).toContain("import { createBakedScene } from '../generated/sample.baked'")
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['blendlink:connect']).toBe('blendlink connect')
    expect(pkg.scripts['blendlink:preview']).toBe('blendlink preview')
    expect(pkg.scripts['blendlink:publish']).toBe('blendlink publish')
    expect(pkg.dependencies.three).toBe('0.184.0')
    expect(pkg.devDependencies['@types/three']).toBe('^0.184.0')
    expect(result.nextActions.join('\n')).toContain('Set Up Blendlink Scene')
  })

  it('attaches an existing R3F site without editing application source', async () => {
    const root = project('r3f')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      dependencies: { react: '^19.2.0', '@react-three/fiber': '^9.6.1' },
    }))
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')
    const source = '// the website owns this file\nexport function App() { return null }\n'
    writeFileSync(join(root, 'App.tsx'), source)

    const result = await setupWebsiteProject(root)
    expect(result.stack).toBe('react-three-fiber')
    expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toBe(source)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts).toMatchObject({
      dev: 'vite',
      'blendlink:connect': 'blendlink connect',
      'blendlink:preview': 'blendlink preview',
      'blendlink:publish': 'blendlink publish',
      'blendlink:check': 'blendlink verify',
    })
    expect(pkg.dependencies.blendlink).toMatch(/^\^/)
    expect(pkg.dependencies.three).toBe('0.184.0')
    expect(pkg.devDependencies['@types/three']).toBe('^0.184.0')
    expect(result.nextActions[0]).toContain('install the declared website dependencies')
    expect(result.changes.join('\n')).toContain('without editing application source')
    const integration = join(root, 'src', 'blendlink', 'HeroScene.ts')
    expect(existsSync(integration)).toBe(true)
    const component = readFileSync(integration, 'utf8')
    expect(component.startsWith("'use client'\n")).toBe(true)
    expect(component).toContain("from 'blendlink/react-three-fiber'")
    expect(component).toContain('createR3FCompiledScene')
    expect(component).toContain("createBakedScene")
    expect(component).toContain('export type HeroSceneProps = R3FCompiledSceneProps')
    expect(component).toContain('export const HeroScene = createR3FCompiledScene({')
    expect(component).toContain('export const useHeroScene = HeroScene.useScene')
    expect(component).toContain("displayName: 'HeroScene'")
    expect(component).not.toContain('useFrame')
    expect(component).not.toContain('installThreeCompiledScene')
    expect(component).not.toContain('value.dispose()')
    expect(result.nextActions.join('\n')).toContain('WebGL R3F Canvas with <HeroScene />')
    expect(result.nextActions.join('\n')).toContain('blendlink:publish')
    expect(result.nextActions.findIndex((action) => action.includes('<HeroScene />')))
      .toBeLessThan(result.nextActions.findIndex((action) => action.includes('blendlink:preview')))
  })

  it('connects the exact Preview-selected blend instead of scanning the website', async () => {
    const root = project('selected-blend-site')
    const artwork = project('selected-blend-art')
    const blendPath = join(artwork, 'Artist Hero.blend')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.2.0', '@react-three/fiber': '^9.6.1' },
    }))
    writeFileSync(join(root, 'unrelated.blend'), 'must not be selected')
    writeFileSync(blendPath, 'selected scene')

    const result = await setupWebsiteProject(root, { blendPath })

    expect(result.sceneName).toBe('ArtistHero')
    const config = readFileSync(join(root, 'blendlink.config.mjs'), 'utf8')
    expect(config).toContain('Artist Hero.blend')
    expect(config).not.toContain('unrelated.blend')
    expect(existsSync(join(root, 'src', 'blendlink', 'ArtistHeroScene.ts'))).toBe(true)
  })

  it('does not rewrite an executable config to smuggle in another selected blend', async () => {
    const root = project('selected-existing-config')
    const selected = join(root, 'selected.blend')
    const configPath = join(root, 'blendlink.config.mjs')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { three: '0.184.0' } }))
    writeFileSync(join(root, 'declared.blend'), 'declared')
    writeFileSync(selected, 'selected')
    const source = "export default { scenes: [{ file: 'declared.blend' }] }\n"
    writeFileSync(configPath, source)

    await expect(setupWebsiteProject(root, { blendPath: selected }))
      .rejects.toThrow(/does not declare the selected scene.*never rewrites executable config/s)
    expect(readFileSync(configPath, 'utf8')).toBe(source)
  })

  it('creates a one-call integration for every existing Vanilla Three scene', async () => {
    const root = project('existing-three')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { three: '0.184.0' },
    }))
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')

    const result = await setupWebsiteProject(root)

    expect(result.stack).toBe('three')
    const integration = join(root, 'src', 'blendlink', 'HeroScene.ts')
    expect(existsSync(integration)).toBe(true)
    const source = readFileSync(integration, 'utf8')
    expect(source).toContain("import { hero as compiledScene } from '../generated/hero.gen'")
    expect(source).toContain("import { createBakedScene } from '../generated/hero.baked'")
    expect(source).toContain('export function installHeroScene(')
    expect(source).toContain('descriptor: compiledScene')
    expect(source).toContain('createBakedScene,')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.devDependencies['@types/three']).toBe('^0.184.0')
    expect(result.nextActions.join('\n')).toContain(
      'Three WebGLRenderer with await installHeroScene({ renderer, scene }) from src/blendlink/HeroScene.ts',
    )
  })

  it('preserves conflicting package scripts and reports the exact ownership boundary', async () => {
    const root = project('script-owner')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: { 'blendlink:publish': 'our-release-pipeline' },
      dependencies: { three: '0.184.0', blendlink: 'workspace:*' },
    }))
    writeFileSync(join(root, 'scene.blend'), 'test fixture; discovery only')
    const result = await setupWebsiteProject(root)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['blendlink:publish']).toBe('our-release-pipeline')
    expect(pkg.dependencies.blendlink).toBe('workspace:*')
    expect(result.warnings.join('\n')).toContain('did not overwrite it')
  })

  it('does not produce a stuttering SceneScene component name', async () => {
    const root = project('scene-suffix')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.2.0', '@react-three/fiber': '^9.6.1' },
    }))
    writeFileSync(join(root, 'workbenchScene.blend'), 'test fixture; discovery only')

    const result = await setupWebsiteProject(root)

    expect(existsSync(join(root, 'src', 'blendlink', 'WorkbenchScene.ts'))).toBe(true)
    expect(existsSync(join(root, 'src', 'blendlink', 'WorkbenchSceneScene.ts'))).toBe(false)
    expect(result.nextActions.join('\n')).toContain('<WorkbenchScene />')
  })

  it('imports from the configured generated directory instead of guessing src/generated', async () => {
    const root = project('custom-generated')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.2.0', '@react-three/fiber': '^9.6.1' },
    }))
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'blendlink.config.mjs'), `export default {
  genDir: 'app/scene-artifacts',
  outDir: 'static/scene-assets',
  scenes: [{ file: 'hero.blend', name: 'hero' }],
}\n`)

    const result = await setupWebsiteProject(root)

    const integration = readFileSync(join(root, 'src', 'blendlink', 'HeroScene.ts'), 'utf8')
    expect(integration).toContain("from '../../app/scene-artifacts/hero.gen'")
    expect(integration).toContain("from '../../app/scene-artifacts/hero.baked'")
    expect(existsSync(join(root, 'app', 'scene-artifacts'))).toBe(true)
    expect(existsSync(join(root, 'static', 'scene-assets'))).toBe(true)
    expect(result.nextActions.join('\n')).toContain('static/scene-assets, app/scene-artifacts')
  })

  it('uses a custom generated directory in a new-site starter', async () => {
    const root = project('new-custom-generated')
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'blendlink.config.mjs'), `export default {
  genDir: 'app/scene-artifacts',
  outDir: 'static/scene-assets',
  scenes: [{ file: 'hero.blend', name: 'hero' }],
}\n`)

    const result = await setupWebsiteProject(root)

    expect(result.stack).toBe('new-three-vite')
    const entry = readFileSync(join(root, 'src', 'main.ts'), 'utf8')
    expect(entry).toContain("import { installHeroScene } from './blendlink/HeroScene'")
    const integration = readFileSync(join(root, 'src', 'blendlink', 'HeroScene.ts'), 'utf8')
    expect(integration).toContain("from '../../app/scene-artifacts/hero.gen'")
    expect(integration).toContain("from '../../app/scene-artifacts/hero.baked'")
    expect(existsSync(join(root, 'app', 'scene-artifacts'))).toBe(true)
    expect(existsSync(join(root, 'static', 'scene-assets'))).toBe(true)
  })

  it('creates an explicit R3F integration for every configured scene', async () => {
    const root = project('multiple-scenes')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.2.0', '@react-three/fiber': '^9.6.1' },
    }))
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'gallery.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'blendlink.config.mjs'), `export default {
  scenes: [
    { file: 'hero.blend', name: 'hero' },
    { file: 'gallery.blend', name: 'gallery' },
  ],
}\n`)

    const result = await setupWebsiteProject(root)

    expect(existsSync(join(root, 'src', 'blendlink', 'HeroScene.ts'))).toBe(true)
    expect(existsSync(join(root, 'src', 'blendlink', 'GalleryScene.ts'))).toBe(true)
    expect(result.nextActions.join('\n')).toContain('<HeroScene />')
    expect(result.nextActions.join('\n')).toContain('<GalleryScene />')
  })

  it.each([
    ['Three.js', { three: '0.184.0' }],
    ['React Three Fiber', { react: '^19.2.0', '@react-three/fiber': '^9.6.1' }],
  ])('rejects colliding %s integration names before writing one', async (_label, dependencies) => {
    const root = project('integration-name-collision')
    const packageJson = JSON.stringify({ dependencies })
    writeFileSync(join(root, 'package.json'), packageJson)
    writeFileSync(join(root, 'hero.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'heroScene.blend'), 'test fixture; discovery only')
    writeFileSync(join(root, 'blendlink.config.mjs'), `export default {
  scenes: [
    { file: 'hero.blend', name: 'hero' },
    { file: 'heroScene.blend', name: 'heroScene' },
  ],
}\n`)

    await expect(setupWebsiteProject(root)).rejects.toThrow(
      /"hero" and "heroScene" both map to the website integration HeroScene\.ts/,
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageJson)
    expect(existsSync(join(root, 'src', 'blendlink'))).toBe(false)
  })

  it('recognizes its starter on rerun without creating a competing integration', async () => {
    const root = project('starter-rerun')
    await setupWebsiteProject(root)
    const entryPath = join(root, 'src', 'main.ts')
    const integrationPath = join(root, 'src', 'blendlink', 'SampleScene.ts')
    const entry = readFileSync(entryPath, 'utf8')
    const integration = readFileSync(integrationPath, 'utf8')

    const result = await setupWebsiteProject(root)

    expect(readFileSync(entryPath, 'utf8')).toBe(entry)
    expect(readFileSync(integrationPath, 'utf8')).toBe(integration)
    expect(result.warnings.join('\n')).toContain('recognized the Blendlink starter')
    expect(result.changes.join('\n')).not.toContain('created user-owned Three.js scene integration')
    expect(existsSync(join(root, 'src', 'blendlink', 'SampleSceneScene.ts'))).toBe(false)
  })

  it('refuses to guess a renderer for an unrelated existing website', async () => {
    const root = project('not-three')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }))
    await expect(setupWebsiteProject(root)).rejects.toThrow(/does not declare `three`/)
    expect(existsSync(join(root, 'blendlink.config.mjs'))).toBe(false)
  })

  it('rejects a known-incompatible Three release before mutating the website', async () => {
    const root = project('old-three')
    const packageJson = JSON.stringify({ dependencies: { three: '^0.179.0' } })
    writeFileSync(join(root, 'package.json'), packageJson)

    await expect(setupWebsiteProject(root)).rejects.toThrow(/source-audited Three 0\.184\.0/)

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageJson)
    expect(existsSync(join(root, 'blendlink.config.mjs'))).toBe(false)
  })

  it('rejects an incompatible or incomplete React Three Fiber pair before mutation', async () => {
    const oldRoot = project('old-r3f')
    const oldPackage = JSON.stringify({
      dependencies: { react: '^18.3.0', '@react-three/fiber': '^8.17.0' },
    })
    writeFileSync(join(oldRoot, 'package.json'), oldPackage)

    await expect(setupWebsiteProject(oldRoot)).rejects.toThrow(
      /@react-three\/fiber 9\.x.*React Three Fiber 9/i,
    )
    expect(readFileSync(join(oldRoot, 'package.json'), 'utf8')).toBe(oldPackage)
    expect(existsSync(join(oldRoot, 'blendlink.config.mjs'))).toBe(false)

    const missingReactRoot = project('r3f-missing-react')
    const missingReactPackage = JSON.stringify({
      dependencies: { '@react-three/fiber': '^9.6.1' },
    })
    writeFileSync(join(missingReactRoot, 'package.json'), missingReactPackage)

    await expect(setupWebsiteProject(missingReactRoot)).rejects.toThrow(
      /does not declare `react`.*React 19.*Fiber 9/i,
    )
    expect(readFileSync(join(missingReactRoot, 'package.json'), 'utf8')).toBe(missingReactPackage)
    expect(existsSync(join(missingReactRoot, 'blendlink.config.mjs'))).toBe(false)
  })

  it('rejects Three releases newer than the post stack has been validated against', async () => {
    const root = project('future-three')
    const packageJson = JSON.stringify({ dependencies: { three: '^0.186.0' } })
    writeFileSync(join(root, 'package.json'), packageJson)

    await expect(setupWebsiteProject(root)).rejects.toThrow(/source-audited Three 0\.184\.0/i)

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageJson)
    expect(existsSync(join(root, 'blendlink.config.mjs'))).toBe(false)
  })

  it('requires the exact audited Three runtime and refuses ranges or aliases', async () => {
    const compatible = project('exact-three')
    writeFileSync(join(compatible, 'package.json'), JSON.stringify({
      dependencies: { three: '0.184.0' },
    }))
    await expect(setupWebsiteProject(compatible)).resolves.toMatchObject({ stack: 'three' })

    for (const [label, range] of [
      ['caret', '^0.184.0'],
      ['minor-wildcard', '0.184.x'],
      ['bounded-minor', '>=0.184.0 <0.185.0'],
      ['formerly-broad', '>=0.180.0 <0.186.0'],
      ['excluding-runtime-patch', '^0.184.1'],
    ]) {
      const root = project(label)
      const packageJson = JSON.stringify({ dependencies: { three: range } })
      writeFileSync(join(root, 'package.json'), packageJson)
      await expect(setupWebsiteProject(root)).rejects.toThrow(/exact source-audited Three 0\.184\.0/i)
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageJson)
    }

    const unprovable = project('aliased-three')
    const packageJson = JSON.stringify({ dependencies: { three: 'workspace:*' } })
    writeFileSync(join(unprovable, 'package.json'), packageJson)
    await expect(setupWebsiteProject(unprovable)).rejects.toThrow(/exact source-audited Three 0\.184\.0/i)
    expect(readFileSync(join(unprovable, 'package.json'), 'utf8')).toBe(packageJson)
  })

  it('aliases a scene-named descriptor so it cannot collide with the Three world', async () => {
    const root = project('scene-name')
    writeFileSync(join(root, 'scene.blend'), 'test fixture; discovery only')
    const result = await setupWebsiteProject(root)
    expect(result.sceneName).toBe('scene')
    const entry = readFileSync(join(root, 'src', 'main.ts'), 'utf8')
    expect(entry).toContain("import { installScene } from './blendlink/Scene'")
    expect(entry).toContain('const world = new THREE.Scene()')
    expect(entry).not.toContain('const scene = new THREE.Scene()')
    const integration = readFileSync(join(root, 'src', 'blendlink', 'Scene.ts'), 'utf8')
    expect(integration).toContain("import { scene as compiledScene } from '../generated/scene.gen'")
  })
})
