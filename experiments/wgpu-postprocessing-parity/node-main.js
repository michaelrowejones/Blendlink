// WGPU-NODE-001 (Phase 4 Track 0): per-effect fixtures for the node-based
// post-processing pipeline (three RenderPipeline + in-tree TSL display nodes
// + n8ao-webgpu), measured on BOTH WebGPURenderer backends — native WebGPU
// and the WebGL2 fallback (forceWebGL) — beside the pinned pmndrs WebGL
// stack as the look-continuity control.  Unlike WGPU-PP-001 (which proved
// the pinned stack constructs 0/13 on WebGPURenderer), this instrument
// measures the REPLACEMENT pipeline the port will ship.
//
// Capture contract: node-pipeline cells render into an explicit RenderTarget
// and read back via readRenderTargetPixelsAsync (the proven
// tsl-node-differential pattern; WebGPU canvases may present-and-clear
// before a drawImage capture).  The WebGL control keeps the WGPU-PP-001
// canvas capture that measured 13/13.  Readback rows are top-down while the
// canvas capture is bottom-up; only orientation-independent stats (mean
// luma, non-background count) are compared across the two capture paths.
import * as THREE from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import {
  directionToColor,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  texture3D,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl'
import {
  blendlinkAnisotropicKuwahara,
  blendlinkGeometryAwarePixelation,
  blendlinkRadialChromaticAberration,
  blendlinkTiltShift,
  blendlinkVignette,
} from 'blendlink/three/tsl-effects'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  LookupTexture,
  LUT3DEffect,
  OutlineEffect,
  PixelationEffect,
  RenderPass,
  SelectiveBloomEffect,
  TiltShiftEffect,
  ToneMappingEffect,
  VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { createN8AOScenePass, N8AONode } from 'n8ao-webgpu'

const SIZE = 384
// Temporal/warm-up passes (TRAA accumulation, N8AO history) get identical
// repeated frames before capture; the scene is static so every non-temporal
// cell is idempotent under repetition.
const WARMUP_FRAMES = 3

function deterministicScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202830)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
  camera.position.set(2.4, 1.8, 3.2)
  camera.lookAt(0, 0.4, 0)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x777f88, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0xcc5533, metalness: 0.8, roughness: 0.25,
    }),
  )
  sphere.position.set(-0.7, 0.6, 0)
  scene.add(sphere)

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3366aa, roughness: 0.6 }),
  )
  box.position.set(0.8, 0.4, 0.3)
  box.rotation.y = 0.6
  scene.add(box)

  // Emissive standard material (the WGPU-PP-001 scene used MeshBasicMaterial
  // here): the selective-bloom node route selects subjects through the
  // emissive MRT target, so the fixture needs a genuinely emissive surface.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.7),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffe0a0, emissiveIntensity: 2,
    }),
  )
  glow.position.set(0, 1.2, -1.2)
  scene.add(glow)

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(3, 5, 2)
  scene.add(key)
  scene.add(new THREE.AmbientLight(0x404050, 0.8))
  return { scene, camera, sphere, box, glow }
}

class ProbeEffect extends Effect {
  constructor() {
    super(
      'BlendlinkProbeEffect',
      'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {' +
      '  outputColor = vec4(1.0 - inputColor.rgb, inputColor.a);' +
      '}',
    )
  }
}

function controlFactories(context) {
  const { scene, camera, sphere, glow } = context
  return {
    'render-pass-only': () => [],
    'tone-mapping': () => [new ToneMappingEffect()],
    bloom: () => [new BloomEffect({ intensity: 1.2 })],
    'selective-bloom': () => {
      const effect = new SelectiveBloomEffect(scene, camera, { intensity: 1.5 })
      effect.selection.add(glow)
      return [effect]
    },
    vignette: () => [new VignetteEffect({ darkness: 0.6 })],
    'chromatic-aberration': () => [new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.004, 0.002),
      radialModulation: false,
      modulationOffset: 0,
    })],
    pixelation: () => [new PixelationEffect(6)],
    'tilt-shift': () => [new TiltShiftEffect({ focusArea: 0.3 })],
    outline: () => {
      const effect = new OutlineEffect(scene, camera, { edgeStrength: 3 })
      effect.selection.add(sphere)
      return [effect]
    },
    lut3d: () => [new LUT3DEffect(LookupTexture.createNeutral(32))],
    'depth-of-field': () => [new DepthOfFieldEffect(camera, {
      focusDistance: 0.02, focalLength: 0.05, bokehScale: 2,
    })],
    'custom-effect': () => [new ProbeEffect()],
  }
}

