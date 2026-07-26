import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inspectBakedRecipeTemplate, updateBakedRecipeTemplateFile } from './bakedRecipe.js'
import { resolveConfig, sceneIdentifier, type ResolvedConfig } from './config.js'
import { websitePackageRunner } from './packageRunner.js'
import {
  LEGACY_PREVIEW_STUDIO_INDEX_WITH_FAVICON,
  LEGACY_PREVIEW_STUDIO_STYLE,
  PREVIEW_STUDIO_INDEX,
  PREVIEW_STUDIO_INDEX_VERSION_MARKER,
  PREVIEW_STUDIO_HOST_VERSION,
  PREVIEW_STUDIO_MAIN_MARKER,
  PREVIEW_STUDIO_MAIN_VERSION_MARKER,
  PREVIEW_STUDIO_STYLE,
  PREVIEW_STUDIO_STYLE_VERSION_MARKER,
  PREVIEW_STUDIO_VITE_VERSION_MARKER,
  UNVERSIONED_PREVIEW_STUDIO_STYLE,
  PreviewStudioStatusWriter,
  clearPreviewStudioAcknowledgement,
  ensurePreviewStudioControl,
  previewStudioBakedBridgeSource,
  previewStudioMainSource as polishedPreviewStudioMainSource,
  previewStudioViteConfigSource,
  unversionedPreviewStudioViteConfigSource,
  readPreviewStudioGeneration,
  readPreviewStudioStatus,
  watchPreviewStudioAcknowledgements,
  type PreviewStudioClientAck,
  type PreviewStudioStatus,
} from './previewStudioHost.js'
import { syncAll, type SyncOutcome } from './sync.js'
import { watchScenes, type WatchHandle, type WatchOptions } from './watch.js'

export { websitePackageRunner } from './packageRunner.js'

