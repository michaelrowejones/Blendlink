// GPU-vs-CPU bisection rig for Blender's perlin_1d in TSL.
//
// The failed 1D attempt (see the noise-dimensions comment in tsl_ir.py)
// established the ALGORITHM is understood: a CPU port matches the Blender
// reference bake to 2e-4. What diverged is the GPU translation, so this page
// renders each pipeline stage in isolation — seed literal, rotate, 1-arg
// Jenkins hash, gradient select, fade, full perlin — for run-debug1d.mjs to
// diff against the same stages computed on the CPU. Every field is a function
// of uv().x only, so row disagreement would itself be a finding.
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn, bitcast, float, floor, fract, int, mix, select, uint, uv, vec3,
} from 'three/tsl'

const SIZE = 64

// --- the code under test: verbatim shapes from the reverted attempt -------

const uintRotate = (value, bits) => value.shiftLeft(uint(bits))
  .bitOr(value.shiftRight(uint(32 - bits)))

function jenkinsFinal(a0, b0, c0) {
  let a = a0
  let b = b0
  let c = c0
  c = c.bitXor(b).sub(uintRotate(b, 14))
  a = a.bitXor(c).sub(uintRotate(c, 11))
  b = b.bitXor(a).sub(uintRotate(a, 25))
  c = c.bitXor(b).sub(uintRotate(b, 16))
  a = a.bitXor(c).sub(uintRotate(c, 4))
  b = b.bitXor(a).sub(uintRotate(a, 14))
  c = c.bitXor(b).sub(uintRotate(b, 24))
  return c
}

const SEED1 = 0xdeadbeef + (1 << 2) + 13

function hashUint1(kx) {
  // WGSL const-expressions ERROR on u32 overflow instead of wrapping, and
  // with b and c both literal seeds the whole Jenkins mix const-folds.
  // .toVar() forces them into runtime vars, where u32 arithmetic wraps.
  const b = uint(SEED1).toVar()
  const c = uint(SEED1).toVar()
  return jenkinsFinal(uint(SEED1).add(kx), b, c)
}

const fadeNode = (t) => t.mul(t).mul(t)
  .mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0))

function grad1(hash, x) {
  const h = hash.bitAnd(uint(15))
  const g = float(h.bitAnd(uint(7))).add(1.0)
  const positive = h.bitAnd(uint(8)).equal(uint(0))
  return select(positive, g, g.negate()).mul(x)
}

function perlin1d(x) {
  const ix = floor(x)
  const fx = x.sub(ix)
  const X = bitcast(int(ix), 'uint')
  const u = fadeNode(fx)
  const a = grad1(hashUint1(X), fx)
  const b = grad1(hashUint1(X.add(uint(1))), fx.sub(1.0))
  return mix(a, b, u)
}

// --- 4D under test: verbatim shapes from the production patch --------------

function jenkinsMix(a0, b0, c0) {
  let a = a0
  let b = b0
  let c = c0
  a = a.sub(c); a = a.bitXor(uintRotate(c, 4)); c = c.add(b)
  b = b.sub(a); b = b.bitXor(uintRotate(a, 6)); a = a.add(c)
  c = c.sub(b); c = c.bitXor(uintRotate(b, 8)); b = b.add(a)
  a = a.sub(c); a = a.bitXor(uintRotate(c, 16)); c = c.add(b)
  b = b.sub(a); b = b.bitXor(uintRotate(a, 19)); a = a.add(c)
  c = c.sub(b); c = c.bitXor(uintRotate(b, 4)); b = b.add(a)
  return [a, b, c]
}

const SEED4 = 0xdeadbeef + (4 << 2) + 13

function hashUint4(kx, ky, kz, kw) {
  const [a, b, c] = jenkinsMix(
    uint(SEED4).add(kx), uint(SEED4).add(ky), uint(SEED4).add(kz),
  )
  return jenkinsFinal(a.add(kw), b, c)
}

// Fn-wrapped like three's own mx_gradient_float: arguments are evaluated at
// the CALL SITE, so an outer .toVar() can never have its assignment pulled
// inside one of the selects' if/else branches.
const grad4 = Fn(([hash, x, y, z, w]) => {
  const h = hash.bitAnd(uint(31))
  const u = select(h.lessThan(uint(24)), x, y)
  const v = select(h.lessThan(uint(16)), y, z)
  const s = select(h.lessThan(uint(8)), z, w)
  return select(h.bitAnd(uint(1)).equal(uint(0)), u, u.negate())
    .add(select(h.bitAnd(uint(2)).equal(uint(0)), v, v.negate()))
    .add(select(h.bitAnd(uint(4)).equal(uint(0)), s, s.negate()))
}).setLayout({
  name: 'blenderGrad4',
  type: 'float',
  inputs: [
    { name: 'hash', type: 'uint' },
    { name: 'x', type: 'float' },
    { name: 'y', type: 'float' },
    { name: 'z', type: 'float' },
    { name: 'w', type: 'float' },
  ],
})

