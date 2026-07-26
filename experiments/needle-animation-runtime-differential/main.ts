import {
  Animation,
  getComponentInChildren,
} from '../needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/lib/needle-engine.js'
import * as ENGINE_THREE from '../needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/node_modules/three/build/three.module.js'
import * as PROJECT_THREE from '../needle-coherent-addon-1.4.2/node_modules/three/build/three.module.js'

type TransformSample = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

type ReferenceSample = {
  frame: number
  timeSeconds: number
  transform: TransformSample
  morphInfluence: number
  deformedWorldPoints: [number, number, number][]
}

type Reference = {
  schemaVersion: number
  fixture: {
    transformObject: { name: string; blendlinkId: string }
    skinnedMesh: {
      name: string
      blendlinkId: string
      boneNames: string[]
      morphTarget: string
    }
  }
  samples: ReferenceSample[]
}

type LoadedModel = {
  src: string
  file: {
    scene: ENGINE_THREE.Object3D
    animations: ENGINE_THREE.AnimationClip[]
  }
}

type SampleEvidence = {
  frame: number
  timeSeconds: number
  transformPositionError: number
  transformQuaternionAngleRadians: number
  morphInfluenceError: number
  deformedPointHausdorff: number
  browserGeometryVertices: number
  browserDeformedUniquePoints: number
}

type DisposalEvidence = {
  elementDisconnected: boolean
  elementContextCleared: boolean
  rendererClearedFromContext: boolean
  registeredMixersAfterDispose: number
  actionsRunningAfterDispose: number
}

type BrowserEvidence = {
  engineAdvertisedVersion: string
  engineThreeRevision: string
  projectThreeRevision: string
  globalThreeRevision: string | null
  webglVersion: string
  webglRenderer: string
  loadingPath: '<needle-engine src autoplay>'
  playbackPath: 'Animation.play(exclusive:false)/pause/time/update'
  component: {
    constructorName: string
    autoCreatedWithoutNeedleComponentMetadata: boolean
    initialAutoplayActionNames: string[]
    animationNames: string[]
    actionCount: number
    coordinatedClipCount: number
    playReturnedPromise: boolean
    registeredMixerCount: number
  }
  crossCopy: {
    projectAndEngineObject3DConstructorsSame: boolean
    projectAndEngineAnimationMixerConstructorsSame: boolean
    loadedRootIsEngineObject3D: boolean
    loadedRootIsProjectObject3D: boolean
    skinnedMeshIsEngineSkinnedMesh: boolean
    skinnedMeshIsProjectSkinnedMesh: boolean
    componentMixerIsEngineAnimationMixer: boolean
    componentMixerIsProjectAnimationMixer: boolean
    projectVectorAcceptedByLoadedObject: boolean
    projectVectorPositionDelta: number
  }
  clipNames: string[]
  clipDurations: number[]
  animationTrackCount: number
  samples: SampleEvidence[]
  maxima: {
    transformPositionError: number
    transformQuaternionAngleRadians: number
    morphInfluenceError: number
    deformedPointHausdorff: number
  }
  keyMaxima: BrowserEvidence['maxima']
  subframeMaxima: BrowserEvidence['maxima']
  pixels: {
    total: number
    nonBackground: number
    chromatic: number
    corner: [number, number, number, number]
  }
}

declare global {
  interface Window {
    THREE?: { REVISION?: string }
    __needleAnimationRuntimeEvidence?: {
      ready: boolean
      evidence?: BrowserEvidence
      errors: string[]
      dispose(): DisposalEvidence
    }
  }
}

const state: NonNullable<Window['__needleAnimationRuntimeEvidence']> = {
  ready: false,
  errors: [],
  dispose: () => ({
    elementDisconnected: false,
    elementContextCleared: false,
    rendererClearedFromContext: false,
    registeredMixersAfterDispose: -1,
    actionsRunningAfterDispose: -1,
  }),
}
window.__needleAnimationRuntimeEvidence = state

function vec3(values: readonly number[]): ENGINE_THREE.Vector3 {
  return new ENGINE_THREE.Vector3(values[0]!, values[1]!, values[2]!)
}

