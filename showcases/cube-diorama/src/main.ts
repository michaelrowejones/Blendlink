// Blendlink starter: this entry point is application-owned and safe to edit.
import * as THREE from 'three'
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
