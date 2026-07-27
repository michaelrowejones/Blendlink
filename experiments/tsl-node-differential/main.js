// MTLX-TSL-001 TSL side: each cell hand-writes the TSL mapping the future
// compiler will generate, renders it over a unit-UV quad into a FLOAT
// render target, and returns raw linear pixels. No canvas, no tone map, no
// sRGB encode anywhere — the constant-linear calibration cell proves it.
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  add,
  clamp,
  cos,
  float,
  floor,
  mix,
  mul,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_float,
  oneMinus,
  pow,
  select,
  sign,
  sin,
  step,
  sub,
  uv,
  vec2,
  vec3,
} from 'three/tsl'

// --- Blender safe-math wrappers ---------------------------------------------
// Cycles guards its Math node against undefined GPU behavior; the compiler
// must emit these exact wrappers, and their cells prove them.

// safe_divide: b == 0 -> 0, never inf/NaN.
function blenderDivide(a, b) {
  return select(b.equal(0.0), float(0.0), a.div(b))
}

// C fmod (truncated, sign of the dividend) with the b == 0 guard — GLSL's
// floored mod has the divisor's sign and disagrees for negative dividends.
function blenderModulo(a, b) {
  const quotient = a.div(b)
  const truncated = sign(quotient).mul(floor(abs(quotient)))
  return select(b.equal(0.0), float(0.0), a.sub(b.mul(truncated)))
}

// compatible pow: negative base is defined only for integer exponents —
// pow(|x|, y) carrying the sign of an odd exponent; GLSL pow(neg, y) is
// undefined. Zero base: y == 0 -> 1 else 0.
function blenderPower(base, exponent) {
  const isInteger = floor(exponent).equal(exponent)
  const magnitude = pow(abs(base), exponent)
  const oddExponent = blenderModulo(exponent, float(2.0)).equal(1.0)
  const signedMagnitude = select(
    oddExponent, magnitude.negate(), magnitude,
  )
  const negativeBase = select(isInteger, signedMagnitude, float(0.0))
  const zeroBase = select(exponent.equal(0.0), float(1.0), float(0.0))
  return select(
    base.lessThan(0.0), negativeBase,
    select(base.equal(0.0), zeroBase, pow(base, exponent)),
  )
}

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
    // three's MaterialX noise, remapped to Blender's 0..1 Fac range.
    // Measured 2026-07-27: the base octave AGREES to 1.2e-4 — Blender's
    // Perlin and MaterialX's share a lineage. Now a gated regression.
    const sample = mx_noise_float(vec3(uv().mul(4.0), 0.0))
    return vec3(sample.mul(0.5).add(0.5))
  },
  'math-safe-divide': () => {
    const a = uv().x.mul(4.0).sub(2.0)
    const bands = floor(uv().y.mul(3.0)).sub(1.0)
    const biased = blenderDivide(a, bands).mul(0.25).add(0.5)
    return vec3(clamp(biased, 0.0, 1.0))
  },
  'math-modulo-sign': () => {
    const a = uv().x.mul(8.0).sub(4.0)
    const biased = blenderModulo(a, float(1.5)).mul(0.25).add(0.5)
    return vec3(clamp(biased, 0.0, 1.0))
  },
  'math-power-negative-base': () => {
    const base = uv().x.mul(4.0).sub(2.0)
    const scaled = blenderPower(base, float(2.0)).mul(0.2)
    return vec3(clamp(scaled, 0.0, 1.0))
  },
  'math-trig': () => vec3(
    sin(uv().x.mul(8.0)).mul(0.5).add(0.5),
    cos(uv().y.mul(8.0)).mul(0.5).add(0.5),
    0.0,
  ),
  'colorramp-constant': () => {
    // CONSTANT interpolation takes the left stop's color.
    const factor = uv().x
    const low = vec3(0.1, 0.1, 0.7)
    const middle = vec3(0.2, 0.7, 0.2)
    const high = vec3(0.8, 0.3, 0.1)
    return select(
      factor.lessThan(0.3), low,
      select(factor.lessThan(0.6), middle, high),
    )
  },
  'mapping-texture-mode': () => {
    // Blender Mapping TEXTURE mode is the inverse of POINT: inverse-rotate
    // first, then divide by scale.
    const radians = (30.0 * Math.PI) / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const point = uv()
    const rotatedX = point.x.mul(cosine).add(point.y.mul(sine))
    const rotatedY = point.x.mul(-sine).add(point.y.mul(cosine))
    const mapped = vec2(rotatedX.div(2.0), rotatedY.div(1.0))
    return vec3(
      mapped.x.mul(0.25).add(0.5),
      mapped.y.mul(0.25).add(0.5),
      0.0,
    )
  },
  'noise-fractal-detail': () => {
    // Blender detail 2 / roughness 0.5 against MaterialX fBM with 3
    // octaves, lacunarity 2, diminish 0.5 — measured, not assumed.
    const sample = mx_fractal_noise_float(
      vec3(uv().mul(4.0), 0.0), 3, 2.0, 0.5, 1.0,
    )
    return vec3(sample.mul(0.5).add(0.5))
  },
  'voronoi-f1-divergence': () => {
    const sample = mx_worley_noise_float(vec3(uv().mul(4.0), 0.0), 1.0)
    return vec3(sample)
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
