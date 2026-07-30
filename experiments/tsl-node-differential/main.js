// MTLX-TSL-001 TSL side: cells render through the PRODUCTION pipeline —
// the IR emitted by tsl_ir.py from the real Blender graphs, built into TSL
// by the packaged tslNodeRecipe module. A cell therefore proves the exact
// compiler mapping, not a lookalike. Only diagnostic cells without an IR
// route (Voronoi, until the Cycles hash is ported) keep hand-written TSL.
// No canvas, no tone map, no sRGB anywhere — the byte-exact constant
// calibration cell proves it.
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import { mx_worley_noise_float, normalize, uv, vec3 } from 'three/tsl'
import { buildTslColorNode } from '@blendlink-tsl-recipe'

// The view-dependent cell camera contract, mirrored from reference.py:
// camera at (0, 0, 2) looking down -Z at the quad spanning [-1, 1]^2 at
// z = 0. V = normalize(camera - worldPos); cos = V.z against normal +Z.
function analyticViewCos() {
  const wx = uv().x.mul(2.0).sub(1.0)
  const wy = uv().y.mul(2.0).sub(1.0)
  return normalize(vec3(wx.negate(), wy.negate(), 2.0)).z
}

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
    // Magenta clear sentinel: a cell whose pipeline fails to build must
    // read back as the sentinel, never as the previous cell's pixels.
    renderer.setClearColor(new THREE.Color(1.0, 0.0, 1.0), 1.0)
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

function ensureQuadVertexColors() {
  // Mirror the reference proxy's corner colors: linear in UV, so any
  // triangulation interpolates it exactly.
  const geometry = state.mesh.geometry
  if (geometry.getAttribute('color')) return
  const uvs = geometry.getAttribute('uv')
  const colors = new Float32Array(uvs.count * 3)
  for (let index = 0; index < uvs.count; index += 1) {
    colors[index * 3] = uvs.getX(index)
    colors[index * 3 + 1] = uvs.getY(index)
    colors[index * 3 + 2] = 0.25
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

window.__tslDiffRun = async (
  cellId, pipeline, irPath, analyticCamera, analyticLight, objectAttributes,
) => {
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
      const document = await response.json()
      if (JSON.stringify(document).includes('"vertex_color"')) {
        ensureQuadVertexColors()
      }
      colorNode = buildTslColorNode(document, {
        ...(analyticCamera ? { viewCos: analyticViewCos() } : {}),
        // The light-contract override: a sun of the cell's declared
        // effective irradiance (the EEVEE reference measures the same
        // contract; the cell decides the scaling constant).
        ...(analyticLight
          ? {
              diffuseIrradiance: vec3(
                analyticLight.irradiance[0],
                analyticLight.irradiance[1],
                analyticLight.irradiance[2],
              ),
            }
          : {}),
        // The tile-proxy texspace contract, measured by the probe: the
        // quad reports texspace location (0,0,0), size (1,1,1).
        generatedTexspace: {
          location: [0, 0, 0],
          size: [1, 1, 1],
        },
        // Per-object attribute fixture values (the runtime supplies a
        // per-object uniform instead; the cell pins the semantics).
        ...(objectAttributes
          ? {
              objectAttribute: (name) => {
                const value = objectAttributes[name]
                if (!value) return null
                return vec3(value[0], value[1], value[2])
              },
            }
          : {}),
      })
    }
    const material = new MeshBasicNodeMaterial()
    material.colorNode = colorNode
    state.mesh.material.dispose()
    state.mesh.material = material
    state.renderer.setRenderTarget(state.target)
    // Truthfulness, in two parts. Clear in an OWN submit first, so a
    // cell whose pipeline later fails reads back the magenta sentinel,
    // never the previous cell's pixels. Then bracket the render in a
    // validation error scope, so an async pipeline failure surfaces as
    // ok:false instead of a silent stale readback -- the failure mode
    // that measured ellie.hair_mesh as a bit-exact copy of the gums
    // reference and cost a misdiagnosis.
    await state.renderer.clearAsync()
    const device = state.renderer.backend?.device
    device?.pushErrorScope('validation')
    await state.renderer.renderAsync(state.scene, state.camera)
    const validationError = await device?.popErrorScope()
    if (validationError) {
      state.renderer.setRenderTarget(null)
      return {
        ok: false,
        error: `WebGPU validation: ${validationError.message}`,
      }
    }
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
