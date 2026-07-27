// WGPU-PP-001: do the exact pinned postprocessing@6.39.3 + n8ao@1.10.2 run
// against three's WebGPURenderer, and do they produce identical pixels to the
// WebGLRenderer path?  The harness steps through the same effect classes the
// production ThreePostPipelineService constructs, one backend at a time, and
// reports every failure phase (construct-renderer, construct-composer,
// construct-effect, render) instead of a boolean.
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  LookupTexture,
  LUT3DEffect,
  NormalPass,
  OutlineEffect,
  PixelationEffect,
  RenderPass,
  SelectiveBloomEffect,
  TiltShiftEffect,
  ToneMappingEffect,
  VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'

const SIZE = 384

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

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.7),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0 }),
  )
  glow.position.set(0, 1.2, -1.2)
  scene.add(glow)

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(3, 5, 2)
  scene.add(key)
  scene.add(new THREE.AmbientLight(0x404050, 0.8))
  return { scene, camera, sphere, box }
}

class ProbeEffect extends Effect {
  // Stands for the shipped custom Effect shaders (sharpen/CAS, kuwahara,
  // custom vignette/pixelation variants): the minimal library-idiomatic
  // fragment the pmndrs Effect base compiles.
  constructor() {
    super(
      'BlendlinkProbeEffect',
      'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {' +
      '  outputColor = vec4(1.0 - inputColor.rgb, inputColor.a);' +
      '}',
    )
  }
}

function effectFactories(context) {
  const { scene, camera, sphere } = context
  return {
    'render-pass-only': () => [],
    'tone-mapping': () => [new ToneMappingEffect()],
    bloom: () => [new BloomEffect({ intensity: 1.2 })],
    'selective-bloom': () => {
      const effect = new SelectiveBloomEffect(scene, camera, { intensity: 1.5 })
      effect.selection.add(sphere)
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

const state = {
  ready: false,
  environment: null,
  renderers: {},
  contexts: {},
}

async function makeRenderer(backend) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.id = `canvas-${backend}`
  document.body.appendChild(canvas)
  if (backend === 'webgl') {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, preserveDrawingBuffer: true,
    })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
    return renderer
  }
  const renderer = new WebGPURenderer({
    canvas, antialias: false, forceWebGL: false,
  })
  renderer.setSize(SIZE, SIZE, false)
  renderer.setPixelRatio(1)
  await renderer.init()
  return renderer
}

async function capturePixels(canvas) {
  // drawImage + getImageData reads both WebGL and WebGPU canvases without
  // depending on toDataURL support for the webgpu context.
  const staging = document.createElement('canvas')
  staging.width = canvas.width
  staging.height = canvas.height
  const context = staging.getContext('2d')
  context.drawImage(canvas, 0, 0)
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  let sum = 0
  let nonBackground = 0
  for (let index = 0; index < data.length; index += 4) {
    const luma = 0.2126 * data[index]
      + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]
    sum += luma
    if (luma > 8) nonBackground += 1
  }
  const digest = await crypto.subtle.digest('SHA-256', data)
  return {
    meanLuma: sum / (data.length / 4),
    nonBackgroundPixels: nonBackground,
    sha256: [...new Uint8Array(digest)]
      .map((item) => item.toString(16).padStart(2, '0')).join(''),
  }
}

window.__wgpuPpInit = async () => {
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
  for (const backend of ['webgl', 'webgpu']) {
    try {
      const renderer = await makeRenderer(backend)
      state.renderers[backend] = renderer
      state.contexts[backend] = deterministicScene()
      environment.backends[backend] = {
        constructed: true,
        isWebGPUBackend: Boolean(renderer.backend?.isWebGPUBackend),
      }
    } catch (error) {
      environment.backends[backend] = {
        constructed: false,
        error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
      }
    }
  }
  state.environment = environment
  state.ready = true
  return environment
}

window.__wgpuPpPlain = async (backend) => {
  // Question 0: does the renderer itself present the deterministic scene?
  const renderer = state.renderers[backend]
  const context = state.contexts[backend]
  if (!renderer) return { ok: false, phase: 'construct-renderer' }
  try {
    if (backend === 'webgpu' && renderer.renderAsync) {
      await renderer.renderAsync(context.scene, context.camera)
    } else {
      renderer.render(context.scene, context.camera)
    }
    const pixels = await capturePixels(renderer.domElement)
    return { ok: true, pixels }
  } catch (error) {
    return {
      ok: false,
      phase: 'render',
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  }
}

window.__wgpuPpEffect = async (backend, effectId) => {
  const renderer = state.renderers[backend]
  const context = state.contexts[backend]
  if (!renderer) return { ok: false, phase: 'construct-renderer' }
  let phase = 'construct-composer'
  let composer = null
  try {
    composer = new EffectComposer(renderer)
    composer.setSize(SIZE, SIZE)
    composer.addPass(new RenderPass(context.scene, context.camera))
    phase = 'construct-effect'
    if (effectId === 'n8ao') {
      composer.addPass(new N8AOPostPass(
        context.scene, context.camera, SIZE, SIZE,
      ))
    } else {
      const factory = effectFactories(context)[effectId]
      if (!factory) throw new Error(`unknown effect ${effectId}`)
      const effects = factory()
      if (effects.length > 0) {
        composer.addPass(new EffectPass(context.camera, ...effects))
      }
    }
    phase = 'render'
    composer.render(1 / 60)
    const pixels = await capturePixels(renderer.domElement)
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
      // A backend that failed mid-construction may also fail to dispose;
      // the measured failure above is the evidence that matters.
    }
  }
}

window.__wgpuPpEffectIds = () => [
  ...Object.keys(effectFactories(state.contexts.webgl ?? {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    sphere: new THREE.Mesh(),
  })),
  'n8ao',
]

window.__wgpuPpReady = () => state.ready