function perlin4d(px, py, pz, pw) {
  const ix = floor(px)
  const iy = floor(py)
  const iz = floor(pz)
  const iw = floor(pw)
  const fx = px.sub(ix).toVar()
  const fy = py.sub(iy).toVar()
  const fz = pz.sub(iz).toVar()
  const fw = pw.sub(iw).toVar()
  const X = bitcast(int(ix), 'uint').toVar()
  const Y = bitcast(int(iy), 'uint').toVar()
  const Z = bitcast(int(iz), 'uint').toVar()
  const W = bitcast(int(iw), 'uint').toVar()
  const u = fadeNode(fx).toVar()
  const v = fadeNode(fy).toVar()
  const t = fadeNode(fz).toVar()
  const sw = fadeNode(fw).toVar()
  const one = uint(1)
  const tap = (i, j, k, l) => grad4(
    hashUint4(
      i ? X.add(one) : X, j ? Y.add(one) : Y,
      k ? Z.add(one) : Z, l ? W.add(one) : W,
    ),
    i ? fx.sub(1.0) : fx, j ? fy.sub(1.0) : fy,
    k ? fz.sub(1.0) : fz, l ? fw.sub(1.0) : fw,
  ).toVar()
  const tri = (l) => mix(
    mix(
      mix(tap(0, 0, 0, l), tap(1, 0, 0, l), u),
      mix(tap(0, 1, 0, l), tap(1, 1, 0, l), u), v,
    ),
    mix(
      mix(tap(0, 0, 1, l), tap(1, 0, 1, l), u),
      mix(tap(0, 1, 1, l), tap(1, 1, 1, l), u), v,
    ), t,
  )
  return mix(tri(0), tri(1), sw).mul(0.8344)
}

// --- the stage ladder ------------------------------------------------------

const toUnit = (value) => float(value).div(4294967295.0)
const cellX = () => bitcast(int(floor(uv().x.mul(8.0))), 'uint')

