import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  BAKED_RECIPE_TEMPLATE_MARKER,
  BAKED_RECIPE_TEMPLATE_VERSION,
  bakedRecipeBackupPath,
  inspectBakedRecipeTemplate,
  renderBakedRecipe,
} from './bakedRecipe.js'
import { resolveConfig } from './config.js'
import {
  LEGACY_PREVIEW_STUDIO_INDEX_WITH_FAVICON,
  PREVIEW_STUDIO_HOST_VERSION,
  PREVIEW_STUDIO_INDEX_VERSION_MARKER,
  PREVIEW_STUDIO_MAIN_VERSION_MARKER,
  PREVIEW_STUDIO_STYLE_VERSION_MARKER,
  PREVIEW_STUDIO_VITE_VERSION_MARKER,
  UNVERSIONED_PREVIEW_STUDIO_STYLE,
  unversionedPreviewStudioViteConfigSource,
} from './previewStudioHost.js'
import {
  PreviewStudioGenerationGate,
  canReuseReachablePreview,
  extractLocalPreviewUrl,
  legacyLivePreviewStudioMainSource,
  legacyPreviewStudioMainSource,
  planPreviewStudio,
  previewStudioNeedsInstall,
  previewStudioStageError,
  resolvePreviewStudioBlendlinkDependency,
  resolveWebsitePreview,
  runWebsitePreview,
  scaffoldPreviewStudio,
} from './preview.js'

function tempProject(name: string): string {
  const root = join(tmpdir(), `blendlink-preview-${process.pid}-${name}`)
  mkdirSync(root, { recursive: true })
  return root
}

function blendlinkEvents(calls: readonly unknown[][]): Record<string, unknown>[] {
  return calls.flatMap((call) => {
    const line = String(call[0] ?? '')
    if (!line.startsWith('##blendlink ')) return []
    return [JSON.parse(line.slice('##blendlink '.length)) as Record<string, unknown>]
  })
}

