import { describe, expect, it, vi } from 'vitest'
import {
  publishWebsiteProjectWithDependencies,
  websiteBuildCallsPublish,
} from './publish.js'
import type { ResolvedConfig } from './config.js'
import type { SyncOutcome, VerifyIssue } from './sync.js'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PUBLICATION_SCOPE_DELEGATION_ENV,
  publicationRootsForScene,
  resolvePublicationScopes,
} from './publicationScopes.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'blendlink-publish-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: { build: 'next build' },
  }))
  const config = {
    root,
    website: { root },
    scenes: [
      {
        name: 'hero',
        root,
        blendPath: join(root, 'hero.blend'),
        glbPath: join(root, 'public', 'models', 'hero.glb'),
        url: '/models/hero.glb',
        manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
        modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
        settings: {},
        external: false,
      },
      {
        name: 'legacyGallery',
        root,
        blendPath: join(root, 'gallery.blend'),
        glbPath: join(root, 'public', 'models', 'legacyGallery.glb'),
        url: '/models/legacyGallery.glb',
        manifestPath: join(root, 'src', 'generated', 'legacyGallery.manifest.json'),
        modulePath: join(root, 'src', 'generated', 'legacyGallery.gen.ts'),
        settings: {},
        external: false,
      },
    ],
  } as ResolvedConfig
  const outcome = {
    scene: 'hero', action: 'exported', durationMs: 10, warnings: [],
  } as SyncOutcome
  const compile = vi.fn(async () => [outcome])
  const verify = vi.fn(async () => [] as VerifyIssue[])
  const runBuild = vi.fn()
  const runBrowserSmoke = vi.fn()
  const findAvailablePort = vi.fn(async () => 43127)
  return {
    root,
    config,
    outcome,
    dependencies: {
      loadConfig: vi.fn(async () => config), compile, verify, runBuild, runBrowserSmoke,
      findAvailablePort,
    },
  }
}

