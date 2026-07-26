import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import {
  assertConfigSourceRevisionCurrent,
  loadConfig,
  type ResolvedConfig,
} from './config.js'
import { websitePackageRunner } from './packageRunner.js'
import {
  isBlockingVerifyIssue,
  syncAll,
  verifyAll,
  type SyncOutcome,
  type VerifyIssue,
} from './sync.js'
import {
  publicationRootsForScene,
  withPublicationScopes,
  type PublicationScopesLease,
} from './publicationScopes.js'
import { emitProgress } from './progress.js'

interface WebsitePackage {
  packageManager?: string
  scripts?: Record<string, string>
}

export interface PublishWebsiteOptions {
  root?: string
  scene?: string
  force?: boolean
  allowNewerFile?: boolean
  /** Compile and verify deployable assets without invoking the website's
   * application build. The skipped build is explicit in the result. */
  assetsOnly?: boolean
}

export interface WebsiteBuildResult {
  status: 'passed' | 'skipped'
  root: string
  command?: string
  reason?: string
}

export interface BrowserSmokeResult {
  status: 'passed' | 'skipped'
  root: string
  command?: string
  reason?: string
  port?: number
}

export interface PublishWebsiteResult {
  root: string
  scenes: string[]
  outcomes: SyncOutcome[]
  siteBuild: WebsiteBuildResult
  browserSmoke: BrowserSmokeResult
}

interface PublishWebsiteDependencies {
  loadConfig(root: string): Promise<ResolvedConfig>
  compile(config: ResolvedConfig, options: {
    scene?: string
    quality: 'final'
    force?: boolean
    allowNewerFile?: boolean
  }): Promise<SyncOutcome[]>
  verify(config: ResolvedConfig, options: { only?: string }): Promise<VerifyIssue[]>
  runBuild(command: string, root: string, environment?: Readonly<Record<string, string>>): void
  runBrowserSmoke(command: string, root: string, environment?: Readonly<Record<string, string>>): void
  findAvailablePort(): Promise<number>
}

function readWebsitePackage(root: string): WebsitePackage {
  const path = join(root, 'package.json')
  if (!existsSync(path)) {
    throw new Error(
      `Blendlink cannot build the website because ${path} does not exist. ` +
        'Use --assets-only for a custom/non-Node deployment pipeline.',
    )
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the JSON root is not an object')
    }
    return parsed as WebsitePackage
  } catch (error) {
    throw new Error(
      `Blendlink cannot read the website package at ${path}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

export function websiteBuildCallsPublish(script: string): boolean {
  return /\bblendlink(?:@[^\s]+)?\s+publish\b/i.test(script)
    || /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?blendlink:publish\b/i.test(script)
}

function formatVerificationFailure(issues: VerifyIssue[]): string {
  return 'Blendlink refused to build the website because Final verification failed:\n' +
    issues.map((issue) =>
      `  - ${issue.scene}: ${issue.problem}\n    fix: ${issue.fix}`,
    ).join('\n')
}

function runWebsiteBuild(
  command: string,
  root: string,
  environment: Readonly<Record<string, string>> = {},
): void {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...environment },
  })
  if (result.error) {
    throw new Error(`Website build could not start (${command}): ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`Website build failed with exit code ${result.status ?? 'unknown'}: ${command}`)
  }
}

