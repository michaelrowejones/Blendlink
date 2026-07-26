import * as BlendlinkThree from 'three'
import { ContactShadows as NeedleContactShadows } from '../needle-spike/node_modules/@needle-tools/engine/lib/engine-components/ContactShadows.js'
import { Context as NeedleContext } from '../needle-spike/node_modules/@needle-tools/engine/lib/engine/engine_context.js'
import { initObject3DExtensions } from '../needle-spike/node_modules/@needle-tools/engine/lib/engine/js-extensions/Object3D.js'
import { patchLayers } from '../needle-spike/node_modules/@needle-tools/engine/lib/engine/js-extensions/Layers.js'
import * as NeedleThree from '../needle-spike/node_modules/@needle-tools/engine/node_modules/three/build/three.module.js'
import {
  installThreeContactShadows,
} from '../../packages/blendlink/dist/threeContactShadows.js'

const WIDTH = 400
const HEIGHT = 300
const MASK_SIZE = 512
const disposals: Array<() => void> = []
const errors: string[] = []

// The public Needle entry point calls these exact initializers as part of
// initEngine(). Calling only the two dependencies ContactShadows uses keeps
// this differential harness offline and avoids unrelated loader side effects.
patchLayers()
initObject3DExtensions()

type RenderEvent = {
  index: number
  scene: string
  camera: string
  target: string | null
  width: number | null
  height: number | null
  calls: number
  triangles: number
  lines: number
  points: number
  cpuMs: number
}

type Instrumentation = {
  renderEvents: RenderEvent[]
  targets: any[]
  restore(): void
}

type MaskMetrics = {
  nonzeroAlpha: number
  partialAlpha: number
  opaqueAlpha: number
  alphaSum: number
  alphaMean: number
  alphaMax: number
  regions: { left: number; center: number; right: number }
}

type ImplementationResult = {
  implementation: 'needle' | 'blendlink'
  threeRevision: string
  externalContext?: {
    constructor: string
    isManagedExternally: boolean
    rendererIdentity: boolean
    sceneIdentity: boolean
    cameraIdentity: boolean
  }
  passEvents: RenderEvent[]
  passCount: number
  drawCalls: number
  target: {
    width: number
    height: number
    depthBuffer: boolean
    stencilBuffer: boolean
    generateMipmaps: boolean
  }
  raw: number[]
  mask: MaskMetrics
  composite: {
    shadowDarkenedPixels: number
    maxDarkening: number
  }
  helperPlaneLayerMask: number
  cameraLayerMask: number
  memory: {
    before: { geometries: number; textures: number }
    installed: { geometries: number; textures: number }
  }
  scheduling?: {
    firstFrameAuxiliaryRenders?: number
    unchangedStaticFrames?: number
    laterStaticAuxiliaryRenders?: number
    continuousFrames?: number
    continuousAuxiliaryRenders?: number[]
    needleDefaultFrames?: number
    needleDefaultAuxiliaryRenders?: number[]
  }
  firstSetup?: {
    passCount: number
    drawCalls: number
    mask: MaskMetrics
  }
  webgl?: ReturnType<typeof rendererIdentity>
}

declare global {
  interface Window {
    __contactShadowEvidence?: {
      ready: boolean
      errors: string[]
      matched?: {
        needle: Omit<ImplementationResult, 'raw'>
        blendlink: Omit<ImplementationResult, 'raw'>
        rawAlphaComparison: {
          mae: number
          rmse: number
          maximumError: number
          pearson: number
        }
      }
      layers?: {
        needle: { shadowDarkenedPixels: number; helperPlaneLayerMask: number; cameraLayerMask: number }
        blendlink: { shadowDarkenedPixels: number; helperPlaneLayerMask: number; cameraLayerMask: number }
      }
      exclusions?: {
        needle: MaskMetrics
        blendlink: MaskMetrics
      }
      renderer: {
        userAgent: string
        webglVersion: string
        glVendor: string
        glRenderer: string
        unmaskedVendor: string | null
        unmaskedRenderer: string | null
        dpr: number
        canvas: { width: number; height: number }
      } | null
      dispose(): void
    }
  }
}

function canvas(id: string): HTMLCanvasElement {
  const result = document.querySelector<HTMLCanvasElement>(`#${id}`)
  if (!result) throw new Error(`Missing #${id} canvas`)
  return result
}

