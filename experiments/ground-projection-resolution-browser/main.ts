import * as THREE from '../../node_modules/three/build/three.module.js'
import { EXRLoader } from '../../node_modules/three/examples/jsm/loaders/EXRLoader.js'
import { GroundedSkybox } from '../../node_modules/three/examples/jsm/objects/GroundedSkybox.js'

const WIDTH = 560
const HEIGHT = 350
const CAPTURE_HEIGHT = 1.6
const RADIUS = 50
const DIFFERENCE_AMPLIFICATION = 12

type ViewDefinition = {
  id: string
  label: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

type PixelSummary = {
  mean: [number, number, number, number]
  opaquePixels: number
  nonBlackPixels: number
}

type PixelMetrics = {
  rgbMae: number
  rgbRmse: number
  rgbPsnr: number | null
  maxRgbError: number
  changedPixels: number
  changedPixelsOver1: number
  changedPixelsOver2: number
  changedPixelsOver4: number
  changedPixelsOver8: number
  changedPixelsOver16: number
  pixelCount: number
}

const views: ViewDefinition[] = [
  {
    id: 'eye-level-horizon',
    label: 'Eye-level horizon',
    position: [0, 1.6, 0.5],
    target: [0, 1.6, -10],
    fov: 58,
  },
  {
    id: 'low-forward',
    label: 'Low forward view',
    position: [0, 0.25, 2.5],
    target: [0, 0.12, -8],
    fov: 58,
  },
  {
    id: 'floor-grazing',
    label: 'Floor-grazing diagonal',
    position: [5, 0.12, 4],
    target: [-5, 0.05, -8],
    fov: 62,
  },
  {
    id: 'floor-downward',
    label: 'Near-floor downward view',
    position: [0, 0.35, 3],
    target: [0, 0, -2],
    fov: 68,
  },
  {
    id: 'offset-horizon',
    label: 'Offset low horizon',
    position: [8, 1, 6],
    target: [-8, 0.8, -10],
    fov: 64,
  },
]

function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id)
  if (!(element instanceof constructor)) throw new Error(`Missing #${id}`)
  return element
}

function triangleCount(mesh: THREE.Mesh): number {
  const index = mesh.geometry.index
  return index
    ? index.count / 3
    : mesh.geometry.getAttribute('position').count / 3
}

function summarize(pixels: Uint8Array): PixelSummary {
  const totals = [0, 0, 0, 0]
  let opaquePixels = 0
  let nonBlackPixels = 0
  for (let index = 0; index < pixels.length; index += 4) {
    totals[0] += pixels[index]
    totals[1] += pixels[index + 1]
    totals[2] += pixels[index + 2]
    totals[3] += pixels[index + 3]
    if (pixels[index + 3] === 255) opaquePixels += 1
    if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 12) nonBlackPixels += 1
  }
  const count = pixels.length / 4
  return {
    mean: totals.map((value) => value / count) as [number, number, number, number],
    opaquePixels,
    nonBlackPixels,
  }
}

function comparePixels(left: Uint8Array, right: Uint8Array): PixelMetrics {
  if (left.length !== right.length) throw new Error('Pixel arrays have different lengths')
  let absolute = 0
  let squared = 0
  let maxRgbError = 0
  let changedPixels = 0
  let changedPixelsOver1 = 0
  let changedPixelsOver2 = 0
  let changedPixelsOver4 = 0
  let changedPixelsOver8 = 0
  let changedPixelsOver16 = 0

  for (let index = 0; index < left.length; index += 4) {
    let maximum = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(left[index + channel] - right[index + channel])
      absolute += difference
      squared += difference * difference
      maximum = Math.max(maximum, difference)
      maxRgbError = Math.max(maxRgbError, difference)
    }
    if (maximum > 0) changedPixels += 1
    if (maximum > 1) changedPixelsOver1 += 1
    if (maximum > 2) changedPixelsOver2 += 1
    if (maximum > 4) changedPixelsOver4 += 1
    if (maximum > 8) changedPixelsOver8 += 1
    if (maximum > 16) changedPixelsOver16 += 1
  }

  const channelCount = (left.length / 4) * 3
  const rgbRmse = Math.sqrt(squared / channelCount)
  return {
    rgbMae: absolute / channelCount,
    rgbRmse,
    rgbPsnr: rgbRmse === 0 ? null : 20 * Math.log10(255 / rgbRmse),
    maxRgbError,
    changedPixels,
    changedPixelsOver1,
    changedPixelsOver2,
    changedPixelsOver4,
    changedPixelsOver8,
    changedPixelsOver16,
    pixelCount: left.length / 4,
  }
}

