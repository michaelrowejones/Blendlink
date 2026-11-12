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
import type { CompileProgress } from './progress.js'

export const PREVIEW_STUDIO_STATUS = '.blendlink-preview-status.json'
export const PREVIEW_STUDIO_CONTROL = '.blendlink-preview-control.json'
export const PREVIEW_STUDIO_ACK = '.blendlink-preview-ack.json'
export const PREVIEW_STUDIO_CLIENT_PREFIX = '##blendlink-preview-client '
export const PREVIEW_STUDIO_HOST_VERSION = 17
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
  compileProgress?: CompileProgress & { startedAt: number; stageStartedAt: number }
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
  /** A newly installed renderer, not an old tab's periodic ready heartbeat. */
  recovery?: true
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
    // Windows readers (including the live viewer) can briefly prevent a
    // replacement. Keep the previous complete snapshot available throughout
    // a bounded retry; never unlink it or expose a partially written status.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temporaryPath, path)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 6) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * 2 ** attempt)
      }
    }
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
    <section id="viewport" aria-label="Blendlink Web Presentation"><img id="reference-image" alt="Blender reference render" hidden></section>
    <header class="studio-bar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Blendlink</span><span class="muted">Preview Studio</span></div>
      <div id="status-chip" class="status-chip" role="status"><span class="status-dot"></span><span id="status-label">Opening preview…</span></div>
      <nav class="toolbar" aria-label="Preview controls">
        <button id="pause" type="button" title="Pause animation" aria-pressed="false">Pause</button>
        <button id="reset" type="button" title="Reset authored camera">Reset view</button>
        <button id="inspect" type="button" title="Pause playback and orbit around the scene without changing Blender" aria-pressed="false">Inspect</button>
        <button id="mobile" type="button" title="Check phone framing" aria-pressed="false">Phone</button>
        <button id="capture" type="button" title="Save the current rendered view as a PNG">Save image</button>
        <button id="compare" type="button" title="Compare with a Blender render">Compare</button>
        <button id="background" type="button" title="Background: dark. Cycle dark, checker, and light." aria-label="Background: dark">Background</button>
        <button id="fullscreen" type="button" title="Enter fullscreen">Fullscreen</button>
        <button id="details" type="button" aria-expanded="false" aria-controls="drawer">Details</button>
      </nav>
    </header>
    <input id="reference-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <section id="comparison-controls" class="comparison-controls" hidden aria-label="Render comparison">
      <span id="reference-name"></span>
      <label>Blender <input id="comparison-split" type="range" min="0" max="100" value="50" aria-label="Blender reference coverage"> Three.js</label>
      <label><input id="comparison-difference" type="checkbox"> Difference view</label>
      <button id="comparison-close" type="button">Close comparison</button>
    </section>
    <section id="first-load" class="first-load" aria-live="polite">
      <div class="loader-mark" aria-hidden="true"></div>
      <p id="first-load-title">Preparing your Web Presentation</p>
      <p id="first-load-detail">The preview opens now and updates whenever you save in Blender.</p>
    </section>
    <section id="notice" class="notice" hidden aria-live="assertive">
      <p id="notice-message"></p>
      <div id="notice-actions" class="notice-actions" hidden>
        <button id="retry-preview" type="button" hidden>Retry preview</button>
        <button id="failure-details" type="button">View error details</button>
      </div>
    </section>
    <aside id="drawer" class="drawer" hidden>
      <div class="drawer-heading"><div><strong id="scene-name">Scene</strong><div id="generation" class="muted">Waiting for first generation</div></div><button id="close-details" type="button" aria-label="Close details">×</button></div>
      <div class="viewport-presets" aria-label="Responsive viewport">
        <button type="button" data-viewport="fill" aria-pressed="true">Fit window</button>
        <button type="button" data-viewport="desktop" aria-pressed="false">Desktop</button>
        <button type="button" data-viewport="mobile" aria-pressed="false">Mobile</button>
      </div>
      <section id="compile-progress" class="drawer-section" hidden>
        <h2>Compile progress</h2><p id="compile-stage" aria-live="polite"></p>
        <progress id="compile-meter" max="1" aria-label="Compile stages completed"></progress>
        <p id="compile-timing" class="muted"></p><p id="compile-device" class="muted"></p>
      </section>
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
button { white-space: nowrap; appearance: none; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: inherit; background: rgba(15,19,26,.78); padding: 8px 11px; font: inherit; font-size: 12px; cursor: pointer; backdrop-filter: blur(18px); }
button:hover { background: rgba(38,46,57,.9); border-color: rgba(110,231,199,.34); }
button[data-active], button[aria-pressed="true"] { border-color: rgba(110,231,199,.48); background: rgba(38,73,69,.88); }
button:focus-visible { outline: 2px solid #6ee7c7; outline-offset: 2px; }
#studio { position: relative; display: grid; place-items: center; background: #11151d; }
#studio[data-background="checker"] { background-color: #141921; background-image: linear-gradient(45deg,#1d2430 25%,transparent 25%),linear-gradient(-45deg,#1d2430 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1d2430 75%),linear-gradient(-45deg,transparent 75%,#1d2430 75%); background-size: 28px 28px; background-position: 0 0,0 14px,14px -14px,-14px 0; }
#studio[data-background="light"] { background: #cbd2d1; }
#viewport { position: relative; width: 100%; height: 100%; overflow: hidden; box-shadow: 0 28px 80px rgba(0,0,0,.28); transition: width .22s ease, height .22s ease, border-radius .22s ease; }
#studio[data-viewport="desktop"] #viewport { width: min(92vw, 131.2vh, 1440px); height: auto; aspect-ratio: 16 / 10; border-radius: 12px; }
#studio[data-viewport="mobile"] #viewport { width: min(88vw, 41vh, 430px); height: auto; aspect-ratio: 1 / 2; border-radius: 18px; }
.scene-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; pointer-events: none; }
.scene-canvas.active { opacity: 1; pointer-events: auto; }
#reference-image { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; }
.comparison-controls { position: fixed; z-index: 22; left: 18px; bottom: 18px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; max-width: calc(100vw - 36px); background: rgba(10,13,18,.94); border-radius: 10px; padding: 12px; font-size: 12px; }
.comparison-controls[hidden], #reference-image[hidden] { display: none; }
.comparison-controls label { display: flex; align-items: center; gap: 6px; }
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
.notice { width: max-content; }
.notice p { margin: 0; }
#compile-meter { width: 100%; accent-color: #6ee7c7; }
#compile-progress p { font-size: 12px; line-height: 1.45; }
.first-load #first-load-detail { white-space: pre-line; }
.notice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.notice-actions[hidden], .notice-actions button[hidden] { display: none; }
button:disabled { opacity: .45; cursor: default; }
.first-load[data-state="failed"] .loader-mark { animation: none; background: #ff8d86; box-shadow: none; }
.first-load[data-state="failed"] #first-load-detail { max-height: 30vh; overflow: auto; white-space: pre-wrap; text-align: left; color: #ffc1bd; overflow-wrap: anywhere; }
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
@media (max-width: 1100px) { .studio-bar { top: 10px; left: 10px; right: 10px; grid-template-columns: 1fr auto; }.status-chip { order: 3; grid-column: 1/-1; }.brand .muted { display: none; }.toolbar { position: fixed; left: 10px; right: 10px; bottom: 10px; justify-content: flex-start; overflow-x: auto; padding: 3px; }.toolbar button { display: block; flex: 0 0 auto; }.notice { bottom: 66px; }.drawer { bottom: 66px; } }
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
            const retryingValidation = status.phase === 'failed' &&
              (status.failureKind === 'validation' || status.failureKind === 'runtime')
            if (!generation || status.generation !== generation ||
                (status.phase !== 'published' && status.phase !== 'ready' && !retryingValidation)) {
              response.statusCode = 409
              response.end('Preview generation is no longer current')
              return
            }
            const ack = {
              schemaVersion: 1,
              sessionId: control.sessionId,
              generation,
              phase: payload.phase,
              ...(payload.phase === 'ready' && payload.recovery === true ? { recovery: true } : {}),
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
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
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
  compileProgress?: { fraction: number; label: string; startedAt: number; stageStartedAt: number; device?: 'cpu' | 'gpu'; backend?: string; samples?: number }
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
  renderer: WebGPURenderer
  world: THREE.Scene
  installed: Awaited<ReturnType<typeof installThreeCompiledScene>>
  cameraSnapshot: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; zoom?: number }
  descriptor: any
  sourceStatus: StudioStatus
  warnings: string[]
  lastWidth: number
  lastHeight: number
  inspection?: OrbitControls
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
const noticeMessage = element<HTMLElement>('notice-message')
const noticeActions = element<HTMLElement>('notice-actions')
const retryButton = element<HTMLButtonElement>('retry-preview')
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
let failedLoad: StudioStatus | null = null
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
let loadAttempt = 0

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setPhase(phase: StudioStatus['phase'], label: string): void {
  statusChip.dataset.phase = phase
  statusLabel.textContent = label
}

function showNotice(message: string, error = false): void {
  noticeMessage.textContent = message
  noticeActions.hidden = !error
  notice.classList.toggle('error', error)
  notice.hidden = false
}

function hideNotice(): void {
  notice.hidden = true
  notice.classList.remove('error')
}

function renderCompileProgress(): void {
  if (statusConnectionLost) return
  const progress = latestStatus?.compileProgress
  const building = latestStatus?.phase === 'building'
  element<HTMLElement>('compile-progress').hidden = !progress || !building
  if (!progress || !building) return
  const seconds = (start: number) => Math.max(0, Math.floor((Date.now() - start) / 1000))
  const duration = (value: number) => value < 60 ? value + 's' : Math.floor(value / 60) + 'm ' + value % 60 + 's'
  const elapsed = seconds(progress.startedAt)
  const timing = duration(elapsed) + ' elapsed · ' + duration(seconds(progress.stageStartedAt)) + ' in this stage'
  const device = progress.device
    ? 'Cycles: ' + (progress.device === 'cpu' ? 'CPU' : (progress.backend ? progress.backend.toUpperCase() + ' GPU' : 'GPU'))
      + (progress.samples ? ' · ' + progress.samples + ' samples' : '')
    : 'Preparing on CPU · Cycles device not selected yet'
  element<HTMLElement>('compile-stage').textContent = progress.label
  element<HTMLProgressElement>('compile-meter').value = progress.fraction
  element<HTMLElement>('compile-timing').textContent = timing
  element<HTMLElement>('compile-device').textContent = device
  statusLabel.textContent = 'Compiling · ' + duration(elapsed)
  if (!active) {
    firstLoadTitle.textContent = progress.label
    firstLoadDetail.textContent = timing + '\\n' + device
  }
}

function updateRecoveryControls(): void {
  const failure = failedLoad || latestStatus
  const retryable = failure?.phase === 'failed' && (failure.failureKind === 'validation' || failure.failureKind === 'runtime')
    && failure.generation === latestStatus?.generation
    && (latestStatus?.phase === 'published' || latestStatus?.phase === 'ready'
      || (latestStatus?.phase === 'failed' && (latestStatus.failureKind === 'validation' || latestStatus.failureKind === 'runtime')))
  retryButton.hidden = !retryable
  retryButton.disabled = Boolean(loadingGeneration) || !retryable
  retryButton.textContent = loadingGeneration ? 'Retrying…' : 'Retry preview'
  const usable = Boolean(active && runtimeFailedGeneration !== active.generation)
  element<HTMLButtonElement>('pause').disabled = !usable || Boolean(active?.inspection)
  element<HTMLButtonElement>('reset').disabled = !usable
  element<HTMLButtonElement>('inspect').disabled = !usable
  element<HTMLButtonElement>('capture').disabled = !usable
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
  recovery?: true
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
  if (disposed || !active || runtimeFailedGeneration === active.generation) return
  const generation = active.generation
  const message = source + ': ' + errorText(error)
  runtimeFailedGeneration = generation
  runtimeFailureMessage = message
  failedLoad = { ...active.sourceStatus, phase: 'failed', failureKind: 'runtime', error: message }
  updateRecoveryControls()
  setPhase('failed', 'Runtime paused · retry preview')
  showNotice('The scene runtime stopped safely. Retry preview to recreate the renderer, or open Details for diagnostics.', true)
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
  presentation.inspection?.dispose()
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
  const shaderChecks: Promise<void>[] = []
  const world = new THREE.Scene()
  let renderer: WebGPURenderer | null = null
  let deviceLoss: string | null = null
  let validationDevice: { pushErrorScope(type: 'validation'): void; popErrorScope(): Promise<{ message: string } | null> } | undefined
  let validationScopeOpen = false
  let installed: Awaited<ReturnType<typeof installThreeCompiledScene>> | null = null
  const runtimeWarnings = [...(status.warnings || [])]
  try {
    renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true,
      forceWebGL: new URLSearchParams(location.search).get('backend') === 'webgl2' })
    renderer.onDeviceLost = info => {
      deviceLoss = info.message || 'Graphics device was lost'
      if (active?.canvas === canvas) reportRuntimeFailure(new Error(deviceLoss), 'Renderer')
    }
    await renderer.init()
    validationDevice = (renderer.backend as unknown as { device?: typeof validationDevice }).device
    if (validationDevice) {
      validationDevice.pushErrorScope('validation')
      validationScopeOpen = true
    }
    // Three owns inner GPU validation scopes and logs some pipeline failures
    // without rejecting compileAsync. Inspect each module's public compilation
    // result as well, before allowing this candidate to replace the live view.
    const shaderDevice = validationDevice as unknown as {
      createShaderModule(descriptor: unknown): {
        getCompilationInfo(): Promise<{ messages: { type: string; message: string; lineNum: number }[] }>
      }
      createRenderPipeline(descriptor: unknown): unknown
      createRenderPipelineAsync(descriptor: unknown): Promise<unknown>
    } | undefined
    if (shaderDevice) {
      const recordShaderError = (detail: string): void => {
        shaderErrors.push(detail)
        if (active?.canvas === canvas) reportRuntimeFailure(new Error(detail), 'Shader')
      }
      const createModule = shaderDevice.createShaderModule.bind(shaderDevice)
      shaderDevice.createShaderModule = descriptor => {
        const module = createModule(descriptor)
        shaderChecks.push(module.getCompilationInfo().then(info => {
          for (const message of info.messages) {
            if (message.type !== 'error') continue
            const detail = 'Line ' + message.lineNum + ': ' + message.message
            recordShaderError(detail)
          }
        }).catch(error => recordShaderError(error instanceof Error ? error.message : String(error))))
        return module
      }
      const createPipeline = shaderDevice.createRenderPipeline.bind(shaderDevice)
      shaderDevice.createRenderPipeline = descriptor => {
        validationDevice!.pushErrorScope('validation')
        try { return createPipeline(descriptor) }
        finally {
          shaderChecks.push(validationDevice!.popErrorScope().then(error => {
            if (error) recordShaderError(error.message)
          }).catch(error => recordShaderError(error instanceof Error ? error.message : String(error))))
        }
      }
      const createPipelineAsync = shaderDevice.createRenderPipelineAsync.bind(shaderDevice)
      shaderDevice.createRenderPipelineAsync = descriptor => createPipelineAsync(descriptor).catch(error => {
        recordShaderError(error instanceof Error ? error.message : String(error))
        throw error
      })
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      shaderErrors.push([
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertexShader),
        gl.getShaderInfoLog(fragmentShader),
      ].filter(Boolean).join('\\n'))
    }
    const generated = await import(/* @vite-ignore */ GENERATED_MODULE + '?generation=' + encodeURIComponent(generation) + '&attempt=' + (++loadAttempt))
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
    await Promise.all(shaderChecks)
    shaderChecks.length = 0
    if (validationScopeOpen) {
      validationScopeOpen = false
      const validationError = await validationDevice!.popErrorScope()
      if (validationError) throw new Error('GPU shader or render validation failed: ' + validationError.message)
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (deviceLoss) throw new Error(deviceLoss)
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
    if (validationScopeOpen) {
      validationScopeOpen = false
      try { await validationDevice!.popErrorScope() } catch { /* retain the original failure */ }
    }
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
  if (!generation || (active?.generation === generation && runtimeFailedGeneration !== generation)) return
  desiredGeneration = generation
  if (loadingGeneration) {
    queuedPromotion = status
    return
  }
  const retainedAfterFailure = status.phase === 'failed'
  loadingGeneration = generation
  failedLoad = null
  firstLoad.dataset.state = 'loading'
  updateRecoveryControls()
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
    if (!retainedAfterFailure && !await acknowledge({ generation, phase: 'ready',
      ...(status.failureKind === 'runtime' ? { recovery: true as const } : {}),
    })) {
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
    if (inspecting) {
      const sameCamera = previous && previous.cameraSnapshot.position.equals(promoted.cameraSnapshot.position)
        && previous.cameraSnapshot.quaternion.equals(promoted.cameraSnapshot.quaternion)
        && previous.cameraSnapshot.zoom === promoted.cameraSnapshot.zoom
      if (sameCamera) {
        promoted.installed.camera.position.copy(previous.installed.camera.position)
        promoted.installed.camera.quaternion.copy(previous.installed.camera.quaternion)
        if ('zoom' in promoted.installed.camera && 'zoom' in previous.installed.camera) {
          promoted.installed.camera.zoom = previous.installed.camera.zoom
          promoted.installed.camera.updateProjectionMatrix()
        }
      }
      startInspection(promoted, sameCamera ? previous?.inspection?.target : undefined)
    }
    runtimeFailedGeneration = ''
    runtimeFailureMessage = ''
    candidate = null
    renderChecks(promoted.warnings)
    renderSceneControls(promoted)
    generationElement.textContent = 'Generation ' + generation.slice(0, 12) +
      (retainedAfterFailure ? ' · last good scene retained' : ' · browser verified')
    firstLoad.hidden = true
    if (!retainedAfterFailure) {
      hideNotice()
      errorSection.hidden = true
      errorDetail.textContent = ''
    }
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
    const retained = active && runtimeFailedGeneration !== active.generation ? active : null
    if (!retainedAfterFailure) failedLoad = { ...status, phase: 'failed', failureKind: 'validation', error: message }
    setPhase('failed', retained ? 'Update failed · showing last good scene' : 'Preview could not render')
    showNotice(retained ? 'Update failed — the last good scene is still active. Open Details for the exact error.' : 'The scene could not render. Open Details for the exact error.', true)
    errorSection.hidden = false
    errorDetail.textContent = message
    if (!active) {
      firstLoad.hidden = false
      firstLoad.dataset.state = 'failed'
      firstLoadTitle.textContent = 'Preview could not load'
      firstLoadDetail.textContent = message
    }
    try {
      await acknowledge({
        generation,
        phase: 'failed',
        failureKind: 'validation',
        ...(retained ? { retainedGeneration: retained.generation } : {}),
        error: message,
      })
    } catch (ackError) {
      console.error('Blendlink Preview Studio could not report its runtime failure:', ackError)
    }
  } finally {
    loadingGeneration = ''
    updateRecoveryControls()
    const queued = queuedPromotion
    queuedPromotion = null
    if (queued?.generation && queued.generation === desiredGeneration &&
        (active?.generation !== queued.generation || runtimeFailedGeneration === queued.generation)) {
      void promote(queued)
    }
  }
}

