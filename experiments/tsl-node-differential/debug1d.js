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
  bitcast, float, floor, fract, int, mix, select, uint, uv, vec3,
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