describe('Preview to website publish transaction', () => {
  it('compiles the exact loaded config, builds one coherent snapshot, and verifies three times', async () => {
    const value = fixture()
    try {
      const result = await publishWebsiteProjectWithDependencies({
        root: value.root,
        scene: 'hero',
      }, value.dependencies)

      expect(value.dependencies.compile).toHaveBeenCalledWith(value.config, {
        scene: 'hero',
        quality: 'final',
      })
      expect(value.dependencies.verify).toHaveBeenNthCalledWith(1, value.config, { only: 'hero' })
      expect(value.dependencies.runBuild).toHaveBeenCalledWith(
        'npm run build',
        value.root,
        expect.objectContaining({
          [PUBLICATION_SCOPE_DELEGATION_ENV]: expect.any(String),
        }),
      )
      expect(value.dependencies.verify).toHaveBeenNthCalledWith(2, value.config, { only: 'hero' })
      expect(value.dependencies.verify).toHaveBeenNthCalledWith(3, value.config, { only: 'hero' })
      expect(result.siteBuild).toMatchObject({ status: 'passed', command: 'npm run build' })
      expect(result.browserSmoke).toMatchObject({ status: 'skipped' })
    } finally {
      rmSync(value.root, { recursive: true, force: true })
    }
  })

  it('never starts the website build when Final verification fails', async () => {
    const value = fixture()
    value.dependencies.verify.mockResolvedValueOnce([{
      scene: 'hero', problem: 'recipe is stale', fix: 'update it',
    }])

    await expect(publishWebsiteProjectWithDependencies({ root: value.root }, value.dependencies))
      .rejects.toThrow(/Final verification failed.*recipe is stale/s)
    expect(value.dependencies.runBuild).not.toHaveBeenCalled()
    expect(value.dependencies.runBrowserSmoke).not.toHaveBeenCalled()
  })

  it('surfaces an accepted-risk verification warning without blocking the website build', async () => {
    const value = fixture()
    const notice: VerifyIssue = {
      scene: 'hero',
      severity: 'warning',
      problem: 'material collapse accepted by src/materials/hero.ts',
      fix: 'keep the browser gate',
    }
    value.dependencies.verify.mockResolvedValue([notice])

    const result = await publishWebsiteProjectWithDependencies({ root: value.root }, value.dependencies)

    expect(value.dependencies.runBuild).toHaveBeenCalledTimes(1)
    expect(result.outcomes[0]?.warnings).toContain(
      'accepted material risk: material collapse accepted by src/materials/hero.ts ' +
        'Follow-up: keep the browser gate',
    )
  })

  it('reports an explicit asset-only handoff and still verifies after it', async () => {
    const value = fixture()
    const result = await publishWebsiteProjectWithDependencies({
      root: value.root,
      assetsOnly: true,
    }, value.dependencies)

    expect(result.siteBuild).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('--assets-only'),
    })
    expect(value.dependencies.runBuild).not.toHaveBeenCalled()
    expect(value.dependencies.verify).toHaveBeenCalledTimes(3)
    expect(result.browserSmoke).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('--assets-only'),
    })
  })

  it('runs an application-owned browser smoke only after build and post-build verification', async () => {
    const value = fixture()
    value.config.website.browserSmoke = {
      command: 'npx playwright test e2e/blendlink-lab.spec.ts',
    }

    const result = await publishWebsiteProjectWithDependencies({ root: value.root }, value.dependencies)

    expect(value.dependencies.verify).toHaveBeenCalledTimes(3)
    expect(value.dependencies.runBrowserSmoke).toHaveBeenCalledWith(
      'npx playwright test e2e/blendlink-lab.spec.ts',
      value.root,
      expect.objectContaining({
        [PUBLICATION_SCOPE_DELEGATION_ENV]: expect.any(String),
      }),
    )
    expect(value.dependencies.runBrowserSmoke.mock.invocationCallOrder[0])
      .toBeGreaterThan(value.dependencies.verify.mock.invocationCallOrder[1]!)
    expect(result.browserSmoke).toMatchObject({
      status: 'passed', command: 'npx playwright test e2e/blendlink-lab.spec.ts',
    })
  })

  it('gives an opted-in browser smoke a fresh application-named port', async () => {
    const value = fixture()
    value.config.website.browserSmoke = {
      command: 'npx playwright test',
      portEnv: 'PLAYWRIGHT_PORT',
    }

    const result = await publishWebsiteProjectWithDependencies({ root: value.root }, value.dependencies)

    expect(value.dependencies.findAvailablePort).toHaveBeenCalledTimes(1)
    expect(value.dependencies.runBrowserSmoke).toHaveBeenCalledWith(
      'npx playwright test',
      value.root,
      expect.objectContaining({
        [PUBLICATION_SCOPE_DELEGATION_ENV]: expect.any(String),
        PLAYWRIGHT_PORT: '43127',
      }),
    )
    expect(result.browserSmoke).toMatchObject({ status: 'passed', port: 43127 })
  })

  it('recognizes direct and package-script publish recursion', () => {
    expect(websiteBuildCallsPublish('blendlink publish && next build')).toBe(true)
    expect(websiteBuildCallsPublish('npm run blendlink:publish')).toBe(true)
    expect(websiteBuildCallsPublish('next build')).toBe(false)
  })

  it('holds every selected publication scope through build and browser smoke', async () => {
    const value = fixture()
    value.config.website.browserSmoke = { command: 'npx playwright test' }
    const roots = value.config.scenes.flatMap((scene) => {
      const publicationRoots = publicationRootsForScene(scene)
      return [publicationRoots.assetRoot, publicationRoots.generatedRoot]
    })
    const lockPaths = resolvePublicationScopes(roots).map((scope) => scope.lockPath)
    const assertHeld = () => {
      expect(lockPaths.every((path) => existsSync(path))).toBe(true)
    }
    value.dependencies.compile.mockImplementation(async () => {
      assertHeld()
      return [value.outcome]
    })
    value.dependencies.verify.mockImplementation(async () => {
      assertHeld()
      return []
    })
    value.dependencies.runBuild.mockImplementation(assertHeld)
    value.dependencies.runBrowserSmoke.mockImplementation(assertHeld)

    await publishWebsiteProjectWithDependencies({ root: value.root }, value.dependencies)

    expect(lockPaths.every((path) => !existsSync(path))).toBe(true)
  })

  it('rejects a config edit made during the application build', async () => {
    const value = fixture()
    const configPath = join(value.root, 'blendlink.config.mjs')
    writeFileSync(configPath, 'export default { scenes: [] }\n')
    const configSource = {
      path: configPath,
      hash: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    }
    value.config.configSource = configSource
    for (const scene of value.config.scenes) scene.configSource = configSource
    value.dependencies.runBuild.mockImplementation(() => {
      writeFileSync(configPath, 'export default { scenes: [], changed: true }\n')
    })

    await expect(publishWebsiteProjectWithDependencies(
      { root: value.root },
      value.dependencies,
    )).rejects.toThrow(/config.*changed since.*loaded/i)
    expect(value.dependencies.runBrowserSmoke).not.toHaveBeenCalled()
  })
})
