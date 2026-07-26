import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

type Transform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

type ReferenceSample = {
  frame: number
  timeSeconds: number
  constrained: Transform
  driven: Transform
  camera: Transform & { forward: [number, number, number] }
  skinnedWorldPoints: [number, number, number][]
  unsupportedMaterialRoughness: number
}

type Reference = {
  fixture: {
    savedFrame: number
    objectNames: Record<string, string>
    skinnedMesh: string
    bone: string
  }
  samples: ReferenceSample[]
}

type Errors = {
  constrainedPosition: number
  drivenPosition: number
  cameraPosition: number
  cameraForwardRadians: number
  skinnedPointHausdorff: number
  materialRoughness: number
  maximumPortable: number
}

type VariantEvidence = {
  initial: Errors
  samples?: Array<{ frame: number; errors: Errors }>
  maxima?: Errors
  clipNames: string[]
  clipCount: number
}

type BrowserEvidence = {
  threeRevision: string
  savedFrame: number
  needle: VariantEvidence & { savedFramePortableError: number }
  designA: VariantEvidence
  designB: VariantEvidence & { extraArtifactBytes: number }
  designC: VariantEvidence
  designD: VariantEvidence & {
    presentationTrackCount: number
    presentationJsonBytes: number
    restoredIdle: Errors
    developerClipPlaybackMaxima: Errors
  }
  actionsBakedDiagnostic: VariantEvidence
  materialDriver: {
    gltfPointerPresent: boolean
    referenceValues: number[]
    designAObservedValues: number[]
  }
  pixels: {
    total: number
    nonBackground: number
    chromatic: number
  }
}

declare global {
  interface Window {
    __authoredFrameEvidence?: {
      ready: boolean
      errors: string[]
      evidence?: BrowserEvidence
      dispose(): boolean
    }
  }
}

const state: NonNullable<Window['__authoredFrameEvidence']> = {
  ready: false,
  errors: [],
  dispose: () => false,
}
window.__authoredFrameEvidence = state

const loader = new GLTFLoader()

function vector(values: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(values[0]!, values[1]!, values[2]!)
}

function quaternion(values: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion(values[0]!, values[1]!, values[2]!, values[3]!).normalize()
}

function angle(left: THREE.Vector3, right: THREE.Vector3): number {
  return left.angleTo(right)
}

function nearestMaximum(
  source: readonly THREE.Vector3[],
  target: readonly THREE.Vector3[],
): number {
  let maximum = 0
  for (const point of source) {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of target) nearest = Math.min(nearest, point.distanceTo(candidate))
    maximum = Math.max(maximum, nearest)
  }
  return maximum
}

function hausdorff(
  left: readonly THREE.Vector3[],
  right: readonly THREE.Vector3[],
): number {
  if (left.length === 0 || right.length === 0) return Number.POSITIVE_INFINITY
  return Math.max(nearestMaximum(left, right), nearestMaximum(right, left))
}

function unique(points: readonly THREE.Vector3[], epsilon = 1e-6): THREE.Vector3[] {
  const result: THREE.Vector3[] = []
  for (const point of points) {
    if (!result.some((candidate) => candidate.distanceToSquared(point) <= epsilon * epsilon)) {
      result.push(point.clone())
    }
  }
  return result
}

function requireObject(root: THREE.Object3D, name: string): THREE.Object3D {
  const result = root.getObjectByName(name)
  if (!result) throw new Error(`GLB omitted required node "${name}"`)
  return result
}

function requireSkinnedMesh(root: THREE.Object3D, name: string): THREE.SkinnedMesh {
  const object = requireObject(root, name)
  let result: THREE.SkinnedMesh | undefined
  object.traverse((candidate) => {
    if (!result && (candidate as THREE.SkinnedMesh).isSkinnedMesh) {
      result = candidate as THREE.SkinnedMesh
    }
  })
  if (!result && (object as THREE.SkinnedMesh).isSkinnedMesh) {
    result = object as THREE.SkinnedMesh
  }
  if (!result) throw new Error(`node "${name}" contained no SkinnedMesh`)
  return result
}

function skinnedWorldPoints(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  const count = mesh.geometry.getAttribute('position').count
  const points: THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    const point = mesh.getVertexPosition(index, new THREE.Vector3())
    points.push(mesh.localToWorld(point))
  }
  return unique(points)
}