function output(id: string, text: string): void {
  const element = document.querySelector<HTMLOutputElement>(`#${id}`)
  if (element) element.textContent = text
}

function makeRenderer(THREE: any, id: string): any {
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas(id),
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.setClearColor(0xf1eee7, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.info.autoReset = false
  renderer.info.reset()
  return renderer
}

function instrument(renderer: any): Instrumentation {
  const renderEvents: RenderEvent[] = []
  const targets: any[] = []
  const originalSetRenderTarget = renderer.setRenderTarget.bind(renderer)
  const originalRender = renderer.render.bind(renderer)
  renderer.setRenderTarget = (target: any, activeCubeFace?: number, activeMipmapLevel?: number) => {
    if (target && !targets.includes(target)) targets.push(target)
    return originalSetRenderTarget(target, activeCubeFace, activeMipmapLevel)
  }
  renderer.render = (scene: any, camera: any) => {
    const before = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      points: renderer.info.render.points,
    }
    const target = renderer.getRenderTarget()
    const started = performance.now()
    const result = originalRender(scene, camera)
    renderEvents.push({
      index: renderEvents.length,
      scene: scene?.name || scene?.type || '(unnamed)',
      camera: camera?.name || camera?.type || '(unnamed)',
      target: target?.texture?.name || target?.texture?.uuid || null,
      width: target?.width ?? null,
      height: target?.height ?? null,
      calls: renderer.info.render.calls - before.calls,
      triangles: renderer.info.render.triangles - before.triangles,
      lines: renderer.info.render.lines - before.lines,
      points: renderer.info.render.points - before.points,
      cpuMs: performance.now() - started,
    })
    return result
  }
  return {
    renderEvents,
    targets,
    restore() {
      renderer.setRenderTarget = originalSetRenderTarget
      renderer.render = originalRender
    },
  }
}

function configureCamera(THREE: any, layer: number | null): any {
  const camera = new THREE.PerspectiveCamera(36, WIDTH / HEIGHT, 0.1, 30)
  camera.name = 'Evidence Main Camera'
  if (layer === null) camera.layers.enableAll()
  else camera.layers.set(layer)
  camera.position.set(4.2, 3.4, 5.2)
  camera.lookAt(0, 0.42, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function addCaster(
  THREE: any,
  root: any,
  options: {
    x?: number
    transparent?: boolean
    allowOverride?: boolean
    layer?: number | null
    color?: number
  } = {},
): any {
  const material = new THREE.MeshBasicMaterial({
    color: options.color ?? 0xd67f4b,
    transparent: options.transparent ?? false,
    opacity: options.transparent ? 0.72 : 1,
  })
  if (options.allowOverride === false) material.allowOverride = false
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.25, 0.9), material)
  mesh.name = options.allowOverride === false
    ? 'allowOverride=false caster'
    : options.transparent
      ? 'transparent caster'
      : 'opaque caster'
  mesh.position.set(options.x ?? 0, 0.69, 0)
  if (options.layer !== null && options.layer !== undefined) mesh.layers.set(options.layer)
  root.add(mesh)
  return mesh
}

function makeScene(
  THREE: any,
  options: {
    layer?: number | null
    exclusions?: boolean
  } = {},
): { scene: any; root: any; anchor: any; camera: any } {
  const scene = new THREE.Scene()
  scene.name = 'Evidence Scene'
  scene.background = new THREE.Color(0xf1eee7)
  const root = new THREE.Group()
  root.name = 'Evidence Compiled Root'
  scene.add(root)
  const anchor = new THREE.Group()
  anchor.name = 'Evidence Contact Shadow Empty'
  anchor.scale.set(5, 2.6, 4)
  scene.add(anchor)
  if (options.exclusions) {
    addCaster(THREE, root, { x: -1.25, transparent: true })
    addCaster(THREE, root, { x: 0 })
    addCaster(THREE, root, { x: 1.25, allowOverride: false, color: 0xffffff })
  } else {
    addCaster(THREE, root, { layer: options.layer ?? null })
  }
  const camera = configureCamera(THREE, options.layer ?? null)
  return { scene, root, anchor, camera }
}

function memory(renderer: any): { geometries: number; textures: number } {
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  }
}

