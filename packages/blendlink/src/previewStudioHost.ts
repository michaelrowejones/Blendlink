import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { renderBakedRecipe } from './bakedRecipe.js'

export const PREVIEW_STUDIO_STATUS = '.blendlink-preview-status.json'
export const PREVIEW_STUDIO_CONTROL = '.blendlink-preview-control.json'
export const PREVIEW_STUDIO_ACK = '.blendlink-preview-ack.json'
export const PREVIEW_STUDIO_CLIENT_PREFIX = '##blendlink-preview-client '
export const PREVIEW_STUDIO_HOST_VERSION = 6
export const PREVIEW_STUDIO_MAIN_MARKER =
  '// Blendlink Preview Studio owns this disposable, browser-verified viewer.'
export const PREVIEW_STUDIO_MAIN_VERSION_MARKER =
  '// Blendlink Preview Studio host template:'
export const PREVIEW_STUDIO_INDEX_VERSION_MARKER =
  '<!-- Blendlink Preview Studio host template:'
export const PREVIEW_STUDIO_STYLE_VERSION_MARKER =
  '/* Blendlink Preview Studio host template:'
export const PREVIEW_STUDIO_VITE_VERSION_MARKER =
  '// Blendlink Preview Studio host template:'

export interface PreviewStudioHostPlan {
  workspace: string
  sessionId: string
  sceneName: string
  blendPath: string
}

export type PreviewStudioPhase =
  | 'preparing'
  | 'building'
  | 'published'
  | 'ready'
  | 'failed'

export interface PreviewStudioStatus {
  schemaVersion: 1
  sequence: number
  sessionId: string
  sceneName: string
  blendPath: string
  phase: PreviewStudioPhase
  label: string
  generation?: string
  retainedGeneration?: string
  warnings: string[]
  failureKind?: 'validation' | 'runtime'
  error?: string
  stats?: {
    bytes: number
    triangles: number
    meshes: number
    texturesBytes: number
    gpuTextureBytes?: number
    drawCallsEstimate?: number
  }
  durationMs?: number
  /** Duration of the latest no-op source/integrity check. This is not a
   * compile duration and must never replace the last real build report. */
  checkDurationMs?: number
  updatedAt: string
}

export interface PreviewStudioClientAck {
  schemaVersion: 1
  sessionId: string
  generation: string
  phase: 'ready' | 'failed'
  failureKind?: 'validation' | 'runtime'
  retainedGeneration?: string
  error?: string
  updatedAt: string
}

interface PreviewStudioControl {
  schemaVersion: 1
  sessionId: string
  token: string
}

let atomicWriteSequence = 0

/** Status and control files are polled by both Vite and the CLI. Publish a
 * complete adjacent file in one rename so neither reader can observe a JSON
 * document between write syscalls. */
function writeTextAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${++atomicWriteSequence}.tmp`
  try {
    writeFileSync(temporaryPath, contents)
    renameSync(temporaryPath, path)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
}

export const LEGACY_PREVIEW_STUDIO_INDEX_WITH_FAVICON = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23101116'/%3E%3Cpath d='M4 4h8v8H4z' fill='%2366d9ef'/%3E%3C/svg%3E"><title>Blendlink Preview</title></head>
<body><canvas id="scene" aria-label="Blendlink web preview"></canvas><script type="module" src="/src/main.ts"></script></body></html>
`

export const PREVIEW_STUDIO_INDEX = `${PREVIEW_STUDIO_INDEX_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION} -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%230d1016'/%3E%3Cpath d='M3.5 4.2h5.2a3.3 3.3 0 0 1 0 6.6H3.5z' fill='%236ee7c7'/%3E%3C/svg%3E">
  <title>Blendlink Preview Studio</title>
</head>
<body>
  <main id="studio" data-background="dark" data-viewport="fill">
    <section id="viewport" aria-label="Blendlink Web Presentation"></section>
    <header class="studio-bar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Blendlink</span><span class="muted">Preview Studio</span></div>
      <div id="status-chip" class="status-chip" role="status"><span class="status-dot"></span><span id="status-label">Opening preview…</span></div>
      <nav class="toolbar" aria-label="Preview controls">
        <button id="pause" type="button" title="Pause animation" aria-pressed="false">Pause</button>
        <button id="reset" type="button" title="Reset authored camera">Reset view</button>
        <button id="background" type="button" title="Background: dark. Cycle dark, checker, and light." aria-label="Background: dark">Background</button>
        <button id="fullscreen" type="button" title="Enter fullscreen">Fullscreen</button>
        <button id="details" type="button" aria-expanded="false" aria-controls="drawer">Details</button>
      </nav>
    </header>
    <section id="first-load" class="first-load" aria-live="polite">
      <div class="loader-mark" aria-hidden="true"></div>
      <p id="first-load-title">Preparing your Web Presentation</p>
      <p id="first-load-detail">The preview opens now and updates whenever you save in Blender.</p>
    </section>
    <section id="notice" class="notice" hidden aria-live="assertive"></section>
    <aside id="drawer" class="drawer" hidden>
      <div class="drawer-heading"><div><strong id="scene-name">Scene</strong><div id="generation" class="muted">Waiting for first generation</div></div><button id="close-details" type="button" aria-label="Close details">×</button></div>
      <div class="viewport-presets" aria-label="Responsive viewport">
        <button type="button" data-viewport="fill" aria-pressed="true">Fit window</button>
        <button type="button" data-viewport="desktop" aria-pressed="false">Desktop</button>
        <button type="button" data-viewport="mobile" aria-pressed="false">Mobile</button>
      </div>
      <dl id="stats" class="stats"></dl>
      <section id="scene-controls" class="drawer-section"></section>
      <section class="drawer-section"><h2>Web Checks</h2><div id="warnings" class="checks"><p class="muted">No warnings reported.</p></div></section>
      <section id="error-section" class="drawer-section" hidden><h2>What needs attention</h2><pre id="error-detail"></pre></section>
    </aside>
  </main>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`

