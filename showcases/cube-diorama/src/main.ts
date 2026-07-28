// Blendlink starter: this entry point is application-owned and safe to edit.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { installCubeDioramaScene } from './blendlink/CubeDioramaScene'
import './style.css'

const canvasElement = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvasElement) throw new Error('Blendlink starter: #scene canvas is missing')
const canvas: HTMLCanvasElement = canvasElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const world = new THREE.Scene()

const installed = await installCubeDioramaScene({
  renderer,
  scene: world,
})

// Viewer navigation: orbit and zoom around the authored framing. The
// artist-authored view stays the opening frame; refresh returns to it.
const controls = new OrbitControls(installed.camera, canvas)
const sphere = new THREE.Box3().setFromObject(installed.root).getBoundingSphere(new THREE.Sphere())
// Pivot on the authored view ray at the scene-center depth: update() then
// re-aims at a point the camera already looks at, so the authored rotation
// survives while orbiting still revolves around the diorama.
const viewDirection = installed.camera.getWorldDirection(new THREE.Vector3())
const focusDistance = Math.max(
  sphere.radius * 0.05,
  sphere.center.clone().sub(installed.camera.position).dot(viewDirection),
)
controls.target.copy(installed.camera.position).addScaledVector(viewDirection, focusDistance)
controls.minDistance = sphere.radius * 0.05
controls.maxDistance = sphere.radius * 8
controls.enableDamping = true
controls.update()

// Performance readout (fps / frame ms / draw calls / triangles). autoReset
// would keep only the last internal pass; reset once per frame instead so
// multi-pass frames report their full cost.
renderer.info.autoReset = false
const hud = document.createElement('div')
hud.className = 'perf-hud'
hud.innerHTML = '<span data-fps>--</span> fps · <span data-ms>--</span> ms'
  + ' · <span data-draws>--</span> draws · <span data-tris>--</span> tris'
document.body.appendChild(hud)
const hudFps = hud.querySelector('[data-fps]') as HTMLElement
const hudMs = hud.querySelector('[data-ms]') as HTMLElement
const hudDraws = hud.querySelector('[data-draws]') as HTMLElement
const hudTris = hud.querySelector('[data-tris]') as HTMLElement

const hint = document.createElement('div')
hint.className = 'viewer-hint'
hint.textContent = 'drag to orbit · scroll to zoom'
document.body.appendChild(hint)
const dismissHint = () => hint.classList.add('viewer-hint--hidden')
canvas.addEventListener('pointerdown', dismissHint, { once: true })
setTimeout(dismissHint, 8000)

let frameCount = 0
let accumulatedMs = 0
let lastHudUpdate = performance.now()

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
  controls.update()
  renderer.info.reset()
  installed.render(deltaSeconds)

  frameCount += 1
  accumulatedMs += deltaSeconds * 1000
  if (now - lastHudUpdate >= 500 && frameCount > 0) {
    hudFps.textContent = String(Math.round(frameCount / ((now - lastHudUpdate) / 1000)))
    hudMs.textContent = (accumulatedMs / frameCount).toFixed(1)
    hudDraws.textContent = String(renderer.info.render.calls)
    hudTris.textContent = renderer.info.render.triangles.toLocaleString('en-US')
    frameCount = 0
    accumulatedMs = 0
    lastHudUpdate = now
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.addEventListener('beforeunload', () => installed.dispose(), { once: true })