const PREVIEW_STUDIO_MARKER = '.blendlink-preview-studio.json'
const PREVIEW_STUDIO_STATE = '.blendlink-preview-studio-state.json'
const PREVIEW_STUDIO_KIND = 'blendlink-preview-studio'
const LEGACY_PREVIEW_STUDIO_INDEX = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Blendlink Preview</title></head>
<body><canvas id="scene" aria-label="Blendlink web preview"></canvas><script type="module" src="/src/main.ts"></script></body></html>
`

export interface PreviewStudioPlan {
  /** Absolute source .blend path. This is the sole artist-owned input. */
  blendPath: string
  /** User-local, disposable workspace; never adjacent to the .blend. */
  workspace: string
  /** Stable identity derived from the absolute source path. */
  sessionId: string
  /** Safe generated-module binding and asset name. */
  sceneName: string
}

export interface PreviewStudioOptions {
  blendPath: string
  cacheRoot?: string
  openBrowser?: boolean
  force?: boolean
  allowNewerFile?: boolean
  startupTimeoutMs?: number
  signal?: AbortSignal
}

export interface PreviewEndpoint {
  url?: string
  /** Whether the current CLI process owns the website server lifecycle. */
  owned: boolean
  /** Private Studio identity. Connected websites intentionally omit it. */
  sessionId?: string
  blendPath?: string
  /** Compile success is only `loading` until this Studio's browser accepts
   * and renders the generation. */
  browserVerification?: boolean
}

export type PreviewBuildEvent =
  | { type: 'building'; scene: string }
  | { type: 'published'; scene: string; outcome: SyncOutcome }
  | { type: 'failed'; scene: string; error: string }

export type PreviewStudioAckDisposition = 'ready' | 'failed' | 'ignore'

/** One mutable generation gate keeps late saves and multiple open browser
 * tabs from racing the CLI's shared ready/failed status. */
export class PreviewStudioGenerationGate {
  currentGeneration: string | undefined
  private readyGeneration: string | undefined
  private failedGeneration: string | undefined
  private runtimeFailedGeneration: string | undefined

  beginBuild(): void {
    this.currentGeneration = undefined
    this.readyGeneration = undefined
    this.failedGeneration = undefined
    this.runtimeFailedGeneration = undefined
  }

  publish(generation: string): void {
    this.currentGeneration = generation
    this.readyGeneration = undefined
    this.failedGeneration = undefined
    this.runtimeFailedGeneration = undefined
  }

  accept(ack: PreviewStudioClientAck): PreviewStudioAckDisposition {
    if (!this.currentGeneration || ack.generation !== this.currentGeneration) return 'ignore'
    if (ack.phase === 'ready') {
      if (this.readyGeneration === ack.generation || this.runtimeFailedGeneration === ack.generation) {
        return 'ignore'
      }
      this.readyGeneration = ack.generation
      this.failedGeneration = undefined
      return 'ready'
    }
    if (this.failedGeneration === ack.generation) {
      return 'ignore'
    }
    // Validation failures cannot supersede browser-ready evidence for the
    // same bytes. A runtime failure is different: it proves that an already
    // rendered generation later stopped working and must revoke Ready.
    if (this.readyGeneration === ack.generation && ack.failureKind !== 'runtime') return 'ignore'
    this.failedGeneration = ack.generation
    if (ack.failureKind === 'runtime') {
      this.runtimeFailedGeneration = ack.generation
      this.readyGeneration = undefined
    }
    return 'failed'
  }
}

type PreviewStudioCompiledReport = Pick<
  PreviewStudioStatus,
  'generation' | 'warnings' | 'durationMs' | 'stats'
>

/** Keep a no-op integrity check from impersonating a new compile report.
 * The content generation is the join key: evidence is retained only while
 * the browser is still presenting the exact bytes that produced it. */
export class PreviewStudioReportLedger {
  private compiled: PreviewStudioCompiledReport | undefined

  constructor(prior?: PreviewStudioStatus) {
    const generation = prior?.phase === 'ready' || prior?.phase === 'published'
      ? prior.generation
      : undefined
    // Stats are emitted by Blendlink's internal compiler. Warnings are also
    // useful evidence for an older/external report, but a bare duration from
    // the pre-ledger host may itself be the misleading no-op check we are
    // repairing, so it is deliberately not enough to seed the ledger.
    if (generation && (prior?.stats || (prior?.warnings?.length ?? 0) > 0)) {
      this.compiled = {
        generation,
        warnings: [...(prior?.warnings ?? [])],
        ...(prior?.durationMs !== undefined ? { durationMs: prior.durationMs } : {}),
        ...(prior?.stats ? { stats: prior.stats } : {}),
      }
    }
  }

  publish(generation: string, outcome: SyncOutcome): Pick<
    PreviewStudioStatus,
    'warnings' | 'durationMs' | 'checkDurationMs' | 'stats'
  > {
    if (outcome.action !== 'skipped') {
      this.compiled = {
        generation,
        warnings: [...outcome.warnings],
        durationMs: outcome.durationMs,
        ...(outcome.stats ? { stats: outcome.stats } : {}),
      }
      return {
        warnings: [...outcome.warnings],
        durationMs: outcome.durationMs,
        ...(outcome.stats ? { stats: outcome.stats } : {}),
      }
    }

    const compiled = this.compiled?.generation === generation ? this.compiled : undefined
    return {
      warnings: [...new Set([...(compiled?.warnings ?? []), ...outcome.warnings])],
      ...(compiled?.durationMs !== undefined ? { durationMs: compiled.durationMs } : {}),
      ...(compiled?.stats ? { stats: compiled.stats } : {}),
      checkDurationMs: outcome.durationMs,
    }
  }
}

interface PreviewAutoUpdateOptions {
  only?: string
  force?: boolean
  authoringPreview?: boolean
  allowNewerFile?: boolean
  /** Private Studio keeps its diagnostic shell live after an invalid first
   * revision and recovers on the next Blender save. */
  recoverInitialFailure?: boolean
  onBuildEvent?: (event: PreviewBuildEvent) => void
  /** Test seam; production always uses the repository's save watcher. */
  watch?: typeof watchScenes
}

interface PreviewStudioState {
  kind: typeof PREVIEW_STUDIO_KIND
  sessionId: string
  packageHash?: string
  hostVersion?: number
  url?: string
}

interface PreviewStudioPackage {
  blendlinkPreviewStudio?: { kind?: string; sessionId?: string }
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Kept separate from scaffolding so its identity can be unit-tested without
 * Blender, npm, or filesystem writes. */
export function defaultPreviewStudioCacheRoot(
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (process.platform === 'win32' && environment.LOCALAPPDATA) {
    return join(environment.LOCALAPPDATA, 'Blendlink', 'Preview Studio')
  }
  if (environment.XDG_CACHE_HOME) return join(environment.XDG_CACHE_HOME, 'blendlink', 'preview-studio')
  return join(home || tmpdir(), '.cache', 'blendlink', 'preview-studio')
}

/** The plan is deliberately path-only: one saved .blend always maps to one
 * cache session, without leaking a project/config folder into artist work. */
export function planPreviewStudio(
  blendPath: string,
  options: { cacheRoot?: string } = {},
): PreviewStudioPlan {
  const absoluteBlendPath = resolve(blendPath)
  const sessionId = shortHash(process.platform === 'win32'
    ? absoluteBlendPath.toLowerCase()
    : absoluteBlendPath)
  const sceneName = sceneIdentifier(basename(absoluteBlendPath).replace(/\.blend$/i, ''))
  const cacheRoot = resolve(options.cacheRoot ?? defaultPreviewStudioCacheRoot())
  return {
    blendPath: absoluteBlendPath,
    workspace: join(cacheRoot, `${sceneName.toLowerCase()}-${sessionId}`),
    sessionId,
    sceneName,
  }
}

interface PreviewStudioPackageIdentity {
  root: string
  version: string
}

function previewStudioPackageIdentity(): PreviewStudioPackageIdentity {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string; version?: string }
    if (pkg.name === 'blendlink' && pkg.version) {
      return { root: dirname(packagePath), version: pkg.version }
    }
  } catch {
    // The later dependency-install stage explains a broken package install.
  }
  throw new Error('Blendlink cannot read its own package identity. Reinstall Blendlink, then preview again.')
}

function packageFileSpec(packageRoot: string): string {
  return `file:${resolve(packageRoot).replace(/\\/g, '/')}`
}

function packageRootOutsideNodeModules(packageRoot: string): boolean {
  let cursor = resolve(packageRoot)
  while (true) {
    if (basename(cursor).toLowerCase() === 'node_modules') return false
    const parent = dirname(cursor)
    if (parent === cursor) return true
    cursor = parent
  }
}

function localInstallRecorded(packageRoot: string): boolean {
  let cursor = resolve(packageRoot)
  while (true) {
    const parent = dirname(cursor)
    if (basename(parent).toLowerCase() === 'node_modules') {
      const installRoot = dirname(parent)
      const packageKey = relative(installRoot, packageRoot).replace(/\\/g, '/')
      for (const lockPath of [
        join(installRoot, 'package-lock.json'),
        join(installRoot, 'node_modules', '.package-lock.json'),
      ]) {
        if (!existsSync(lockPath)) continue
        try {
          const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
            packages?: Record<string, { link?: boolean; resolved?: string }>
          }
          const entry = lock.packages?.[packageKey]
          if (entry?.link === true || /^(?:file|link|workspace):/i.test(entry?.resolved ?? '')) {
            return true
          }
        } catch {
          // A package-manager lock that is unreadable or uses another schema
          // is not evidence that this is a local install. Prefer the exact
          // released version in that ambiguous case.
        }
      }
    }
    if (parent === cursor) return false
    cursor = parent
  }
}

/** Choose the runtime package used inside a disposable Preview Studio.
 *
 * A checkout, workspace, npm link, or file/tarball install must remain usable
 * before the release exists in the registry, so it points at the package that
 * is currently executing. A normal registry installation retains an exact
 * version pin so the generated bindings and runtime cannot drift.
 */
export function resolvePreviewStudioBlendlinkDependency(
  packageRoot: string,
  version: string,
): string {
  let realPackageRoot = resolve(packageRoot)
  try {
    realPackageRoot = realpathSync(realPackageRoot)
  } catch {
    // The identity reader gives a clear error for a broken real invocation;
    // keeping this resolver pure enough for path-only tests is useful.
  }
  if (packageRootOutsideNodeModules(realPackageRoot) || localInstallRecorded(realPackageRoot)) {
    return packageFileSpec(realPackageRoot)
  }
  return version
}

function previewStudioPackageDependency(): string {
  const identity = previewStudioPackageIdentity()
  return resolvePreviewStudioBlendlinkDependency(identity.root, identity.version)
}

function previewStudioLiveMainSource(
  plan: PreviewStudioPlan,
  useAuthoringPreview: boolean,
): string {
  const generated = `./generated/${plan.sceneName}`
  const authoringPreviewOption = useAuthoringPreview ? '  useAuthoringPreview: true,\n' : ''
  return `// Blendlink Preview Studio owns this disposable entry point.