function readTarget(renderer: any, target: any): Uint8Array {
  const pixels = new Uint8Array(MASK_SIZE * MASK_SIZE * 4)
  renderer.readRenderTargetPixels(target, 0, 0, MASK_SIZE, MASK_SIZE, pixels)
  return pixels
}

function readCanvas(renderer: any): Uint8Array {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return pixels
}

function maskMetrics(raw: Uint8Array): MaskMetrics {
  let nonzeroAlpha = 0
  let partialAlpha = 0
  let opaqueAlpha = 0
  let alphaSum = 0
  let alphaMax = 0
  const regions = { left: 0, center: 0, right: 0 }
  for (let index = 0; index < MASK_SIZE * MASK_SIZE; index += 1) {
    const alpha = raw[index * 4 + 3]!
    if (alpha > 0) nonzeroAlpha += 1
    if (alpha > 0 && alpha < 255) partialAlpha += 1
    if (alpha === 255) opaqueAlpha += 1
    alphaSum += alpha
    alphaMax = Math.max(alphaMax, alpha)
    const x = index % MASK_SIZE
    if (x < MASK_SIZE / 3) regions.left += alpha
    else if (x < MASK_SIZE * 2 / 3) regions.center += alpha
    else regions.right += alpha
  }
  return {
    nonzeroAlpha,
    partialAlpha,
    opaqueAlpha,
    alphaSum,
    alphaMean: alphaSum / (MASK_SIZE * MASK_SIZE),
    alphaMax,
    regions,
  }
}

