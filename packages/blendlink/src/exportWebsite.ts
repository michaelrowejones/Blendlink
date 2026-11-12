import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path'
import { defaultPreviewStudioCacheRoot, installPreviewStudioDependencies, planPreviewStudio, previewStudioPackageDependency } from './preview.js'
import { publishWebsiteProject } from './publish.js'
import { emitProgress } from './progress.js'
import { canonicalizePublicationRoot, withPublicationScopes } from './publicationScopes.js'

const MARKER = '.blendlink-website.json'

function websiteLicenseNotices(workspace: string): string {
  const localRequire = createRequire(join(workspace, 'package.json'))
  const compilerRequire = createRequire(import.meta.url)
  const notices = ['Blendlink\n' + readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')]
  for (const name of ['three', 'postprocessing', 'n8ao', 'meshoptimizer']) {
    let entry: string
    try { entry = localRequire.resolve(name) } catch { entry = compilerRequire.resolve(name) }
    let directory = dirname(entry)
    while (true) {
      const packagePath = join(directory, 'package.json')
      if (existsSync(packagePath) && JSON.parse(readFileSync(packagePath, 'utf8')).name === name) break
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Cannot locate the ${name} runtime license`)
      directory = parent
    }
    const license = readdirSync(directory).find(file => /^license(?:\.md|\.txt)?$/i.test(file))
    if (!license) throw new Error(`The installed ${name} runtime has no license notice`)
    notices.push(name + '\n' + readFileSync(join(directory, license), 'utf8'))
  }
  notices.push('n8ao-webgpu\n' + readFileSync(new URL('./vendor/n8ao-webgpu/LICENSE', import.meta.url), 'utf8'))
  notices.push(readFileSync(new URL('./vendor/n8ao-webgpu/NOTICE.md', import.meta.url), 'utf8'))
  notices.push('Basis Universal\n' + readFileSync(new URL('../assets/basis-apache-2.0.txt', import.meta.url), 'utf8'))
  notices.push(readFileSync(new URL('../assets/blender-spectral-NOTICE.txt', import.meta.url), 'utf8'))
  notices.push(readFileSync(new URL('../assets/blender-spectral-apache-2.0.txt', import.meta.url), 'utf8'))
  notices.push(readFileSync(new URL('../assets/blender-noise-bsd-3-clause.txt', import.meta.url), 'utf8'))
  return notices.join('\n\n--------------------\n\n') + '\n'
}

export function assertWebsiteExportDestination(output: string, sourceKey: string): void {
  if (existsSync(output) && !statSync(output).isDirectory()) {
    throw new Error('Choose a folder for the website export. The selected path is an existing file and was left untouched.')
  }
  if (!existsSync(output) || readdirSync(output).length === 0) return
  try {
    const marker = JSON.parse(readFileSync(join(output, MARKER), 'utf8'))
    if (marker.schemaVersion === 1 && marker.sourceKey === sourceKey) return
  } catch { /* An unknown folder is never an export target. */ }
  throw new Error('Choose an empty folder, or the previous Blendlink website export for this scene. Existing files were left untouched.')
}

export function resolveWebsiteExportDestination(output: string, blendPath: string): string {
  // Resolve folder aliases before checking containment and replacing an owned
  // export. Otherwise renaming a symlink replaces the alias itself, and a
  // parent reached through an alias can conceal the source scene.
  const destination = canonicalizePublicationRoot(resolve(output))
  const sourceRelative = relative(destination, realpathSync(blendPath))
  if (!isAbsolute(sourceRelative) && !sourceRelative.startsWith('..' + sep) && sourceRelative !== '..') {
    throw new Error('The website export folder cannot contain its source .blend. Choose a separate folder.')
  }
  return destination
}

export function standaloneWebsiteMainSource(sceneName: string): string {
  return `import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { installThreeCompiledScene } from 'blendlink/three'
import { ${sceneName} as descriptor } from './generated/${sceneName}.gen'
import { createBakedScene } from './generated/${sceneName}.baked'
import './style.css'

const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
const status = document.querySelector<HTMLElement>('#status')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const pause = document.querySelector<HTMLButtonElement>('#pause')!
const reset = document.querySelector<HTMLButtonElement>('#reset')!
let installed: Awaited<ReturnType<typeof installThreeCompiledScene>> | null = null
let renderer: WebGPURenderer | null = null
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
const loading = new AbortController()
let paused = motionPreference.matches
let playbackChosen = false
let failed = false
let disposed = false
let animationFrame = 0
let previous = performance.now()
function releaseResources(): void {
  const scene = installed, graphics = renderer
  installed = null; renderer = null
  delete canvas.dataset.tslMaterialsApplied
  delete canvas.dataset.tslMaterialsSkipped
  delete canvas.dataset.postprocessingOrder
  try { scene?.dispose() } catch (error) { console.warn('Scene cleanup failed:', error) }
  try { graphics?.dispose() } catch (error) { console.warn('Renderer cleanup failed:', error) }
}
function fail(error: unknown): void {
  if (disposed || failed) return
  failed = true
  loading.abort()
  cancelAnimationFrame(animationFrame)
  delete document.body.dataset.ready
  const restoreFocus = document.activeElement === pause || document.activeElement === reset
  status.hidden = false
  status.setAttribute('role', 'alert')
  status.textContent = 'This scene could not load. ' + (error instanceof Error ? error.message : String(error))
  retry.hidden = false
  pause.disabled = true; reset.disabled = true
  if (restoreFocus) retry.focus()
  releaseResources()
}
async function load(): Promise<void> {
  try {
    const graphics = new WebGPURenderer({ canvas, antialias: true, alpha: true })
    renderer = graphics
    graphics.setPixelRatio(Math.min(devicePixelRatio, 2))
    graphics.onDeviceLost = info => fail(new Error(info.message || 'Graphics device was lost.'))
    await graphics.init()
    if (disposed || failed) return
    const candidate = await installThreeCompiledScene({
      renderer: graphics, scene: new THREE.Scene(), descriptor, createBakedScene,
      assetBaseUrl: new URL('./', location.href), useAuthoringPreview: true,
      signal: loading.signal,
      onWarning(message) { console.warn(message) },
    })
    if (disposed || failed) { candidate.dispose(); return }
    installed = candidate
    setPaused(paused)
    resize()
    installed.update(0); installed.render(0)
    if (disposed || failed) return
    canvas.dataset.tslMaterialsApplied = String(installed.tslMaterials?.applied ?? 0)
    canvas.dataset.tslMaterialsSkipped = String(installed.tslMaterials?.skipped.length ?? 0)
    canvas.dataset.postprocessingOrder = JSON.stringify(installed.components.postprocessingOrder)
    status.hidden = true
    pause.disabled = false
    pause.hidden = !installed.animation || installed.animation.availableClips.length === 0
    reset.disabled = false; reset.hidden = !installed.cameraController?.interactive
    document.body.dataset.ready = 'true'
  } catch (error) { fail(error) }
}
function resize(): void {
  if (disposed || failed) return
  try { installed?.resize(Math.max(1, innerWidth), Math.max(1, innerHeight)) }
  catch (error) { fail(error) }
}
function frame(now: number): void {
  if (disposed || failed) return
  animationFrame = requestAnimationFrame(frame)
  const delta = Math.min(.1, Math.max(0, (now - previous) / 1000))
  previous = now
  if (!installed || failed || document.hidden) return
  try {
    installed.update(paused ? 0 : delta)
    // Explicit visitor navigation still works while authored motion is paused.
    // Orbit damping updates above; free controls also need elapsed input time.
    if (paused && installed.cameraController?.behavior === 'free') installed.cameraController.update(delta)
    installed.render(paused ? 0 : delta)
    if (!paused && installed.animation?.state.phase === 'finished') { paused = true; updatePause() }
  } catch (error) { fail(error) }
}
function updatePause(): void {
  pause.textContent = paused ? 'Play' : 'Pause'
  pause.title = paused ? 'Resume scene animation' : 'Pause scene animation'
  pause.setAttribute('aria-pressed', String(paused))
}
function setPaused(value: boolean, explicit = false): void {
  paused = value
  const animation = installed?.animation
  if (animation) {
    if (paused && animation.state.phase === 'playing') animation.pause()
    else if (!paused && (explicit || animation.state.phase === 'paused')) animation.play()
    // Manual playback waits for the visitor; a motion preference change must
    // not turn an authored idle scene into autoplay.
    if (animation.state.phase === 'idle' || animation.state.phase === 'finished') paused = true
  }
  updatePause()
}
pause.addEventListener('click', () => { playbackChosen = true; setPaused(!paused, true) })
reset.addEventListener('click', () => {
  try { installed?.cameraController?.reset() } catch (error) { fail(error) }
})
retry.addEventListener('click', () => location.reload())
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('Graphics context was lost.')) })
window.addEventListener('resize', resize)
motionPreference.addEventListener('change', event => {
  if (!playbackChosen) setPaused(event.matches)
})
window.addEventListener('pagehide', event => {
  // A cached page keeps its scene for Back/Forward restoration. A departing
  // page releases even when loading is still in progress.
  if ((event as PageTransitionEvent).persisted) return
  disposed = true
  loading.abort()
  cancelAnimationFrame(animationFrame)
  releaseResources()
})
window.addEventListener('pageshow', () => { previous = performance.now() })
updatePause()
void load()
animationFrame = requestAnimationFrame(frame)
`
}

/** Final compile + verified static site. No change to the source or live preview. */
export async function exportStandaloneWebsite(options: { blendPath: string; output: string; force?: boolean }): Promise<{ output: string; warnings: string[] }> {
  const blendPath = realpathSync(resolve(options.blendPath))
  const output = resolveWebsiteExportDestination(options.output, blendPath)
  if (!blendPath.toLowerCase().endsWith('.blend')) throw new Error('Choose a saved .blend scene to export.')
  const sourceKey = createHash('sha256').update(blendPath).digest('hex')
  assertWebsiteExportDestination(output, sourceKey)
  const plan = planPreviewStudio(blendPath, { cacheRoot: join(defaultPreviewStudioCacheRoot(), 'website-exports') })
  return withPublicationScopes({
    roots: [plan.workspace, join(plan.workspace, 'public/models'), join(plan.workspace, 'src/generated'), output],
    intent: 'publish', label: 'Export Website',
  }, async () => {
    assertWebsiteExportDestination(output, sourceKey)
    emitProgress(.02, 'Preparing your website · first export installs private tools')
    const workspaceMarker = join(plan.workspace, '.blendlink-export-workspace.json')
    if (existsSync(plan.workspace) && readdirSync(plan.workspace).length && !existsSync(workspaceMarker)) {
      // Recognize only this scene's identity-proven former private scaffold.
      let identity: { sessionId?: string } = {}
      try { identity = JSON.parse(readFileSync(join(plan.workspace, 'public/.blendlink-preview-studio.json'), 'utf8')) } catch {}
      if (identity.sessionId !== plan.sessionId) throw new Error('The private website export cache is not owned by this scene. Choose another cache location.')
    }
    if (existsSync(workspaceMarker) && JSON.parse(readFileSync(workspaceMarker, 'utf8')).sourceKey !== sourceKey) {
      throw new Error('The private website export cache belongs to a different scene.')
    }
    mkdirSync(join(plan.workspace, 'src'), { recursive: true })
    mkdirSync(join(plan.workspace, 'public'), { recursive: true })
    writeFileSync(workspaceMarker, JSON.stringify({ schemaVersion: 1, sourceKey }))
    writeFileSync(join(plan.workspace, 'blendlink.config.mjs'), `export default { outDir: 'public/models', genDir: 'src/generated', urlPrefix: '/models', scenes: [{ file: ${JSON.stringify(blendPath)}, name: ${JSON.stringify(plan.sceneName)} }] }\n`)
    const pkgPath = join(plan.workspace, 'package.json')
    const packageText = JSON.stringify({
      name: `blendlink-website-${plan.sessionId}`, private: true, version: '0.0.0', type: 'module',
      scripts: { build: 'vite build --base=./' },
      dependencies: { blendlink: previewStudioPackageDependency(), three: '0.184.0' },
      devDependencies: { vite: '7.3.8' },
    }, null, 2) + '\n'
    writeFileSync(pkgPath, packageText)
    await installPreviewStudioDependencies(plan, createHash('sha256').update(packageText).digest('hex').slice(0, 16))
    writeFileSync(join(plan.workspace, 'vite.config.mjs'), "export default { base: './', resolve: { dedupe: ['three'] } }\n")
    writeFileSync(join(plan.workspace, 'src/main.ts'), standaloneWebsiteMainSource(plan.sceneName))
    writeFileSync(join(plan.workspace, 'src/style.css'), `html,body,canvas{margin:0;width:100%;height:100%;display:block}body{font:14px system-ui;background:#10131b;color:#fff;overflow:hidden}#status{position:fixed;inset:35% 8% auto;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}nav{position:fixed;bottom:18px;left:18px;display:flex;gap:8px}button{font:inherit;color:inherit;background:#202832;border:1px solid #71808d;border-radius:8px;padding:10px 15px;cursor:pointer}button:focus-visible{outline:3px solid #6ee7c7}button:disabled{opacity:.4}button[hidden],[hidden]{display:none}\n`)
    writeFileSync(join(plan.workspace, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><title>${plan.sceneName}</title></head><body><canvas aria-label="Interactive 3D scene"></canvas><p id="status" role="status">Loading your scene…</p><nav aria-label="Scene controls"><button id="pause" type="button" disabled>Pause</button><button id="reset" type="button" disabled>Reset view</button><button id="retry" type="button" hidden>Retry</button></nav><script type="module" src="/src/main.ts"></script></body></html>`)
    const result = await publishWebsiteProject({ root: plan.workspace, ...(options.force ? { force: true } : {}) })
    emitProgress(.95, 'Saving your complete website')
    mkdirSync(dirname(output), { recursive: true })
    const staging = mkdtempSync(join(dirname(output), '.blendlink-website-'))
    const backup = staging + '-previous'
    let movedPrevious = false
    try {
      cpSync(join(plan.workspace, 'dist'), staging, { recursive: true })
      for (const file of readdirSync(staging).filter(name => name.startsWith('.blendlink-preview-'))) {
        rmSync(join(staging, file), { force: true })
      }
      writeFileSync(join(staging, MARKER), JSON.stringify({ schemaVersion: 1, sourceKey, scene: plan.sceneName }) + '\n')
      writeFileSync(join(staging, 'THIRD_PARTY_NOTICES.txt'), websiteLicenseNotices(plan.workspace))
      writeFileSync(join(staging, 'HOSTING.txt'), 'Upload the contents of this folder to any static website host.\nOpen the hosted URL to view or embed the scene. No Blender or Node installation is needed on the host.\nUse an HTTP server for local viewing; browsers block 3D assets opened through file://.\nAll models, textures, decoders and scripts are included.\n')
      assertWebsiteExportDestination(output, sourceKey)
      if (existsSync(output)) { renameSync(output, backup); movedPrevious = true }
      try { renameSync(staging, output) }
      catch (error) { if (movedPrevious) renameSync(backup, output); throw error }
      if (movedPrevious) rmSync(backup, { recursive: true, force: true })
    } finally { rmSync(staging, { recursive: true, force: true }) }
    emitProgress(1, 'Website exported · upload this folder to your hosting')
    return { output, warnings: result.outcomes.flatMap(outcome => outcome.warnings) }
  })
}