function neutralLut(size) {
  const data = new Uint8Array(size * size * size * 4)
  let index = 0
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        data[index] = Math.round((r * 255) / (size - 1))
        data[index + 1] = Math.round((g * 255) / (size - 1))
        data[index + 2] = Math.round((b * 255) / (size - 1))
        data[index + 3] = 255
        index += 4
      }
    }
  }
  const lut = new THREE.Data3DTexture(data, size, size, size)
  lut.format = THREE.RGBAFormat
  lut.type = THREE.UnsignedByteType
  lut.minFilter = THREE.LinearFilter
  lut.magFilter = THREE.LinearFilter
  lut.wrapS = THREE.ClampToEdgeWrapping
  lut.wrapT = THREE.ClampToEdgeWrapping
  lut.wrapR = THREE.ClampToEdgeWrapping
  lut.needsUpdate = true
  return lut
}

// Each cell mirrors one production ThreePostPipelineService configuration on
// the node pipeline.  A cell returns { outputNode, outputColorTransform?,
// disposables? }; RenderPipeline applies the default output transform unless
// the cell composes renderOutput() itself.
function nodeCells(context) {
  const { scene, camera, sphere } = context
  return {
    'render-pass-only': () => ({ outputNode: pass(scene, camera) }),
    'tone-mapping': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: renderOutput(scenePass),
        outputColorTransform: false,
      }
    },
    bloom: () => {
      const scenePass = pass(scene, camera)
      const color = scenePass.getTextureNode()
      return { outputNode: color.add(bloom(color, 1.2)) }
    },
    'selective-bloom': () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({ output, emissive }))
      const color = scenePass.getTextureNode()
      const emissiveColor = scenePass.getTextureNode('emissive')
      return { outputNode: color.add(bloom(emissiveColor, 1.5)) }
    },
    'chromatic-aberration': () => {
      const scenePass = pass(scene, camera)
      // The helper's default center=null is broken upstream in r184: the
      // docstring promises screen center but setup() forwards the null into
      // a declared vec2 parameter, producing black.  Pass it explicitly.
      return {
        outputNode: chromaticAberration(
          scenePass.getTextureNode(), 1.0, vec2(0.5, 0.5), 1.1,
        ),
      }
    },
    pixelation: () => ({
      outputNode: pixelationPass(scene, camera, 6, 0.3, 0.3),
    }),
    outline: () => {
      const scenePass = pass(scene, camera)
      const outlinePass = outline(scene, camera, {
        selectedObjects: [sphere], edgeThickness: 1, edgeGlow: 0,
      })
      const { visibleEdge, hiddenEdge } = outlinePass
      const edgeColor = visibleEdge.mul(vec3(1, 1, 1))
        .add(hiddenEdge.mul(vec3(0.3, 0.2, 0.2))).mul(3)
      return {
        outputNode: edgeColor.add(scenePass.getTextureNode()),
        disposables: [outlinePass],
      }
    },
    lut3d: () => {
      const lut = neutralLut(32)
      const scenePass = pass(scene, camera)
      return {
        outputNode: lut3D(scenePass.getTextureNode(), texture3D(lut), 32, 1),
        disposables: [lut],
      }
    },
    'depth-of-field': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: dof(
          scenePass.getTextureNode(), scenePass.getViewZNode(), 4.2, 3.5, 3,
        ),
      }
    },
    'custom-effect': () => {
      const scenePass = pass(scene, camera)
      const color = scenePass.getTextureNode()
      return { outputNode: vec4(color.rgb.oneMinus(), color.a) }
    },
    n8ao: () => {
      const scenePass = createN8AOScenePass(scene, camera)
      const node = new N8AONode({
        beautyNode: scenePass.getTextureNode('output'),
        beautyTexture: scenePass.getTexture('output'),
        depthNode: scenePass.getTextureNode('depth'),
        depthTexture: scenePass.getTexture('depth'),
        normalNode: scenePass.getTextureNode('normal'),
        normalTexture: scenePass.getTexture('normal'),
        scenePassNode: scenePass,
        scene,
        camera,
      })
      return { outputNode: node.getTextureNode(), disposables: [node] }
    },
    traa: () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({ output, velocity }))
      return {
        outputNode: traa(
          scenePass.getTextureNode(),
          scenePass.getTextureNode('depth'),
          scenePass.getTextureNode('velocity'),
          camera,
        ),
      }
    },
    fxaa: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: fxaa(renderOutput(scenePass)),
        outputColorTransform: false,
      }
    },
    smaa: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: smaa(renderOutput(scenePass)),
        outputColorTransform: false,
      }
    },
    // The five Blendlink-owned nodes (blendlink/three/tsl-effects), each
    // mirroring the shipped GLSL math from threeComponents.ts.
    vignette: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkVignette(scenePass.getTextureNode(), {
          intensity: 0.6, softness: 0.55,
        }),
      }
    },
    'tilt-shift': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkTiltShift(scenePass.getTextureNode(), {
          feather: 0.25, strength: 0.7,
        }),
      }
    },
    kuwahara: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkAnisotropicKuwahara(scenePass.getTextureNode(), {
          brushScale: 4, strength: 0.75,
        }),
      }
    },
    'radial-chromatic-aberration': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkRadialChromaticAberration(
          scenePass.getTextureNode(), { amount: 0.004 },
        ),
      }
    },
    'geometry-pixelation': () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({
        output,
        normal: directionToColor(normalView),
      }))
      return {
        outputNode: blendlinkGeometryAwarePixelation({
          color: scenePass.getTextureNode(),
          depth: scenePass.getTextureNode('depth'),
          normal: scenePass.getTextureNode('normal'),
          camera,
        }, {
          pixelSize: 6, depthEdgeStrength: 1, normalEdgeStrength: 1,
        }),
      }
    },
  }
}