const STAGES = {
  // Readback sanity: is uv().x what the CPU thinks it is?
  x: () => uv().x,
  // Does a > 2^31 uint literal survive WGSL emission on this path?
  seed: () => toUnit(uint(SEED1)),
  // One rotate in isolation.
  rot14: () => toUnit(uintRotate(uint(0x12345678).toVar(), 14)),
  // int(floor(f32)) -> bitcast u32 -> back to float: the conversion chain.
  floorx: () => float(bitcast(int(floor(uv().x.mul(8.0))), 'uint')).div(8.0),
  // The 1-argument Jenkins hash over the 8 lattice cells.
  hash1: () => toUnit(hashUint1(cellX())),
  // The same hash at X+1 (the second tap's index arithmetic).
  hash1next: () => toUnit(hashUint1(cellX().add(uint(1)))),
  // Gradient selection over the hash, scaled from [-8, 8] into [0, 1].
  grad: () => grad1(hashUint1(cellX()), fract(uv().x.mul(8.0)))
    .mul(0.0625).add(0.5),
  // The quintic ease alone.
  fade: () => fadeNode(fract(uv().x.mul(8.0))),
  // The whole thing, in Blender's Fac form: 0.5 * (0.25 * perlin) + 0.5.
  perlin: () => perlin1d(uv().x.mul(11.0)).mul(0.25).mul(0.5).add(0.5),
  // 4D ladder, full-field (varies in x AND y).
  hash4cell: () => float(hashUint4(
    bitcast(int(floor(uv().x.mul(5.0))), 'uint'),
    bitcast(int(floor(uv().y.mul(5.0))), 'uint'),
    uint(0), uint(16),
  )).div(4294967295.0),
  grad4probe: () => grad4(
    hashUint4(
      bitcast(int(floor(uv().x.mul(5.0))), 'uint'),
      bitcast(int(floor(uv().y.mul(5.0))), 'uint'),
      uint(0), uint(16),
    ),
    fract(uv().x.mul(5.0)), fract(uv().y.mul(5.0)), float(0.3), float(0.7),
  ).mul(0.1).add(0.5),
  perlin4dsingle: () => perlin4d(
    uv().x.mul(5.0), uv().y.mul(5.0), float(0.0), float(16.5),
  ).mul(0.5).add(0.5),
  // Single tap with the full perlin4d-style lattice derivation (toVars and
  // all): isolates the composition from the arithmetic that grad4probe
  // already proved.
  tap0000: () => {
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    return grad4(hashUint4(X, Y, uint(0).toVar(), uint(16).toVar()),
      fx, fy, float(0.0), float(0.5)).mul(0.1).add(0.5)
  },
  mixtap: () => {
    // The innermost lerp of tri(0): mix(tap0000, tap1000, fadeU).
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    const Z = uint(0).toVar()
    const W = uint(16).toVar()
    const one = uint(1)
    const u = fadeNode(fx).toVar()
    const a = grad4(hashUint4(X, Y, Z, W), fx, fy, float(0.0), float(0.5)).toVar()
    const b = grad4(hashUint4(X.add(one), Y, Z, W),
      fx.sub(1.0), fy, float(0.0), float(0.5)).toVar()
    return mix(a, b, u).mul(0.1).add(0.5)
  },
  tri0: () => {
    // One full trilinear over the l=0 plane, exactly as perlin4d builds it.
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    const Z = uint(0).toVar()
    const W = uint(16).toVar()
    const one = uint(1)
    const u = fadeNode(fx).toVar()
    const v = fadeNode(fy).toVar()
    const t = fadeNode(float(0.0)).toVar()
    const tap = (i, j, k) => grad4(
      hashUint4(i ? X.add(one) : X, j ? Y.add(one) : Y,
        k ? Z.add(one) : Z, W),
      i ? fx.sub(1.0) : fx, j ? fy.sub(1.0) : fy,
      k ? float(-1.0) : float(0.0), float(0.5),
    ).toVar()
    return mix(
      mix(mix(tap(0, 0, 0), tap(1, 0, 0), u), mix(tap(0, 1, 0), tap(1, 1, 0), u), v),
      mix(mix(tap(0, 0, 1), tap(1, 0, 1), u), mix(tap(0, 1, 1), tap(1, 1, 1), u), v),
      t,
    ).mul(0.1).add(0.5)
  },
  tap1100: () => {
    // The DOUBLE-incremented corner tap: X+1 and Y+1 together, which no
    // earlier stage exercised.
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    const one = uint(1)
    return grad4(
      hashUint4(X.add(one), Y.add(one), uint(0).toVar(), uint(16).toVar()),
      fx.sub(1.0), fy.sub(1.0), float(0.0), float(0.5),
    ).mul(0.1).add(0.5)
  },
  bil0: () => {
    // Four taps + three mixes: the bilinear over the k=0, l=0 plane.
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    const Z = uint(0).toVar()
    const W = uint(16).toVar()
    const one = uint(1)
    const u = fadeNode(fx).toVar()
    const v = fadeNode(fy).toVar()
    const tap = (i, j) => grad4(
      hashUint4(i ? X.add(one) : X, j ? Y.add(one) : Y, Z, W),
      i ? fx.sub(1.0) : fx, j ? fy.sub(1.0) : fy, float(0.0), float(0.5),
    ).toVar()
    return mix(
      mix(tap(0, 0), tap(1, 0), u), mix(tap(0, 1), tap(1, 1), u), v,
    ).mul(0.1).add(0.5)
  },
  tap1000: () => {
    const px = uv().x.mul(5.0)
    const py = uv().y.mul(5.0)
    const ix = floor(px)
    const iy = floor(py)
    const fx = px.sub(ix).toVar()
    const fy = py.sub(iy).toVar()
    const X = bitcast(int(ix), 'uint').toVar()
    const Y = bitcast(int(iy), 'uint').toVar()
    return grad4(hashUint4(X.add(uint(1)), Y, uint(0).toVar(), uint(16).toVar()),
      fx.sub(1.0), fy, float(0.0), float(0.5)).mul(0.1).add(0.5)
  },
}

// --- render machinery, cribbed from main.js --------------------------------

const state = { ready: false, error: null }

window.__debugInit = async () => {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    document.body.appendChild(canvas)
    const renderer = new WebGPURenderer({ canvas, antialias: false })
    renderer.setPixelRatio(1)
    renderer.setSize(SIZE, SIZE, false)
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(new THREE.Color(1.0, 0.0, 1.0), 1.0)
    await renderer.init()
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2), new MeshBasicNodeMaterial(),
    )
    scene.add(mesh)
    const target = new THREE.RenderTarget(SIZE, SIZE, {
      type: THREE.FloatType, depthBuffer: false, stencilBuffer: false,
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

window.__debugShader = async (stageId) => {
  if (state.error) return { ok: false, error: state.error }
  try {
    const factory = STAGES[stageId]
    if (!factory) return { ok: false, error: `unknown stage ${stageId}` }
    const material = new MeshBasicNodeMaterial()
    material.colorNode = vec3(factory())
    state.mesh.material.dispose()
    state.mesh.material = material
    const shaders = await state.renderer.debug.getShaderAsync(
      state.scene, state.camera, state.mesh,
    )
    return { ok: true, fragment: shaders.fragmentShader ?? null }
  } catch (error) {
    return { ok: false, error: `${error?.name ?? 'Error'}: ${error?.message ?? error}` }
  }
}

window.__debugRun = async (stageId) => {
  if (state.error) return { ok: false, error: state.error }
  try {
    const factory = STAGES[stageId]
    if (!factory) return { ok: false, error: `unknown stage ${stageId}` }
    const material = new MeshBasicNodeMaterial()
    material.colorNode = vec3(factory())
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
    return { ok: false, error: `${error?.name ?? 'Error'}: ${error?.message ?? error}` }
  }
}