import * as THREE from 'three'
import { installThreeCompiledScene } from 'blendlink/three'
import { ${plan.sceneName} as compiledScene } from '${generated}.gen'
import { createBakedScene } from '${generated}.baked'
import './style.css'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvas) throw new Error('Blendlink Preview Studio: #scene canvas is missing')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const world = new THREE.Scene()
const installed = await installThreeCompiledScene({
  renderer,
  scene: world,
  descriptor: compiledScene,
  createBakedScene,
${authoringPreviewOption}})
let lastWidth = 0
let lastHeight = 0
let previousTime = performance.now()
let animationFrame = 0
let disposed = false
function frame(now: number) {
  if (disposed) return
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
    installed.resize(width, height)
    lastWidth = width
    lastHeight = height
  }
  const deltaSeconds = Math.max(0, (now - previousTime) / 1000)
  previousTime = now
  installed.update(deltaSeconds)
  installed.render(deltaSeconds)
  animationFrame = requestAnimationFrame(frame)
}
animationFrame = requestAnimationFrame(frame)
function dispose() {
  if (disposed) return
  disposed = true
  cancelAnimationFrame(animationFrame)
  installed.dispose()
}
window.addEventListener('beforeunload', dispose, { once: true })
if (import.meta.hot) import.meta.hot.dispose(dispose)
`
}

/** Exact browser entry shipped immediately before browser-verified,
 * generation-swapped Preview Studio. Retained only for cache migration. */
export function legacyAuthoringPreviewStudioMainSource(plan: PreviewStudioPlan): string {
  return previewStudioLiveMainSource(plan, true)
}

function previewStudioMainSource(plan: PreviewStudioPlan): string {
  return polishedPreviewStudioMainSource(plan)
}

/** Exact managed live-preview template shipped before Blender authoring look
 * and shadow fallbacks. Retained only for conservative cache migration. */
export function legacyLivePreviewStudioMainSource(plan: PreviewStudioPlan): string {
  return previewStudioLiveMainSource(plan, false)
}

/** Exact template shipped before live Preview began reloading on every save.
 * It is retained only so managed disposable sessions can migrate without
 * overwriting an artist-edited entry point. */
export function legacyPreviewStudioMainSource(plan: PreviewStudioPlan): string {
  const generated = `./generated/${plan.sceneName}`
  return `// Blendlink Preview Studio owns this disposable entry point.
import * as THREE from 'three'
import { installThreeCompiledScene } from 'blendlink/three'
import { ${plan.sceneName} as compiledScene } from '${generated}.gen'
import { createBakedScene } from '${generated}.baked'
import './style.css'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvas) throw new Error('Blendlink Preview Studio: #scene canvas is missing')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const world = new THREE.Scene()
const installed = await installThreeCompiledScene({
  renderer,
  scene: world,
  descriptor: compiledScene,
  createBakedScene,
})
let lastWidth = 0
let lastHeight = 0
let previousTime = performance.now()
function frame(now: number) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
    installed.resize(width, height)
    lastWidth = width
    lastHeight = height
  }
  const deltaSeconds = Math.max(0, (now - previousTime) / 1000)
  previousTime = now
  installed.update(deltaSeconds)
  installed.render(deltaSeconds)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.addEventListener('beforeunload', () => installed.dispose(), { once: true })
`
}

function previewStudioFiles(
  plan: PreviewStudioPlan,
  blendlinkDependency: string,
): Record<string, string> {
  return {
    'blendlink.config.mjs': `// Blendlink Preview Studio owns this disposable config.\nexport default {\n  outDir: 'public/models',\n  genDir: 'src/generated',\n  urlPrefix: '/models',\n  scenes: [{ file: ${JSON.stringify(plan.blendPath.replace(/\\/g, '/'))}, name: ${JSON.stringify(plan.sceneName)} }],\n}\n`,
    'package.json': JSON.stringify({
      name: `blendlink-preview-${plan.sessionId}`,
      private: true,
      version: '0.0.0',
      type: 'module',
      blendlinkPreviewStudio: { kind: PREVIEW_STUDIO_KIND, sessionId: plan.sessionId },
      scripts: { 'preview:dev': 'vite --host 127.0.0.1 --port 0' },
      dependencies: {
        // The generated bindings and runtime share a schema contract. Keep
        // them on the exact CLI release, or on the executing package while a
        // local checkout/install is being tested before publication.
        blendlink: blendlinkDependency,
        three: '0.184.0',
      },
      devDependencies: { vite: '^7.0.0' },
    }, null, 2) + '\n',
    'index.html': PREVIEW_STUDIO_INDEX,
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        noEmit: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], skipLibCheck: true,
      },
      include: ['src'],
    }, null, 2) + '\n',
    'vite.config.mjs': previewStudioViteConfigSource(),
    [join('src', 'main.ts')]: previewStudioMainSource(plan),
    [join('src', 'previewBaked.ts')]: previewStudioBakedBridgeSource(plan),
    [join('src', 'style.css')]: PREVIEW_STUDIO_STYLE,
    [join('public', PREVIEW_STUDIO_MARKER)]: JSON.stringify({
      kind: PREVIEW_STUDIO_KIND,
      sessionId: plan.sessionId,
    }) + '\n',
  }
}

function readStudioState(path: string): PreviewStudioState | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PreviewStudioState>
    return value.kind === PREVIEW_STUDIO_KIND && typeof value.sessionId === 'string'
      ? value as PreviewStudioState
      : undefined
  } catch {
    return undefined
  }
}

function assertPreviewStudioOwnership(plan: PreviewStudioPlan): void {
  const markerPath = join(plan.workspace, PREVIEW_STUDIO_MARKER)
  const marker = readStudioState(markerPath)
  if (marker) {
    if (marker.sessionId !== plan.sessionId) {
      throw new Error(`Preview Studio workspace identity mismatch at ${plan.workspace}; Blendlink will not overwrite it.`)
    }
    return
  }
  if (existsSync(plan.workspace) && readdirSync(plan.workspace).length > 0) {
    throw new Error(
      `Preview Studio will not use an existing unknown workspace at ${plan.workspace}. ` +
      'Move it aside or choose a different local cache directory.',
    )
  }
  mkdirSync(plan.workspace, { recursive: true })
  writeFileSync(markerPath, JSON.stringify({
    kind: PREVIEW_STUDIO_KIND,
    sessionId: plan.sessionId,
  }, null, 2) + '\n')
}

function writeMissingPreviewStudioFiles(
  plan: PreviewStudioPlan,
  blendlinkDependency: string,
): string[] {
  const created: string[] = []
  for (const [relativePath, content] of Object.entries(previewStudioFiles(plan, blendlinkDependency))) {
    const path = join(plan.workspace, relativePath)
    // A disposable session is Blendlink-owned, but we still never replace a
    // file once present: a partial/manual edit must remain visible and safe.
    if (existsSync(path)) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    created.push(relativePath.replace(/\\/g, '/'))
  }
  return created
}

