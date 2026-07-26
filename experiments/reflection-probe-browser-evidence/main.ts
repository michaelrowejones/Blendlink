import * as THREE from 'three'
import {
  applyCompiledSceneReflectionProbes,
  createThreeWebGLReflectionCapture,
  type CompiledReflectionProbes,
  type ReflectionProbeRuntimeContext,
  type ThreeWebGLReflectionCaptureNamespace,
} from '../../packages/blendlink/dist/reflectionProbes.js'
import type { CompiledSceneDescriptor } from '../../packages/blendlink/dist/runtime.js'
import type { ReflectionProbeRecipe } from '../../packages/blendlink/dist/sceneRecipe.js'

const WIDTH = 720
const HEIGHT = 480
const CUBE_SIZE = 64

type Rgba = [number, number, number, number]

type LifecycleEvidence = {
  cubeTargetsCreated: number
  cubeTargetsDisposed: number
  cubeCameraUpdates: number
  receiverVisibilityAtUpdate: boolean[]
  generatorsCreated: number
  generatorsDisposed: number
  pmremTargetsCreated: number
  pmremTargetsDisposed: number
}

type PixelEvidence = {
  total: number
  nonBackground: number
  chromatic: number
  center: [number, number, number, number]
}

type BrowserEvidence = {
  threeRevision: string
  webglVersion: string
  webglRenderer: string
  captureMilliseconds: number
  cubeTextureType: number
  faceCenters: Rgba[]
  success: {
    lifecycle: LifecycleEvidence
    receiverVisibleAfterCapture: boolean
    receiverRenderCallsDuringCapture: number
    receiverRenderCallsAfterPresentation: number
    originalMaterialCloned: boolean
    pmremAssigned: boolean
    report: CompiledReflectionProbes['report']
    texturesAfterCapture: number
    negativeControlPixels: PixelEvidence
    pixels: PixelEvidence
  }
  forcedFailure: {
    lifecycle: LifecycleEvidence
    message: string
    receiverVisibleAfterFailure: boolean
  }
}

type DisposalEvidence = {
  materialIdentityRestored: boolean
  pmremTargetsDisposed: number
  cubeTargetsDisposed: number
  generatorsDisposed: number
  texturesBeforeDispose: number
  texturesAfterDispose: number
  secondDisposeWasIdempotent: boolean
}

declare global {
  interface Window {
    __reflectionProbeEvidence?: {
      ready: boolean
      evidence?: BrowserEvidence
      errors: string[]
      dispose(): DisposalEvidence
    }
  }
}

function lifecycle(): LifecycleEvidence {
  return {
    cubeTargetsCreated: 0,
    cubeTargetsDisposed: 0,
    cubeCameraUpdates: 0,
    receiverVisibilityAtUpdate: [],
    generatorsCreated: 0,
    generatorsDisposed: 0,
    pmremTargetsCreated: 0,
    pmremTargetsDisposed: 0,
  }
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) === 0 ? 1 : -1
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

function readFaceCenters(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLCubeRenderTarget,
): Rgba[] {
  const result: Rgba[] = []
  const center = Math.floor(target.width / 2)
  for (let face = 0; face < 6; face += 1) {
    if (target.texture.type === THREE.HalfFloatType) {
      const pixel = new Uint16Array([0x7bff, 0x7bff, 0x7bff, 0x7bff])
      renderer.readRenderTargetPixels(target, center, center, 1, 1, pixel, face)
      result.push([
        halfToFloat(pixel[0]!),
        halfToFloat(pixel[1]!),
        halfToFloat(pixel[2]!),
        halfToFloat(pixel[3]!),
      ])
      continue
    }
    if (target.texture.type === THREE.FloatType) {
      const pixel = new Float32Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN])
      renderer.readRenderTargetPixels(target, center, center, 1, 1, pixel, face)
      result.push([pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!])
      continue
    }
    const pixel = new Uint8Array([127, 127, 127, 127])
    renderer.readRenderTargetPixels(target, center, center, 1, 1, pixel, face)
    result.push([
      pixel[0]! / 255,
      pixel[1]! / 255,
      pixel[2]! / 255,
      pixel[3]! / 255,
    ])
  }
  return result
}

