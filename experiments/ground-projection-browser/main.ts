import * as THREE from '../../node_modules/three/build/three.module.js'
import { installLoadedThreeCompiledScene } from '../../packages/blendlink/src/threeRuntime.ts'
import { inspectThreeGroundedCameraSafety } from '../../packages/blendlink/src/threeGroundedCameraSafety.ts'
import * as NEEDLE_THREE from '../needle-spike/node_modules/@needle-tools/engine/node_modules/three/build/three.module.js'
import { RGBELoader as NeedleRGBELoader } from '../needle-spike/node_modules/@needle-tools/engine/node_modules/three/examples/jsm/loaders/RGBELoader.js'
import { GroundProjectedEnv } from '../needle-spike/node_modules/@needle-tools/engine/src/engine-components/GroundProjection.ts'

const WIDTH = 480
const HEIGHT = 360
const HEIGHT_METERS = 2
const RADIUS_METERS = 18

type PixelSummary = {
  mean: [number, number, number, number]
  opaquePixels: number
  nonBlackPixels: number
}

type RenderedCell = {
  pixels: Uint8Array
  summary: PixelSummary
  geometryTriangles: number
  projectionPosition: [number, number, number]
  dispose(): Record<string, unknown>
}

type CameraSafetyCell = RenderedCell & {
  cameraFar: number
  requiredFar: number
  clippedVertexCount: number
  safeReferencePixels: Uint8Array
}

type Differential = {
  mae: number
  rmse: number
  maxError: number
  changedPixels: number
  changedPixelsOver8: number
  pixelCount: number
}

function requiredCanvas(id: string): HTMLCanvasElement {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLCanvasElement)) throw new Error(`Missing canvas #${id}`)
  value.width = WIDTH
  value.height = HEIGHT
  return value
}

function writeOutput(id: string, text: string): void {
  const output = document.getElementById(id)
  if (output) output.textContent = text
}

const HDR_URL = '/axis.hdr'

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

function comparePixels(left: Uint8Array, right: Uint8Array): Differential {
  if (left.length !== right.length) throw new Error('Pixel arrays have different sizes')
  let absolute = 0
  let squared = 0
  let maxError = 0
  let changedPixels = 0
  let changedPixelsOver8 = 0
  for (let index = 0; index < left.length; index += 4) {
    let pixelChanged = false
    let pixelOver8 = false
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(left[index + channel] - right[index + channel])
      absolute += difference
      squared += difference * difference
      maxError = Math.max(maxError, difference)
      if (difference > 0) pixelChanged = true
      if (difference > 8) pixelOver8 = true
    }
    if (pixelChanged) changedPixels += 1
    if (pixelOver8) changedPixelsOver8 += 1
  }
  return {
    mae: absolute / left.length,
    rmse: Math.sqrt(squared / left.length),
    maxError,
    changedPixels,
    changedPixelsOver8,
    pixelCount: left.length / 4,
  }
}

function readNeedlePixels(
  renderer: NEEDLE_THREE.WebGLRenderer,
  scene: NEEDLE_THREE.Scene,
  camera: NEEDLE_THREE.Camera,
): Uint8Array {
  const target = new NEEDLE_THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: true,
    stencilBuffer: false,
  })
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  target.dispose()
  return pixels
}

function readBlendlinkPixels(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Uint8Array {
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: true,
    stencilBuffer: false,
  })
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  target.dispose()
  return pixels
}

function configureNeedleRenderer(canvas: HTMLCanvasElement): NEEDLE_THREE.WebGLRenderer {
  const renderer = new NEEDLE_THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = NEEDLE_THREE.SRGBColorSpace
  renderer.toneMapping = NEEDLE_THREE.NoToneMapping
  renderer.setClearColor(0x000000, 1)
  return renderer
}

function configureBlendlinkRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 1)
  return renderer
}