function migrateManagedPreviewStudioEntry(plan: PreviewStudioPlan): boolean {
  const path = join(plan.workspace, 'src', 'main.ts')
  if (!existsSync(path)) return false
  const current = readFileSync(path, 'utf8')
  const legacyExact = current === legacyPreviewStudioMainSource(plan)
    || current === legacyLivePreviewStudioMainSource(plan)
    || current === legacyAuthoringPreviewStudioMainSource(plan)
  const managedVersionLine = current.split(/\r?\n/)
    .find((line) => line.startsWith(PREVIEW_STUDIO_MAIN_VERSION_MARKER))
  const managedVersion = current.startsWith(PREVIEW_STUDIO_MAIN_MARKER)
    ? Number(managedVersionLine?.slice(PREVIEW_STUDIO_MAIN_VERSION_MARKER.length).trim() || 1)
    : undefined
  if (!legacyExact && (managedVersion === undefined
      || managedVersion >= PREVIEW_STUDIO_HOST_VERSION)) return false
  const next = previewStudioMainSource(plan)
  if (current === next) return false
  writeFileSync(path, next)
  return true
}

function migrateManagedPreviewStudioIndex(plan: PreviewStudioPlan): boolean {
  const path = join(plan.workspace, 'index.html')
  if (!existsSync(path)) return false
  const current = readFileSync(path, 'utf8')
  const legacyExact = current === LEGACY_PREVIEW_STUDIO_INDEX
    || current === LEGACY_PREVIEW_STUDIO_INDEX_WITH_FAVICON
  const versionLine = current.split(/\r?\n/)
    .find((line) => line.startsWith(PREVIEW_STUDIO_INDEX_VERSION_MARKER))
  const managedVersion = versionLine
    ? Number(versionLine.slice(PREVIEW_STUDIO_INDEX_VERSION_MARKER.length)
        .replace('-->', '').trim())
    : current.includes('<main id="studio" data-background="dark" data-viewport="fill">')
      && current.includes('<title>Blendlink Preview Studio</title>')
      ? 1
      : undefined
  if (!legacyExact && (managedVersion === undefined
      || managedVersion >= PREVIEW_STUDIO_HOST_VERSION)) return false
  if (current === PREVIEW_STUDIO_INDEX) return false
  writeFileSync(path, PREVIEW_STUDIO_INDEX)
  return true
}

function legacyPreviewStudioViteConfigSource(): string {
  return `// Blendlink Preview Studio owns this disposable config.
// A file-linked Blendlink checkout can otherwise give Vite one Three instance
// for the app and another for GLTFLoader. Three objects intentionally expose
// stable is* flags, but renderer/loaders/materials must still share one module.
export default {
  resolve: { dedupe: ['three'] },
}
`
}

const KNOWN_UNVERSIONED_PREVIEW_HOST_HASHES = {
  style: new Set([
    // Polished host shipped before CSS gained its own version marker.
    'B35000B22F9D32068F6CA69D2DF131E81B8985DC543555700918343DC47EBC7D',
    // Host v5, immediately before the mobile toolbar remained fully visible.
    '3E958679B9712F260DACA5D05E0D7B3DB9AF0AADD0856DE6E6C3552EDCFCF1AA',
  ]),
  vite: new Set([
    // Browser-verification adapter shipped before Vite config versioning.
    '0EC89CCD0806FDD4DFFA083374A8C88C895369BFE7E768FA94DAAE86AA741D',
    'DE147303AE93DD86F6B5FC054E7952E2BBDB33D171FBBCFD2AFEE8C48422E430',
  ]),
}

function managedHostVersion(source: string, marker: string): number | undefined {
  const line = source.split(/\r?\n/, 1)[0]
  if (!line.startsWith(marker)) return undefined
  const version = Number(line.slice(marker.length).replace('*/', '').trim())
  return Number.isInteger(version) && version > 0 ? version : undefined
}

function migrateManagedPreviewStudioHostFile(options: {
  path: string
  label: 'style' | 'vite'
  marker: string
  next: string
  recognizedUnversioned: readonly string[]
}): void {
  if (!existsSync(options.path)) return
  const current = readFileSync(options.path, 'utf8')
  if (current === options.next) return
  const version = managedHostVersion(current, options.marker)
  if (version !== undefined) {
    // Current/future marked files may contain local diagnostics. They remain
    // visible; only an older, identity-proven generated template is replaced.
    if (version >= PREVIEW_STUDIO_HOST_VERSION) return
    writeFileSync(options.path, options.next)
    return
  }
  const hash = createHash('sha256').update(current).digest('hex').toUpperCase()
  const recognized = options.recognizedUnversioned.includes(current)
    || KNOWN_UNVERSIONED_PREVIEW_HOST_HASHES[options.label].has(hash)
  if (!recognized) {
    throw new Error(
      `Preview Studio ${options.label} host at ${options.path} is unversioned and does not match ` +
      'a known Blendlink template; Blendlink will not mix host generations or overwrite it. ' +
      'Remove this disposable cache session and preview again.',
    )
  }
  writeFileSync(options.path, options.next)
}

function migrateManagedPreviewStudioHostFiles(plan: PreviewStudioPlan): void {
  migrateManagedPreviewStudioHostFile({
    path: join(plan.workspace, 'src', 'style.css'),
    label: 'style',
    marker: PREVIEW_STUDIO_STYLE_VERSION_MARKER,
    next: PREVIEW_STUDIO_STYLE,
    recognizedUnversioned: [LEGACY_PREVIEW_STUDIO_STYLE, UNVERSIONED_PREVIEW_STUDIO_STYLE],
  })
  migrateManagedPreviewStudioHostFile({
    path: join(plan.workspace, 'vite.config.mjs'),
    label: 'vite',
    marker: PREVIEW_STUDIO_VITE_VERSION_MARKER,
    next: previewStudioViteConfigSource(),
    recognizedUnversioned: [
      legacyPreviewStudioViteConfigSource(),
      unversionedPreviewStudioViteConfigSource(),
    ],
  })
}

function migrateManagedPreviewStudioBakedRecipe(plan: PreviewStudioPlan): boolean {
  const path = join(plan.workspace, 'src', 'generated', `${plan.sceneName}.baked.ts`)
  if (!existsSync(path)) return false
  const status = inspectBakedRecipeTemplate(readFileSync(path, 'utf8'))
  // A marked older template inside the identity-proven disposable cache is an
  // implementation artifact, not the editable recipe owned by a connected
  // website. Legacy/unmarked and future files retain the normal loud gate.
  if (status.kind !== 'outdated') return false
  const migration = updateBakedRecipeTemplateFile(path, plan.sceneName)
  console.log(
    `Preview Studio: refreshed owned baked recipe ${plan.sceneName} ` +
    `(template v${status.version} -> current; previous bytes kept at ${migration.backupPath}).`,
  )
  return true
}