function quat(values: readonly number[]): ENGINE_THREE.Quaternion {
  return new ENGINE_THREE.Quaternion(
    values[0]!,
    values[1]!,
    values[2]!,
    values[3]!,
  ).normalize()
}

function quaternionAngle(
  left: ENGINE_THREE.Quaternion,
  right: ENGINE_THREE.Quaternion,
): number {
  const dot = Math.min(1, Math.abs(left.dot(right)))
  return 2 * Math.acos(dot)
}

function maxNearestDistance(
  source: readonly ENGINE_THREE.Vector3[],
  target: readonly ENGINE_THREE.Vector3[],
): number {
  if (source.length === 0 || target.length === 0) return Number.POSITIVE_INFINITY
  let maximum = 0
  for (const point of source) {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of target) nearest = Math.min(nearest, point.distanceTo(candidate))
    maximum = Math.max(maximum, nearest)
  }
  return maximum
}

function hausdorff(
  left: readonly ENGINE_THREE.Vector3[],
  right: readonly ENGINE_THREE.Vector3[],
): number {
  return Math.max(maxNearestDistance(left, right), maxNearestDistance(right, left))
}

function uniquePoints(
  points: readonly ENGINE_THREE.Vector3[],
  epsilon = 1e-6,
): ENGINE_THREE.Vector3[] {
  const result: ENGINE_THREE.Vector3[] = []
  for (const point of points) {
    if (!result.some((candidate) => candidate.distanceToSquared(point) <= epsilon * epsilon)) {
      result.push(point.clone())
    }
  }
  return result
}

function findSkinnedMesh(root: ENGINE_THREE.Object3D): ENGINE_THREE.SkinnedMesh {
  let result: ENGINE_THREE.SkinnedMesh | undefined
  root.traverse((object) => {
    if (!result && (object as ENGINE_THREE.SkinnedMesh).isSkinnedMesh) {
      result = object as ENGINE_THREE.SkinnedMesh
    }
  })
  if (!result) throw new Error('Needle-loaded root contained no SkinnedMesh')
  return result
}

function transformedVertices(mesh: ENGINE_THREE.SkinnedMesh): ENGINE_THREE.Vector3[] {
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  const count = mesh.geometry.getAttribute('position').count
  const result: ENGINE_THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    const point = mesh.getVertexPosition(index, new ENGINE_THREE.Vector3())
    result.push(mesh.localToWorld(point))
  }
  return result
}

function framebufferEvidence(renderer: ENGINE_THREE.WebGLRenderer): BrowserEvidence['pixels'] {
  const size = renderer.getDrawingBufferSize(new ENGINE_THREE.Vector2())
  const pixels = new Uint8Array(size.x * size.y * 4)
  const context = renderer.getContext()
  context.readPixels(0, 0, size.x, size.y, context.RGBA, context.UNSIGNED_BYTE, pixels)
  const corner: [number, number, number, number] = [
    pixels[0]!,
    pixels[1]!,
    pixels[2]!,
    pixels[3]!,
  ]
  let nonBackground = 0
  let chromatic = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!
    const green = pixels[offset + 1]!
    const blue = pixels[offset + 2]!
    const alpha = pixels[offset + 3]!
    if (
      alpha > 0 &&
      Math.max(
        Math.abs(red - corner[0]),
        Math.abs(green - corner[1]),
        Math.abs(blue - corner[2]),
      ) > 10
    ) {
      nonBackground += 1
    }
    if (alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 30) {
      chromatic += 1
    }
  }
  return {
    total: size.x * size.y,
    nonBackground,
    chromatic,
    corner,
  }
}

function waitForAnimationComponent(
  root: ENGINE_THREE.Object3D,
): Promise<Animation> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const poll = () => {
      const animation = getComponentInChildren(root, Animation, true)
      if (animation?.actions?.length > 0) {
        resolve(animation)
        return
      }
      attempts += 1
      if (attempts >= 180) {
        reject(new Error(
          'Needle autoplay did not create and start an Animation component within 180 frames',
        ))
        return
      }
      requestAnimationFrame(poll)
    }
    poll()
  })
}