export const LEGACY_PREVIEW_STUDIO_STYLE =
  'html, body, #scene { width: 100%; height: 100%; margin: 0; display: block; }\n' +
  'body { overflow: hidden; background: #101116; }\n'

export const UNVERSIONED_PREVIEW_STUDIO_STYLE = `
:root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f4f7f5; background: #0d1016; font-synthesis: none; }
* { box-sizing: border-box; }
html, body, #studio { width: 100%; height: 100%; margin: 0; overflow: hidden; }
button { appearance: none; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: inherit; background: rgba(15,19,26,.78); padding: 8px 11px; font: inherit; font-size: 12px; cursor: pointer; backdrop-filter: blur(18px); }
button:hover { background: rgba(38,46,57,.9); border-color: rgba(110,231,199,.34); }
button[data-active], button[aria-pressed="true"] { border-color: rgba(110,231,199,.48); background: rgba(38,73,69,.88); }
button:focus-visible { outline: 2px solid #6ee7c7; outline-offset: 2px; }
#studio { position: relative; display: grid; place-items: center; background: #11151d; }
#studio[data-background="checker"] { background-color: #141921; background-image: linear-gradient(45deg,#1d2430 25%,transparent 25%),linear-gradient(-45deg,#1d2430 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1d2430 75%),linear-gradient(-45deg,transparent 75%,#1d2430 75%); background-size: 28px 28px; background-position: 0 0,0 14px,14px -14px,-14px 0; }
#studio[data-background="light"] { background: #cbd2d1; }
#viewport { position: relative; width: 100%; height: 100%; overflow: hidden; box-shadow: 0 28px 80px rgba(0,0,0,.28); transition: width .22s ease, height .22s ease, border-radius .22s ease; }
#studio[data-viewport="desktop"] #viewport { width: min(92vw, 1440px); height: min(82vh, 900px); border-radius: 12px; }
#studio[data-viewport="mobile"] #viewport { width: min(88vw, 430px); height: min(82vh, 860px); border-radius: 18px; }
.scene-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; pointer-events: none; }
.scene-canvas.active { opacity: 1; pointer-events: auto; }
.studio-bar { position: fixed; z-index: 20; top: 14px; left: 14px; right: 14px; min-height: 44px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; pointer-events: none; }
.brand, .status-chip, .toolbar { pointer-events: auto; }
.brand { justify-self: start; display: flex; gap: 8px; align-items: center; padding: 9px 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 11px; background: rgba(10,13,18,.7); backdrop-filter: blur(18px); font-size: 12px; font-weight: 650; }
.brand-mark { width: 12px; height: 12px; border-radius: 4px 8px 8px 4px; background: #6ee7c7; box-shadow: 0 0 18px rgba(110,231,199,.42); }
.muted { color: #9da7a6; font-weight: 450; }
.status-chip { justify-self: center; display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(10,13,18,.72); backdrop-filter: blur(18px); font-size: 12px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #6ee7c7; box-shadow: 0 0 14px currentColor; }
.status-chip[data-phase="building"] .status-dot, .status-chip[data-phase="published"] .status-dot { color: #f6c96a; background: currentColor; animation: pulse 1.1s infinite alternate; }
.status-chip[data-phase="failed"] .status-dot { color: #ff8d86; background: currentColor; }
.toolbar { justify-self: end; display: flex; gap: 6px; }
.first-load { position: fixed; z-index: 10; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; background: radial-gradient(circle at 50% 42%,rgba(41,61,66,.36),transparent 42%),#0d1016; transition: opacity .28s ease, visibility .28s ease; }
.first-load[hidden] { display: none; }
.first-load p { margin: 12px 20px 0; max-width: 510px; }
#first-load-title { font-size: clamp(19px,2.2vw,28px); font-weight: 620; }
#first-load-detail { color: #9da7a6; font-size: 13px; line-height: 1.5; }
.loader-mark { width: 42px; height: 42px; border-radius: 14px 25px 25px 14px; background: #6ee7c7; box-shadow: 0 0 55px rgba(110,231,199,.28); animation: breathe 1.5s ease-in-out infinite alternate; }
.notice { position: fixed; z-index: 24; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: min(680px,calc(100vw - 30px)); padding: 11px 14px; border: 1px solid rgba(255,255,255,.12); border-radius: 11px; background: rgba(10,13,18,.88); box-shadow: 0 18px 60px rgba(0,0,0,.3); backdrop-filter: blur(18px); font-size: 12px; line-height: 1.45; }
.notice.error { border-color: rgba(255,141,134,.42); }
.drawer { position: fixed; z-index: 30; top: 70px; right: 14px; bottom: 14px; width: min(390px,calc(100vw - 28px)); overflow: auto; padding: 16px; border: 1px solid rgba(255,255,255,.11); border-radius: 14px; background: rgba(11,14,19,.92); box-shadow: 0 24px 90px rgba(0,0,0,.46); backdrop-filter: blur(22px); }
.drawer-heading { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
.drawer-heading strong { font-size: 16px; }
.viewport-presets { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-top: 16px; }
.stats { display: grid; grid-template-columns: 1fr auto; gap: 7px 16px; padding: 14px 0; margin: 0; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 12px; }
.stats dt { color: #9da7a6; }.stats dd { margin: 0; font-variant-numeric: tabular-nums; }
.drawer-section { padding-top: 15px; }.drawer-section h2 { margin: 0 0 9px; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: #aeb8b6; }
.checks { display: grid; gap: 7px; }.check { padding: 9px 10px; border-radius: 9px; background: rgba(255,255,255,.05); font-size: 12px; line-height: 1.45; }
.control-row { display: flex; flex-wrap: wrap; gap: 6px; }.control-row + .control-row { margin-top: 8px; }
.range-summary { margin: 8px 0 0; font-size: 11px; line-height: 1.45; }
pre { margin: 0; padding: 11px; white-space: pre-wrap; word-break: break-word; border-radius: 9px; background: rgba(255,141,134,.08); color: #ffc1bd; font: 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
@keyframes pulse { to { opacity: .42; } } @keyframes breathe { to { transform: scale(.92); opacity: .72; } }
@media (max-width: 820px) { .studio-bar { top: 10px; left: 10px; right: 10px; grid-template-columns: 1fr auto; }.status-chip { order: 3; grid-column: 1/-1; }.brand .muted { display: none; }.toolbar { position: fixed; left: 10px; right: 10px; bottom: 10px; justify-content: flex-start; overflow-x: auto; padding: 3px; }.toolbar button { display: block; flex: 0 0 auto; }.notice { bottom: 66px; }.drawer { bottom: 66px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`