function flipRows(pixels: Uint8Array): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels.length)
  const rowBytes = WIDTH * 4
  for (let y = 0; y < HEIGHT; y += 1) {
    const source = (HEIGHT - y - 1) * rowBytes
    result.set(pixels.subarray(source, source + rowBytes), y * rowBytes)
  }
  return result
}

function drawPixels(canvas: HTMLCanvasElement, pixels: Uint8Array): void {
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  context.putImageData(new ImageData(flipRows(pixels), WIDTH, HEIGHT), 0, 0)
}

function differencePixels(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length)
  for (let index = 0; index < left.length; index += 4) {
    const difference = Math.max(
      Math.abs(left[index] - right[index]),
      Math.abs(left[index + 1] - right[index + 1]),
      Math.abs(left[index + 2] - right[index + 2]),
    )
    const amplified = Math.min(255, difference * DIFFERENCE_AMPLIFICATION)
    result[index] = amplified
    result[index + 1] = Math.round(amplified * amplified / 255)
    result[index + 2] = 0
    result[index + 3] = 255
  }
  return result
}

function createCell(
  grid: HTMLElement,
  view: ViewDefinition,
  suffix: string,
  title: string,
): HTMLCanvasElement {
  const figure = document.createElement('figure')
  const canvas = document.createElement('canvas')
  canvas.id = `${view.id}-${suffix}`
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const caption = document.createElement('figcaption')
  caption.innerHTML = `<strong>${title}</strong><span class="metric" id="${view.id}-${suffix}-metric"></span>`
  figure.append(canvas, caption)
  grid.append(figure)
  return canvas
}

function addViewRow(grid: HTMLElement, view: ViewDefinition): {
  resolution64: HTMLCanvasElement
  resolution128: HTMLCanvasElement
  difference: HTMLCanvasElement
} {
  const heading = document.createElement('section')
  heading.className = 'view-heading'
  heading.id = `row-${view.id}`
  heading.innerHTML = `
    <h2>${view.label}</h2>
    <p>camera ${view.position.join(', ')} → ${view.target.join(', ')} · fov ${view.fov}°</p>
  `
  grid.append(heading)
  return {
    resolution64: createCell(grid, view, '64', 'Resolution 64'),
    resolution128: createCell(grid, view, '128', 'Resolution 128'),
    difference: createCell(grid, view, 'difference', `Absolute RGB difference ×${DIFFERENCE_AMPLIFICATION}`),
  }
}

function renderPixels(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
  renderer.setRenderTarget(null)
  return pixels
}