function trackedNamespace(options: {
  renderer: THREE.WebGLRenderer
  receiver: THREE.Object3D
  lifecycle: LifecycleEvidence
  faceCenters?: Rgba[]
  failUpdate?: boolean
}): ThreeWebGLReflectionCaptureNamespace {
  let latestTarget: THREE.WebGLCubeRenderTarget | undefined

  class TrackedCubeRenderTarget extends THREE.WebGLCubeRenderTarget {
    private blendlinkDisposed = false

    constructor(size: number, targetOptions?: THREE.RenderTargetOptions) {
      super(size, targetOptions)
      latestTarget = this
      options.lifecycle.cubeTargetsCreated += 1
    }

    override dispose(): void {
      if (!this.blendlinkDisposed) {
        this.blendlinkDisposed = true
        options.lifecycle.cubeTargetsDisposed += 1
      }
      super.dispose()
    }
  }

  class TrackedCubeCamera extends THREE.CubeCamera {
    override update(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
      options.lifecycle.cubeCameraUpdates += 1
      options.lifecycle.receiverVisibilityAtUpdate.push(options.receiver.visible)
      if (options.failUpdate) throw new Error('intentional browser CubeCamera failure')
      super.update(renderer, scene)
    }
  }

  class TrackedPMREMGenerator extends THREE.PMREMGenerator {
    private blendlinkDisposed = false

    constructor(renderer: THREE.WebGLRenderer) {
      super(renderer)
      options.lifecycle.generatorsCreated += 1
    }

    override fromCubemap(
      cubemap: THREE.Texture,
      renderTarget: THREE.WebGLRenderTarget | null = null,
    ): THREE.WebGLRenderTarget {
      if (!latestTarget) throw new Error('PMREM conversion had no tracked cubemap target')
      if (options.faceCenters) {
        options.faceCenters.splice(
          0,
          options.faceCenters.length,
          ...readFaceCenters(options.renderer, latestTarget),
        )
      }
      const target = super.fromCubemap(cubemap, renderTarget)
      options.lifecycle.pmremTargetsCreated += 1
      const dispose = target.dispose.bind(target)
      let disposed = false
      target.dispose = () => {
        if (!disposed) {
          disposed = true
          options.lifecycle.pmremTargetsDisposed += 1
        }
        dispose()
      }
      return target
    }

    override dispose(): void {
      if (!this.blendlinkDisposed) {
        this.blendlinkDisposed = true
        options.lifecycle.generatorsDisposed += 1
      }
      super.dispose()
    }
  }

  return {
    Vector3: THREE.Vector3,
    WebGLCubeRenderTarget: TrackedCubeRenderTarget,
    CubeCamera: TrackedCubeCamera,
    PMREMGenerator: TrackedPMREMGenerator,
    HalfFloatType: THREE.HalfFloatType,
    LinearMipmapLinearFilter: THREE.LinearMipmapLinearFilter,
  } as unknown as ThreeWebGLReflectionCaptureNamespace
}

function cardinalPanel(
  axis: THREE.Vector3,
  color: THREE.ColorRepresentation,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }),
  )
  panel.position.copy(axis).multiplyScalar(6)
  panel.lookAt(0, 0, 0)
  return panel
}

function captureEnvironment(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Cardinal capture environment'
  group.add(
    cardinalPanel(new THREE.Vector3(1, 0, 0), 0xff0000),
    cardinalPanel(new THREE.Vector3(-1, 0, 0), 0x00ffff),
    cardinalPanel(new THREE.Vector3(0, 1, 0), 0x00ff00),
    cardinalPanel(new THREE.Vector3(0, -1, 0), 0xff00ff),
    cardinalPanel(new THREE.Vector3(0, 0, 1), 0x0000ff),
    cardinalPanel(new THREE.Vector3(0, 0, -1), 0xffff00),
  )
  return group
}

function probeRecipe(): ReflectionProbeRecipe {
  return {
    id: 'browser-cardinal',
    name: 'Browser Cardinal Probe',
    objectId: 'probe-object-id',
    objectName: 'RuntimeProbe',
    source: 'runtime',
    resolution: CUBE_SIZE,
    influence: 8,
    intensity: 1,
    samples: 1,
  }
}

function probeContext(
  receiver: THREE.Mesh,
  probe: THREE.Object3D,
): ReflectionProbeRuntimeContext<THREE.Object3D & { material?: THREE.Material }> {
  return {
    definition: probeRecipe(),
    probeObject: probe,
    anchorObject: probe,
    assignedObjects: [receiver],
  }
}