export const PREVIEW_STUDIO_STYLE =
  `${PREVIEW_STUDIO_STYLE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION} */\n` +
  UNVERSIONED_PREVIEW_STUDIO_STYLE

export function previewStudioBakedBridgeSource(plan: PreviewStudioHostPlan): string {
  const source = renderBakedRecipe(plan.sceneName)
  const importLine = `import { ${plan.sceneName} } from './${plan.sceneName}.gen'`
  if (!source.includes(importLine)) {
    throw new Error(`Preview Studio could not adapt the generated baked recipe for ${plan.sceneName}.`)
  }
  return source.replace(
    importLine,
    `let ${plan.sceneName}: any = null\n\nexport function bindPreviewDescriptor(value: any): void {\n  ${plan.sceneName} = value\n}`,
  )
}

export function unversionedPreviewStudioViteConfigSource(): string {
  return `// Blendlink Preview Studio owns this disposable host adapter.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const controlPath = resolve('public/${PREVIEW_STUDIO_CONTROL}')
const ackPath = resolve('public/${PREVIEW_STUDIO_ACK}')
const statusPath = resolve('public/${PREVIEW_STUDIO_STATUS}')
const clientPrefix = ${JSON.stringify(PREVIEW_STUDIO_CLIENT_PREFIX)}
let ackSequence = 0

function writeAck(ack) {
  const temporaryPath = ackPath + '.' + process.pid + '.' + (++ackSequence) + '.tmp'
  try {
    writeFileSync(temporaryPath, JSON.stringify(ack, null, 2) + '\\n')
    renameSync(temporaryPath, ackPath)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }
}

function previewControlPlugin() {
  return {
    name: 'blendlink-preview-control',
    handleHotUpdate(context) {
      const path = context.file.replace(/\\\\/g, '/')
      if (path.includes('/src/generated/') || path.includes('/public/models/') ||
          path.includes('/public/${PREVIEW_STUDIO_STATUS}') ||
          path.includes('/public/${PREVIEW_STUDIO_CONTROL}') ||
          path.includes('/public/${PREVIEW_STUDIO_ACK}')) return []
    },
    configureServer(server) {
      server.middlewares.use('/__blendlink/preview-client', (request, response, next) => {
        if (request.method !== 'POST') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', chunk => {
          body += chunk
          if (body.length > 64 * 1024) request.destroy()
        })
        request.on('end', () => {
          try {
            if (!existsSync(controlPath)) throw new Error('Preview control identity is missing')
            const control = JSON.parse(readFileSync(controlPath, 'utf8'))
            const payload = JSON.parse(body)
            if (payload.token !== control.token || payload.sessionId !== control.sessionId) {
              response.statusCode = 403
              response.end('Preview session identity mismatch')
              return
            }
            if (payload.phase !== 'ready' && payload.phase !== 'failed') {
              throw new Error('Preview acknowledgement has an invalid phase')
            }
            if (payload.failureKind !== undefined &&
                payload.failureKind !== 'validation' && payload.failureKind !== 'runtime') {
              throw new Error('Preview acknowledgement has an invalid failure kind')
            }
            if (payload.phase === 'ready' && payload.failureKind !== undefined) {
              throw new Error('A ready acknowledgement cannot carry a failure kind')
            }
            if (!existsSync(statusPath)) throw new Error('Preview status is missing')
            const status = JSON.parse(readFileSync(statusPath, 'utf8'))
            const generation = String(payload.generation || '')
            if (status.schemaVersion !== 1 || status.sessionId !== control.sessionId) {
              response.statusCode = 409
              response.end('Preview status identity mismatch')
              return
            }
            if (!generation || status.generation !== generation ||
                (status.phase !== 'published' && status.phase !== 'ready')) {
              response.statusCode = 409
              response.end('Preview generation is no longer current')
              return
            }
            const ack = {
              schemaVersion: 1,
              sessionId: control.sessionId,
              generation,
              phase: payload.phase,
              ...(payload.failureKind ? { failureKind: payload.failureKind } : {}),
              ...(payload.retainedGeneration && payload.retainedGeneration === status.retainedGeneration
                ? { retainedGeneration: String(payload.retainedGeneration) }
                : {}),
              ...(payload.error ? { error: String(payload.error) } : {}),
              updatedAt: new Date().toISOString(),
            }
            writeAck(ack)
            console.log(clientPrefix + JSON.stringify(ack))
            response.statusCode = 204
            response.end()
          } catch (error) {
            response.statusCode = 400
            response.end(error instanceof Error ? error.message : String(error))
          }
        })
      })
    },
  }
}

export default {
  resolve: { dedupe: ['three'] },
  plugins: [previewControlPlugin()],
}
`
}

export function previewStudioViteConfigSource(): string {
  return `${PREVIEW_STUDIO_VITE_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}\n` +
    unversionedPreviewStudioViteConfigSource()
}

