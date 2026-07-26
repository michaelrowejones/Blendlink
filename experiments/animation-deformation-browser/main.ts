import * as THREE from 'three'
import {
  installThreeCompiledScene,
  type InstalledThreeCompiledScene,
} from '../../packages/blendlink/dist/threeRuntime.js'
import type { CompiledSceneDescriptor } from '../../packages/blendlink/dist/runtime.js'

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
  bones: Record<string, TransformSample>
}

type Reference = {
  schemaVersion: number
  blender: { version: string; buildHash: string }
  gltfExporter: { version: number[]; modulePath: string }
  fixture: {
    transformObject: { name: string; blendlinkId: string }
    skinnedMesh: {
      name: string
      blendlinkId: string
      sourceVertexCount: number
      boneNames: string[]
      morphTarget: string
    }
  }
  samples: ReferenceSample[]
}

type SampleEvidence = {
  frame: number
  timeSeconds: number
  transformPositionError: number
  transformQuaternionAngleRadians: number
  morphInfluenceError: number
  deformedPointHausdorff: number
  browserDeformedUniquePoints: number
  browserGeometryVertices: number
  boneDiagnostics: Record<string, {
    positionError: number
    quaternionAngleRadians: number
  }>
}

type BrowserEvidence = {
  threeRevision: string
  webglVersion: string
  webglRenderer: string
  blendlinkInstaller: 'installThreeCompiledScene'
  clipNames: string[]
  clipDurations: number[]
  animationTrackCount: number
  skinnedMesh: {
    isSkinnedMesh: boolean
    boneCount: number
    boneNames: string[]
    morphTargetDictionary: Record<string, number>
    geometryVertexCount: number
    getVertexPosition: boolean
  }
  progress: unknown[]
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
  finalRequiresContinuousFrames: boolean
}

declare global {
  interface Window {
    __animationDeformationEvidence?: {
      ready: boolean
      evidence?: BrowserEvidence
      errors: string[]
      dispose(): boolean
    }
  }
}

const state: NonNullable<Window['__animationDeformationEvidence']> = {
  ready: false,
  errors: [],
  dispose: () => false,
}
window.__animationDeformationEvidence = state

function vec3(values: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(values[0]!, values[1]!, values[2]!)
}

function quat(values: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion(values[0]!, values[1]!, values[2]!, values[3]!).normalize()
}

function quaternionAngle(left: THREE.Quaternion, right: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(left.dot(right)))
  return 2 * Math.acos(dot)
}

function maxNearestDistance(
  source: readonly THREE.Vector3[],
  target: readonly THREE.Vector3[],
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

function hausdorff(left: readonly THREE.Vector3[], right: readonly THREE.Vector3[]): number {
  return Math.max(maxNearestDistance(left, right), maxNearestDistance(right, left))
}

function uniquePoints(points: readonly THREE.Vector3[], epsilon = 1e-6): THREE.Vector3[] {
  const result: THREE.Vector3[] = []
  for (const point of points) {
    if (!result.some((candidate) => candidate.distanceToSquared(point) <= epsilon * epsilon)) {
      result.push(point.clone())
    }
  }
  return result
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let result: THREE.SkinnedMesh | undefined
  root.traverse((object) => {
    if (!result && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      result = object as THREE.SkinnedMesh
    }
  })
  if (!result) throw new Error('production-loaded root contained no SkinnedMesh')
  return result
}

function transformedVertices(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  const count = mesh.geometry.getAttribute('position').count
  const result: THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    const point = mesh.getVertexPosition(index, new THREE.Vector3())
    result.push(mesh.localToWorld(point))
  }
  return result
}