function runWebsiteBrowserSmoke(
  command: string,
  root: string,
  environment: Readonly<Record<string, string>> = {},
): void {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, BLENDLINK_PUBLISH_BUILD_READY: '1', ...environment },
  })
  if (result.error) {
    throw new Error(`Website browser smoke could not start (${command}): ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `Website browser smoke failed with exit code ${result.status ?? 'unknown'}: ${command}`,
    )
  }
}

/** Ask the OS for a currently unused loopback port. The socket closes before
 * the application-owned smoke process starts, so this avoids fixed-port
 * collisions without claiming an impossible cross-process reservation. */
export async function findAvailableLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve the temporary loopback port.')))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

const defaultDependencies: PublishWebsiteDependencies = {
  loadConfig,
  compile: async (config, options) => syncAll(config, {
    ...(options.scene ? { only: options.scene } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  }),
  verify: verifyAll,
  runBuild: runWebsiteBuild,
  runBrowserSmoke: runWebsiteBrowserSmoke,
  findAvailablePort: findAvailableLoopbackPort,
}

/**
 * Turn a Preview workflow into deployable repository state in one transaction:
 * Final compile, scene-scoped integrity verification, the site's own build,
 * then a second drift check. Remote deployment remains application-owned.
 */
export async function publishWebsiteProject(
  options: PublishWebsiteOptions = {},
): Promise<PublishWebsiteResult> {
  return publishWebsiteProjectWithDependencies(options, defaultDependencies)
}

/** Internal dependency seam used by interface-level tests. Not re-exported by
 * the package root. */
export async function publishWebsiteProjectWithDependencies(
  options: PublishWebsiteOptions,
  dependencies: PublishWebsiteDependencies,
): Promise<PublishWebsiteResult> {
  const root = resolve(options.root ?? process.cwd())
  const config = await dependencies.loadConfig(root)
  assertConfigSourceRevisionCurrent(config.configSource)
  const scenes = options.scene
    ? config.scenes.filter((scene) => scene.name === options.scene)
    : config.scenes
  if (options.scene && scenes.length === 0) {
    throw new Error(`No scene named "${options.scene}" in blendlink.config.`)
  }
  if (scenes.length === 0) {
    throw new Error('Blendlink publish needs at least one configured scene.')
  }
  const publicationRoots = scenes.flatMap((scene) => {
    const sceneRoots = publicationRootsForScene(scene)
    return [sceneRoots.assetRoot, sceneRoots.generatedRoot]
  })
  return withPublicationScopes({
    roots: publicationRoots,
    intent: 'publish',
    label: options.scene
      ? `${options.scene} / Publish Website`
      : `${scenes.length} scenes / Publish Website`,
    onWait(fact) {
      emitProgress(0, fact.message)
    },
  }, (lease) => publishWebsiteProjectWithLease(
    root,
    config,
    options,
    dependencies,
    lease,
  ))
}

async function publishWebsiteProjectWithLease(
  root: string,
  config: ResolvedConfig,
  options: PublishWebsiteOptions,
  dependencies: PublishWebsiteDependencies,
  lease: PublicationScopesLease,
): Promise<PublishWebsiteResult> {
  assertConfigSourceRevisionCurrent(config.configSource)
  const verificationOptions = options.scene ? { only: options.scene } : {}
  const outcomes = await dependencies.compile(config, {
    quality: 'final',
    ...(options.scene ? { scene: options.scene } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  })
  assertConfigSourceRevisionCurrent(config.configSource)

  const beforeBuild = await dependencies.verify(config, verificationOptions)
  const beforeBuildBlocking = beforeBuild.filter(isBlockingVerifyIssue)
  if (beforeBuildBlocking.length > 0) {
    throw new Error(formatVerificationFailure(beforeBuildBlocking))
  }
  for (const notice of beforeBuild.filter((issue) => !isBlockingVerifyIssue(issue))) {
    const outcome = outcomes.find((candidate) => candidate.scene === notice.scene)
    outcome?.warnings.push(
      `accepted material risk: ${notice.problem} Follow-up: ${notice.fix}`,
    )
  }

  let siteBuild: WebsiteBuildResult
  if (options.assetsOnly) {
    siteBuild = {
      status: 'skipped',
      root: config.website.root,
      reason: '--assets-only was requested; the application build remains website-owned',
    }
  } else {
    const pkg = readWebsitePackage(config.website.root)
    const buildScript = pkg.scripts?.build?.trim()
    if (!buildScript) {
      throw new Error(
        `The website at ${config.website.root} has no package.json build script. ` +
          'Add the site build or rerun with --assets-only for a custom deployment pipeline.',
      )
    }
    if (websiteBuildCallsPublish(buildScript)) {
      throw new Error(
        'The website build script calls Blendlink publish and would recurse. Keep `build` ' +
          'application-owned, call `blendlink publish` from a separate script, or use --assets-only.',
      )
    }
    const command = `${websitePackageRunner(config.website.root, pkg)} build`
    dependencies.runBuild(
      command,
      config.website.root,
      lease.delegationEnvironment,
    )
    assertConfigSourceRevisionCurrent(config.configSource)
    siteBuild = { status: 'passed', root: config.website.root, command }
  }

  const afterBuild = await dependencies.verify(config, verificationOptions)
  const afterBuildBlocking = afterBuild.filter(isBlockingVerifyIssue)
  if (afterBuildBlocking.length > 0) {
    throw new Error(
      'The website build changed or removed published scene artifacts.\n' +
        formatVerificationFailure(afterBuildBlocking),
    )
  }

  let browserSmoke: BrowserSmokeResult
  const smokeCommand = config.website.browserSmoke?.command
  if (options.assetsOnly) {
    browserSmoke = {
      status: 'skipped',
      root: config.website.root,
      reason: '--assets-only was requested; no production website build was available to smoke',
    }
  } else if (!smokeCommand) {
    browserSmoke = {
      status: 'skipped',
      root: config.website.root,
      reason: 'website.browserSmoke is not configured; browser verification remains application-owned',
    }
  } else {
    if (websiteBuildCallsPublish(smokeCommand)) {
      throw new Error(
        'The website browser smoke command calls Blendlink publish and would recurse. ' +
          'Point website.browserSmoke.command at the application-owned browser test instead.',
      )
    }
    const portEnv = config.website.browserSmoke?.portEnv
    const port = portEnv ? await dependencies.findAvailablePort() : undefined
    dependencies.runBrowserSmoke(
      smokeCommand,
      config.website.root,
      {
        ...lease.delegationEnvironment,
        ...(portEnv && port ? { [portEnv]: String(port) } : {}),
      },
    )
    assertConfigSourceRevisionCurrent(config.configSource)
    browserSmoke = {
      status: 'passed', root: config.website.root, command: smokeCommand,
      ...(port ? { port } : {}),
    }
  }

  const afterSmoke = await dependencies.verify(config, verificationOptions)
  const afterSmokeBlocking = afterSmoke.filter(isBlockingVerifyIssue)
  if (afterSmokeBlocking.length > 0) {
    throw new Error(
      'Published scene artifacts changed during the browser smoke handoff.\n' +
        formatVerificationFailure(afterSmokeBlocking),
    )
  }
  assertConfigSourceRevisionCurrent(config.configSource)

  return {
    root,
    scenes: outcomes.map((outcome) => outcome.scene),
    outcomes,
    siteBuild,
    browserSmoke,
  }
}