function drawRaw(id: string, raw: Uint8Array): void {
  const target = canvas(id)
  const context = target.getContext('2d')
  if (!context) throw new Error(`Could not create 2D context for #${id}`)
  const image = context.createImageData(MASK_SIZE, MASK_SIZE)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    const sourceY = MASK_SIZE - 1 - y
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const source = (sourceY * MASK_SIZE + x) * 4
      const destination = (y * MASK_SIZE + x) * 4
      const alpha = raw[source + 3]!
      image.data[destination] = 255 - alpha
      image.data[destination + 1] = 255 - alpha
      image.data[destination + 2] = 255 - alpha
      image.data[destination + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
}

function compositeDifference(withShadow: Uint8Array, withoutShadow: Uint8Array): {
  shadowDarkenedPixels: number
  maxDarkening: number
} {
  let shadowDarkenedPixels = 0
  let maxDarkening = 0
  for (let offset = 0; offset < withShadow.length; offset += 4) {
    const withLuma =
      withShadow[offset]! * 0.2126 +
      withShadow[offset + 1]! * 0.7152 +
      withShadow[offset + 2]! * 0.0722
    const withoutLuma =
      withoutShadow[offset]! * 0.2126 +
      withoutShadow[offset + 1]! * 0.7152 +
      withoutShadow[offset + 2]! * 0.0722
    const darkening = withoutLuma - withLuma
    if (darkening > 4) shadowDarkenedPixels += 1
    maxDarkening = Math.max(maxDarkening, darkening)
  }
  return { shadowDarkenedPixels, maxDarkening }
}

function findPlane(root: any, prefix: string): any {
  let result: any
  root.traverse((object: any) => {
    if (!result && object.isMesh && object.material?.map &&
        (object.name.includes(prefix) || object.material.name?.includes(prefix))) {
      result = object
    }
  })
  if (!result) throw new Error(`Could not find ${prefix} display plane`)
  return result
}

function renderComposite(
  renderer: any,
  scene: any,
  camera: any,
  plane: any,
): { shadowDarkenedPixels: number; maxDarkening: number } {
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  const withShadow = readCanvas(renderer)
  const visible = plane.visible
  plane.visible = false
  renderer.render(scene, camera)
  const withoutShadow = readCanvas(renderer)
  plane.visible = visible
  renderer.render(scene, camera)
  return compositeDifference(withShadow, withoutShadow)
}

function withoutRaw(result: ImplementationResult): Omit<ImplementationResult, 'raw'> {
  const { raw: _raw, ...rest } = result
  return rest
}

async function runNeedle(
  id: string,
  options: { layer?: number | null; exclusions?: boolean } = {},
): Promise<ImplementationResult> {
  const renderer = makeRenderer(NeedleThree, id)
  const instrumentation = instrument(renderer)
  const { scene, root, anchor, camera } = makeScene(NeedleThree, options)
  const host = document.querySelector<HTMLElement>('#needle-context-host')
  if (!host) throw new Error('Missing Needle Context host')
  const context = new NeedleContext({
    name: `contact-shadows-evidence-${id}`,
    domElement: host,
    renderer,
    scene,
    camera,
    runInBackground: true,
  })
  const externalContext = {
    constructor: context.constructor.name,
    isManagedExternally: context.isManagedExternally,
    rendererIdentity: context.renderer === renderer,
    sceneIdentity: context.scene === scene,
    cameraIdentity: context.mainCamera === camera,
  }
  const contact = new NeedleContactShadows({
    autoFit: false,
    darkness: 0.5,
    opacity: 0.5,
    blur: 4,
    occludeBelowGround: false,
    backfaceShadows: true,
  })
  contact.context = context
  contact.gameObject = anchor
  anchor.userData.components = [contact]
  contact.__internalAwake()
  contact.__internalEnable()

  scene.updateMatrixWorld(true)
  renderer.render(scene, camera)
  const before = memory(renderer)
  const firstPassStart = instrumentation.renderEvents.length
  contact.renderShadowsNow()
  const firstPassEvents = instrumentation.renderEvents.slice(firstPassStart)
  const target = contact.renderTarget
  if (!target) throw new Error('Needle ContactShadows did not create its render target')
  const firstRaw = readTarget(renderer, target)

  // Needle creates its helper hierarchy during the first pass, after the
  // caller's matrix update. Give that newly attached hierarchy one normal
  // world-matrix update before capturing the settled, like-for-like pass.
  scene.updateMatrixWorld(true)
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  const passStart = instrumentation.renderEvents.length
  contact.renderShadowsNow()
  const passEvents = instrumentation.renderEvents.slice(passStart)
  const raw = readTarget(renderer, target)
  const plane = findPlane(anchor, 'ContactShadows Plane')
  const composite = renderComposite(renderer, scene, camera, plane)
  const installed = memory(renderer)
  const needleDefaultAuxiliaryRenders: number[] = []
  for (let frame = 0; frame < 3; frame += 1) {
    const start = instrumentation.renderEvents.length
    contact.onBeforeRender(null)
    needleDefaultAuxiliaryRenders.push(instrumentation.renderEvents.length - start)
  }

  disposals.push(() => {
    try { contact.destroy() } finally {
      instrumentation.restore()
      context.dispose()
      renderer.dispose()
    }
  })
  return {
    implementation: 'needle',
    threeRevision: NeedleThree.REVISION,
    externalContext,
    passEvents,
    passCount: passEvents.length,
    drawCalls: passEvents.reduce((sum, event) => sum + event.calls, 0),
    target: {
      width: target.width,
      height: target.height,
      depthBuffer: target.depthBuffer,
      stencilBuffer: target.stencilBuffer,
      generateMipmaps: target.texture.generateMipmaps,
    },
    raw: [...raw],
    mask: maskMetrics(raw),
    composite,
    helperPlaneLayerMask: plane.layers.mask,
    cameraLayerMask: camera.layers.mask,
    memory: { before, installed },
    firstSetup: {
      passCount: firstPassEvents.length,
      drawCalls: firstPassEvents.reduce((sum, event) => sum + event.calls, 0),
      mask: maskMetrics(firstRaw),
    },
    scheduling: {
      needleDefaultFrames: 3,
      needleDefaultAuxiliaryRenders,
    },
  }
}

function blendlinkValues(updatePolicy: 'static' | 'continuous') {
  return {
    autoFit: false,
    darkness: 0.5,
    opacity: 0.5,
    blur: 4,
    occludeBelowGround: false,
    backfaceShadows: true,
    updatePolicy,
  } as const
}

async function runBlendlink(
  id: string,
  options: {
    layer?: number | null
    exclusions?: boolean
    scheduling?: boolean
  } = {},
): Promise<ImplementationResult> {
  const renderer = makeRenderer(BlendlinkThree, id)
  const instrumentation = instrument(renderer)
  const { scene, root, anchor, camera } = makeScene(BlendlinkThree, options)
  scene.updateMatrixWorld(true)
  renderer.render(scene, camera)
  const before = memory(renderer)
  const installed = installThreeContactShadows({
    scene,
    root,
    anchor,
    renderer,
    camera,
    values: blendlinkValues('static'),
  })
  const passStart = instrumentation.renderEvents.length
  installed.update()
  installed.beforeRender()
  const passEvents = instrumentation.renderEvents.slice(passStart)
  const target = instrumentation.targets.find((candidate) =>
    candidate.texture?.name === 'Blendlink Contact Shadows')
  if (!target) throw new Error('Blendlink Contact Shadows did not expose its named render target')
  const raw = readTarget(renderer, target)
  const plane = findPlane(anchor, 'Blendlink Contact Shadows Plane')
  const composite = renderComposite(renderer, scene, camera, plane)
  const installedMemory = memory(renderer)
  let scheduling: ImplementationResult['scheduling']

  if (options.scheduling) {
    const afterFirst = instrumentation.renderEvents.length
    for (let index = 0; index < 120; index += 1) {
      installed.update()
      installed.beforeRender()
    }
    const laterStaticAuxiliaryRenders =
      instrumentation.renderEvents.length - afterFirst

    const continuousScene = makeScene(BlendlinkThree)
    const continuous = installThreeContactShadows({
      scene: continuousScene.scene,
      root: continuousScene.root,
      anchor: continuousScene.anchor,
      renderer,
      camera: continuousScene.camera,
      values: blendlinkValues('continuous'),
    })
    const continuousAuxiliaryRenders: number[] = []
    for (let frame = 0; frame < 3; frame += 1) {
      const start = instrumentation.renderEvents.length
      continuous.update()
      continuous.beforeRender()
      continuousAuxiliaryRenders.push(instrumentation.renderEvents.length - start)
    }
    continuous.dispose()
    scheduling = {
      firstFrameAuxiliaryRenders: passEvents.length,
      unchangedStaticFrames: 120,
      laterStaticAuxiliaryRenders,
      continuousFrames: 3,
      continuousAuxiliaryRenders,
    }
  }

  disposals.push(() => {
    try { installed.dispose() } finally {
      instrumentation.restore()
      renderer.dispose()
    }
  })
  return {
    implementation: 'blendlink',
    threeRevision: BlendlinkThree.REVISION,
    passEvents,
    passCount: passEvents.length,
    drawCalls: passEvents.reduce((sum, event) => sum + event.calls, 0),
    target: {
      width: target.width,
      height: target.height,
      depthBuffer: target.depthBuffer,
      stencilBuffer: target.stencilBuffer,
      generateMipmaps: target.texture.generateMipmaps,
    },
    raw: [...raw],
    mask: maskMetrics(raw),
    composite,
    helperPlaneLayerMask: plane.layers.mask,
    cameraLayerMask: camera.layers.mask,
    memory: { before, installed: installedMemory },
    ...(scheduling ? { scheduling } : {}),
    webgl: rendererIdentity(renderer),
  }
}

function compareAlpha(needle: readonly number[], blendlink: readonly number[]) {
  let absolute = 0
  let squared = 0
  let maximumError = 0
  let sumA = 0
  let sumB = 0
  const count = MASK_SIZE * MASK_SIZE
  for (let index = 0; index < count; index += 1) {
    const a = needle[index * 4 + 3]!
    const b = blendlink[index * 4 + 3]!
    const error = Math.abs(a - b)
    absolute += error
    squared += error * error
    maximumError = Math.max(maximumError, error)
    sumA += a
    sumB += b
  }
  const meanA = sumA / count
  const meanB = sumB / count
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let index = 0; index < count; index += 1) {
    const a = needle[index * 4 + 3]! - meanA
    const b = blendlink[index * 4 + 3]! - meanB
    covariance += a * b
    varianceA += a * a
    varianceB += b * b
  }
  return {
    mae: absolute / count,
    rmse: Math.sqrt(squared / count),
    maximumError,
    pearson: covariance / Math.sqrt(Math.max(1e-12, varianceA * varianceB)),
  }
}