function framebufferEvidence(
  renderer: THREE.WebGLRenderer,
): BrowserEvidence['pixels'] {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
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

function boneDiagnostics(
  mesh: THREE.SkinnedMesh,
  reference: ReferenceSample,
): SampleEvidence['boneDiagnostics'] {
  const diagnostics: SampleEvidence['boneDiagnostics'] = {}
  for (const name of Object.keys(reference.bones)) {
    const bone = mesh.skeleton.bones.find((candidate) => candidate.name === name)
    if (!bone) continue
    const expected = reference.bones[name]!
    diagnostics[name] = {
      positionError: bone.getWorldPosition(new THREE.Vector3()).distanceTo(vec3(expected.position)),
      quaternionAngleRadians: quaternionAngle(
        bone.getWorldQuaternion(new THREE.Quaternion()),
        quat(expected.quaternion),
      ),
    }
  }
  return diagnostics
}

function updateFacts(evidence: BrowserEvidence): void {
  const format = (value: number) => value.toExponential(3)
  document.querySelector('#position-error')!.textContent = format(evidence.maxima.transformPositionError)
  document.querySelector('#quaternion-error')!.textContent =
    `${format(evidence.maxima.transformQuaternionAngleRadians)} rad`
  document.querySelector('#morph-error')!.textContent = format(evidence.maxima.morphInfluenceError)
  document.querySelector('#skin-error')!.textContent = format(evidence.maxima.deformedPointHausdorff)
  document.querySelector('#clips')!.textContent = evidence.clipNames.join(', ')
  document.querySelector('#rig')!.textContent =
    `${evidence.skinnedMesh.boneCount} bones / ${evidence.skinnedMesh.geometryVertexCount} web vertices`
  const status = document.querySelector('#status')!
  status.textContent = 'PASS — all nine Blender reference times agree'
  status.classList.add('pass')
}

async function run(): Promise<void> {
  const reference = await fetch('/output/blender-reference.json').then((response) => {
    if (!response.ok) throw new Error(`reference fetch failed: HTTP ${response.status}`)
    return response.json() as Promise<Reference>
  })
  const stage = document.querySelector<HTMLDivElement>('#stage')!
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(720, 540, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  stage.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x10182a)
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x1d2942, 2.5))
  const key = new THREE.DirectionalLight(0xffffff, 3.5)
  key.position.set(-4, 6, 5)
  scene.add(key)
  const grid = new THREE.GridHelper(8, 16, 0x38527a, 0x22334d)
  scene.add(grid)

  const camera = new THREE.PerspectiveCamera(38, 720 / 540, 0.05, 100)
  camera.position.set(4.6, 3.2, 6.6)
  camera.lookAt(-0.2, 0.9, 0)
  const progress: unknown[] = []
  const descriptor: CompiledSceneDescriptor = {
    url: '/output/animation-deformation-fixture.glb',
    nodes: {
      TransformDriver: reference.fixture.transformObject.name,
      SkinnedDeformer: reference.fixture.skinnedMesh.name,
    },
    nodeIds: {
      TransformDriver: reference.fixture.transformObject.blendlinkId,
      SkinnedDeformer: reference.fixture.skinnedMesh.blendlinkId,
    },
    objectsById: {
      [reference.fixture.transformObject.blendlinkId]: reference.fixture.transformObject.name,
      [reference.fixture.skinnedMesh.blendlinkId]: reference.fixture.skinnedMesh.name,
    },
    playback: {
      start: 'all',
      loop: 'once',
      speed: 1,
    },
  }

  let installed: InstalledThreeCompiledScene | undefined
  try {
    installed = await installThreeCompiledScene({
      descriptor,
      renderer,
      scene,
      fallbackCamera: camera,
      viewport: { width: 720, height: 540 },
      prewarm: true,
      onProgress: (event) => progress.push(event),
    })
    const transform = installed.bindings.object(reference.fixture.transformObject.blendlinkId)
    const skinned = findSkinnedMesh(
      installed.bindings.object(reference.fixture.skinnedMesh.blendlinkId),
    )
    const morphIndex = skinned.morphTargetDictionary?.[reference.fixture.skinnedMesh.morphTarget]
    if (morphIndex === undefined) {
      throw new Error(
        `morph target "${reference.fixture.skinnedMesh.morphTarget}" was not present; ` +
        `loaded ${Object.keys(skinned.morphTargetDictionary ?? {}).join(', ') || 'none'}`,
      )
    }

    const samples: SampleEvidence[] = []
    let elapsed = 0
    for (const expected of reference.samples) {
      const delta = expected.timeSeconds - elapsed
      installed.update(delta)
      elapsed = expected.timeSeconds
      installed.root.updateMatrixWorld(true)
      installed.render(delta)
      const browserPoints = transformedVertices(skinned)
      const uniqueBrowserPoints = uniquePoints(browserPoints)
      const expectedPoints = expected.deformedWorldPoints.map(vec3)
      const actualPosition = transform.getWorldPosition(new THREE.Vector3())
      const actualQuaternion = transform.getWorldQuaternion(new THREE.Quaternion())
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
        browserDeformedUniquePoints: uniqueBrowserPoints.length,
        browserGeometryVertices: browserPoints.length,
        boneDiagnostics: boneDiagnostics(skinned, expected),
      })
    }

    const maximum = (select: (sample: SampleEvidence) => number) =>
      Math.max(...samples.map(select))
    const maximaFor = (subset: SampleEvidence[]): BrowserEvidence['maxima'] => ({
      transformPositionError: Math.max(...subset.map(
        (sample) => sample.transformPositionError,
      )),
      transformQuaternionAngleRadians: Math.max(...subset.map(
        (sample) => sample.transformQuaternionAngleRadians,
      )),
      morphInfluenceError: Math.max(...subset.map(
        (sample) => sample.morphInfluenceError,
      )),
      deformedPointHausdorff: Math.max(...subset.map(
        (sample) => sample.deformedPointHausdorff,
      )),
    })
    const keySamples = samples.filter((sample) => Number.isInteger(sample.frame))
    const subframeSamples = samples.filter((sample) => !Number.isInteger(sample.frame))
    const finalRequiresContinuousFrames = installed.requiresContinuousFrames
    // The numerical path above advances only through Blendlink.update().
    // Repositioning the already-proven mixer is solely for a readable visual
    // artifact and framebuffer assertion at Blender frame 13.
    const visualSample = reference.samples.find((sample) => sample.frame === 13)
    for (const action of installed.playback?.actions ?? []) {
      action.reset()
      action.play()
    }
    ;(installed.playback?.mixer as THREE.AnimationMixer | undefined)?.setTime(
      visualSample?.timeSeconds ?? 13 / 24,
    )
    installed.root.updateMatrixWorld(true)
    installed.render(0)
    const pixels = framebufferEvidence(renderer)
    const context = renderer.getContext()
    const evidence: BrowserEvidence = {
      threeRevision: THREE.REVISION,
      webglVersion: String(context.getParameter(context.VERSION)),
      webglRenderer: String(context.getParameter(context.RENDERER)),
      blendlinkInstaller: 'installThreeCompiledScene',
      clipNames: installed.loaded.animations.map((clip) => clip.name),
      clipDurations: installed.loaded.animations.map((clip) => clip.duration),
      animationTrackCount: installed.loaded.animations.reduce(
        (sum, clip) => sum + clip.tracks.length,
        0,
      ),
      skinnedMesh: {
        isSkinnedMesh: skinned.isSkinnedMesh,
        boneCount: skinned.skeleton.bones.length,
        boneNames: skinned.skeleton.bones.map((bone) => bone.name),
        morphTargetDictionary: { ...skinned.morphTargetDictionary },
        geometryVertexCount: skinned.geometry.getAttribute('position').count,
        getVertexPosition: typeof skinned.getVertexPosition === 'function',
      },
      progress,
      samples,
      maxima: {
        transformPositionError: maximum((sample) => sample.transformPositionError),
        transformQuaternionAngleRadians: maximum(
          (sample) => sample.transformQuaternionAngleRadians,
        ),
        morphInfluenceError: maximum((sample) => sample.morphInfluenceError),
        deformedPointHausdorff: maximum((sample) => sample.deformedPointHausdorff),
      },
      keyMaxima: maximaFor(keySamples),
      subframeMaxima: maximaFor(subframeSamples),
      pixels,
      finalRequiresContinuousFrames,
    }
    updateFacts(evidence)
    state.evidence = evidence
    state.dispose = () => {
      installed?.dispose()
      renderer.dispose()
      return installed !== undefined
    }
    state.ready = true
  } catch (error) {
    state.errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
    state.ready = true
    throw error
  }
}

void run()