function materialRoughness(root: THREE.Object3D, name: string): number {
  const object = requireObject(root, name) as THREE.Mesh
  const material = Array.isArray(object.material) ? object.material[0] : object.material
  return (material as THREE.MeshStandardMaterial | undefined)?.roughness ?? Number.NaN
}

function measure(
  root: THREE.Object3D,
  reference: Reference,
  expected: ReferenceSample,
): Errors {
  root.updateMatrixWorld(true)
  const constrained = requireObject(root, reference.fixture.objectNames.constrained!)
  const driven = requireObject(root, reference.fixture.objectNames.driven!)
  const camera = requireObject(root, reference.fixture.objectNames.camera!)
  const mesh = requireSkinnedMesh(root, reference.fixture.skinnedMesh)
  const constrainedPosition = constrained.getWorldPosition(new THREE.Vector3())
    .distanceTo(vector(expected.constrained.position))
  const drivenPosition = driven.getWorldPosition(new THREE.Vector3())
    .distanceTo(vector(expected.driven.position))
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3())
    .distanceTo(vector(expected.camera.position))
  const cameraForward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()))
    .normalize()
  const cameraForwardRadians = angle(cameraForward, vector(expected.camera.forward).normalize())
  const skinnedPointHausdorff = hausdorff(
    skinnedWorldPoints(mesh),
    expected.skinnedWorldPoints.map(vector),
  )
  const roughness = materialRoughness(root, reference.fixture.objectNames.driven!)
  const materialRoughnessError = Math.abs(
    roughness - expected.unsupportedMaterialRoughness,
  )
  return {
    constrainedPosition,
    drivenPosition,
    cameraPosition,
    cameraForwardRadians,
    skinnedPointHausdorff,
    materialRoughness: materialRoughnessError,
    maximumPortable: Math.max(
      constrainedPosition,
      drivenPosition,
      cameraPosition,
      cameraForwardRadians,
      skinnedPointHausdorff,
    ),
  }
}

function maxima(samples: Array<{ errors: Errors }>): Errors {
  const field = (key: keyof Errors) =>
    Math.max(...samples.map((sample) => sample.errors[key]))
  return {
    constrainedPosition: field('constrainedPosition'),
    drivenPosition: field('drivenPosition'),
    cameraPosition: field('cameraPosition'),
    cameraForwardRadians: field('cameraForwardRadians'),
    skinnedPointHausdorff: field('skinnedPointHausdorff'),
    materialRoughness: field('materialRoughness'),
    maximumPortable: field('maximumPortable'),
  }
}

function playAll(gltf: GLTF): THREE.AnimationMixer {
  const mixer = new THREE.AnimationMixer(gltf.scene)
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip)
    action.enabled = true
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
  }
  return mixer
}

function sampleClips(
  gltf: GLTF,
  reference: Reference,
): Array<{ frame: number; errors: Errors }> {
  const mixer = playAll(gltf)
  return reference.samples.map((expected) => {
    mixer.setTime(expected.timeSeconds)
    gltf.scene.updateMatrixWorld(true)
    return { frame: expected.frame, errors: measure(gltf.scene, reference, expected) }
  })
}

function copyNodeTransforms(source: THREE.Object3D, target: THREE.Object3D): number {
  let count = 0
  source.traverse((sourceNode) => {
    if (!sourceNode.name) return
    const targetNode = target.getObjectByName(sourceNode.name)
    if (!targetNode) return
    targetNode.position.copy(sourceNode.position)
    targetNode.quaternion.copy(sourceNode.quaternion)
    targetNode.scale.copy(sourceNode.scale)
    count += 1
  })
  target.updateMatrixWorld(true)
  return count
}

