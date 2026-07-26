import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, type RootState } from '@react-three/fiber'
import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  createR3FCompiledScene,
  type R3FCompiledSceneHandle,
} from '../../packages/blendlink/dist/reactThreeFiber.js'
import type {
  CompiledSceneAnimationState,
  CompiledSceneDescriptor,
} from '../../packages/blendlink/dist/runtime.js'
import type { InstalledThreeCompiledScene } from '../../packages/blendlink/dist/threeRuntime.js'

type Kind = 'manual' | 'sequence'

type RenderSample = {
  render: number
  atMs: number
  phase: CompiledSceneAnimationState['phase'] | 'loading' | 'disposed'
  animationTime: number
  poseX: number
  pixelCentroidX: number
  coloredPixels: number
  internalActionsPaused: boolean | null
}

type ResourceEvidence = {
  geometriesCreated: number
  materialsCreated: number
  geometryDisposed: number
  materialDisposed: number
}

type SceneEvidence = {
  ready: boolean
  mounted: boolean
  unmounted: boolean
  loaderCalls: number
  renders: number
  notifications: number
  phase: CompiledSceneAnimationState['phase'] | 'loading' | 'disposed'
  time: number
  duration: number | null
  activeClips: readonly string[]
  requiresContinuousFrames: boolean
  poseX: number
  restX: number
  pixelCentroidX: number
  coloredPixels: number
  internalActionsPaused: boolean | null
  webglVersion: string
  webglRenderer: string
  resources: ResourceEvidence
  renderSamples: RenderSample[]
}

type Snapshot = Omit<SceneEvidence, 'renderSamples'> & {
  renderSamples: number
}

type HarnessEvidence = {
  ready: boolean
  versions: {
    react: '19.0.0'
    reactDom: '19.0.0'
    reactThreeFiber: '9.6.1'
    three: '0.184.0'
  }
  manual: SceneEvidence
  sequence: SceneEvidence
  errors: string[]
}

type HarnessApi = {
  evidence: HarnessEvidence
  snapshot(kind: Kind): Snapshot
  manual: {
    play(clip?: string): void
    pause(): void
    seek(timeSeconds: number): void
    stop(): void
  }
  mountSequence(): void
  disposeManual(): void
  disposeSequence(): void
  invokeStaleManual(): string
}

declare global {
  interface Window {
    __blendlinkR3fAnimationTransport: HarnessApi
  }
}

const REST_X = -1.35
const MANUAL_COLOR = new THREE.Color(0x4ce8e0)
const SEQUENCE_COLOR = new THREE.Color(0xff7968)
const BACKGROUND = new THREE.Color(0x091223)

function makeSceneEvidence(): SceneEvidence {
  return {
    ready: false,
    mounted: false,
    unmounted: false,
    loaderCalls: 0,
    renders: 0,
    notifications: 0,
    phase: 'loading',
    time: 0,
    duration: 0,
    activeClips: [],
    requiresContinuousFrames: false,
    poseX: REST_X,
    restX: REST_X,
    pixelCentroidX: -1,
    coloredPixels: 0,
    internalActionsPaused: null,
    webglVersion: '',
    webglRenderer: '',
    resources: {
      geometriesCreated: 0,
      materialsCreated: 0,
      geometryDisposed: 0,
      materialDisposed: 0,
    },
    renderSamples: [],
  }
}

const evidence: HarnessEvidence = {
  ready: false,
  versions: {
    react: '19.0.0',
    reactDom: '19.0.0',
    reactThreeFiber: '9.6.1',
    three: '0.184.0',
  },
  manual: makeSceneEvidence(),
  sequence: makeSceneEvidence(),
  errors: [],
}

const live: Record<Kind, {
  handle: R3FCompiledSceneHandle | null
  installed: InstalledThreeCompiledScene | null
  node: THREE.Object3D | null
}> = {
  manual: { handle: null, installed: null, node: null },
  sequence: { handle: null, installed: null, node: null },
}

let setManualMounted: ((mounted: boolean) => void) | null = null
let setSequenceMounted: ((mounted: boolean) => void) | null = null
let staleManualHandle: R3FCompiledSceneHandle | null = null

function syncState(kind: Kind, state: CompiledSceneAnimationState): void {
  const target = evidence[kind]
  target.phase = state.phase
  target.time = state.time
  target.duration = state.duration
  target.activeClips = [...state.activeClips]
  target.requiresContinuousFrames =
    live[kind].handle?.requiresContinuousFrames ?? false
  target.poseX = live[kind].node?.position.x ?? target.poseX
  refreshUi(kind)
}