export function previewStudioMainSource(plan: PreviewStudioHostPlan): string {
  const generatedModule = `./generated/${plan.sceneName}.gen.ts`
  return `${PREVIEW_STUDIO_MAIN_MARKER}
${PREVIEW_STUDIO_MAIN_VERSION_MARKER} ${PREVIEW_STUDIO_HOST_VERSION}
import * as THREE from 'three'
import { installThreeCompiledScene } from 'blendlink/three'
import { bindPreviewDescriptor, createBakedScene } from './previewBaked'
import './style.css'

const SESSION_ID = ${JSON.stringify(plan.sessionId)}
const SCENE_NAME = ${JSON.stringify(plan.sceneName)}
const GENERATED_MODULE = ${JSON.stringify(generatedModule)}
const STATUS_URL = '/${PREVIEW_STUDIO_STATUS}'
const CONTROL_URL = '/${PREVIEW_STUDIO_CONTROL}'
const CLIENT_URL = '/__blendlink/preview-client'

type StudioStatus = {
  schemaVersion: 1
  sequence: number
  sessionId: string
  sceneName: string
  phase: 'preparing' | 'building' | 'published' | 'ready' | 'failed'
  label: string
  generation?: string
  retainedGeneration?: string
  warnings: string[]
  failureKind?: 'validation' | 'runtime'
  error?: string
  stats?: { bytes: number; triangles: number; meshes: number; texturesBytes: number; gpuTextureBytes?: number; drawCallsEstimate?: number }
  durationMs?: number
  checkDurationMs?: number
}

type Presentation = {
  generation: string
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  world: THREE.Scene
  installed: Awaited<ReturnType<typeof installThreeCompiledScene>>
  cameraSnapshot: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; zoom?: number }
  descriptor: any
  sourceStatus: StudioStatus
  warnings: string[]
  lastWidth: number
  lastHeight: number
}

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id)
  if (!value) throw new Error('Blendlink Preview Studio is missing #' + id)
  return value as T
}
const studio = element<HTMLElement>('studio')
const viewport = element<HTMLElement>('viewport')
const firstLoad = element<HTMLElement>('first-load')
const firstLoadTitle = element<HTMLElement>('first-load-title')
const firstLoadDetail = element<HTMLElement>('first-load-detail')
const statusChip = element<HTMLElement>('status-chip')
const statusLabel = element<HTMLElement>('status-label')
const notice = element<HTMLElement>('notice')
const drawer = element<HTMLElement>('drawer')
const warningsElement = element<HTMLElement>('warnings')
const statsElement = element<HTMLElement>('stats')
const controlsElement = element<HTMLElement>('scene-controls')
const errorSection = element<HTMLElement>('error-section')
const errorDetail = element<HTMLElement>('error-detail')
const generationElement = element<HTMLElement>('generation')
element<HTMLElement>('scene-name').textContent = SCENE_NAME

let active: Presentation | null = null
let loadingGeneration = ''
let desiredGeneration = ''
let queuedPromotion: StudioStatus | null = null
let latestStatus: StudioStatus | null = null
let lastSequence = -1
let paused = false
let updateNoticeTimer = 0
let animationFrame = 0
let previousTime = performance.now()
let disposed = false
let controlToken = ''
let runtimeFailedGeneration = ''
let runtimeFailureMessage = ''
let statusPollFailures = 0
let statusConnectionLost = false

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setPhase(phase: StudioStatus['phase'], label: string): void {
  statusChip.dataset.phase = phase
  statusLabel.textContent = label
}

function showNotice(message: string, error = false): void {
  notice.textContent = message
  notice.classList.toggle('error', error)
  notice.hidden = false
}

function hideNotice(): void {
  notice.hidden = true
  notice.classList.remove('error')
}

function renderChecks(messages: readonly string[]): void {
  warningsElement.replaceChildren()
  if (messages.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'No warnings reported.'
    warningsElement.append(empty)
    return
  }
  for (const message of messages) {
    const item = document.createElement('div')
    item.className = 'check'
    item.textContent = message
    warningsElement.append(item)
  }
}

function renderStats(status: StudioStatus): void {
  const stats = status.stats
  const rows: Array<[string, string]> = [
    ['Generation', (status.generation || active?.generation || '—').slice(0, 12)],
    ['Build', status.durationMs === undefined ? '—' : (status.durationMs / 1000).toFixed(1) + ' s'],
  ]
  if (status.checkDurationMs !== undefined) {
    rows.push(['In-sync check', (status.checkDurationMs / 1000).toFixed(1) + ' s'])
  }
  if (stats) rows.push(
    ['GLB', (stats.bytes / 1024 / 1024).toFixed(2) + ' MB'],
    ['Triangles', stats.triangles.toLocaleString()],
    ['Meshes', stats.meshes.toLocaleString()],
    ['Texture source', (stats.texturesBytes / 1024 / 1024).toFixed(2) + ' MB'],
    ['GPU textures', stats.gpuTextureBytes === undefined ? '—' : (stats.gpuTextureBytes / 1024 / 1024).toFixed(2) + ' MB'],
    ['Draw calls est.', stats.drawCallsEstimate?.toLocaleString() || '—'],
  )
  statsElement.replaceChildren()
  for (const [term, value] of rows) {
    const dt = document.createElement('dt'); dt.textContent = term
    const dd = document.createElement('dd'); dd.textContent = value
    statsElement.append(dt, dd)
  }
}

function addControlGroup(title: string, names: readonly string[], activate: (name: string, button: HTMLButtonElement) => void): HTMLDivElement | null {
  if (names.length === 0) return null
  const heading = document.createElement('h2'); heading.textContent = title
  const row = document.createElement('div'); row.className = 'control-row'
  for (const name of names) {
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = name; button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => activate(name, button))
    row.append(button)
  }
  controlsElement.append(heading, row)
  return row
}

function renderSceneControls(presentation: Presentation): void {
  controlsElement.replaceChildren()
  const stateNames = Object.keys(presentation.descriptor.states || {})
  const stateRangeSummary = document.createElement('p')
  stateRangeSummary.className = 'muted range-summary'
  const showStateRange = (name: string): void => {
    const values = Object.values(presentation.descriptor.stateScales?.[name] || {})
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    const range = values.length > 0 ? Math.max(...values) : 1
    stateRangeSummary.textContent = range > 1.001
      ? 'Runtime range ' + range.toFixed(2) + '× · 99.9% of covered texels preserved'
      : 'Runtime range 1× · no HDR normalization needed'
  }
  const stateGroup = addControlGroup('Baked states', stateNames, (name, button) => {
    void presentation.installed.setStateAsync(name).then(ok => {
      if (!ok) showNotice('Could not select baked state “' + name + '”.', true)
      else for (const sibling of button.parentElement?.querySelectorAll('button') || []) {
        const selected = sibling === button
        sibling.toggleAttribute('data-active', selected)
        sibling.setAttribute('aria-pressed', String(selected))
      }
      if (ok) showStateRange(name)
    }).catch(error => {
      showNotice('Could not select baked state “' + name + '”: ' + errorText(error), true)
    })
  })
  const activeState = presentation.descriptor.defaultState || stateNames[0]
  for (const button of stateGroup?.querySelectorAll<HTMLButtonElement>('button') || []) {
    const selected = button.textContent === activeState
    button.toggleAttribute('data-active', selected)
    button.setAttribute('aria-pressed', String(selected))
  }
  if (stateGroup && activeState) {
    showStateRange(activeState)
    controlsElement.append(stateRangeSummary)
  }
  const lightGroup = addControlGroup('Light groups', Object.keys(presentation.descriptor.lightGroups || {}), (name, button) => {
    const enabled = button.dataset.enabled !== 'true'
    const changed = presentation.installed.setLightGroup(name, { strength: enabled ? 1 : 0 })
    if (!changed) {
      showNotice('Could not change Light Group "' + name + '".', true)
      return
    }
    button.dataset.enabled = String(enabled)
    button.setAttribute('aria-pressed', String(enabled))
    button.textContent = name + (enabled ? ' on' : ' off')
  })
  for (const button of lightGroup?.querySelectorAll<HTMLButtonElement>('button') || []) {
    const name = button.textContent || ''
    const enabled = presentation.installed.setLightGroup(name, { strength: 1 })
    button.dataset.enabled = String(enabled)
    button.setAttribute('aria-pressed', String(enabled))
    button.textContent = name + (enabled ? ' on' : ' unavailable')
    if (!enabled) button.disabled = true
  }
}

async function control(): Promise<string> {
  if (controlToken) return controlToken
  const response = await fetch(CONTROL_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Preview control channel returned ' + response.status)
  const value = await response.json() as { schemaVersion?: number; sessionId?: string; token?: string }
  if (value.schemaVersion !== 1 || value.sessionId !== SESSION_ID || !value.token) {
    throw new Error('Preview control channel belongs to another session')
  }
  controlToken = value.token
  return controlToken
}

async function acknowledge(payload: {
  generation: string
  phase: 'ready' | 'failed'
  failureKind?: 'validation' | 'runtime'
  retainedGeneration?: string
  error?: string
}): Promise<boolean> {
  const token = await control()
  const response = await fetch(CLIENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, token, sessionId: SESSION_ID }),
  })
  if (response.status === 409) return false
  if (!response.ok) throw new Error('Preview acknowledgement returned ' + response.status + ': ' + await response.text())
  return true
}

function reportRuntimeFailure(error: unknown, source = 'Scene runtime'): void {
  if (!active || runtimeFailedGeneration === active.generation) return
  const generation = active.generation
  const message = source + ': ' + errorText(error)
  runtimeFailedGeneration = generation
  runtimeFailureMessage = message
  setPhase('failed', 'Runtime paused · save again to retry')
  showNotice('The scene runtime stopped safely. Preview is still watching Blender saves; open Details for diagnostics.', true)
  errorSection.hidden = false
  errorDetail.textContent = message
  generationElement.textContent = 'Generation ' + generation.slice(0, 12) + ' · runtime failed'
  void acknowledge({
    generation,
    phase: 'failed',
    failureKind: 'runtime',
    error: message,
  }).catch(ackError => {
    console.error('Blendlink Preview Studio could not report its runtime failure:', ackError)
  })
}

function disposePresentation(presentation: Presentation): void {
  try {
    presentation.installed.dispose()
  } finally {
    try {
      presentation.renderer.dispose()
    } finally {
      presentation.canvas.remove()
    }
  }
}

async function createPresentation(generation: string, status: StudioStatus): Promise<Presentation> {
  const canvas = document.createElement('canvas')
  canvas.className = 'scene-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.setAttribute('aria-label', SCENE_NAME + ' candidate ' + generation.slice(0, 8))
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault()
    if (active?.canvas === canvas) {
      reportRuntimeFailure(new Error('WebGL context was lost'), 'Renderer')
    }
  })
  viewport.append(canvas)
  const shaderErrors: string[] = []
  const world = new THREE.Scene()
  let renderer: THREE.WebGLRenderer | null = null
  let installed: Awaited<ReturnType<typeof installThreeCompiledScene>> | null = null
  const runtimeWarnings = [...(status.warnings || [])]
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      shaderErrors.push([
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertexShader),
        gl.getShaderInfoLog(fragmentShader),
      ].filter(Boolean).join('\\n'))
    }
    const generated = await import(/* @vite-ignore */ GENERATED_MODULE + '?generation=' + encodeURIComponent(generation))
    const descriptor = generated[SCENE_NAME]
    if (!descriptor || typeof descriptor.url !== 'string') throw new Error('Generated scene descriptor is missing')
    bindPreviewDescriptor(descriptor)
    installed = await installThreeCompiledScene({
      renderer,
      scene: world,
      descriptor,
      createBakedScene,
      useAuthoringPreview: true,
      onWarning(message) {
        // Compiler diagnostics may add a category prefix to the same runtime
        // warning. Show the artist one actionable check, not two spellings of
        // it, while preserving genuinely distinct messages.
        if (!runtimeWarnings.some(existing =>
          existing === message || existing.endsWith(message) || message.endsWith(existing)
        )) runtimeWarnings.push(message)
      },
    })
    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    installed.resize(width, height)
    installed.update(0)
    if ('compileAsync' in renderer) await renderer.compileAsync(world, installed.camera)
    installed.render(0)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (renderer.getContext().isContextLost()) throw new Error('WebGL context was lost while validating the scene')
    if (shaderErrors.length > 0) throw new Error('A material shader did not compile:\\n' + shaderErrors.join('\\n\\n'))
    const camera = installed.camera
    return {
      generation, canvas, renderer, world, installed, descriptor,
      cameraSnapshot: {
        position: camera.position.clone(), quaternion: camera.quaternion.clone(), scale: camera.scale.clone(),
        ...('zoom' in camera ? { zoom: camera.zoom } : {}),
      },
      sourceStatus: status,
      warnings: [...new Set(runtimeWarnings)], lastWidth: width, lastHeight: height,
    }
  } catch (error) {
    try { installed?.dispose() }
    catch (disposeError) { console.warn('Blendlink Preview Studio install cleanup failed:', disposeError) }
    try { renderer?.dispose() }
    catch (disposeError) { console.warn('Blendlink Preview Studio renderer cleanup failed:', disposeError) }
    canvas.remove()
    throw error
  }
}

async function promote(status: StudioStatus): Promise<void> {
  const generation = status.generation
  if (!generation || active?.generation === generation) return
  desiredGeneration = generation
  if (loadingGeneration) {
    queuedPromotion = status
    return
  }
  const retainedAfterFailure = status.phase === 'failed'
  loadingGeneration = generation
  let candidate: Presentation | null = null
  if (!active) {
    firstLoadTitle.textContent = 'Loading your Web Presentation'
    firstLoadDetail.textContent = 'Textures, lighting, and runtime behavior are being verified before the scene appears.'
  }
  try {
    candidate = await createPresentation(generation, status)
    if (disposed || desiredGeneration !== generation) {
      disposePresentation(candidate)
      candidate = null
      return
    }
    // A retained generation represents the last successfully published files
    // after the current Blender save failed. It is useful to show, but must
    // not turn that invalid save into a false ready acknowledgement.
    if (!retainedAfterFailure && !await acknowledge({ generation, phase: 'ready' })) {
      disposePresentation(candidate)
      candidate = null
      return
    }
    if (disposed || desiredGeneration !== generation) {
      disposePresentation(candidate)
      candidate = null
      return
    }
    const previous = active
    candidate.canvas.classList.add('active')
    candidate.canvas.removeAttribute('aria-hidden')
    candidate.canvas.setAttribute('aria-label', SCENE_NAME + ' preview')
    previous?.canvas.classList.remove('active')
    previous?.canvas.setAttribute('aria-hidden', 'true')
    const promoted = candidate
    active = promoted
    runtimeFailedGeneration = ''
    runtimeFailureMessage = ''
    candidate = null
    renderChecks(promoted.warnings)
    renderSceneControls(promoted)
    generationElement.textContent = 'Generation ' + generation.slice(0, 12) +
      (retainedAfterFailure ? ' · last good scene retained' : ' · browser verified')
    firstLoad.hidden = true
    if (!retainedAfterFailure) hideNotice()
    if (previous) {
      try { disposePresentation(previous) }
      catch (error) { console.warn('Blendlink Preview Studio could not completely release the previous scene:', error) }
    }
    if (retainedAfterFailure) {
      setPhase('failed', 'Saved update failed · showing last good scene')
      showNotice('The saved update failed — this is the last good scene. Fix the issue in Blender and save again.', true)
    } else {
      setPhase('ready', 'Ready · updates when you save')
    }
  } catch (error) {
    if (candidate) {
      try { disposePresentation(candidate) }
      catch (disposeError) { console.warn('Blendlink Preview Studio candidate cleanup failed:', disposeError) }
    }
    if (desiredGeneration !== generation) return
    const message = errorText(error)
    setPhase('failed', active ? 'Update failed · showing last good scene' : 'Preview could not render')
    showNotice(active ? 'Update failed — the last good scene is still active. Open Details for the exact error.' : 'The scene could not render. Open Details for the exact error.', true)
    errorSection.hidden = false
    errorDetail.textContent = message
    try {
      await acknowledge({
        generation,
        phase: 'failed',
        failureKind: 'validation',
        ...(active ? { retainedGeneration: active.generation } : {}),
        error: message,
      })
    } catch (ackError) {
      console.error('Blendlink Preview Studio could not report its runtime failure:', ackError)
    }
  } finally {
    loadingGeneration = ''
    const queued = queuedPromotion
    queuedPromotion = null
    if (queued?.generation && queued.generation === desiredGeneration && active?.generation !== queued.generation) {
      void promote(queued)
    }
  }
}

function applyStatus(status: StudioStatus): void {
  latestStatus = status
  const keepActiveDetails = active && (
    status.phase === 'preparing' || status.phase === 'building' || status.phase === 'failed'
  )
  renderChecks(keepActiveDetails ? active.warnings : status.warnings || [])
  renderStats(keepActiveDetails ? active.sourceStatus : status)
  if (status.error) {
    errorSection.hidden = false
    errorDetail.textContent = status.error
  } else if (status.phase !== 'failed') {
    errorSection.hidden = true
    errorDetail.textContent = ''
  }
  if (status.phase === 'preparing' || status.phase === 'building') {
    desiredGeneration = ''
    queuedPromotion = null
    setPhase('building', status.label)
    window.clearTimeout(updateNoticeTimer)
    if (active) updateNoticeTimer = window.setTimeout(() => showNotice('Updating from your saved Blender scene…'), 300)
    else {
      firstLoad.hidden = false
      firstLoadTitle.textContent = status.phase === 'building' ? 'Compiling Preview quality' : 'Preparing Preview Studio'
      firstLoadDetail.textContent = status.label
    }
    return
  }
  window.clearTimeout(updateNoticeTimer)
  if (status.phase === 'failed') {
    const activeRuntimeFailure = Boolean(
      active && status.generation === active.generation && runtimeFailedGeneration === active.generation,
    )
    desiredGeneration = active?.generation || ''
    queuedPromotion = null
    setPhase('failed', activeRuntimeFailure
      ? 'Runtime paused · save again to retry'
      : active ? 'Update failed · showing last good scene' : status.label)
    showNotice(activeRuntimeFailure
      ? 'The scene runtime stopped safely. Preview is still watching Blender saves.'
      : active ? 'Update failed — the last good scene is still active.' : status.label, true)
    if (!active && status.retainedGeneration) {
      void promote({ ...status, generation: status.retainedGeneration })
    }
    if (!active) {
      firstLoad.hidden = false
      firstLoadTitle.textContent = 'The saved scene needs attention'
      firstLoadDetail.textContent = 'Preview is still running. Fix the issue in Blender and save again to recover automatically.'
    }
    return
  }
  if (status.generation && active?.generation !== status.generation) {
    setPhase('published', 'Validating scene in browser…')
    void promote(status)
  } else if (active) {
    if (status.phase === 'published' && status.generation === active.generation) {
      const failed = runtimeFailedGeneration === active.generation
      if (!failed) {
        setPhase('ready', 'Ready · updates when you save')
        hideNotice()
      }
      void acknowledge({
        generation: active.generation,
        phase: failed ? 'failed' : 'ready',
        ...(failed && runtimeFailureMessage ? { error: runtimeFailureMessage } : {}),
      }).catch(error => {
        console.warn('Blendlink Preview Studio could not refresh its ready acknowledgement:', error)
      })
    } else if (runtimeFailedGeneration !== active.generation) {
      setPhase('ready', 'Ready · updates when you save')
      hideNotice()
    }
  }
}

async function pollStatus(): Promise<void> {
  if (disposed) return
  try {
    const response = await fetch(STATUS_URL, { cache: 'no-cache' })
    if (response.ok) {
      const status = await response.json() as StudioStatus
      if (status.schemaVersion !== 1 || status.sessionId !== SESSION_ID) throw new Error('Preview status belongs to another session')
      const recovered = statusConnectionLost
      statusPollFailures = 0
      statusConnectionLost = false
      if (status.sequence > lastSequence || recovered) {
        lastSequence = status.sequence
        applyStatus(status)
      }
    } else throw new Error('Preview status returned ' + response.status)
  } catch (error) {
    console.warn('Blendlink Preview Studio status retry:', error)
    statusPollFailures += 1
    if (statusPollFailures >= 3 && active && runtimeFailedGeneration !== active.generation) {
      statusConnectionLost = true
      setPhase('failed', 'Preview connection lost · retrying')
      showNotice('Preview lost its local update connection and is retrying automatically.', true)
    }
  } finally {
    if (!disposed) {
      const busy = latestStatus?.phase === 'preparing' || latestStatus?.phase === 'building' || latestStatus?.phase === 'published'
      window.setTimeout(() => void pollStatus(), busy ? 300 : 1000)
    }
  }
}

function frame(now: number): void {
  if (disposed) return
  // Schedule first so one component/runtime exception cannot permanently
  // kill polling-era recovery or the render loop for the next good save.
  animationFrame = requestAnimationFrame(frame)
  const deltaSeconds = Math.max(0, Math.min(.1, (now - previousTime) / 1000))
  previousTime = now
  if (active && runtimeFailedGeneration !== active.generation) {
    try {
      const width = Math.max(1, viewport.clientWidth)
      const height = Math.max(1, viewport.clientHeight)
      if (width !== active.lastWidth || height !== active.lastHeight) {
        active.installed.resize(width, height)
        active.lastWidth = width; active.lastHeight = height
      }
      if (!paused) active.installed.update(deltaSeconds)
      active.installed.render(deltaSeconds)
    } catch (error) {
      reportRuntimeFailure(error)
    }
  }
}

element<HTMLButtonElement>('pause').addEventListener('click', event => {
  paused = !paused
  const button = event.currentTarget as HTMLButtonElement
  button.textContent = paused ? 'Play' : 'Pause'
  button.title = paused ? 'Resume animation' : 'Pause animation'
  button.setAttribute('aria-pressed', String(paused))
})
element<HTMLButtonElement>('reset').addEventListener('click', () => {
  if (!active) return
  if (active.installed.cameraController) {
    active.installed.cameraController.reset()
    return
  }
  const camera = active.installed.camera
  camera.position.copy(active.cameraSnapshot.position)
  camera.quaternion.copy(active.cameraSnapshot.quaternion)
  camera.scale.copy(active.cameraSnapshot.scale)
  if (active.cameraSnapshot.zoom !== undefined && 'zoom' in camera) camera.zoom = active.cameraSnapshot.zoom
  camera.updateProjectionMatrix()
})
element<HTMLButtonElement>('background').addEventListener('click', event => {
  const modes = ['dark', 'checker', 'light']
  const current = modes.indexOf(studio.dataset.background || 'dark')
  const next = modes[(current + 1) % modes.length]
  studio.dataset.background = next
  const button = event.currentTarget as HTMLButtonElement
  button.title = 'Background: ' + next + '. Cycle dark, checker, and light.'
  button.setAttribute('aria-label', 'Background: ' + next)
})
element<HTMLButtonElement>('fullscreen').addEventListener('click', () => {
  const change = document.fullscreenElement ? document.exitFullscreen() : studio.requestFullscreen()
  void change.catch(error => showNotice('Fullscreen is unavailable: ' + errorText(error), true))
})
document.addEventListener('fullscreenchange', () => {
  element<HTMLButtonElement>('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'
})
function setDrawer(open: boolean): void {
  drawer.hidden = !open
  element<HTMLButtonElement>('details').setAttribute('aria-expanded', String(open))
}
element<HTMLButtonElement>('details').addEventListener('click', () => setDrawer(drawer.hidden))
element<HTMLButtonElement>('close-details').addEventListener('click', () => setDrawer(false))
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-viewport]')) {
  button.addEventListener('click', () => {
    studio.dataset.viewport = button.dataset.viewport || 'fill'
    for (const sibling of document.querySelectorAll<HTMLButtonElement>('button[data-viewport]')) {
      sibling.setAttribute('aria-pressed', String(sibling === button))
    }
  })
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !drawer.hidden && !document.fullscreenElement) setDrawer(false)
})
window.addEventListener('error', event => {
  if (!active) return
  reportRuntimeFailure(event.error || new Error(event.message), 'Browser')
})
window.addEventListener('unhandledrejection', event => {
  if (!active) return
  reportRuntimeFailure(event.reason, 'Runtime task')
})
window.addEventListener('beforeunload', () => {
  disposed = true
  cancelAnimationFrame(animationFrame)
  if (active) disposePresentation(active)
}, { once: true })

void pollStatus()
animationFrame = requestAnimationFrame(frame)
`
}