function presentationClip(
  source: THREE.Object3D,
  target: THREE.Object3D,
): { clip: THREE.AnimationClip; jsonBytes: number } {
  const tracks: THREE.KeyframeTrack[] = []
  source.traverse((sourceNode) => {
    if (!sourceNode.name || !target.getObjectByName(sourceNode.name)) return
    const binding = sourceNode.name
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${binding}.position`,
        [0],
        sourceNode.position.toArray(),
      ),
      new THREE.QuaternionKeyframeTrack(
        `${binding}.quaternion`,
        [0],
        sourceNode.quaternion.toArray(),
      ),
      new THREE.VectorKeyframeTrack(
        `${binding}.scale`,
        [0],
        sourceNode.scale.toArray(),
      ),
    )
  })
  const clip = new THREE.AnimationClip('__blendlink_authored_frame', 0, tracks)
  return {
    clip,
    jsonBytes: new TextEncoder().encode(JSON.stringify(THREE.AnimationClip.toJSON(clip))).length,
  }
}

function applyPresentationClip(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
): THREE.AnimationMixer {
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  mixer.update(0)
  action.paused = true
  root.updateMatrixWorld(true)
  return mixer
}

function variant(
  gltf: GLTF,
  initial: Errors,
  samples?: Array<{ frame: number; errors: Errors }>,
): VariantEvidence {
  return {
    initial,
    samples,
    maxima: samples ? maxima(samples) : undefined,
    clipNames: gltf.animations.map((clip) => clip.name),
    clipCount: gltf.animations.length,
  }
}

function framebuffer(renderer: THREE.WebGLRenderer): BrowserEvidence['pixels'] {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const bytes = new Uint8Array(size.x * size.y * 4)
  const context = renderer.getContext()
  context.readPixels(0, 0, size.x, size.y, context.RGBA, context.UNSIGNED_BYTE, bytes)
  const corner = [bytes[0]!, bytes[1]!, bytes[2]!]
  let nonBackground = 0
  let chromatic = 0
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const rgb = [bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!]
    if (Math.max(...rgb.map((value, index) => Math.abs(value - corner[index]!))) > 10) {
      nonBackground += 1
    }
    if (Math.max(...rgb) - Math.min(...rgb) > 25) chromatic += 1
  }
  return { total: size.x * size.y, nonBackground, chromatic }
}

function show(id: string, initial: Errors, maximum?: Errors): void {
  const element = document.querySelector(`#${id}`)!
  const format = (value: number) => value.toExponential(2)
  element.innerHTML =
    `<span class="${initial.maximumPortable < 1e-3 ? 'pass' : 'warn'}">` +
    `idle ${format(initial.maximumPortable)}</span>` +
    (maximum
      ? `<br><span class="${maximum.maximumPortable < 1e-3 ? 'pass' : 'warn'}">` +
        `clip max ${format(maximum.maximumPortable)}</span>`
      : '')
}

async function load(name: string): Promise<GLTF> {
  return loader.loadAsync(`/output/${name}.glb`)
}

async function run(): Promise<void> {
  const reference = await fetch('/output/blender-reference.json').then((response) => {
    if (!response.ok) throw new Error(`reference fetch failed: ${response.status}`)
    return response.json() as Promise<Reference>
  })
  const saved = reference.samples.find(
    (sample) => sample.frame === reference.fixture.savedFrame,
  )
  const first = reference.samples[0]
  if (!saved || !first) throw new Error('reference omitted saved/first frame')

  const [
    needle,
    onePass,
    dynamicForB,
    staticForB,
    dynamicForC,
    currentRestForD,
    currentRestSampleSource,
    actionsBaked,
  ] = await Promise.all([
    load('needle-floor'),
    load('one-pass-scene'),
    load('dynamic-scene'),
    load('static-current'),
    load('dynamic-scene'),
    load('current-rest-actions'),
    load('current-rest-actions'),
    load('one-pass-actions-baked'),
  ])

  const needleInitial = measure(needle.scene, reference, first)
  const needleAtSaved = measure(needle.scene, reference, saved)
  const needleSamples = sampleClips(needle, reference)

  const designAInitial = measure(onePass.scene, reference, saved)
  const designASamples = sampleClips(onePass, reference)

  const dynamicInitial = measure(dynamicForB.scene, reference, first)
  if (dynamicInitial.maximumPortable > 1e-3) {
    throw new Error(`dynamic scene frame-0 base mismatch ${dynamicInitial.maximumPortable}`)
  }
  const transplantCount = copyNodeTransforms(staticForB.scene, dynamicForB.scene)
  if (transplantCount < 8) throw new Error(`static transplant matched only ${transplantCount} nodes`)
  const designBInitial = measure(dynamicForB.scene, reference, saved)
  const designBSamples = sampleClips(dynamicForB, reference)

  const designCMixer = playAll(dynamicForC)
  designCMixer.setTime(saved.timeSeconds)
  const designCInitial = measure(dynamicForC.scene, reference, saved)
  const designCSamples = reference.samples.map((expected) => {
    designCMixer.setTime(expected.timeSeconds)
    return {
      frame: expected.frame,
      errors: measure(dynamicForC.scene, reference, expected),
    }
  })

  const sampleMixer = playAll(currentRestSampleSource)
  sampleMixer.setTime(saved.timeSeconds)
  const presentation = presentationClip(
    currentRestSampleSource.scene,
    currentRestForD.scene,
  )
  const presentationMixer = applyPresentationClip(
    currentRestForD.scene,
    presentation.clip,
  )
  const designDInitial = measure(currentRestForD.scene, reference, saved)
  const developerClipSamples = sampleClips(currentRestForD, reference)
  const restoredPresentationMixer = applyPresentationClip(
    currentRestForD.scene,
    presentation.clip,
  )
  const designDRestored = measure(currentRestForD.scene, reference, saved)

  const actionsBakedInitial = measure(actionsBaked.scene, reference, saved)
  const actionsBakedSamples = sampleClips(actionsBaked, reference)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(800, 500, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.0
  document.querySelector('#stage')!.appendChild(renderer.domElement)
  const renderScene = new THREE.Scene()
  renderScene.background = new THREE.Color(0x09111f)
  renderScene.add(onePass.scene)
  renderScene.add(new THREE.HemisphereLight(0xddeaff, 0x1a2233, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 3.5)
  key.position.set(-4, 8, 5)
  renderScene.add(key)
  const camera = requireObject(
    onePass.scene,
    reference.fixture.objectNames.camera!,
  ) as THREE.Camera
  renderer.render(renderScene, camera)
  const pixels = framebuffer(renderer)

  const designAMaterialValues = reference.samples.map((expected) => {
    const mixer = playAll(onePass)
    mixer.setTime(expected.timeSeconds)
    return materialRoughness(onePass.scene, reference.fixture.objectNames.driven!)
  })

  const evidence: BrowserEvidence = {
    threeRevision: THREE.REVISION,
    savedFrame: reference.fixture.savedFrame,
    needle: {
      ...variant(needle, needleInitial, needleSamples),
      savedFramePortableError: needleAtSaved.maximumPortable,
    },
    designA: variant(onePass, designAInitial, designASamples),
    designB: {
      ...variant(dynamicForB, designBInitial, designBSamples),
      extraArtifactBytes: 0,
    },
    designC: variant(dynamicForC, designCInitial, designCSamples),
    designD: {
      ...variant(currentRestForD, designDInitial, developerClipSamples),
      presentationTrackCount: presentation.clip.tracks.length,
      presentationJsonBytes: presentation.jsonBytes,
      restoredIdle: designDRestored,
      developerClipPlaybackMaxima: maxima(developerClipSamples),
    },
    actionsBakedDiagnostic: variant(
      actionsBaked,
      actionsBakedInitial,
      actionsBakedSamples,
    ),
    materialDriver: {
      gltfPointerPresent: false,
      referenceValues: reference.samples.map(
        (sample) => sample.unsupportedMaterialRoughness,
      ),
      designAObservedValues: designAMaterialValues,
    },
    pixels,
  }

  show('needle', evidence.needle.initial, evidence.needle.maxima)
  show('a', evidence.designA.initial, evidence.designA.maxima)
  show('b', evidence.designB.initial, evidence.designB.maxima)
  show('c', evidence.designC.initial, evidence.designC.maxima)
  show('d', evidence.designD.initial, evidence.designD.developerClipPlaybackMaxima)
  const status = document.querySelector('#status')!
  status.textContent =
    'Portable transform/skin differential complete; the material driver remains an intentional loud refusal.'
  status.className = 'done'

  state.evidence = evidence
  state.dispose = () => {
    for (const gltf of [
      needle,
      onePass,
      dynamicForB,
      staticForB,
      dynamicForC,
      currentRestForD,
      currentRestSampleSource,
      actionsBaked,
    ]) {
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) material?.dispose()
      })
    }
    renderer.dispose()
    presentationMixer.stopAllAction()
    restoredPresentationMixer.stopAllAction()
    sampleMixer.stopAllAction()
    return true
  }
  state.ready = true
}

void run().catch((error) => {
  state.errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  state.ready = true
  throw error
})