function snapshot(kind: Kind): Snapshot {
  const target = evidence[kind]
  const handle = live[kind].handle
  const animation = handle?.animation
  if (animation) {
    const current = animation.state
    target.phase = current.phase
    target.time = current.time
    target.duration = current.duration
    target.activeClips = [...current.activeClips]
    target.requiresContinuousFrames = handle.requiresContinuousFrames
  }
  target.poseX = live[kind].node?.position.x ?? target.poseX
  return {
    ...target,
    resources: { ...target.resources },
    activeClips: [...target.activeClips],
    renderSamples: target.renderSamples.length,
  }
}

function requireAnimation(kind: Kind) {
  const animation = live[kind].handle?.animation
  if (!animation) throw new Error(`${kind} ready handle has no animation transport`)
  return animation
}

const api: HarnessApi = {
  evidence,
  snapshot,
  manual: {
    play(clip) { requireAnimation('manual').play(clip) },
    pause() { requireAnimation('manual').pause() },
    seek(timeSeconds) { requireAnimation('manual').seek(timeSeconds) },
    stop() { requireAnimation('manual').stop() },
  },
  mountSequence() {
    if (!setSequenceMounted) throw new Error('React application is not mounted')
    setSequenceMounted(true)
  },
  disposeManual() {
    if (!setManualMounted) throw new Error('React application is not mounted')
    staleManualHandle = live.manual.handle
    setManualMounted(false)
  },
  disposeSequence() {
    if (!setSequenceMounted) throw new Error('React application is not mounted')
    setSequenceMounted(false)
  },
  invokeStaleManual() {
    try {
      staleManualHandle?.animation?.play('ManualMove')
      return 'stale command unexpectedly succeeded'
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },
}
window.__blendlinkR3fAnimationTransport = api

window.addEventListener('error', (event) => {
  evidence.errors.push(event.error instanceof Error
    ? event.error.stack ?? event.error.message
    : event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  evidence.errors.push(
    event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason),
  )
})

function refreshUi(kind: Kind): void {
  const output = document.getElementById(`${kind}-facts`)
  if (output) {
    const value = snapshot(kind)
    output.textContent = [
      `phase=${value.phase}  time=${value.time.toFixed(3)} / ${value.duration?.toFixed(3) ?? 'unknown'}`,
      `renders=${value.renders}  notifications=${value.notifications}`,
      `continuous=${value.requiresContinuousFrames}`,
      `pose.x=${value.poseX.toFixed(3)}  pixel.cx=${value.pixelCentroidX.toFixed(1)}`,
      `Three actions paused=${String(value.internalActionsPaused)}`,
      `disposed geometry/material=${value.resources.geometryDisposed}/${value.resources.materialDisposed}`,
    ].join('\n')
  }
  const status = document.getElementById('status')
  if (status && evidence.manual.ready) {
    status.textContent = evidence.sequence.ready
      ? 'REAL R3F DEMAND CANVASES READY'
      : 'MANUAL TRANSPORT READY'
  }
}

function createFixture(kind: Kind): GLTF {
  const target = evidence[kind]
  const geometry = new THREE.BoxGeometry(0.72, 0.72, 0.72)
  const material = new THREE.MeshBasicMaterial({
    color: kind === 'manual' ? MANUAL_COLOR : SEQUENCE_COLOR,
    toneMapped: false,
  })
  target.resources.geometriesCreated += 1
  target.resources.materialsCreated += 1
  geometry.addEventListener('dispose', () => {
    target.resources.geometryDisposed += 1
    refreshUi(kind)
  })
  material.addEventListener('dispose', () => {
    target.resources.materialDisposed += 1
    refreshUi(kind)
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'AnimatedBox'
  mesh.position.x = REST_X
  mesh.rotation.set(0.18, 0.35, 0)
  const root = new THREE.Group()
  root.name = `${kind}-fixture-root`
  root.add(mesh)

  const clipName = kind === 'manual' ? 'ManualMove' : 'NlaMove'
  const duration = kind === 'manual' ? 1 : 0.9
  const track = new THREE.VectorKeyframeTrack(
    'AnimatedBox.position',
    [0, duration],
    [
      REST_X, 0, 0,
      1.35, kind === 'manual' ? 0 : 0.55, 0,
    ],
    THREE.InterpolateLinear,
  )
  const clip = new THREE.AnimationClip(clipName, duration, [track])
  return {
    scene: root,
    scenes: [root],
    animations: [clip],
    cameras: [],
    asset: { version: '2.0', generator: 'Blendlink deterministic R3F transport fixture' },
    parser: {} as GLTF['parser'],
    userData: {},
  }
}

function createFixtureLoader(kind: Kind): GLTFLoader {
  const manager = new THREE.LoadingManager()
  return {
    manager,
    async loadAsync() {
      evidence[kind].loaderCalls += 1
      return createFixture(kind)
    },
  } as unknown as GLTFLoader
}

function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30)
  camera.position.set(0, 0.2, 4.2)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return camera
}

const manualDescriptor = {
  url: '/virtual/manual-animation.glb',
  nodes: { AnimatedBox: 'AnimatedBox' },
  playback: { start: 'manual', loop: 'once', speed: 1 },
} as const satisfies CompiledSceneDescriptor

const sequenceDescriptor = {
  url: '/virtual/authored-nla-sequence.glb',
  nodes: { AnimatedBox: 'AnimatedBox' },
  playback: { start: 'manual', loop: 'once', speed: 1 },
  animationSequence: {
    name: 'Website Story',
    source: {
      objectId: 'sequence-root',
      objectName: 'Sequence Root',
      track: 'Website Story',
    },
    duration: 0.9,
    loop: false,
    speed: 1,
    strips: [{
      order: 0,
      name: 'Move across',
      clip: 'NlaMove',
      at: 0,
      duration: 0.9,
      clipStart: 0,
      clipEnd: 0.9,
      scale: 1,
      speed: 1,
      repeat: 1,
      blend: 'replace',
      blendIn: 0,
      blendOut: 0,
      weight: 1,
      easing: 'linear',
      extrapolation: 'hold-forward',
      reverse: false,
      muted: false,
    }],
  },
} as const satisfies CompiledSceneDescriptor

const ManualScene = createR3FCompiledScene({
  descriptor: manualDescriptor,
  displayName: 'ManualTransportScene',
  loader: createFixtureLoader('manual'),
  fallbackCamera: createCamera(),
  prewarm: false,
})

const SequenceScene = createR3FCompiledScene({
  descriptor: sequenceDescriptor,
  displayName: 'AuthoredSequenceScene',
  loader: createFixtureLoader('sequence'),
  fallbackCamera: createCamera(),
  prewarm: false,
})

function recordInstalled(kind: Kind, installed: InstalledThreeCompiledScene): void {
  live[kind].installed = installed
  evidence[kind].internalActionsPaused =
    installed.playback?.actions.every((action) => action.paused === true) ?? null
}

function ManualHandleBridge() {
  const handle = ManualScene.useScene()
  useEffect(() => installHandle('manual', handle), [handle])
  return null
}

function SequenceHandleBridge() {
  const handle = SequenceScene.useScene()
  useEffect(() => installHandle('sequence', handle), [handle])
  return null
}

function installHandle(kind: Kind, handle: R3FCompiledSceneHandle): () => void {
  const target = evidence[kind]
  const animation = handle.animation
  if (!animation) throw new Error(`${kind} fixture did not expose animation`)
  live[kind].handle = handle
  live[kind].node = handle.nodes.AnimatedBox
  target.ready = true
  target.mounted = true
  target.unmounted = false
  syncState(kind, animation.state)
  const unsubscribe = animation.subscribe((state) => {
    target.notifications += 1
    syncState(kind, state)
  })
  evidence.ready = evidence.manual.ready && (!evidence.sequence.mounted || evidence.sequence.ready)
  refreshUi(kind)
  return () => {
    unsubscribe()
    target.mounted = false
    target.unmounted = true
    target.ready = false
    target.phase = 'disposed'
    live[kind].handle = null
    live[kind].installed = null
    live[kind].node = null
    refreshUi(kind)
  }
}

function sampleRenderedPixels(
  gl: THREE.WebGLRenderer,
  kind: Kind,
): { centroidX: number; count: number } {
  const size = gl.getDrawingBufferSize(new THREE.Vector2())
  const pixels = new Uint8Array(size.x * size.y * 4)
  const context = gl.getContext()
  context.readPixels(0, 0, size.x, size.y, context.RGBA, context.UNSIGNED_BYTE, pixels)
  let sumX = 0
  let count = 0
  for (let y = 0; y < size.y; y += 1) {
    for (let x = 0; x < size.x; x += 1) {
      const offset = (y * size.x + x) * 4
      const red = pixels[offset]!
      const green = pixels[offset + 1]!
      const blue = pixels[offset + 2]!
      const matches = kind === 'manual'
        ? green > 100 && blue > 100 && green > red * 1.4
        : red > 130 && green > 45 && red > blue * 1.25
      if (!matches) continue
      sumX += x
      count += 1
    }
  }
  return { centroidX: count > 0 ? sumX / count : -1, count }
}

function instrumentRenderer(kind: Kind, state: RootState): void {
  const target = evidence[kind]
  const { gl } = state
  gl.setPixelRatio(1)
  gl.outputColorSpace = THREE.SRGBColorSpace
  const context = gl.getContext()
  target.webglVersion = String(context.getParameter(context.VERSION))
  target.webglRenderer = String(context.getParameter(context.RENDERER))
  const originalRender = gl.render.bind(gl)
  gl.render = ((scene: THREE.Object3D, camera: THREE.Camera) => {
    originalRender(scene, camera)
    target.renders += 1
    target.poseX = live[kind].node?.position.x ?? target.poseX
    target.internalActionsPaused =
      live[kind].installed?.playback?.actions.every((action) => action.paused === true)
      ?? target.internalActionsPaused
    const pixels = sampleRenderedPixels(gl, kind)
    target.pixelCentroidX = pixels.centroidX
    target.coloredPixels = pixels.count
    if (target.renderSamples.length < 500) {
      target.renderSamples.push({
        render: target.renders,
        atMs: performance.now(),
        phase: target.phase,
        animationTime: target.time,
        poseX: target.poseX,
        pixelCentroidX: target.pixelCentroidX,
        coloredPixels: target.coloredPixels,
        internalActionsPaused: target.internalActionsPaused,
      })
    }
    if (target.renders < 6 || target.renders % 8 === 0) refreshUi(kind)
  }) as THREE.WebGLRenderer['render']
}

function SceneCanvas({ kind }: { kind: Kind }) {
  const isManual = kind === 'manual'
  return (
    <Canvas
      frameloop="demand"
      dpr={1}
      flat
      camera={{ position: [0, 0.2, 4.2], fov: 42, near: 0.1, far: 30 }}
      gl={{ antialias: false, preserveDrawingBuffer: true, alpha: false }}
      onCreated={(state) => {
        state.scene.background = BACKGROUND.clone()
        instrumentRenderer(kind, state)
      }}
    >
      {isManual ? (
        <ManualScene onReady={(installed) => recordInstalled('manual', installed)}>
          <ManualHandleBridge />
        </ManualScene>
      ) : (
        <SequenceScene onReady={(installed) => recordInstalled('sequence', installed)}>
          <SequenceHandleBridge />
        </SequenceScene>
      )}
    </Canvas>
  )
}

function SceneCard({
  kind,
  mounted,
}: {
  kind: Kind
  mounted: boolean
}) {
  const title = kind === 'manual' ? 'Manual ordinary clip' : 'Authored bounded NLA'
  const description = kind === 'manual'
    ? 'Website-owned play, pause, seek, resume, and stop through the ready handle.'
    : 'Blendlink samples paused Three actions while the bounded transport owns time.'
  return (
    <article id={`${kind}-card`}>
      <div className="copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="canvas-host" id={`${kind}-canvas`}>
        {mounted ? <SceneCanvas kind={kind} /> : (
          <div className="disposed">CANVAS UNMOUNTED · RESOURCES RELEASED</div>
        )}
      </div>
      <pre id={`${kind}-facts`}>waiting for ready handle…</pre>
    </article>
  )
}

function App() {
  const [manualMounted, updateManualMounted] = useState(true)
  const [sequenceMounted, updateSequenceMounted] = useState(false)
  useEffect(() => {
    setManualMounted = updateManualMounted
    setSequenceMounted = updateSequenceMounted
    refreshUi('manual')
    refreshUi('sequence')
    return () => {
      setManualMounted = null
      setSequenceMounted = null
    }
  }, [])
  return (
    <div className="grid">
      <SceneCard kind="manual" mounted={manualMounted} />
      <SceneCard kind="sequence" mounted={sequenceMounted} />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('missing #root host')
createRoot(root).render(<App />)