function sceneDescriptor(): CompiledSceneDescriptor {
  return {
    reflectionProbes: [probeRecipe()],
    extras: {
      Receiver: { blendlink_reflection_probe: 'probe-object-id' },
    },
    nodeIds: {
      Receiver: 'receiver-object-id',
      RuntimeProbe: 'probe-object-id',
    },
    objectsById: {
      'receiver-object-id': 'Receiver',
      'probe-object-id': 'RuntimeProbe',
    },
  } as unknown as CompiledSceneDescriptor
}

function pixels(renderer: THREE.WebGLRenderer): PixelEvidence {
  const gl = renderer.getContext()
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, data)
  let nonBackground = 0
  let chromatic = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset]!
    const green = data[offset + 1]!
    const blue = data[offset + 2]!
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    if (maximum > 30) nonBackground += 1
    if (maximum - minimum > 35 && maximum > 70) chromatic += 1
  }
  const x = Math.floor(WIDTH / 2)
  const y = Math.floor(HEIGHT / 2)
  const offset = ((HEIGHT - 1 - y) * WIDTH + x) * 4
  return {
    total: WIDTH * HEIGHT,
    nonBackground,
    chromatic,
    center: [
      data[offset]!,
      data[offset + 1]!,
      data[offset + 2]!,
      data[offset + 3]!,
    ],
  }
}

function webglIdentity(renderer: THREE.WebGLRenderer): {
  webglVersion: string
  webglRenderer: string
} {
  const gl = renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    webglVersion: String(gl.getParameter(gl.VERSION)),
    webglRenderer: String(gl.getParameter(
      debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
    )),
  }
}

function showFaceEvidence(faceCenters: Rgba[]): void {
  for (let index = 0; index < faceCenters.length; index += 1) {
    const face = document.querySelector<HTMLElement>(`[data-face="${index}"]`)
    const value = faceCenters[index]!
    if (!face) continue
    face.style.setProperty('--r', String(Math.min(1, Math.max(0, value[0]))))
    face.style.setProperty('--g', String(Math.min(1, Math.max(0, value[1]))))
    face.style.setProperty('--b', String(Math.min(1, Math.max(0, value[2]))))
    const output = face.querySelector('output')
    if (output) output.textContent = value.slice(0, 3).map((channel) => channel.toFixed(3)).join(', ')
  }
}