function waitForLoad(
  engine: HTMLElement,
): Promise<{ context: any; loadedFiles: LoadedModel[] }> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('<needle-engine> did not emit loadfinished within 60 seconds'))
    }, 60_000)
    engine.addEventListener('loadfinished', ((event: CustomEvent) => {
      window.clearTimeout(timeout)
      resolve(event.detail)
    }) as EventListener, { once: true })
    engine.addEventListener('error', ((event: CustomEvent) => {
      const detail = event.detail
      state.errors.push(detail instanceof Error ? detail.stack ?? detail.message : String(detail))
    }) as EventListener)
  })
}

function maximaFor(samples: SampleEvidence[]): BrowserEvidence['maxima'] {
  if (samples.length === 0) throw new Error('cannot compute maxima for an empty sample set')
  return {
    transformPositionError: Math.max(...samples.map(
      (sample) => sample.transformPositionError,
    )),
    transformQuaternionAngleRadians: Math.max(...samples.map(
      (sample) => sample.transformQuaternionAngleRadians,
    )),
    morphInfluenceError: Math.max(...samples.map(
      (sample) => sample.morphInfluenceError,
    )),
    deformedPointHausdorff: Math.max(...samples.map(
      (sample) => sample.deformedPointHausdorff,
    )),
  }
}

function updateFacts(evidence: BrowserEvidence): void {
  const format = (value: number) => value.toExponential(3)
  document.querySelector('#position-error')!.textContent =
    format(evidence.maxima.transformPositionError)
  document.querySelector('#quaternion-error')!.textContent =
    `${format(evidence.maxima.transformQuaternionAngleRadians)} rad`
  document.querySelector('#morph-error')!.textContent =
    format(evidence.maxima.morphInfluenceError)
  document.querySelector('#skin-error')!.textContent =
    format(evidence.maxima.deformedPointHausdorff)
  document.querySelector('#component-path')!.textContent =
    `${evidence.component.constructorName}: ${evidence.playbackPath}`
  document.querySelector('#three-copies')!.textContent =
    `Engine r${evidence.engineThreeRevision}; project r${evidence.projectThreeRevision}; ` +
    `identity=${evidence.crossCopy.loadedRootIsProjectObject3D ? 'shared' : 'separate'}`
  const status = document.querySelector('#status')!
  status.textContent = 'PASS — nine Blender times agree through Needle Animation'
  status.classList.add('pass')
}

