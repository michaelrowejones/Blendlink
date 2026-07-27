// MTLX-TSL-001 TSL side: each cell hand-writes the TSL mapping the future
// compiler will generate, renders it over a unit-UV quad into a FLOAT
// render target, and returns raw linear pixels. No canvas, no tone map, no
// sRGB encode anywhere — the constant-linear calibration cell proves it.
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  add,
  clamp,
  float,
  mix,
  mul,
  mx_noise_float,
  oneMinus,
  step,
  sub,
  uv,
  vec2,
  vec3,
} from 'three/tsl'

const SIZE = 64

function mappingPointZRotate(coords, scaleX, scaleY, degrees) {
  // Blender Mapping (POINT): scale, then rotate, then translate. A wrong
  // order or rotation sign is the documented rotate2d/place2d failure class.
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const scaled = vec2(coords.x.mul(scaleX), coords.y.mul(scaleY))
  return vec2(
    scaled.x.mul(cos).sub(scaled.y.mul(sin)),
    scaled.x.mul(sin).add(scaled.y.mul(cos)),
  )
}

const CELL_NODES = {
  'constant-linear': () => vec3(0.25, 0.5, 0.75),
  'uv-gradient': () => vec3(uv().x, uv().y, 0.0),
  'math-compare': () => vec3(
    // Blender Math GREATER_THAN(u, 0.5) / LESS_THAN(v, 0.5); texel centers
    // never sit exactly on the threshold at this size.
    step(0.5, uv().x),
    oneMinus(step(0.5, uv().y)),
    0.0,
  ),
  'mapping-rotate': () => {
    const mapped = mappingPointZRotate(uv(), 2.0, 1.0, 30.0)
    return vec3(
      mapped.x.mul(0.25).add(0.5),
      mapped.y.mul(0.25).add(0.5),
      0.0,
    )
  },
  'colorramp-linear': () => {
    const factor = clamp(
      uv().x.sub(0.2).div(0.6), 0.0, 1.0,
    )
    return mix(vec3(0.1, 0.2, 0.8), vec3(0.9, 0.5, 0.1), factor)
  },
  'noise-mx-divergence': () => {
    // three's MaterialX noise, remapped toward Blender's 0..1 Fac range.
    // EXPECTED to diverge from Blender's SVM noise — the recorded negative
    // control that justifies porting Blender's exact implementation.
    const sample = mx_noise_float(vec3(uv().mul(4.0), 0.0))
    return vec3(sample.mul(0.5).add(0.5))
  },
}

const state = { ready: false, renderer: null, scene: null, camera: null,
  mesh: null, target: null, error: null }

async function init() {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    document.body.appendChild(canvas)
    const renderer = new WebGPURenderer({ canvas, antialias: false })
    renderer.setPixelRatio(1)
    renderer.setSize(SIZE, SIZE, false)
    renderer.toneMapping = THREE.NoToneMapping
    await renderer.init()
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new MeshBasicNodeMaterial(),
    )
    scene.add(mesh)
    const target = new THREE.RenderTarget(SIZE, SIZE, {
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    })
    target.texture.colorSpace = THREE.NoColorSpace
    Object.assign(state, {
      renderer, scene, camera, mesh, target,
      backend: Boolean(renderer.backend?.isWebGPUBackend),
    })
    state.ready = true
  } catch (error) {
    state.error = `${error?.name ?? 'Error'}: ${error?.message ?? error}`
    state.ready = true
  }
  return { ready: state.ready, error: state.error, backend: state.backend }
}

window.__tslDiffInit = init
window.__tslDiffReady = () => state.ready

window.__tslDiffCellIds = () => Object.keys(CELL_NODES)

window.__tslDiffRun = async (cellId) => {
  if (state.error) return { ok: false, error: state.error }
  const factory = CELL_NODES[cellId]
  if (!factory) return { ok: false, error: `unknown cell ${cellId}` }
  try {
    const material = new MeshBasicNodeMaterial()
    material.colorNode = factory()
    state.mesh.material.dispose()
    state.mesh.material = material
    state.renderer.setRenderTarget(state.target)
    await state.renderer.renderAsync(state.scene, state.camera)
    const pixels = await state.renderer.readRenderTargetPixelsAsync(
      state.target, 0, 0, SIZE, SIZE,
    )
    state.renderer.setRenderTarget(null)
    const bytes = new Uint8Array(
      pixels.buffer, pixels.byteOffset, pixels.byteLength,
    )
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return {
      ok: true,
      size: SIZE,
      components: pixels.length / (SIZE * SIZE),
      base64: btoa(binary),
    }
  } catch (error) {
    return {
      ok: false,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  }
}