function rendererIdentity(renderer: any) {
  const gl = renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    userAgent: navigator.userAgent,
    webglVersion: gl.getParameter(gl.VERSION),
    glVendor: gl.getParameter(gl.VENDOR),
    glRenderer: gl.getParameter(gl.RENDERER),
    unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
    unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    dpr: window.devicePixelRatio,
    canvas: { width: WIDTH, height: HEIGHT },
  }
}

async function main(): Promise<void> {
  window.__contactShadowEvidence = {
    ready: false,
    errors,
    renderer: null,
    dispose() {
      for (const dispose of disposals.splice(0).reverse()) {
        try { dispose() } catch (error) {
          errors.push(`dispose: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }
  try {
    const needle = await runNeedle('needle-composite')
    const blendlink = await runBlendlink('blendlink-composite', { scheduling: true })
    drawRaw('needle-raw', new Uint8Array(needle.raw))
    drawRaw('blendlink-raw', new Uint8Array(blendlink.raw))
    output(
      'needle-composite-output',
      `5-pass=${needle.passCount} · GL draws=${needle.drawCalls} · darkened=${needle.composite.shadowDarkenedPixels}`,
    )
    output(
      'blendlink-composite-output',
      `5-pass=${blendlink.passCount} · GL draws=${blendlink.drawCalls} · darkened=${blendlink.composite.shadowDarkenedPixels}`,
    )
    output(
      'needle-raw-output',
      `alpha mean=${needle.mask.alphaMean.toFixed(3)} · nonzero=${needle.mask.nonzeroAlpha} · depth=${needle.target.depthBuffer}`,
    )
    output(
      'blendlink-raw-output',
      `alpha mean=${blendlink.mask.alphaMean.toFixed(3)} · nonzero=${blendlink.mask.nonzeroAlpha} · depth=${blendlink.target.depthBuffer}`,
    )

    const needleLayer = await runNeedle('needle-layer', { layer: 6 })
    const blendlinkLayer = await runBlendlink('blendlink-layer', { layer: 6 })
    output(
      'needle-layer-output',
      `camera mask=${needleLayer.cameraLayerMask} · helper mask=${needleLayer.helperPlaneLayerMask} · darkened=${needleLayer.composite.shadowDarkenedPixels}`,
    )
    output(
      'blendlink-layer-output',
      `camera mask=${blendlinkLayer.cameraLayerMask} · helper mask=${blendlinkLayer.helperPlaneLayerMask} · darkened=${blendlinkLayer.composite.shadowDarkenedPixels}`,
    )

    const needleExclusion = await runNeedle('needle-exclusion-webgl', { exclusions: true })
    const blendlinkExclusion = await runBlendlink(
      'blendlink-exclusion-webgl',
      { exclusions: true },
    )
    drawRaw('needle-exclusion', new Uint8Array(needleExclusion.raw))
    drawRaw('blendlink-exclusion', new Uint8Array(blendlinkExclusion.raw))
    output(
      'needle-exclusion-output',
      `transparent=${needleExclusion.mask.regions.left} · opaque=${needleExclusion.mask.regions.center} · allowOverride=false=${needleExclusion.mask.regions.right}`,
    )
    output(
      'blendlink-exclusion-output',
      `transparent=${blendlinkExclusion.mask.regions.left} · opaque=${blendlinkExclusion.mask.regions.center} · allowOverride=false=${blendlinkExclusion.mask.regions.right}`,
    )

    window.__contactShadowEvidence.matched = {
      needle: withoutRaw(needle),
      blendlink: withoutRaw(blendlink),
      rawAlphaComparison: compareAlpha(needle.raw, blendlink.raw),
    }
    window.__contactShadowEvidence.layers = {
      needle: {
        shadowDarkenedPixels: needleLayer.composite.shadowDarkenedPixels,
        helperPlaneLayerMask: needleLayer.helperPlaneLayerMask,
        cameraLayerMask: needleLayer.cameraLayerMask,
      },
      blendlink: {
        shadowDarkenedPixels: blendlinkLayer.composite.shadowDarkenedPixels,
        helperPlaneLayerMask: blendlinkLayer.helperPlaneLayerMask,
        cameraLayerMask: blendlinkLayer.cameraLayerMask,
      },
    }
    window.__contactShadowEvidence.exclusions = {
      needle: needleExclusion.mask,
      blendlink: blendlinkExclusion.mask,
    }
    window.__contactShadowEvidence.renderer = blendlink.webgl ?? null
  } catch (error) {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    window.__contactShadowEvidence.ready = true
  }
}

void main()