function needleCamera(): NEEDLE_THREE.PerspectiveCamera {
  const camera = new NEEDLE_THREE.PerspectiveCamera(58, WIDTH / HEIGHT, 0.1, 80)
  camera.position.set(0, 2.2, 5.4)
  camera.lookAt(0, 0.2, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function blendlinkCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(58, WIDTH / HEIGHT, 0.1, 80)
  camera.position.set(0, 2.2, 5.4)
  camera.lookAt(0, 0.2, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function addNeedleSubject(scene: NEEDLE_THREE.Scene): void {
  const subject = new NEEDLE_THREE.Mesh(
    new NEEDLE_THREE.BoxGeometry(2, 1, 3),
    new NEEDLE_THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  subject.name = 'OffOriginSubject'
  subject.position.set(3, -1, 1)
  scene.add(subject)
}

function addBlendlinkSubject(root: THREE.Group): void {
  const subject = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  )
  subject.name = 'OffOriginSubject'
  subject.position.set(3, -1, 1)
  root.add(subject)
}

async function renderNeedle(
  canvasId: string,
  options: { rotationDegrees: number; intensity: number; autoFit: boolean; subject: boolean },
): Promise<RenderedCell> {
  const renderer = configureNeedleRenderer(requiredCanvas(canvasId))
  const scene = new NEEDLE_THREE.Scene()
  const camera = needleCamera()
  const host = new NEEDLE_THREE.Group()
  host.name = 'GroundProjectionHost'
  scene.add(host)
  if (options.subject) addNeedleSubject(scene)

  const texture = await new NeedleRGBELoader().loadAsync(HDR_URL)
  texture.mapping = NEEDLE_THREE.EquirectangularReflectionMapping
  scene.background = texture
  scene.backgroundIntensity = options.intensity
  scene.backgroundBlurriness = 0
  scene.backgroundRotation.set(0, NEEDLE_THREE.MathUtils.degToRad(options.rotationDegrees), 0)

  const component = new GroundProjectedEnv()
  component.context = {
    scene,
    renderer,
    xr: null,
    isInPassThrough: false,
    time: { frameCount: 1 },
    pre_render_callbacks: [],
    post_render_callbacks: [],
  } as never
  component.gameObject = host as never
  component.autoFit = options.autoFit
  component.radius = RADIUS_METERS
  component.height = HEIGHT_METERS
  component.updateProjection()
  component.onBeforeRender()

  const projection = (component as unknown as { _projection?: NEEDLE_THREE.Mesh })._projection
  if (!projection) throw new Error('Pinned Needle GroundProjectedEnv did not create a projection')
  const triangles = projection.geometry.index
    ? projection.geometry.index.count / 3
    : projection.geometry.getAttribute('position').count / 3
  const worldPosition = projection.getWorldPosition(new NEEDLE_THREE.Vector3())
  const pixels = readNeedlePixels(renderer, scene, camera)
  const summary = summarize(pixels)
  writeOutput(
    `${canvasId}-output`,
    `${triangles.toLocaleString()} tris · pos ${worldPosition.toArray().map((v) => v.toFixed(2)).join(', ')}`,
  )

  return {
    pixels,
    summary,
    geometryTriangles: triangles,
    projectionPosition: worldPosition.toArray() as [number, number, number],
    dispose() {
      const geometryBefore = renderer.info.memory.geometries
      component.onDisable()
      renderer.render(scene, camera)
      const geometryAfterRemove = renderer.info.memory.geometries
      const remainedParented = projection.parent !== null
      projection.geometry.dispose()
      const materials = Array.isArray(projection.material) ? projection.material : [projection.material]
      materials.forEach((material) => material.dispose())
      texture.dispose()
      renderer.renderLists.dispose()
      const geometryAfterManualDispose = renderer.info.memory.geometries
      renderer.dispose()
      return {
        geometryBefore,
        geometryAfterRemove,
        geometryAfterManualDispose,
        remainedParented,
        componentDisposedGeometry: geometryAfterRemove < geometryBefore,
      }
    },
  }
}

function blendlinkDescriptor(rotationDegrees: number, intensity: number) {
  return {
    url: '/ground-projection-evidence.glb',
    nodes: {},
    playback: null,
    look: {
      toneMapping: 'none' as const,
      exposure: 1,
      background: 'application' as const,
    },
    fog: null,
    shadows: null,
    environment: {
      source: 'image' as const,
      imageName: 'ground-projection-axis.hdr',
      lighting: 'none' as const,
      background: 'grounded' as const,
      lightingIntensity: 1,
      lightingRotation: 0,
      backgroundIntensity: intensity,
      backgroundRotation: rotationDegrees,
      backgroundBlur: 0,
      groundHeight: HEIGHT_METERS,
      groundRadius: RADIUS_METERS,
    },
    environmentAsset: {
      url: HDR_URL,
      sourceName: 'ground-projection-axis.hdr',
      format: 'hdr' as const,
      bytes: 0,
      hash: 'inline-browser-fixture',
      source: 'packed' as const,
    },
  }
}

function blendlinkSafetyDescriptor() {
  const value = blendlinkDescriptor(0, 1)
  value.environment.groundHeight = 1
  value.environment.groundRadius = 100
  return value
}

async function renderBlendlink(
  canvasId: string,
  options: { rotationDegrees: number; intensity: number; subject: boolean },
): Promise<RenderedCell> {
  const renderer = configureBlendlinkRenderer(requiredCanvas(canvasId))
  const scene = new THREE.Scene()
  const camera = blendlinkCamera()
  const root = new THREE.Group()
  root.name = 'CompiledRoot'
  if (options.subject) addBlendlinkSubject(root)

  const loaded = {
    scene: root,
    scenes: [root],
    animations: [],
    cameras: [],
    asset: {},
    parser: {},
    userData: {},
  }
  const handle = await installLoadedThreeCompiledScene(loaded as never, {
    descriptor: blendlinkDescriptor(options.rotationDegrees, options.intensity),
    renderer,
    scene,
    fallbackCamera: camera,
    prewarm: false,
  })
  const projection = handle.environment.groundedBackground
  if (!(projection instanceof THREE.Mesh)) {
    throw new Error('Blendlink production installer did not create a GroundedSkybox')
  }
  const triangles = projection.geometry.index
    ? projection.geometry.index.count / 3
    : projection.geometry.getAttribute('position').count / 3
  const worldPosition = projection.getWorldPosition(new THREE.Vector3())
  const pixels = readBlendlinkPixels(renderer, scene, camera)
  const summary = summarize(pixels)
  writeOutput(
    `${canvasId}-output`,
    `${triangles.toLocaleString()} tris · pos ${worldPosition.toArray().map((v) => v.toFixed(2)).join(', ')}`,
  )

  return {
    pixels,
    summary,
    geometryTriangles: triangles,
    projectionPosition: worldPosition.toArray() as [number, number, number],
    dispose() {
      const geometryBefore = renderer.info.memory.geometries
      handle.dispose()
      renderer.render(scene, camera)
      const geometryAfterDispose = renderer.info.memory.geometries
      const remainedParented = projection.parent !== null
      renderer.renderLists.dispose()
      renderer.dispose()
      return {
        geometryBefore,
        geometryAfterDispose,
        remainedParented,
        installerDisposedGeometry: geometryAfterDispose < geometryBefore,
      }
    },
  }
}

async function renderBlendlinkCameraSafety(
  canvasId: string,
  farMode: 'unsafe-control' | 'package-repaired' | 'safe-reference',
): Promise<CameraSafetyCell> {
  const renderer = configureBlendlinkRenderer(requiredCanvas(canvasId))
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  root.name = 'CameraSafetyCompiledRoot'
  root.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  ))
  const loaded = {
    scene: root,
    scenes: [root],
    animations: [],
    cameras: [],
    asset: {},
    parser: {},
    userData: {},
  }
  const handle = await installLoadedThreeCompiledScene(loaded as never, {
    descriptor: blendlinkSafetyDescriptor(),
    renderer,
    scene,
    initialViewport: { width: WIDTH, height: HEIGHT },
    prewarm: false,
  })
  const camera = handle.camera
  const projection = handle.environment.groundedBackground
  if (!(camera instanceof THREE.PerspectiveCamera) || !(projection instanceof THREE.Mesh)) {
    handle.dispose()
    renderer.dispose()
    throw new Error('Camera safety fixture needs Blendlink package-owned perspective projection')
  }

  // The unsafe cell deliberately restores the exact pre-fix package fallback
  // formula after installation. It is a browser control, not a supported API
  // path. The repaired and reference cells execute the production installer.
  const preFixFar = Math.sqrt(3) * 0.5 * 100
  if (farMode === 'unsafe-control') camera.far = preFixFar
  if (farMode === 'safe-reference') camera.far = 1000
  camera.updateProjectionMatrix()
  const safety = inspectThreeGroundedCameraSafety(camera, projection, 100)
  const triangles = projection.geometry.index
    ? projection.geometry.index.count / 3
    : projection.geometry.getAttribute('position').count / 3
  const worldPosition = projection.getWorldPosition(new THREE.Vector3())
  const pixels = readBlendlinkPixels(renderer, scene, camera)
  const summary = summarize(pixels)
  const presentedFar = camera.far
  camera.far = 1000
  camera.updateProjectionMatrix()
  const safeReferencePixels = readBlendlinkPixels(renderer, scene, camera)
  camera.far = presentedFar
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  writeOutput(
    `${canvasId}-output`,
    `far ${camera.far.toFixed(3)} / required ${safety.requiredFar.toFixed(3)} · ${safety.clippedVertexCount} clipped vertices`,
  )

  return {
    pixels,
    summary,
    geometryTriangles: triangles,
    projectionPosition: worldPosition.toArray() as [number, number, number],
    cameraFar: camera.far,
    requiredFar: safety.requiredFar,
    clippedVertexCount: safety.clippedVertexCount,
    safeReferencePixels,
    dispose() {
      const geometryBefore = renderer.info.memory.geometries
      handle.dispose()
      renderer.render(scene, camera)
      const geometryAfterDispose = renderer.info.memory.geometries
      const remainedParented = projection.parent !== null
      renderer.renderLists.dispose()
      renderer.dispose()
      return {
        geometryBefore,
        geometryAfterDispose,
        remainedParented,
        installerDisposedGeometry: geometryAfterDispose < geometryBefore,
      }
    },
  }
}

async function verifyUnsafeApplicationCameraRejection(
  kind: 'perspective' | 'orthographic',
): Promise<Record<string, unknown>> {
  const renderer = configureBlendlinkRenderer(document.createElement('canvas'))
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  const camera = kind === 'perspective'
    ? new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 10)
    : new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10)
  camera.position.set(1.5, 1, 2.4)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  const originalFar = camera.far
  const originalProjection = camera.projectionMatrix.clone()
  let message = ''
  try {
    await installLoadedThreeCompiledScene({
      scene: root,
      scenes: [root],
      animations: [],
      cameras: [],
      asset: {},
      parser: {},
      userData: {},
    } as never, {
      descriptor: blendlinkSafetyDescriptor(),
      renderer,
      scene,
      fallbackCamera: camera,
      prewarm: false,
    })
    throw new Error(`Unsafe ${kind} application camera unexpectedly installed`)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  } finally {
    renderer.dispose()
  }
  return {
    kind,
    message,
    farUnchanged: camera.far === originalFar,
    projectionUnchanged: camera.projectionMatrix.equals(originalProjection),
    rootRolledBack: root.parent === null,
    sceneChildren: scene.children.length,
  }
}