async function run(): Promise<void> {
  const reference = await fetch(
    '/experiments/animation-deformation-browser/output/blender-reference.json',
  ).then((response) => {
    if (!response.ok) throw new Error(`reference fetch failed: HTTP ${response.status}`)
    return response.json() as Promise<Reference>
  })

  const stage = document.querySelector<HTMLDivElement>('#stage')!
  const engine = document.createElement('needle-engine') as HTMLElement & {
    context?: any
  }
  engine.id = 'needle-engine'
  engine.setAttribute(
    'src',
    '/experiments/animation-deformation-browser/output/animation-deformation-fixture.glb',
  )
  engine.setAttribute('autoplay', 'true')
  engine.setAttribute('camera-controls', 'false')
  engine.setAttribute('background-color', '#10182a')
  engine.setAttribute(
    'dracoDecoderPath',
    '/experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/' +
      'node_modules/three/examples/jsm/libs/draco/gltf/',
  )
  engine.setAttribute(
    'ktx2DecoderPath',
    '/experiments/needle-coherent-addon-1.4.2/node_modules/@needle-tools/engine/' +
      'node_modules/three/examples/jsm/libs/basis/',
  )
  const loadedPromise = waitForLoad(engine)
  stage.appendChild(engine)

  const { context, loadedFiles } = await loadedPromise
  if (loadedFiles.length !== 1) {
    throw new Error(`expected one Needle loaded file, got ${loadedFiles.length}`)
  }
  const loaded = loadedFiles[0]!
  const root = loaded.file.scene
  const animation = await waitForAnimationComponent(root)
  const initialAutoplayActionNames = animation.actions.map(
    (action: ENGINE_THREE.AnimationAction) => action.getClip().name,
  )

  // Freeze Needle's autonomous frame loop only after its loader and component
  // lifecycle have completed. All controlled samples still go through the
  // runtime-created Animation component and Context renderer below.
  context.renderer.setAnimationLoop(null)
  context.isPaused = true
  animation.stopAll()
  const playResults = animation.animations.map(
    (_clip: ENGINE_THREE.AnimationClip, index: number) => animation.play(index, {
      exclusive: false,
      loop: false,
      clampWhenFinished: true,
      startTime: 0,
      speed: 1,
    }),
  )
  const playReturnedPromise = playResults.every((result: unknown) => result instanceof Promise)
  if (animation.actions.length !== animation.animations.length) {
    throw new Error(
      `expected one Needle Animation action per clip, got ` +
        `${animation.actions.length} actions for ${animation.animations.length} clips`,
    )
  }
  animation.pause()

  const transform = root.getObjectByName(reference.fixture.transformObject.name)
  if (!transform) {
    throw new Error(`Needle-loaded root omitted ${reference.fixture.transformObject.name}`)
  }
  const skinned = findSkinnedMesh(root)
  const morphIndex = skinned.morphTargetDictionary?.[reference.fixture.skinnedMesh.morphTarget]
  if (morphIndex === undefined) {
    throw new Error(
      `Needle-loaded mesh omitted morph target ${reference.fixture.skinnedMesh.morphTarget}`,
    )
  }

  const camera = context.mainCamera as ENGINE_THREE.PerspectiveCamera
  camera.position.set(4.6, 3.2, 6.6)
  camera.lookAt(-0.2, 0.9, 0)
  camera.updateProjectionMatrix()
  const fill = new ENGINE_THREE.HemisphereLight(0xe6eeff, 0x1d2942, 2.5)
  fill.name = 'Needle differential fill'
  context.scene.add(fill)
  const key = new ENGINE_THREE.DirectionalLight(0xffffff, 3.5)
  key.name = 'Needle differential key'
  key.position.set(-4, 6, 5)
  context.scene.add(key)

  const samples: SampleEvidence[] = []
  for (const expected of reference.samples) {
    animation.time = expected.timeSeconds
    // The action is paused, so this component-owned mixer update applies the
    // selected action time without advancing it by wall-clock delta.
    animation.update()
    root.updateMatrixWorld(true)
    const browserPoints = transformedVertices(skinned)
    const uniqueBrowserPoints = uniquePoints(browserPoints)
    const expectedPoints = expected.deformedWorldPoints.map(vec3)
    const actualPosition = transform.getWorldPosition(new ENGINE_THREE.Vector3())
    const actualQuaternion = transform.getWorldQuaternion(new ENGINE_THREE.Quaternion())
    samples.push({
      frame: expected.frame,
      timeSeconds: expected.timeSeconds,
      transformPositionError: actualPosition.distanceTo(vec3(expected.transform.position)),
      transformQuaternionAngleRadians: quaternionAngle(
        actualQuaternion,
        quat(expected.transform.quaternion),
      ),
      morphInfluenceError: Math.abs(
        (skinned.morphTargetInfluences?.[morphIndex] ?? Number.NaN) -
          expected.morphInfluence,
      ),
      deformedPointHausdorff: hausdorff(uniqueBrowserPoints, expectedPoints),
      browserGeometryVertices: browserPoints.length,
      browserDeformedUniquePoints: uniqueBrowserPoints.length,
    })
  }

  const visualSample = reference.samples.find((sample) => sample.frame === 13)
  if (!visualSample) throw new Error('Blender oracle omitted visual sample frame 13')
  animation.time = visualSample.timeSeconds
  animation.update()
  root.updateMatrixWorld(true)
  context.renderNow(camera)
  const pixels = framebufferEvidence(context.renderer)

  const componentMixer = animation.gameObject.animationMixer
  const enginePosition = transform.getWorldPosition(new ENGINE_THREE.Vector3())
  const projectPosition = transform.getWorldPosition(new PROJECT_THREE.Vector3() as any)
  const crossCopy = {
    projectAndEngineObject3DConstructorsSame:
      PROJECT_THREE.Object3D === (ENGINE_THREE.Object3D as any),
    projectAndEngineAnimationMixerConstructorsSame:
      PROJECT_THREE.AnimationMixer === (ENGINE_THREE.AnimationMixer as any),
    loadedRootIsEngineObject3D: root instanceof ENGINE_THREE.Object3D,
    loadedRootIsProjectObject3D: root instanceof PROJECT_THREE.Object3D,
    skinnedMeshIsEngineSkinnedMesh: skinned instanceof ENGINE_THREE.SkinnedMesh,
    skinnedMeshIsProjectSkinnedMesh: skinned instanceof PROJECT_THREE.SkinnedMesh,
    componentMixerIsEngineAnimationMixer:
      componentMixer instanceof ENGINE_THREE.AnimationMixer,
    componentMixerIsProjectAnimationMixer:
      componentMixer instanceof PROJECT_THREE.AnimationMixer,
    projectVectorAcceptedByLoadedObject:
      projectPosition instanceof PROJECT_THREE.Vector3,
    projectVectorPositionDelta:
      enginePosition.distanceTo(new ENGINE_THREE.Vector3(
        projectPosition.x,
        projectPosition.y,
        projectPosition.z,
      )),
  }

  const keySamples = samples.filter((sample) => Number.isInteger(sample.frame))
  const subframeSamples = samples.filter((sample) => !Number.isInteger(sample.frame))
  const rendererContext = context.renderer.getContext()
  const evidence: BrowserEvidence = {
    engineAdvertisedVersion: String(engine.getAttribute('version') ?? 'unknown'),
    engineThreeRevision: String(ENGINE_THREE.REVISION),
    projectThreeRevision: String(PROJECT_THREE.REVISION),
    globalThreeRevision: window.THREE?.REVISION ? String(window.THREE.REVISION) : null,
    webglVersion: String(rendererContext.getParameter(rendererContext.VERSION)),
    webglRenderer: String(rendererContext.getParameter(rendererContext.RENDERER)),
    loadingPath: '<needle-engine src autoplay>',
    playbackPath: 'Animation.play(exclusive:false)/pause/time/update',
    component: {
      constructorName: animation.constructor.name,
      autoCreatedWithoutNeedleComponentMetadata: true,
      initialAutoplayActionNames,
      animationNames: animation.animations.map((clip: ENGINE_THREE.AnimationClip) => clip.name),
      actionCount: animation.actions.length,
      coordinatedClipCount: playResults.length,
      playReturnedPromise,
      registeredMixerCount: context.animations.mixers.length,
    },
    crossCopy,
    clipNames: loaded.file.animations.map((clip) => clip.name),
    clipDurations: loaded.file.animations.map((clip) => clip.duration),
    animationTrackCount: loaded.file.animations.reduce(
      (sum, clip) => sum + clip.tracks.length,
      0,
    ),
    samples,
    maxima: maximaFor(samples),
    keyMaxima: maximaFor(keySamples),
    subframeMaxima: maximaFor(subframeSamples),
    pixels,
  }
  updateFacts(evidence)
  state.evidence = evidence
  state.dispose = () => {
    const savedContext = context
    engine.remove()
    return {
      elementDisconnected: !engine.isConnected,
      elementContextCleared: engine.context == null,
      rendererClearedFromContext: savedContext.renderer == null,
      registeredMixersAfterDispose: savedContext.animations.mixers.length,
      actionsRunningAfterDispose: animation.actions.filter(
        (candidate: ENGINE_THREE.AnimationAction) => candidate.isRunning(),
      ).length,
    }
  }
  state.ready = true
}

void run().catch((error) => {
  state.errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  state.ready = true
  const status = document.querySelector('#status')
  if (status) status.textContent = `FAIL — ${error instanceof Error ? error.message : String(error)}`
  throw error
})