async function main(): Promise<void> {
  const errors: string[] = []
  let compiled: CompiledReflectionProbes | undefined
  let renderer: THREE.WebGLRenderer | undefined
  let receiver: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> | undefined
  let originalMaterial: THREE.MeshStandardMaterial | undefined
  let successfulLifecycle: LifecycleEvidence | undefined
  let disposed = false
  let texturesBeforeDispose = 0

  window.__reflectionProbeEvidence = {
    ready: false,
    errors,
    dispose() {
      if (!renderer || !receiver || !originalMaterial || !successfulLifecycle) {
        throw new Error('Reflection-probe fixture was disposed before setup completed')
      }
      if (!disposed) {
        disposed = true
        texturesBeforeDispose = renderer.info.memory.textures
        compiled?.dispose()
        renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera())
      }
      const firstPmremDisposeCount = successfulLifecycle.pmremTargetsDisposed
      compiled?.dispose()
      const evidence: DisposalEvidence = {
        materialIdentityRestored: receiver.material === originalMaterial,
        pmremTargetsDisposed: successfulLifecycle.pmremTargetsDisposed,
        cubeTargetsDisposed: successfulLifecycle.cubeTargetsDisposed,
        generatorsDisposed: successfulLifecycle.generatorsDisposed,
        texturesBeforeDispose,
        texturesAfterDispose: renderer.info.memory.textures,
        secondDisposeWasIdempotent:
          successfulLifecycle.pmremTargetsDisposed === firstPmremDisposeCount,
      }
      if (disposed) {
        receiver.geometry.dispose()
        originalMaterial.dispose()
        renderer.dispose()
      }
      return evidence
    },
  }

  try {
    const canvas = document.querySelector<HTMLCanvasElement>('#stage')
    if (!canvas) throw new Error('Missing reflection-probe canvas')
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(1)
    renderer.setSize(WIDTH, HEIGHT, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0d12)
    const root = new THREE.Group()
    root.name = 'CompiledRoot'
    scene.add(root)
    const environment = captureEnvironment()
    root.add(environment)

    const probe = new THREE.Object3D()
    probe.name = 'RuntimeProbe'
    probe.userData.blendlink_id = 'probe-object-id'
    root.add(probe)

    originalMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.14,
      side: THREE.DoubleSide,
    })
    receiver = new THREE.Mesh(new THREE.SphereGeometry(1.18, 96, 64), originalMaterial)
    receiver.name = 'Receiver'
    receiver.userData.blendlink_id = 'receiver-object-id'
    root.add(receiver)

    let receiverRenderCalls = 0
    receiver.onBeforeRender = () => { receiverRenderCalls += 1 }

    scene.add(new THREE.HemisphereLight(0xb9d5ff, 0x20131d, 1.25))
    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(3, 5, 4)
    scene.add(key)
    const camera = new THREE.PerspectiveCamera(34, WIDTH / HEIGHT, 0.1, 40)
    camera.position.set(3.8, 2.5, 5.1)
    camera.lookAt(0, 0, 0)
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)

    // Same receiver, camera, lighting, and background but no environment map.
    // This is the independent negative control for visible PMREM consumption.
    environment.visible = false
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
    const negativeControlPixels = pixels(renderer)
    environment.visible = true

    const failureLifecycle = lifecycle()
    const failureCapture = createThreeWebGLReflectionCapture({
      THREE: trackedNamespace({
        renderer,
        receiver,
        lifecycle: failureLifecycle,
        failUpdate: true,
      }),
      renderer,
      scene,
      near: 0.05,
      far: 20,
    })
    let forcedFailureMessage = ''
    try {
      failureCapture(probeContext(receiver, probe))
    } catch (error) {
      forcedFailureMessage = error instanceof Error ? error.message : String(error)
    }
    const forcedFailure = {
      lifecycle: failureLifecycle,
      message: forcedFailureMessage,
      receiverVisibleAfterFailure: receiver.visible,
    }

    const faceCenters: Rgba[] = []
    successfulLifecycle = lifecycle()
    const capture = createThreeWebGLReflectionCapture({
      THREE: trackedNamespace({
        renderer,
        receiver,
        lifecycle: successfulLifecycle,
        faceCenters,
      }),
      renderer,
      scene,
      near: 0.05,
      far: 20,
    })
    const receiverRenderCallsBeforeCapture = receiverRenderCalls
    const captureStartedAt = performance.now()
    compiled = await applyCompiledSceneReflectionProbes(
      root,
      sceneDescriptor(),
      { capture },
    )
    const captureMilliseconds = performance.now() - captureStartedAt
    const receiverRenderCallsDuringCapture = receiverRenderCalls - receiverRenderCallsBeforeCapture
    const installedMaterial = receiver.material
    const originalMaterialCloned = installedMaterial !== originalMaterial
    const pmremAssigned = installedMaterial.envMap === compiled.resources['browser-cardinal']?.texture

    // The panels are capture sources, not application presentation. Hiding
    // them makes every chromatic final-frame pixel attributable to the
    // receiver's assigned PMREM rather than to visible fixture geometry.
    environment.visible = false
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
    renderer.render(scene, camera)
    const receiverRenderCallsAfterPresentation =
      receiverRenderCalls - receiverRenderCallsBeforeCapture
    const successful = {
      lifecycle: successfulLifecycle,
      receiverVisibleAfterCapture: receiver.visible,
      receiverRenderCallsDuringCapture,
      receiverRenderCallsAfterPresentation,
      originalMaterialCloned,
      pmremAssigned,
      report: compiled.report,
      texturesAfterCapture: renderer.info.memory.textures,
      negativeControlPixels,
      pixels: pixels(renderer),
    }

    showFaceEvidence(faceCenters)
    const status = document.querySelector<HTMLOutputElement>('#status')
    if (status) {
      status.textContent =
        `${CUBE_SIZE}px × 6 capture · ${captureMilliseconds.toFixed(1)} ms · ` +
        `receiver hidden=${successfulLifecycle.receiverVisibilityAtUpdate.every((value) => !value)}`
    }
    const identity = webglIdentity(renderer)
    window.__reflectionProbeEvidence.evidence = {
      threeRevision: THREE.REVISION,
      ...identity,
      captureMilliseconds,
      cubeTextureType: THREE.HalfFloatType,
      faceCenters,
      success: successful,
      forcedFailure,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    window.__reflectionProbeEvidence.ready = true
  }
}

void main()