async function main(): Promise<void> {
  const errors: string[] = []
  try {
    const [
      needleCommon,
      blendlinkCommon,
      needleRotated,
      blendlinkRotated,
      needleIntensity,
      blendlinkIntensity,
      needleAutoFit,
      blendlinkAutoFit,
      cameraUnsafe,
      cameraRepaired,
      cameraReference,
      rejectedPerspective,
      rejectedOrthographic,
    ] = await Promise.all([
      renderNeedle('needle-common', {
        rotationDegrees: 0, intensity: 1, autoFit: false, subject: false,
      }),
      renderBlendlink('blendlink-common', {
        rotationDegrees: 0, intensity: 1, subject: false,
      }),
      renderNeedle('needle-rotated', {
        rotationDegrees: 90, intensity: 1, autoFit: false, subject: false,
      }),
      renderBlendlink('blendlink-rotated', {
        rotationDegrees: 90, intensity: 1, subject: false,
      }),
      renderNeedle('needle-intensity', {
        rotationDegrees: 0, intensity: 0.65, autoFit: false, subject: false,
      }),
      renderBlendlink('blendlink-intensity', {
        rotationDegrees: 0, intensity: 0.65, subject: false,
      }),
      renderNeedle('needle-autofit', {
        rotationDegrees: 0, intensity: 1, autoFit: true, subject: true,
      }),
      renderBlendlink('blendlink-autofit', {
        rotationDegrees: 0, intensity: 1, subject: true,
      }),
      renderBlendlinkCameraSafety('blendlink-camera-unsafe', 'unsafe-control'),
      renderBlendlinkCameraSafety('blendlink-camera-repaired', 'package-repaired'),
      renderBlendlinkCameraSafety('blendlink-camera-reference', 'safe-reference'),
      verifyUnsafeApplicationCameraRejection('perspective'),
      verifyUnsafeApplicationCameraRejection('orthographic'),
    ])

    const cells = {
      needleCommon,
      blendlinkCommon,
      needleRotated,
      blendlinkRotated,
      needleIntensity,
      blendlinkIntensity,
      needleAutoFit,
      blendlinkAutoFit,
      cameraUnsafe,
      cameraRepaired,
      cameraReference,
    }
    ;(window as unknown as {
      __groundProjectionEvidence: Record<string, unknown>
    }).__groundProjectionEvidence = {
      ready: true,
      errors,
      shared: {
        common: comparePixels(needleCommon.pixels, blendlinkCommon.pixels),
        rotated: comparePixels(needleRotated.pixels, blendlinkRotated.pixels),
        needleEquirectangularRotationEffect: comparePixels(
          needleCommon.pixels,
          needleRotated.pixels,
        ),
        blendlinkEquirectangularRotationEffect: comparePixels(
          blendlinkCommon.pixels,
          blendlinkRotated.pixels,
        ),
        intensity: comparePixels(needleIntensity.pixels, blendlinkIntensity.pixels),
        autoFit: comparePixels(needleAutoFit.pixels, blendlinkAutoFit.pixels),
        cameraUnsafeToReference: comparePixels(
          cameraUnsafe.pixels,
          cameraUnsafe.safeReferencePixels,
        ),
        cameraRepairedToReference: comparePixels(
          cameraRepaired.pixels,
          cameraRepaired.safeReferencePixels,
        ),
      },
      cells: Object.fromEntries(
        Object.entries(cells).map(([name, cell]) => [name, {
          summary: cell.summary,
          geometryTriangles: cell.geometryTriangles,
          projectionPosition: cell.projectionPosition,
          ...('cameraFar' in cell ? {
            cameraFar: cell.cameraFar,
            requiredFar: cell.requiredFar,
            clippedVertexCount: cell.clippedVertexCount,
          } : {}),
        }]),
      ),
      cameraOwnership: {
        rejectedPerspective,
        rejectedOrthographic,
      },
      dispose() {
        return Object.fromEntries(
          Object.entries(cells).map(([name, cell]) => [name, cell.dispose()]),
        )
      },
    }
  } catch (error) {
    errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
    ;(window as unknown as {
      __groundProjectionEvidence: Record<string, unknown>
    }).__groundProjectionEvidence = { ready: true, errors }
  }
}

void main()