async function main(): Promise<void> {
  const errors: string[] = []
  const host = requiredElement('render-host', HTMLCanvasElement)
  const grid = requiredElement('grid', HTMLElement)
  const status = requiredElement('status', HTMLElement)
  const renderer = new THREE.WebGLRenderer({
    canvas: host,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.setClearColor(0, 1)

  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  })
  target.texture.colorSpace = THREE.SRGBColorSpace

  const loader = new EXRLoader()
  const texture = await loader.loadAsync('/forest.exr')
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.LinearSRGBColorSpace

  const sky64 = new GroundedSkybox(texture, CAPTURE_HEIGHT, RADIUS, 64)
  sky64.name = 'GroundedSkyboxResolution64'
  sky64.position.y = CAPTURE_HEIGHT
  const sky128 = new GroundedSkybox(texture, CAPTURE_HEIGHT, RADIUS, 128)
  sky128.name = 'GroundedSkyboxResolution128'
  sky128.position.y = CAPTURE_HEIGHT

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(58, WIDTH / HEIGHT, 0.05, 100)
  const viewEvidence: Record<string, unknown> = {}

  for (const view of views) {
    const canvases = addViewRow(grid, view)
    camera.fov = view.fov
    camera.position.fromArray(view.position)
    camera.lookAt(...view.target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)

    scene.add(sky64)
    const pixels64 = renderPixels(renderer, target, scene, camera)
    scene.remove(sky64)

    scene.add(sky128)
    const pixels128 = renderPixels(renderer, target, scene, camera)
    scene.remove(sky128)

    const metrics = comparePixels(pixels64, pixels128)
    const summary64 = summarize(pixels64)
    const summary128 = summarize(pixels128)
    drawPixels(canvases.resolution64, pixels64)
    drawPixels(canvases.resolution128, pixels128)
    drawPixels(canvases.difference, differencePixels(pixels64, pixels128))

    requiredElement(`${view.id}-64-metric`, HTMLElement).textContent =
      `${triangleCount(sky64).toLocaleString()} triangles`
    requiredElement(`${view.id}-128-metric`, HTMLElement).textContent =
      `${triangleCount(sky128).toLocaleString()} triangles`
    requiredElement(`${view.id}-difference-metric`, HTMLElement).textContent =
      `MAE ${metrics.rgbMae.toFixed(4)} · RMSE ${metrics.rgbRmse.toFixed(4)} · >8 ${metrics.changedPixelsOver8.toLocaleString()} px`

    viewEvidence[view.id] = {
      camera: view,
      resolution64: { summary: summary64, geometryTriangles: triangleCount(sky64) },
      resolution128: { summary: summary128, geometryTriangles: triangleCount(sky128) },
      differential: metrics,
    }
  }

  const gl = renderer.getContext()
  const debugRendererInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const rendererIdentity = debugRendererInfo
    ? gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER)
  const vendorIdentity = debugRendererInfo
    ? gl.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR)

  status.textContent = 'Complete. The raw evidence object is available as window.__groundProjectionResolutionEvidence.'
  ;(window as unknown as {
    __groundProjectionResolutionEvidence: Record<string, unknown>
  }).__groundProjectionResolutionEvidence = {
    ready: true,
    errors,
    settings: {
      viewport: [WIDTH, HEIGHT],
      deviceScaleFactor: window.devicePixelRatio,
      captureHeight: CAPTURE_HEIGHT,
      radius: RADIUS,
      differenceAmplification: DIFFERENCE_AMPLIFICATION,
      toneMapping: 'ACESFilmicToneMapping',
      toneMappingExposure: renderer.toneMappingExposure,
      outputColorSpace: renderer.outputColorSpace,
      textureColorSpace: texture.colorSpace,
      textureMapping: 'EquirectangularReflectionMapping',
      textureDimensions: [texture.image.width, texture.image.height],
    },
    geometry: {
      resolution64Triangles: triangleCount(sky64),
      resolution128Triangles: triangleCount(sky128),
    },
    renderer: {
      webglVersion: gl instanceof WebGL2RenderingContext ? 2 : 1,
      vendor: vendorIdentity,
      renderer: rendererIdentity,
    },
    views: viewEvidence,
    dispose() {
      sky64.geometry.dispose()
      ;(sky64.material as THREE.Material).dispose()
      sky128.geometry.dispose()
      ;(sky128.material as THREE.Material).dispose()
      texture.dispose()
      target.dispose()
      renderer.dispose()
      return {
        sky64Parented: sky64.parent !== null,
        sky128Parented: sky128.parent !== null,
      }
    },
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  const status = document.getElementById('status')
  if (status) status.textContent = `Failed: ${message}`
  ;(window as unknown as {
    __groundProjectionResolutionEvidence: Record<string, unknown>
  }).__groundProjectionResolutionEvidence = {
    ready: true,
    errors: [message],
  }
})