// Formerly the pendingTrackB list: every Blendlink-owned display node now
// has a measured cell above.  The empty list stays so the run.mjs honesty
// check (a pending id must never also have a cell) keeps its seam.
const PENDING_TRACK_B = []

async function statsFromRgba(data) {
  let sum = 0
  let nonBackground = 0
  let nonFinite = 0
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      nonFinite += 1
      continue
    }
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += luma
    if (luma > 8) nonBackground += 1
  }
  const digest = await crypto.subtle.digest(
    'SHA-256', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  )
  return {
    meanLuma: sum / (data.length / 4),
    nonBackgroundPixels: nonBackground,
    nonFinitePixels: nonFinite,
    sha256: [...new Uint8Array(digest)]
      .map((item) => item.toString(16).padStart(2, '0')).join(''),
  }
}

async function captureCanvas(canvas) {
  const staging = document.createElement('canvas')
  staging.width = canvas.width
  staging.height = canvas.height
  const context = staging.getContext('2d')
  context.drawImage(canvas, 0, 0)
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  return statsFromRgba(data)
}

const state = {
  ready: false,
  environment: null,
  control: null,
  node: {},
}

window.__wgpuNodeInit = async () => {
  const environment = {
    threeRevision: THREE.REVISION,
    webgpuAvailable: Boolean(navigator.gpu),
    adapter: null,
    backends: {},
  }
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const info = adapter.info ?? {}
        environment.adapter = {
          vendor: info.vendor ?? null,
          architecture: info.architecture ?? null,
          device: info.device ?? null,
          description: info.description ?? null,
        }
      }
    } catch (error) {
      environment.adapter = { error: String(error) }
    }
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    document.body.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, preserveDrawingBuffer: true,
    })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
    state.control = { renderer, context: deterministicScene() }
    environment.backends.control = { constructed: true }
  } catch (error) {
    environment.backends.control = {
      constructed: false,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  }

  for (const backendId of ['native', 'fallback']) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      document.body.appendChild(canvas)
      const renderer = new WebGPURenderer({
        canvas, antialias: false, forceWebGL: backendId === 'fallback',
      })
      renderer.setSize(SIZE, SIZE, false)
      renderer.setPixelRatio(1)
      await renderer.init()
      state.node[backendId] = { renderer, context: deterministicScene() }
      environment.backends[backendId] = {
        constructed: true,
        isWebGPUBackend: Boolean(renderer.backend?.isWebGPUBackend),
      }
    } catch (error) {
      environment.backends[backendId] = {
        constructed: false,
        error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
      }
    }
  }
  state.environment = environment
  state.ready = true
  return environment
}