export function ensurePreviewStudioControl(plan: PreviewStudioHostPlan): PreviewStudioControl {
  const path = join(plan.workspace, 'public', PREVIEW_STUDIO_CONTROL)
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PreviewStudioControl>
      if (value.schemaVersion === 1 && value.sessionId === plan.sessionId
          && typeof value.token === 'string' && value.token.length >= 32) {
        return value as PreviewStudioControl
      }
    } catch {
      // This is a cache-owned control secret. Invalid bytes are replaced only
      // after the workspace's separate ownership marker has been verified.
    }
  }
  const control: PreviewStudioControl = {
    schemaVersion: 1,
    sessionId: plan.sessionId,
    token: randomBytes(32).toString('hex'),
  }
  writeTextAtomic(path, JSON.stringify(control, null, 2) + '\n')
  return control
}

/** Begin a fresh browser-verification epoch for one CLI run.
 *
 * Generation hashes are content identities, so an unchanged scene can reuse
 * the same hash across Preview Studio restarts. An acknowledgement left by a
 * prior browser must not make that new run appear browser-verified before a
 * current page has rendered it. Call this only after publishing a non-ACKable
 * `preparing` status; the Vite middleware will then reject any old page racing
 * to recreate the file until the next generation is published. */
export function clearPreviewStudioAcknowledgement(plan: PreviewStudioHostPlan): void {
  const path = join(plan.workspace, 'public', PREVIEW_STUDIO_ACK)
  if (existsSync(path)) unlinkSync(path)
}