describe('website preview contract', () => {
  it('keeps Blender output attached when adding Preview Studio stage context', () => {
    const detail = {
      exitCode: 1,
      stderrTail: 'Traceback: exporter import failed',
    }
    const blenderError = Object.assign(new Error('Blender exited abnormally (code 1).'), {
      detail,
    })

    const wrapped = previewStudioStageError('compile', blenderError) as Error & {
      detail?: typeof detail
    }

    expect(wrapped.message).toBe(
      '[Preview Studio: compile] Blender exited abnormally (code 1).',
    )
    expect(wrapped.detail).toBe(detail)
    expect(wrapped.cause).toBe(blenderError)
  })

  it('plans an isolated, stable Preview Studio workspace for one saved blend', () => {
    const cacheRoot = tempProject('studio-cache')
    const plan = planPreviewStudio(join('C:', 'scenes', 'Hero.blend'), { cacheRoot })

    expect(plan.blendPath).toMatch(/Hero\.blend$/)
    expect(plan.workspace).toMatch(/hero-[a-f0-9]{16}$/)
    expect(plan.workspace.startsWith(cacheRoot)).toBe(true)
    expect(plan.sceneName).toBe('Hero')
    expect(plan.sessionId).toMatch(/^[a-f0-9]{16}$/)
  })

  it('scaffolds a disposable Three/Vite/Blendlink Preview Studio without touching unknown workspaces', () => {
    const cacheRoot = tempProject('studio-scaffold-cache')
    const plan = planPreviewStudio(join(cacheRoot, 'artist-scene.blend'), { cacheRoot })
    const result = scaffoldPreviewStudio(plan)

    const packageJson = JSON.parse(readFileSync(join(plan.workspace, 'package.json'), 'utf8'))
    const blendlinkPackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
    expect(packageJson.dependencies).toMatchObject({
      blendlink: `file:${blendlinkPackageRoot.replace(/\\/g, '/')}`,
      three: '0.184.0',
    })
    expect(packageJson.devDependencies.vite).toBe('^7.0.0')
    expect(packageJson.scripts['preview:dev']).toContain('vite --host 127.0.0.1 --port 0')
    const entry = readFileSync(join(plan.workspace, 'src', 'main.ts'), 'utf8')
    expect(entry).toContain("import * as THREE from 'three'")
    expect(entry).toContain("from 'blendlink/three'")
    expect(entry).toContain('installed.update(deltaSeconds)')
    expect(entry).toContain('installed.render(deltaSeconds)')
    expect(entry).toContain('useAuthoringPreview: true')
    expect(entry).toContain('cancelAnimationFrame(animationFrame)')
    expect(entry).toContain('compileAsync')
    expect(entry).toContain("phase: 'ready'")
    expect(entry).toContain('last good scene')
    expect(entry).not.toContain('renderer.render(world, installed.camera)')
    expect(entry.indexOf('installed.update(deltaSeconds)'))
      .toBeLessThan(entry.indexOf('installed.render(deltaSeconds)'))
    const indexPath = join(plan.workspace, 'index.html')
    const index = readFileSync(indexPath, 'utf8')
    expect(index).toContain(
      `${PREVIEW_STUDIO_INDEX_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION} -->`,
    )
    expect(index).toContain('rel="icon"')
    expect(index).toContain('data:image/svg+xml')
    expect(index).toContain('Preview Studio')
    const viteConfig = readFileSync(join(plan.workspace, 'vite.config.mjs'), 'utf8')
    expect(viteConfig).toContain(
      `${PREVIEW_STUDIO_VITE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}`,
    )
    expect(viteConfig).toContain("dedupe: ['three']")
    expect(viteConfig).toContain('/__blendlink/preview-client')
    expect(viteConfig).toContain('handleHotUpdate')
    expect(readFileSync(join(plan.workspace, 'src', 'previewBaked.ts'), 'utf8'))
      .toContain('bindPreviewDescriptor')
    const style = readFileSync(join(plan.workspace, 'src', 'style.css'), 'utf8')
    expect(style).toContain(
      `${PREVIEW_STUDIO_STYLE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION} */`,
    )
    expect(style).toContain('.toolbar button { display: block;')
    expect(style).not.toContain('.toolbar button:not(#details) { display: none;')
    expect(existsSync(join(plan.workspace, 'public', '.blendlink-preview-control.json'))).toBe(true)
    expect(readFileSync(join(plan.workspace, 'blendlink.config.mjs'), 'utf8'))
      .toContain('artist-scene.blend')
    expect(existsSync(join(plan.workspace, 'public', '.blendlink-preview-studio.json'))).toBe(true)
    expect(result.packageHash).toMatch(/^[a-f0-9]{16}$/)

    const entryPath = join(plan.workspace, 'src', 'main.ts')
    const unversionedManagedEntry = entry.replace(
      `${PREVIEW_STUDIO_MAIN_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}\n`,
      '',
    ).replaceAll('button[data-viewport]', '[data-viewport]')
    writeFileSync(entryPath, unversionedManagedEntry)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toBe(entry)

    const artistEditedCurrentEntry = entry + '// artist edit on current managed template\n'
    writeFileSync(entryPath, artistEditedCurrentEntry)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toBe(artistEditedCurrentEntry)

    const priorManagedEntry = entry.replace(
      `${PREVIEW_STUDIO_MAIN_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}`,
      `${PREVIEW_STUDIO_MAIN_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION - 1}`,
    )
    writeFileSync(entryPath, priorManagedEntry)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toBe(entry)

    writeFileSync(entryPath, legacyPreviewStudioMainSource(plan))
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toContain('cancelAnimationFrame(animationFrame)')
    expect(readFileSync(entryPath, 'utf8')).toContain('useAuthoringPreview: true')

    writeFileSync(entryPath, legacyLivePreviewStudioMainSource(plan))
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toContain('useAuthoringPreview: true')

    const artistEditedLiveEntry = legacyLivePreviewStudioMainSource(plan) + '// artist live edit\n'
    writeFileSync(entryPath, artistEditedLiveEntry)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toBe(artistEditedLiveEntry)

    const artistEditedEntry = legacyPreviewStudioMainSource(plan) + '// artist edit\n'
    writeFileSync(entryPath, artistEditedEntry)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(entryPath, 'utf8')).toBe(artistEditedEntry)

    const unversionedManagedIndex = index
      .replace(`${PREVIEW_STUDIO_INDEX_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION} -->\n`, '')
      .replace(
        'title="Background: dark. Cycle dark, checker, and light." aria-label="Background: dark"',
        'title="Cycle studio background"',
      )
    writeFileSync(indexPath, unversionedManagedIndex)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(indexPath, 'utf8')).toBe(index)

    const artistEditedCurrentIndex = index + '<!-- artist edit on current host -->\n'
    writeFileSync(indexPath, artistEditedCurrentIndex)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(indexPath, 'utf8')).toBe(artistEditedCurrentIndex)

    writeFileSync(indexPath, LEGACY_PREVIEW_STUDIO_INDEX_WITH_FAVICON)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(indexPath, 'utf8')).toBe(index)

    const legacyIndex = index.replace(/<link rel="icon"[^>]+>/, '')
    const artistEditedIndex = legacyIndex.replace('</head>', '<meta name="artist-edit" content="kept"></head>')
    writeFileSync(indexPath, artistEditedIndex)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(indexPath, 'utf8')).toBe(artistEditedIndex)

    // 0.8.0 preview caches were created before the package was published.
    // A retry from this checkout must migrate that managed dependency instead
    // of preserving the registry-only spec and failing with npm E404 again.
    const blendlinkPackage = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    packageJson.dependencies.blendlink = blendlinkPackage.version
    writeFileSync(join(plan.workspace, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
    const migrated = scaffoldPreviewStudio(plan)
    expect(JSON.parse(readFileSync(join(plan.workspace, 'package.json'), 'utf8')).dependencies.blendlink)
      .toBe(`file:${blendlinkPackageRoot.replace(/\\/g, '/')}`)
    expect(migrated.packageHash).toBe(result.packageHash)

    const customizedPackage = JSON.parse(readFileSync(join(plan.workspace, 'package.json'), 'utf8'))
    customizedPackage.dependencies.blendlink = 'github:artist/custom-blendlink'
    const customizedSource = JSON.stringify(customizedPackage, null, 2) + '\n'
    writeFileSync(join(plan.workspace, 'package.json'), customizedSource)
    expect(() => scaffoldPreviewStudio(plan)).toThrow(/unrecognized Blendlink dependency/i)
    expect(readFileSync(join(plan.workspace, 'package.json'), 'utf8')).toBe(customizedSource)

    const untouched = join(cacheRoot, 'unknown-workspace')
    mkdirSync(untouched, { recursive: true })
    writeFileSync(join(untouched, 'keep.txt'), 'artist work')
    const unknownPlan = { ...plan, workspace: untouched }
    expect(() => scaffoldPreviewStudio(unknownPlan)).toThrow(/will not use an existing unknown workspace/i)
    expect(readFileSync(join(untouched, 'keep.txt'), 'utf8')).toBe('artist work')
  })

  it('migrates every recognized Preview host artifact while preserving marked current edits', () => {
    const cacheRoot = tempProject('studio-managed-host-migration')
    const plan = planPreviewStudio(join(cacheRoot, 'artist-scene.blend'), { cacheRoot })
    scaffoldPreviewStudio(plan)
    const stylePath = join(plan.workspace, 'src', 'style.css')
    const vitePath = join(plan.workspace, 'vite.config.mjs')
    const currentStyle = readFileSync(stylePath, 'utf8')
    const currentVite = readFileSync(vitePath, 'utf8')

    writeFileSync(stylePath, currentStyle.replace(
      `${PREVIEW_STUDIO_STYLE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}`,
      `${PREVIEW_STUDIO_STYLE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION - 1}`,
    ))
    writeFileSync(vitePath, currentVite.replace(
      `${PREVIEW_STUDIO_VITE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}`,
      `${PREVIEW_STUDIO_VITE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION - 1}`,
    ))
    scaffoldPreviewStudio(plan)
    expect(readFileSync(stylePath, 'utf8')).toBe(currentStyle)
    expect(readFileSync(vitePath, 'utf8')).toBe(currentVite)

    writeFileSync(stylePath, UNVERSIONED_PREVIEW_STUDIO_STYLE)
    writeFileSync(vitePath, unversionedPreviewStudioViteConfigSource())
    scaffoldPreviewStudio(plan)
    expect(readFileSync(stylePath, 'utf8')).toBe(currentStyle)
    expect(readFileSync(vitePath, 'utf8')).toBe(currentVite)

    const editedStyle = currentStyle + '/* local cache diagnostic */\n'
    const editedVite = currentVite + '// local cache diagnostic\n'
    writeFileSync(stylePath, editedStyle)
    writeFileSync(vitePath, editedVite)
    scaffoldPreviewStudio(plan)
    expect(readFileSync(stylePath, 'utf8')).toBe(editedStyle)
    expect(readFileSync(vitePath, 'utf8')).toBe(editedVite)

    writeFileSync(stylePath, '/* unknown unversioned stylesheet */\n')
    expect(() => scaffoldPreviewStudio(plan)).toThrow(/unversioned.*does not match.*remove this disposable cache/is)
  })

  it('revokes browser-ready evidence only for an idempotent runtime failure', () => {
    const gate = new PreviewStudioGenerationGate()
    const ack = (generation: string, phase: 'ready' | 'failed', failureKind?: 'validation' | 'runtime') => ({
      schemaVersion: 1 as const,
      sessionId: 'session',
      generation,
      phase,
      ...(failureKind ? { failureKind } : {}),
      updatedAt: new Date().toISOString(),
    })

    gate.publish('generation-a')
    expect(gate.accept(ack('generation-a', 'ready'))).toBe('ready')
    expect(gate.accept(ack('generation-a', 'failed', 'validation'))).toBe('ignore')
    expect(gate.accept(ack('generation-a', 'failed', 'runtime'))).toBe('failed')
    expect(gate.accept(ack('generation-a', 'failed', 'runtime'))).toBe('ignore')
    expect(gate.accept(ack('generation-a', 'ready'))).toBe('ignore')
    expect(gate.accept(ack('stale-generation', 'failed', 'runtime'))).toBe('ignore')

    gate.beginBuild()
    gate.publish('generation-b')
    expect(gate.accept(ack('generation-b', 'ready'))).toBe('ready')
  })

  it('self-heals an outdated generated baked recipe in its identity-proven Preview Studio cache', () => {
    const cacheRoot = tempProject('studio-baked-recipe-migration')
    const plan = planPreviewStudio(join(cacheRoot, 'artist-scene.blend'), { cacheRoot })
    scaffoldPreviewStudio(plan)

    const recipePath = join(plan.workspace, 'src', 'generated', `${plan.sceneName}.baked.ts`)
    mkdirSync(dirname(recipePath), { recursive: true })
    const currentRecipe = renderBakedRecipe(plan.sceneName)
    const outdatedRecipe = currentRecipe.replace(
      `// ${BAKED_RECIPE_TEMPLATE_MARKER}: ${BAKED_RECIPE_TEMPLATE_VERSION}`,
      `// ${BAKED_RECIPE_TEMPLATE_MARKER}: 2`,
    )
    expect(inspectBakedRecipeTemplate(outdatedRecipe)).toEqual({ kind: 'outdated', version: 2 })
    writeFileSync(recipePath, outdatedRecipe)
    const bridgePath = join(plan.workspace, 'src', 'previewBaked.ts')
    const currentBridge = readFileSync(bridgePath, 'utf8')
    writeFileSync(bridgePath, currentBridge.replace(
      `// ${BAKED_RECIPE_TEMPLATE_MARKER}: ${BAKED_RECIPE_TEMPLATE_VERSION}`,
      `// ${BAKED_RECIPE_TEMPLATE_MARKER}: 2`,
    ))

    scaffoldPreviewStudio(plan)

    expect(readFileSync(recipePath, 'utf8')).toBe(currentRecipe)
    expect(readFileSync(bridgePath, 'utf8')).toBe(currentBridge)
    const backupPath = bakedRecipeBackupPath(recipePath, { kind: 'outdated', version: 2 })
    expect(readFileSync(backupPath, 'utf8')).toBe(outdatedRecipe)

    expect(() => scaffoldPreviewStudio(plan)).not.toThrow()
    expect(readFileSync(recipePath, 'utf8')).toBe(currentRecipe)
    expect(readFileSync(backupPath, 'utf8')).toBe(outdatedRecipe)
  })

  it('uses the executing package for local origins and an exact version for registry installs', () => {
    const checkoutRoot = join(tempProject('checkout-origin'), 'packages', 'blendlink')
    mkdirSync(checkoutRoot, { recursive: true })
    expect(resolvePreviewStudioBlendlinkDependency(checkoutRoot, '0.8.0'))
      .toBe(`file:${resolve(checkoutRoot).replace(/\\/g, '/')}`)

    const publishedInstall = join(tempProject('registry-origin'), 'node_modules', 'blendlink')
    mkdirSync(publishedInstall, { recursive: true })
    expect(resolvePreviewStudioBlendlinkDependency(publishedInstall, '0.8.0')).toBe('0.8.0')

    const fileInstallRoot = tempProject('file-install-origin')
    const fileInstall = join(fileInstallRoot, 'node_modules', 'blendlink')
    mkdirSync(fileInstall, { recursive: true })
    writeFileSync(join(fileInstallRoot, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/blendlink': {
          version: '0.8.0',
          resolved: 'file:../blendlink-0.8.0.tgz',
        },
      },
    }))
    expect(resolvePreviewStudioBlendlinkDependency(fileInstall, '0.8.0'))
      .toBe(`file:${resolve(fileInstall).replace(/\\/g, '/')}`)
  })

  it('installs Preview Studio dependencies only when the declared package changed or required runtime packages are absent', () => {
    expect(previewStudioNeedsInstall({
      packageHash: 'current',
      installedPackageHash: 'current',
      requiredPackagesPresent: true,
    })).toBe(false)
    expect(previewStudioNeedsInstall({
      packageHash: 'current',
      installedPackageHash: 'older',
      requiredPackagesPresent: true,
    })).toBe(true)
    expect(previewStudioNeedsInstall({
      packageHash: 'current',
      installedPackageHash: 'current',
      requiredPackagesPresent: false,
    })).toBe(true)
  })

  it('detects the package manager, dev script, and framework URL', () => {
    const root = tempProject('detect')
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { vite: '^7.0.0' },
    }))
    const config = resolveConfig({ scenes: [], website: {} }, root)
    expect(resolveWebsitePreview(config)).toMatchObject({
      root,
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      commandSource: 'package.json',
      urlSource: 'framework',
    })
  })

  it('uses an explicit website adapter for monorepos and custom servers', () => {
    const root = tempProject('explicit')
    mkdirSync(join(root, 'apps', 'site'), { recursive: true })
    const config = resolveConfig({
      scenes: [],
      website: {
        root: 'apps/site',
        devCommand: 'custom-site serve',
        url: 'http://localhost:8088/hero',
      },
    }, root)
    const target = resolveWebsitePreview(config)
    expect(target).toMatchObject({
      root: join(root, 'apps', 'site'),
      command: 'custom-site serve',
      url: 'http://localhost:8088/hero',
      commandSource: 'configured',
      urlSource: 'configured',
    })
    expect(canReuseReachablePreview(target)).toBe(true)
  })

  it('never treats a conventional framework port as proof of project ownership', () => {
    const root = tempProject('no-unsafe-reuse')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      packageManager: 'bun@1.2.0',
      devDependencies: { vite: '^7.0.0' },
    }))
    const target = resolveWebsitePreview(resolveConfig({ scenes: [], website: {} }, root))
    expect(target.command).toBe('bun run dev')
    expect(target.urlSource).toBe('framework')
    expect(canReuseReachablePreview(target)).toBe(false)
  })

  it('announces that a reused explicitly configured server is externally owned', async () => {
    const root = tempProject('external-server')
    const server = createServer((_request, response) => response.end('external preview'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP preview server')
    const url = `http://127.0.0.1:${address.port}/`
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const config = resolveConfig({ scenes: [], website: { url } }, root)
      await expect(runWebsitePreview(config, { openBrowser: false })).resolves.toBe(0)
      const ready = blendlinkEvents(log.mock.calls).find((event) => event.label === 'Preview ready')
      expect(ready).toMatchObject({
        fraction: 1,
        previewUrl: url,
        previewOwned: false,
      })
    } finally {
      log.mockRestore()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('extracts only safe local preview URLs from server output', () => {
    expect(extractLocalPreviewUrl('Local: http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(extractLocalPreviewUrl('ready at http://127.0.0.1:3000/hero')).toBe('http://127.0.0.1:3000/hero')
    expect(extractLocalPreviewUrl(
      '\x1b[32m➜\x1b[39m Local: \x1b[36mhttp://127.0.0.1:\x1b[1m5173\x1b[22m/\x1b[39m',
    )).toBe('http://127.0.0.1:5173/')
    expect(extractLocalPreviewUrl('docs: https://vite.dev/guide')).toBeUndefined()
  })

  it('owns a real local server until it exits and announces its reachable URL', async () => {
    const root = tempProject('server')
    writeFileSync(join(root, 'server.mjs'), `
      import { createServer } from 'node:http'
      const server = createServer((request, response) => response.end('blendlink preview'))
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        console.log('Local: http://127.0.0.1:' + address.port + '/')
        setTimeout(() => server.close(), 1200)
      })
    `)
    const config = resolveConfig({
      scenes: [],
      website: { devCommand: 'node server.mjs' },
    }, root)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(runWebsitePreview(config, {
        openBrowser: false,
        startupTimeoutMs: 5_000,
      })).resolves.toBe(0)
      const ready = blendlinkEvents(log.mock.calls).find((event) => event.label === 'Preview ready')
      expect(ready).toMatchObject({
        fraction: 1,
        previewOwned: true,
      })
      expect(ready?.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    } finally {
      log.mockRestore()
    }
  }, 10_000)
})