window.__wgpuNodeControl = async (effectId) => {
  const entry = state.control
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  let phase = 'construct-composer'
  let composer = null
  try {
    composer = new EffectComposer(entry.renderer)
    composer.setSize(SIZE, SIZE)
    composer.addPass(new RenderPass(entry.context.scene, entry.context.camera))
    phase = 'construct-effect'
    if (effectId === 'n8ao') {
      composer.addPass(new N8AOPostPass(
        entry.context.scene, entry.context.camera, SIZE, SIZE,
      ))
    } else {
      const factory = controlFactories(entry.context)[effectId]
      if (!factory) throw new Error(`unknown control effect ${effectId}`)
      const effects = factory()
      if (effects.length > 0) {
        composer.addPass(new EffectPass(entry.context.camera, ...effects))
      }
    }
    phase = 'render'
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      composer.render(1 / 60)
    }
    const pixels = await captureCanvas(entry.renderer.domElement)
    return { ok: true, pixels }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      composer?.dispose()
    } catch {
      // A failed construction may also fail to dispose; the measured failure
      // above is the evidence that matters.
    }
  }
}

window.__wgpuNodeEffect = async (backendId, effectId) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const { renderer } = entry
  let phase = 'construct-node'
  let pipeline = null
  let target = null
  let disposables = []
  try {
    const factory = nodeCells(entry.context)[effectId]
    if (!factory) throw new Error(`unknown node cell ${effectId}`)
    const built = factory()
    disposables = built.disposables ?? []
    phase = 'construct-pipeline'
    pipeline = new RenderPipeline(renderer, built.outputNode)
    if (built.outputColorTransform === false) {
      pipeline.outputColorTransform = false
    }
    phase = 'render'
    // Default (no) color space: the pipeline's renderOutput already encodes
    // sRGB in-shader; an SRGBColorSpace target would make the hardware
    // encode AGAIN on write (measured: baseline mean luma 144 vs the
    // control's 79 — a classic double-encode wash-out).
    target = new THREE.RenderTarget(SIZE, SIZE, {
      type: THREE.UnsignedByteType,
    })
    renderer.setRenderTarget(target)
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      pipeline.render()
    }
    renderer.setRenderTarget(null)
    phase = 'readback'
    const data = await renderer.readRenderTargetPixelsAsync(
      target, 0, 0, SIZE, SIZE,
    )
    const pixels = await statsFromRgba(data)
    return { ok: true, pixels }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      renderer.setRenderTarget(null)
      target?.dispose()
      for (const item of disposables) item?.dispose?.()
      pipeline?.dispose()
    } catch {
      // Same contract as the control path: the recorded failure is the
      // evidence; cleanup of a half-built pipeline may itself fail.
    }
  }
}

window.__wgpuNodeIds = () => {
  const context = state.node.native?.context
    ?? state.node.fallback?.context ?? state.control?.context
  return {
    control: [...Object.keys(controlFactories(context)), 'n8ao'],
    node: Object.keys(nodeCells(context)),
    pendingTrackB: PENDING_TRACK_B,
  }
}

window.__wgpuNodeReady = () => state.ready