export function readPreviewStudioGeneration(plan: PreviewStudioHostPlan): string | undefined {
  const path = join(plan.workspace, 'src', 'generated', `${plan.sceneName}.manifest.json`)
  if (!existsSync(path)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { hash?: unknown }
    return typeof manifest.hash === 'string' && manifest.hash.length > 0 ? manifest.hash : undefined
  } catch {
    return undefined
  }
}

/** Read the last complete cache-owned status before a new run replaces it
 * with `preparing`. This lets an unchanged first check retain the report for
 * the generation that a prior Preview run actually compiled. */
export function readPreviewStudioStatus(plan: PreviewStudioHostPlan): PreviewStudioStatus | undefined {
  const path = join(plan.workspace, 'public', PREVIEW_STUDIO_STATUS)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PreviewStudioStatus>
    return value.schemaVersion === 1 && value.sessionId === plan.sessionId
      ? value as PreviewStudioStatus
      : undefined
  } catch {
    return undefined
  }
}

export class PreviewStudioStatusWriter {
  readonly path: string
  private sequence = 0
  private activeGeneration: string | undefined

  constructor(private readonly plan: PreviewStudioHostPlan) {
    this.path = join(plan.workspace, 'public', PREVIEW_STUDIO_STATUS)
    const prior = readPreviewStudioStatus(plan)
    if (prior) {
      this.sequence = Number.isInteger(prior.sequence) ? Number(prior.sequence) : 0
      this.activeGeneration = prior.phase === 'ready' ? prior.generation : prior.retainedGeneration
    }
  }

