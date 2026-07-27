// MTLX-TSL-001 TSL side: cells render through the PRODUCTION pipeline —
// the IR emitted by tsl_ir.py from the real Blender graphs, built into TSL
// by the packaged tslNodeRecipe module. A cell therefore proves the exact
// compiler mapping, not a lookalike. Only diagnostic cells without an IR
// route (Voronoi, until the Cycles hash is ported) keep hand-written TSL.
// No canvas, no tone map, no sRGB anywhere — the byte-exact constant
// calibration cell proves it.
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import { mx_worley_noise_float, uv, vec3 } from 'three/tsl'
import { buildTslColorNode } from '@blendlink-tsl-recipe'

const SIZE = 64

const HANDWRITTEN_CELLS = {
  'voronoi-f1-divergence': () => vec3(
    mx_worley_noise_float(vec3(uv().mul(4.0), 0.0), 1.0),
  ),
}

const state = {
  ready: false, renderer: null, scene: null, camera: null,
  mesh: null, target: null, error: null,
}

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

window.__tslDiffRun = async (cellId, pipeline, irPath) => {
  if (state.error) return { ok: false, error: state.error }
  try {
    let colorNode
    if (pipeline === 'handwritten') {
      const factory = HANDWRITTEN_CELLS[cellId]
      if (!factory) {
        return { ok: false, error: `no handwritten mapping for ${cellId}` }
      }
      colorNode = factory()
    } else {
      const response = await fetch(
        irPath ?? `/output/reference/ir/${cellId}.json`,
      )
      if (!response.ok) {
        return {
          ok: false,
          error: `IR fetch failed for ${cellId}: ${response.status}`,
        }
      }
      colorNode = buildTslColorNode(await response.json())
    }
    const material = new MeshBasicNodeMaterial()
    material.colorNode = colorNode
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