function migrateManagedPreviewStudioBakedBridge(plan: PreviewStudioPlan): boolean {
  const path = join(plan.workspace, 'src', 'previewBaked.ts')
  if (!existsSync(path)) return false
  const status = inspectBakedRecipeTemplate(readFileSync(path, 'utf8'))
  if (status.kind !== 'outdated') return false
  writeFileSync(path, previewStudioBakedBridgeSource(plan))
  console.log(
    `Preview Studio: refreshed owned baked runtime bridge ` +
    `(template v${status.version} -> current).`,
  )
  return true
}

export interface PreviewStudioScaffoldResult {
  workspace: string
  packageHash: string
  created: string[]
}

const MANAGED_BLENDLINK_DEPENDENCY = /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|file:.+)$/

function migrateManagedPreviewStudioDependency(
  packagePath: string,
  packageJson: PreviewStudioPackage,
  desiredDependency: string,
): void {
  const currentDependency = packageJson.dependencies?.blendlink
  if (currentDependency === desiredDependency) return
  if (!currentDependency || !MANAGED_BLENDLINK_DEPENDENCY.test(currentDependency)) {
    throw new Error(
      `Preview Studio package at ${packagePath} declares an unrecognized Blendlink dependency ` +
      `${JSON.stringify(currentDependency)}; Blendlink will not overwrite it. ` +
      'Remove this disposable cache session and preview again.',
    )
  }
  packageJson.dependencies = { ...packageJson.dependencies, blendlink: desiredDependency }
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n')
}

/** Filesystem-only companion to planPreviewStudio. It is intentionally
 * non-destructive: unknown sessions fail and authored files are never
 * replaced. Managed cache artifacts migrate when the invoking package changes
 * so an earlier Preview Studio session can self-heal. */
export function scaffoldPreviewStudio(plan: PreviewStudioPlan): PreviewStudioScaffoldResult {
  assertPreviewStudioOwnership(plan)
  const blendlinkDependency = previewStudioPackageDependency()
  migrateManagedPreviewStudioEntry(plan)
  const created = writeMissingPreviewStudioFiles(plan, blendlinkDependency)
  const packagePath = join(plan.workspace, 'package.json')
  if (!existsSync(packagePath)) {
    throw new Error(`Preview Studio setup did not create ${packagePath}.`)
  }
  let packageJson: PreviewStudioPackage
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as PreviewStudioPackage
  } catch (error) {
    throw new Error(`Preview Studio package is invalid at ${packagePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (packageJson.blendlinkPreviewStudio?.kind !== PREVIEW_STUDIO_KIND
      || packageJson.blendlinkPreviewStudio.sessionId !== plan.sessionId
      || packageJson.scripts?.['preview:dev'] !== 'vite --host 127.0.0.1 --port 0') {
    throw new Error(
      `Preview Studio package at ${packagePath} is no longer Blendlink-managed; ` +
      'Blendlink will not run or overwrite it. Remove this disposable cache session and preview again.',
    )
  }
  migrateManagedPreviewStudioIndex(plan)
  migrateManagedPreviewStudioHostFiles(plan)
  migrateManagedPreviewStudioBakedRecipe(plan)
  migrateManagedPreviewStudioBakedBridge(plan)
  migrateManagedPreviewStudioDependency(packagePath, packageJson, blendlinkDependency)
  ensurePreviewStudioControl(plan)
  return {
    workspace: plan.workspace,
    packageHash: shortHash(readFileSync(packagePath, 'utf8')),
    created,
  }
}

export function previewStudioNeedsInstall(snapshot: {
  packageHash: string
  installedPackageHash?: string
  requiredPackagesPresent: boolean
}): boolean {
  return snapshot.packageHash !== snapshot.installedPackageHash || !snapshot.requiredPackagesPresent
}

function previewStudioPackagesPresent(workspace: string): boolean {
  return ['blendlink', 'three', 'vite'].every((name) =>
    existsSync(join(workspace, 'node_modules', name, 'package.json')))
}

export function previewStudioStageError(stage: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  const wrapped = new Error(`[Preview Studio: ${stage}] ${detail}`, { cause: error })
  const processDetail = (error as {
    detail?: { exitCode?: number | null; stderrTail?: string }
  } | null | undefined)?.detail
  if (processDetail && typeof processDetail === 'object') {
    Object.assign(wrapped, { detail: processDetail })
  }
  return wrapped
}

async function runPreviewStudioCommand(command: string, cwd: string, stage: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', (error) => reject(previewStudioStageError(stage, error)))
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(
        `[Preview Studio: ${stage}] ${command} ${signal ? `stopped (${signal})` : `exited with code ${code ?? 'unknown'}`}. ` +
        'Fix the reported command error, then click Preview Website again.',
      ))
    })
  })
}

async function installPreviewStudioDependencies(plan: PreviewStudioPlan, packageHash: string): Promise<void> {
  const state = readStudioState(join(plan.workspace, PREVIEW_STUDIO_STATE))
  if (!previewStudioNeedsInstall({
    packageHash,
    installedPackageHash: state?.packageHash,
    requiredPackagesPresent: previewStudioPackagesPresent(plan.workspace),
  })) return
  console.log(`Preview Studio: installing declared dependencies in ${plan.workspace}`)
  await runPreviewStudioCommand('npm install --no-audit --no-fund', plan.workspace, 'install')
  writeFileSync(join(plan.workspace, PREVIEW_STUDIO_STATE), JSON.stringify({
    kind: PREVIEW_STUDIO_KIND,
    sessionId: plan.sessionId,
    packageHash,
    // A dependency change invalidates the already-running Vite process even
    // when its old URL still answers. It must not be reused with new bindings.
    ...(state?.packageHash === packageHash && state.url ? { url: state.url } : {}),
    ...(state?.packageHash === packageHash && state.hostVersion
      ? { hostVersion: state.hostVersion }
      : {}),
  }, null, 2) + '\n')
}

export async function compilePreviewStudio(
  plan: PreviewStudioPlan,
  options: Pick<PreviewStudioOptions, 'force' | 'allowNewerFile'> = {},
): Promise<SyncOutcome[]> {
  try {
    const config = previewStudioConfig(plan)
    return await syncAll(config, {
      draft: true,
      authoringPreview: true,
      ...(options.force ? { force: true } : {}),
      ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
    })
  } catch (error) {
    throw previewStudioStageError('compile', error)
  }
}

function previewStudioConfig(plan: PreviewStudioPlan): ResolvedConfig {
  return resolveConfig({
    outDir: 'public/models',
    genDir: 'src/generated',
    urlPrefix: '/models',
    scenes: [{ file: plan.blendPath, name: plan.sceneName }],
  }, plan.workspace)
}

type PreviewWatchOutcome = SyncOutcome | { scene: string; error: string }

function previewEndpointPayload(endpoint: PreviewEndpoint): Record<string, unknown> {
  return {
    ...(endpoint.url ? { previewUrl: endpoint.url, previewOwned: endpoint.owned } : {}),
    ...(endpoint.sessionId ? { schemaVersion: 1, sessionId: endpoint.sessionId } : {}),
    ...(endpoint.blendPath ? { blendPath: endpoint.blendPath } : {}),
  }
}

function announcePreviewUpdate(
  endpoint: PreviewEndpoint,
  update: 'building' | 'loading' | 'ready' | 'failed',
  extra: Record<string, unknown> = {},
): void {
  const label = {
    building: 'Saved changes detected - compiling Preview quality',
    loading: 'Scene compiled - validating it in the browser',
    ready: endpoint.url
      ? 'Preview updated — watching saves'
      : 'Preview scene compiled — starting website',
    failed: endpoint.url
      ? 'Preview update failed — last good preview kept'
      : 'Preview scene could not be compiled',
  }[update]
  console.log(`##blendlink ${JSON.stringify({
    fraction: update === 'building' ? 0.05 : update === 'loading' ? 0.9 : 1,
    label,
    previewWatching: true,
    previewUpdate: update,
    ...previewEndpointPayload(endpoint),
    ...extra,
  })}`)
}

function reportPreviewOutcome(
  endpoint: PreviewEndpoint,
  outcome: PreviewWatchOutcome,
  onBuildEvent?: (event: PreviewBuildEvent) => void,
): void {
  if ('error' in outcome) {
    console.error(`\u2717 ${outcome.scene}: ${outcome.error}`)
    onBuildEvent?.({ type: 'failed', scene: outcome.scene, error: outcome.error })
    announcePreviewUpdate(endpoint, 'failed', { error: outcome.error })
    return
  }
  const stats = outcome.stats
    ? ` — ${(outcome.stats.bytes / 1024).toFixed(0)}kB, ${outcome.stats.triangles} tris`
    : ''
  const verb = { exported: 'synced', built: 'built', skipped: 'in sync' }[outcome.action]
  console.log(
    `✓ ${verb} ${outcome.scene}` +
      `${outcome.action === 'skipped' ? '' : ` in ${(outcome.durationMs / 1000).toFixed(1)}s`}${stats}`,
  )
  if (outcome.vocabulary) console.log(`  ◦ ${outcome.vocabulary}`)
  for (const warning of outcome.warnings) console.warn(`  ! ${warning}`)
  onBuildEvent?.({ type: 'published', scene: outcome.scene, outcome })
  announcePreviewUpdate(endpoint, endpoint.browserVerification ? 'loading' : 'ready')
}

/** Build once through the same subscribed single-flight path used for every
 * later save. The mutable endpoint is filled after the website is reachable,
 * so subsequent outcomes can preserve and refresh the exact browser URL. */
export async function startPreviewAutoUpdate(
  config: ResolvedConfig,
  endpoint: PreviewEndpoint,
  options: PreviewAutoUpdateOptions = {},
): Promise<WatchHandle> {
  const watch = options.watch ?? watchScenes
  const watchOptions: WatchOptions = {
    draft: true,
    ...(options.authoringPreview ? { authoringPreview: true } : {}),
    initialBuild: options.force ? 'force' : 'if-needed',
    ...(options.recoverInitialFailure ? { initialBuildFailure: 'report' as const } : {}),
    onStart: (scene) => {
      options.onBuildEvent?.({ type: 'building', scene })
      announcePreviewUpdate(endpoint, 'building')
    },
    ...(options.only ? { only: options.only } : {}),
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  }
  return await watch(
    config,
    (outcome) => reportPreviewOutcome(endpoint, outcome, options.onBuildEvent),
    watchOptions,
  )
}

export interface WebsitePreviewTarget {
  root: string
  command?: string
  url?: string
  commandSource: 'configured' | 'package.json' | 'none'
  urlSource: 'configured' | 'framework' | 'server-output' | 'none'
}

interface PackageJson {
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackage(root: string): PackageJson | undefined {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  } catch (error) {
    throw new Error(
      `Website preview found ${path}, but it is not valid JSON: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