  write(input: Omit<PreviewStudioStatus,
    'schemaVersion' | 'sequence' | 'sessionId' | 'sceneName' | 'blendPath' | 'updatedAt' | 'warnings'> & {
      warnings?: readonly string[]
    }): PreviewStudioStatus {
    if (input.phase === 'ready' && input.generation) this.activeGeneration = input.generation
    if (input.phase === 'failed' && input.failureKind === 'runtime'
        && input.generation === this.activeGeneration) {
      // A post-ready runtime failure invalidates the active generation itself;
      // do not relabel those same broken bytes as a retained last-good scene.
      this.activeGeneration = undefined
    }
    const status: PreviewStudioStatus = {
      schemaVersion: 1,
      sequence: ++this.sequence,
      sessionId: this.plan.sessionId,
      sceneName: this.plan.sceneName,
      blendPath: this.plan.blendPath,
      ...input,
      ...(input.retainedGeneration
        ? { retainedGeneration: input.retainedGeneration }
        : this.activeGeneration && input.phase !== 'ready'
          ? { retainedGeneration: this.activeGeneration }
          : {}),
      warnings: [...(input.warnings ?? [])],
      updatedAt: new Date().toISOString(),
    }
    writeTextAtomic(this.path, JSON.stringify(status, null, 2) + '\n')
    return status
  }
}