function applyStatus(status: StudioStatus): void {
  latestStatus = status
  element<HTMLElement>('compile-progress').hidden = status.phase !== 'building'
  if (status.phase === 'preparing' || status.phase === 'building'
      || status.generation !== failedLoad?.generation
      || (status.phase === 'failed' && status.failureKind !== 'validation')) failedLoad = null
  updateRecoveryControls()
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
    firstLoad.dataset.state = 'loading'
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
    renderCompileProgress()
    return
  }
  window.clearTimeout(updateNoticeTimer)
  if (status.phase === 'failed') {
    const activeRuntimeFailure = Boolean(
      active && runtimeFailedGeneration === active.generation,
    )
    desiredGeneration = active?.generation || ''
    queuedPromotion = null
    setPhase('failed', activeRuntimeFailure
      ? 'Runtime paused · retry preview'
      : active ? 'Update failed · showing last good scene' : 'Preview needs attention')
    showNotice(activeRuntimeFailure
      ? 'The scene runtime stopped safely. Retry preview to recreate the renderer.'
      : active ? 'Update failed. The last good scene is still active.'
      : status.failureKind === 'validation' || status.failureKind === 'runtime'
        ? 'The scene could not load in this browser. Retry preview, or open the error details.'
        : 'Fix the reported issue in Blender and save. Preview will update automatically.', true)
    if (!active && status.retainedGeneration) {
      void promote({ ...status, generation: status.retainedGeneration })
    }
    if (!active) {
      firstLoad.hidden = false
      firstLoad.dataset.state = 'failed'
      firstLoadTitle.textContent = status.failureKind === 'validation' || status.failureKind === 'runtime' ? 'Preview could not load' : 'The saved scene needs attention'
      firstLoadDetail.textContent = status.error || status.label
    }
    return
  }
  if (status.generation && (active?.generation !== status.generation ||
      (status.phase === 'published' && runtimeFailedGeneration === status.generation))) {
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
      if (!paused && !active.inspection) active.installed.update(deltaSeconds)
      active.inspection?.update()
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
function resetView(): void {
  if (!active) return
  stopInspection()
  if (active.installed.cameraController?.interactive) {
    active.installed.cameraController.reset()
    return
  }
  const camera = active.installed.camera
  camera.position.copy(active.cameraSnapshot.position)
  camera.quaternion.copy(active.cameraSnapshot.quaternion)
  camera.scale.copy(active.cameraSnapshot.scale)
  if (active.cameraSnapshot.zoom !== undefined && 'zoom' in camera) camera.zoom = active.cameraSnapshot.zoom
  camera.updateProjectionMatrix()
}
element<HTMLButtonElement>('reset').addEventListener('click', resetView)

let inspecting = false
function startInspection(presentation: Presentation, target?: THREE.Vector3): void {
  presentation.inspection?.dispose()
  const camera = presentation.installed.camera
  const controls = new OrbitControls(camera, presentation.canvas)
  const sphere = new THREE.Box3().setFromObject(presentation.installed.root).getBoundingSphere(new THREE.Sphere())
  const direction = camera.getWorldDirection(new THREE.Vector3())
  const distance = Math.max(sphere.radius * .05, sphere.center.clone().sub(camera.position).dot(direction), .01)
  controls.target.copy(target || camera.position.clone().addScaledVector(direction, distance))
  controls.enableDamping = true
  controls.update()
  presentation.inspection = controls
  updateRecoveryControls()
}
function stopInspection(): void {
  inspecting = false
  active?.inspection?.dispose()
  if (active) active.inspection = undefined
  element<HTMLButtonElement>('inspect').setAttribute('aria-pressed', 'false')
  if (noticeMessage.textContent?.startsWith('Inspecting ·')) hideNotice()
  updateRecoveryControls()
}
element<HTMLButtonElement>('inspect').addEventListener('click', () => {
  if (!active) return
  if (inspecting) { resetView(); return }
  if (active.installed.cameraController?.interactive) {
    showNotice('This scene already has authored camera controls. Drag in the preview to explore it.')
    return
  }
  inspecting = true
  startInspection(active)
  element<HTMLButtonElement>('inspect').setAttribute('aria-pressed', 'true')
  showNotice('Inspecting · drag to orbit, scroll to zoom. Reset view returns to your Blender camera.')
})
element<HTMLButtonElement>('capture').addEventListener('click', () => {
  if (!active) return
  try {
    active.installed.render(0)
    active.canvas.toBlob(blob => {
      if (!blob) { showNotice('The browser could not capture this frame.', true); return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = SCENE_NAME + '-preview.png'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  } catch (error) { showNotice('Could not save the image: ' + errorText(error), true) }
})

const referenceImage = element<HTMLImageElement>('reference-image')
const referenceFile = element<HTMLInputElement>('reference-file')
const comparisonSplit = element<HTMLInputElement>('comparison-split')
const comparisonDifference = element<HTMLInputElement>('comparison-difference')
let referenceUrl: string | null = null
function resizeReference(): void {
  if (referenceImage.hidden || !referenceImage.naturalWidth) return
  const ratio = referenceImage.naturalWidth / referenceImage.naturalHeight
  const width = Math.min(window.innerWidth * .92, window.innerHeight * .82 * ratio)
  viewport.style.width = width + 'px'
  viewport.style.height = (width / ratio) + 'px'
}
function updateComparison(): void {
  referenceImage.style.clipPath = comparisonDifference.checked ? 'none' : 'inset(0 ' + (100 - Number(comparisonSplit.value)) + '% 0 0)'
  referenceImage.style.mixBlendMode = comparisonDifference.checked ? 'difference' : 'normal'
  comparisonSplit.disabled = comparisonDifference.checked
}
function closeComparison(): void {
  referenceImage.onload = null
  referenceImage.onerror = null
  referenceImage.hidden = true
  referenceImage.removeAttribute('src')
  element<HTMLElement>('comparison-controls').hidden = true
  viewport.style.removeProperty('width')
  viewport.style.removeProperty('height')
  if (referenceUrl) URL.revokeObjectURL(referenceUrl)
  referenceUrl = null
  referenceFile.value = ''
}
element<HTMLButtonElement>('compare').addEventListener('click', () => referenceFile.click())
referenceFile.addEventListener('change', () => {
  const file = referenceFile.files?.[0]
  if (!file) return
  closeComparison()
  referenceUrl = URL.createObjectURL(file)
  referenceImage.onload = () => {
    referenceImage.hidden = false
    element<HTMLElement>('comparison-controls').hidden = false
    element<HTMLElement>('reference-name').textContent = file.name + ' · use the same saved frame'
    if (!paused) element<HTMLButtonElement>('pause').click()
    element<HTMLButtonElement>('reset').click()
    resizeReference()
    updateComparison()
  }
  referenceImage.onerror = () => { closeComparison(); showNotice('The reference image could not be decoded.', true) }
  referenceImage.src = referenceUrl
})
comparisonSplit.addEventListener('input', updateComparison)
comparisonDifference.addEventListener('change', updateComparison)
element<HTMLButtonElement>('comparison-close').addEventListener('click', closeComparison)
window.addEventListener('resize', resizeReference)
window.addEventListener('beforeunload', closeComparison)
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
  element<HTMLButtonElement>(open ? 'close-details' : 'details').focus()
}
element<HTMLButtonElement>('failure-details').addEventListener('click', () => {
  setDrawer(true)
  errorSection.scrollIntoView({ block: 'nearest' })
})
retryButton.addEventListener('click', () => {
  const failure = failedLoad || latestStatus
  if (loadingGeneration || retryButton.hidden || retryButton.disabled || !failure) return
  // Reinstall this compiled generation. No Blender save or bake is needed.
  // Only browser validation/runtime failures can retry; compile failures need a new save.
  showNotice('Retrying browser loading and validation…')
  setPhase('published', 'Retrying preview…')
  void promote({ ...failure, phase: 'published' })
})
element<HTMLButtonElement>('details').addEventListener('click', () => setDrawer(drawer.hidden))
element<HTMLButtonElement>('close-details').addEventListener('click', () => setDrawer(false))
function setViewport(name: string): void {
  studio.dataset.viewport = name
  element<HTMLButtonElement>('mobile').setAttribute('aria-pressed', String(name === 'mobile'))
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-viewport]')) {
    button.setAttribute('aria-pressed', String(button.dataset.viewport === name))
  }
}
element<HTMLButtonElement>('mobile').addEventListener('click', () => {
  setViewport(studio.dataset.viewport === 'mobile' ? 'fill' : 'mobile')
})
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-viewport]')) {
  button.addEventListener('click', () => {
    setViewport(button.dataset.viewport || 'fill')
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

updateRecoveryControls()
const compileClock = window.setInterval(renderCompileProgress, 1000)
window.addEventListener('beforeunload', () => window.clearInterval(compileClock), { once: true })
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

  /** Progress is replaceable telemetry. A reader lock must not escape a child
   * stdout callback and kill the compile; the next stage/heartbeat retries it.
   * Build outcomes still use write() and keep its failure contract. */
  writeProgress(compileProgress: NonNullable<PreviewStudioStatus['compileProgress']>): boolean {
    try {
      this.write({ phase: 'building', label: compileProgress.label, compileProgress })
      return true
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      return false
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
          || (value.phase !== 'ready' && value.phase !== 'failed')
          || (value.failureKind !== undefined && value.failureKind !== 'validation' && value.failureKind !== 'runtime')
          || (value.phase === 'ready' && value.failureKind !== undefined)) return
      lastBytes = bytes
      onAck({
        schemaVersion: 1,
        sessionId: plan.sessionId,
        generation: value.generation,
        phase: value.phase,
        ...(value.phase === 'ready' && value.recovery === true ? { recovery: true as const } : {}),
        ...(value.failureKind ? { failureKind: value.failureKind } : {}),
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