function frameworkUrl(packageJson: PackageJson | undefined): string | undefined {
  const packages = { ...packageJson?.dependencies, ...packageJson?.devDependencies }
  if ('vite' in packages) return 'http://localhost:5173'
  if ('next' in packages) return 'http://localhost:3000'
  if ('astro' in packages) return 'http://localhost:4321'
  if ('@remix-run/dev' in packages) return 'http://localhost:3000'
  return undefined
}

/** Resolve the website seam once. Blender and the CLI consume this small
 * target instead of learning framework/package-manager conventions. */
export function resolveWebsitePreview(config: ResolvedConfig): WebsitePreviewTarget {
  const packageJson = readPackage(config.website.root)
  let command = config.website.devCommand
  let commandSource: WebsitePreviewTarget['commandSource'] = command ? 'configured' : 'none'
  if (!command && packageJson?.scripts) {
    const script = packageJson.scripts.dev ? 'dev' : packageJson.scripts.start ? 'start' : undefined
    if (script) {
      command = `${websitePackageRunner(config.website.root, packageJson)} ${script}`
      commandSource = 'package.json'
    }
  }
  const url = config.website.url ?? frameworkUrl(packageJson)
  return {
    root: config.website.root,
    ...(command ? { command } : {}),
    ...(url ? { url } : {}),
    commandSource,
    urlSource: config.website.url ? 'configured' : url ? 'framework' : 'none',
  }
}

/** Dev-server logs contain dependency/docs URLs too. Only accept loopback
 * addresses so the browser never opens an arbitrary line from npm output. */
export function extractLocalPreviewUrl(line: string): string | undefined {
  // Vite applies bold/color escapes inside the URL itself (including around
  // the port), so matching the raw line truncates it to http://127.0.0.1.
  const plain = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
  const match = plain.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i)
  return match?.[0].replace(/[),.;]+$/, '')
}

export async function isPreviewReachable(url: string, timeoutMs = 900): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
    return response.status < 500
  } catch {
    return false
  }
}

export function openExternalUrl(url: string): void {
  const command = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]] as const
    : process.platform === 'darwin'
      ? ['open', [url]] as const
      : ['xdg-open', [url]] as const
  const opener = spawn(command[0], command[1], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  opener.unref()
}

function announceReady(url: string, previewOwned: boolean, watching = false): void {
  console.log(`##blendlink ${JSON.stringify({
    fraction: 1,
    label: watching ? 'Preview ready — updates when you save' : 'Preview ready',
    previewUrl: url,
    previewOwned,
    ...(watching ? { previewWatching: true, previewUpdate: 'ready' } : {}),
  })}`)
  console.log(`✓ website preview: ${url}`)
}