export function watchPreviewStudioAcknowledgements(
  plan: PreviewStudioHostPlan,
  onAck: (ack: PreviewStudioClientAck) => void,
  intervalMs = 200,
): { close(): void } {
  const path = join(plan.workspace, 'public', PREVIEW_STUDIO_ACK)
  let lastBytes = ''
  let closed = false
  const poll = (): void => {
    if (closed || !existsSync(path)) return
    try {
      const bytes = readFileSync(path, 'utf8')
      if (bytes === lastBytes) return
      const value = JSON.parse(bytes) as Partial<PreviewStudioClientAck>
      if (value.schemaVersion !== 1 || value.sessionId !== plan.sessionId
          || typeof value.generation !== 'string' || value.generation.length === 0
          || (value.phase !== 'ready' && value.phase !== 'failed')) return
      lastBytes = bytes
      onAck({
        schemaVersion: 1,
        sessionId: plan.sessionId,
        generation: value.generation,
        phase: value.phase,
        ...(typeof value.retainedGeneration === 'string'
          ? { retainedGeneration: value.retainedGeneration }
          : {}),
        ...(typeof value.error === 'string' ? { error: value.error } : {}),
        updatedAt: typeof value.updatedAt === 'string'
          ? value.updatedAt
          : new Date().toISOString(),
      })
    } catch {
      // The Vite middleware may be between write syscalls; retry next tick.
    }
  }
  poll()
  const timer = setInterval(poll, intervalMs)
  return {
    close() {
      closed = true
      clearInterval(timer)
    },
  }
}