async function waitForReachableUrl(
  child: ChildProcess,
  candidates: Set<string>,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const url of candidates) {
      if (await isPreviewReachable(url)) return url
    }
    if (child.exitCode !== null) {
      throw new Error(
        `Website preview command exited with code ${child.exitCode} before a local URL became ready.`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const checked = candidates.size > 0 ? [...candidates].join(', ') : 'no loopback URL was printed'
  throw new Error(
    `Website preview did not become reachable within ${(timeoutMs / 1000).toFixed(0)}s (${checked}). ` +
      'Set website.url in blendlink.config.mjs if the server uses a custom hostname.',
  )
}

function stopOwnedProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

export interface RunWebsitePreviewOptions {
  openBrowser?: boolean
  startupTimeoutMs?: number
  autoUpdate?: boolean
  only?: string
  force?: boolean
  allowNewerFile?: boolean
  signal?: AbortSignal
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) return await new Promise<void>(() => {})
  if (signal.aborted) return
  await new Promise<void>((resolveAbort) => {
    signal.addEventListener('abort', () => resolveAbort(), { once: true })
  })
}

/** A conventional framework port is not proof that the process serving it
 * belongs to this project. Reuse is safe only when the project explicitly
 * declared the URL; inferred servers must identify their actual URL in their
 * own startup output (including automatic port fallback). */
export function canReuseReachablePreview(target: WebsitePreviewTarget): boolean {
  return target.urlSource === 'configured'
}

/** Compile callers may invoke this after publishing. It reuses an already
 * reachable website, otherwise owns the dev-server process until canceled. */
export async function runWebsitePreview(
  config: ResolvedConfig,
  options: RunWebsitePreviewOptions = {},
): Promise<number> {
  const target = resolveWebsitePreview(config)
  const endpoint: PreviewEndpoint = { owned: false }
  const live = options.autoUpdate
    ? await startPreviewAutoUpdate(config, endpoint, {
        ...(options.only ? { only: options.only } : {}),
        ...(options.force ? { force: true } : {}),
        ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
      })
    : undefined
  if (target.url && canReuseReachablePreview(target) && await isPreviewReachable(target.url)) {
    endpoint.url = target.url
    endpoint.owned = false
    announceReady(target.url, false, Boolean(live))
    if (options.openBrowser !== false) openExternalUrl(target.url)
    if (live) {
      try {
        await waitForAbort(options.signal)
      } finally {
        await live.close()
      }
    }
    return 0
  }
  if (!target.command) {
    if (live) await live.close()
    throw new Error(
      `Blendlink could not find a website dev server in ${target.root}. ` +
        'Add a package.json dev/start script, or set website: { root, devCommand, url } ' +
        'in blendlink.config.mjs.',
    )
  }

  console.log(`starting website preview in ${target.root}`)
  console.log(`  $ ${target.command}`)
  const child = spawn(target.command, {
    cwd: target.root,
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const candidates = new Set<string>()
  if (target.url && target.urlSource === 'configured') candidates.add(target.url)
  const forward = (stream: NodeJS.ReadableStream, writer: (line: string) => void) => {
    const lines = createInterface({ input: stream })
    lines.on('line', (line) => {
      writer(line)
      const discovered = extractLocalPreviewUrl(line)
      if (discovered) candidates.add(discovered)
    })
  }
  if (child.stdout) forward(child.stdout, console.log)
  if (child.stderr) forward(child.stderr, console.error)

  try {
    const url = await waitForReachableUrl(child, candidates, options.startupTimeoutMs ?? 60_000)
    endpoint.url = url
    endpoint.owned = true
    announceReady(url, true, Boolean(live))
    if (options.openBrowser !== false) openExternalUrl(url)
  } catch (error) {
    stopOwnedProcessTree(child)
    if (live) await live.close()
    throw error
  }

  try {
    if (child.exitCode !== null) return child.exitCode
    const exit = new Promise<number>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (signal) console.log(`website preview stopped (${signal})`)
        resolveExit(code ?? 0)
      })
    })
    if (!options.signal) return await exit
    const aborted = waitForAbort(options.signal).then(() => {
      stopOwnedProcessTree(child)
      return 0
    })
    return await Promise.race([exit, aborted])
  } finally {
    if (live) await live.close()
  }
}

async function previewStudioOwnsUrl(url: string, sessionId: string): Promise<boolean> {
  try {
    const markerUrl = new URL('/.blendlink-preview-studio.json', url)
    const response = await fetch(markerUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(900),
      redirect: 'manual',
    })
    if (response.status >= 400) return false
    const marker = await response.json() as Partial<PreviewStudioState>
    return marker.kind === PREVIEW_STUDIO_KIND && marker.sessionId === sessionId
  } catch {
    return false
  }
}

async function reusablePreviewStudioUrl(
  plan: PreviewStudioPlan,
  packageHash: string,
): Promise<string | undefined> {
  const state = readStudioState(join(plan.workspace, PREVIEW_STUDIO_STATE))
  if (!state?.url || state.sessionId !== plan.sessionId
      || state.packageHash !== packageHash
      || state.hostVersion !== PREVIEW_STUDIO_HOST_VERSION) return undefined
  return await previewStudioOwnsUrl(state.url, plan.sessionId) ? state.url : undefined
}

function recordPreviewStudioUrl(plan: PreviewStudioPlan, packageHash: string, url: string): void {
  writeFileSync(join(plan.workspace, PREVIEW_STUDIO_STATE), JSON.stringify({
    kind: PREVIEW_STUDIO_KIND,
    sessionId: plan.sessionId,
    packageHash,
    hostVersion: PREVIEW_STUDIO_HOST_VERSION,
    url,
  }, null, 2) + '\n')
}

/** One artist-facing action for a saved .blend: provision a cache-owned
 * Three/Vite/Blendlink website, compile Preview quality, then open it. */
export async function runPreviewStudio(options: PreviewStudioOptions): Promise<number> {
  const plan = planPreviewStudio(options.blendPath, { cacheRoot: options.cacheRoot })
  if (!/\.blend$/i.test(plan.blendPath)) {
    throw new Error(`[Preview Studio: setup] --blend must point to a saved .blend file, got ${plan.blendPath}`)
  }
  if (!existsSync(plan.blendPath)) {
    throw new Error(`[Preview Studio: setup] saved .blend not found: ${plan.blendPath}`)
  }

  let scaffold: PreviewStudioScaffoldResult
  try {
    scaffold = scaffoldPreviewStudio(plan)
  } catch (error) {
    throw previewStudioStageError('setup', error)
  }
  const reportLedger = new PreviewStudioReportLedger(readPreviewStudioStatus(plan))
  const status = new PreviewStudioStatusWriter(plan)
  status.write({
    phase: 'preparing',
    label: 'Preparing the private Preview Studio',
  })
  try {
    clearPreviewStudioAcknowledgement(plan)
  } catch (error) {
    throw previewStudioStageError('setup', error)
  }
  await installPreviewStudioDependencies(plan, scaffold.packageHash)
  const endpoint: PreviewEndpoint = {
    owned: false,
    sessionId: plan.sessionId,
    blendPath: plan.blendPath,
    browserVerification: true,
  }
  let latestPublished: PreviewStudioStatus | undefined
  const generationGate = new PreviewStudioGenerationGate()
  let lastBuildError = ''
  let live: WatchHandle
  try {
    live = await startPreviewAutoUpdate(previewStudioConfig(plan), endpoint, {
      only: plan.sceneName,
      authoringPreview: true,
      recoverInitialFailure: true,
      onBuildEvent(event) {
        if (event.type === 'building') {
          lastBuildError = ''
          // An acknowledgement for the prior generation may arrive while a
          // newer Blender save is compiling. It must not make that in-flight
          // save appear ready.
          generationGate.beginBuild()
          latestPublished = undefined
          status.write({
            phase: 'building',
            label: 'Compiling Preview quality from the saved Blender scene',
          })
          return
        }
        if (event.type === 'failed') {
          lastBuildError = event.error
          status.write({
            phase: 'failed',
            label: 'The saved scene could not be compiled - fix it and save again',
            error: event.error,
          })
          return
        }
        const generation = readPreviewStudioGeneration(plan)
        if (!generation) {
          throw new Error(
            `Preview Studio compiled ${event.scene}, but its generation manifest is missing or invalid.`,
          )
        }
        lastBuildError = ''
        generationGate.publish(generation)
        const report = reportLedger.publish(generation, event.outcome)
        latestPublished = status.write({
          phase: 'published',
          label: 'Scene compiled - waiting for browser validation',
          generation,
          ...report,
        })
      },
      ...(options.force ? { force: true } : {}),
      ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
    })
  } catch (error) {
    throw previewStudioStageError('compile', error)
  }

  let acknowledgements: ReturnType<typeof watchPreviewStudioAcknowledgements> | undefined
  const watchAcknowledgements = (): void => {
    acknowledgements ??= watchPreviewStudioAcknowledgements(plan, (ack: PreviewStudioClientAck) => {
      const disposition = generationGate.accept(ack)
      if (disposition === 'ignore') return
      if (disposition === 'ready') {
        const published = latestPublished
        status.write({
          phase: 'ready',
          label: 'Preview rendered in the browser - watching Blender saves',
          generation: ack.generation,
          warnings: published?.warnings ?? [],
          ...(published?.durationMs !== undefined ? { durationMs: published.durationMs } : {}),
          ...(published?.checkDurationMs !== undefined
            ? { checkDurationMs: published.checkDurationMs }
            : {}),
          ...(published?.stats ? { stats: published.stats } : {}),
        })
        announcePreviewUpdate(endpoint, 'ready', {
          generation: ack.generation,
          browserVerified: true,
        })
        return
      }
      const error = ack.error || 'The browser could not install and render this generation.'
      lastBuildError = error
      const runtimeFailure = ack.failureKind === 'runtime'
      status.write({
        phase: 'failed',
        label: runtimeFailure
          ? 'Browser runtime failed - fix the scene and save again to retry'
          : 'Browser validation failed - the last good scene was retained',
        generation: ack.generation,
        ...(ack.failureKind ? { failureKind: ack.failureKind } : {}),
        ...(ack.retainedGeneration ? { retainedGeneration: ack.retainedGeneration } : {}),
        error,
      })
      announcePreviewUpdate(endpoint, 'failed', {
        generation: ack.generation,
        ...(ack.retainedGeneration ? { retainedGeneration: ack.retainedGeneration } : {}),
        browserVerified: false,
        error,
      })
    })
  }

  const reusableUrl = await reusablePreviewStudioUrl(plan, scaffold.packageHash)
  if (reusableUrl) {
    console.log(`Preview Studio: reusing ${reusableUrl}`)
    endpoint.url = reusableUrl
    endpoint.owned = false
    if (lastBuildError) announcePreviewUpdate(endpoint, 'failed', { error: lastBuildError })
    else announcePreviewUpdate(endpoint, 'loading', {
      ...(generationGate.currentGeneration
        ? { generation: generationGate.currentGeneration }
        : {}),
    })
    watchAcknowledgements()
    if (options.openBrowser !== false) openExternalUrl(reusableUrl)
    try {
      await waitForAbort(options.signal)
    } finally {
      acknowledgements?.close()
      await live.close()
    }
    return 0
  }

  const command = 'npm run preview:dev'
  console.log(`Preview Studio: starting local preview in ${plan.workspace}`)
  console.log(`  $ ${command}`)
  const child = spawn(command, {
    cwd: plan.workspace,
    env: process.env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const candidates = new Set<string>()
  const forward = (stream: NodeJS.ReadableStream, writer: (line: string) => void) => {
    const lines = createInterface({ input: stream })
    lines.on('line', (line) => {
      writer(line)
      const discovered = extractLocalPreviewUrl(line)
      if (discovered) candidates.add(discovered)
    })
  }
  if (child.stdout) forward(child.stdout, console.log)
  if (child.stderr) forward(child.stderr, console.error)

  try {
    const url = await waitForReachableUrl(child, candidates, options.startupTimeoutMs ?? 60_000)
    if (!await previewStudioOwnsUrl(url, plan.sessionId)) {
      throw new Error(`The server at ${url} did not serve this Preview Studio session.`)
    }
    recordPreviewStudioUrl(plan, scaffold.packageHash, url)
    endpoint.url = url
    endpoint.owned = true
    if (lastBuildError) announcePreviewUpdate(endpoint, 'failed', { error: lastBuildError })
    else announcePreviewUpdate(endpoint, 'loading', {
      ...(generationGate.currentGeneration
        ? { generation: generationGate.currentGeneration }
        : {}),
    })
    watchAcknowledgements()
    if (options.openBrowser !== false) openExternalUrl(url)
  } catch (error) {
    stopOwnedProcessTree(child)
    await live.close()
    throw previewStudioStageError('server', error)
  }

  try {
    if (child.exitCode !== null) return child.exitCode
    const exit = new Promise<number>((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (signal) console.log(`Preview Studio stopped (${signal})`)
        resolvePromise(code ?? 0)
      })
    })
    if (!options.signal) return await exit
    const aborted = waitForAbort(options.signal).then(() => {
      stopOwnedProcessTree(child)
      return 0
    })
    return await Promise.race([exit, aborted])
  } finally {
    acknowledgements?.close()
    await live.close()
  }
}
