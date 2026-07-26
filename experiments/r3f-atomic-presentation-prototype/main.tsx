import React, { StrictMode, useEffect, useRef } from 'react'
import { createRoot as createDomRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createR3FCompiledScene } from '../../packages/blendlink/src/reactThreeFiber.ts'
import { defineThreeComponentAdapter } from '../../packages/blendlink/src/threeRuntime.ts'

type Mode =
  | 'live-gate'
  | 'visibility-gate'
  | 'detached-commit'
  | 'production-adapter'
  | 'production-external-assets'
type Phase =
  | 'initial'
  | 'preparing-red'
  | 'compiling-green'
  | 'fetching-glb'
  | 'fetching-texture'
  | 'decoded-texture'
  | 'uploading-texture'
  | 'compiling-textured'
  | 'ready'
type PixelClass = 'baseline-blue' | 'partial-red' | 'ready-green' | 'other'

type PixelSample = Readonly<{
  frame: number
  phase: Phase
  rgba: readonly [number, number, number, number]
  classification: PixelClass
}>

type CellEvidence = {
  mode: Mode
  phase: Phase
  effectSetups: number
  effectCleanups: number
  staleAttemptsStopped: number
  completedAttempts: number
  gateCallbacks: number
  gateBlocks: number
  competingRenders: number
  compileAsyncCalls: number
  detachedPreparationChecks: number
  livePreparationLeaks: number
  adapterActivations: number
  adapterCommittedSceneMatches: number
  adapterCommittedCameraMatches: number
  managerStartedUrls: string[]
  managerCompletedUrls: string[]
  externalGltfLoads: number
  externalTextureDecodeChecks: number
  externalTextureInitCalls: number
  externalTextureDimensions: readonly [number, number] | null
  externalTextureImageKind: string | null
  samples: PixelSample[]
  counts: Record<PixelClass, number>
  errors: string[]
}

type AtomicEvidence = {
  ready: boolean
  versions: {
    react: '19.0.0'
    reactDom: '19.0.0'
    reactThreeFiber: '9.6.1'
    three: '0.184.0'
  }
  strictMode: {
    reactDomRoot: true
    r3fSubtree: true
    reactDomEffectSetups: number
    reactDomEffectCleanups: number
  }
  cells: Record<Mode, CellEvidence>
  errors: string[]
}

declare global {
  interface Window {
    __r3fAtomicEvidence: AtomicEvidence
  }
}

const BASELINE = new THREE.Color(0.01, 0.02, 0.24)
const PARTIAL = new THREE.Color(1, 0.005, 0.005)
const READY = new THREE.Color(0.005, 1, 0.025)
const MODES: readonly Mode[] = [
  'live-gate',
  'visibility-gate',
  'detached-commit',
  'production-adapter',
  'production-external-assets',
]

let productionLiveWorld: THREE.Scene | null = null
let externalLiveWorld: THREE.Scene | null = null

function makeCell(mode: Mode): CellEvidence {
  return {
    mode,
    phase: 'initial',
    effectSetups: 0,
    effectCleanups: 0,
    staleAttemptsStopped: 0,
    completedAttempts: 0,
    gateCallbacks: 0,
    gateBlocks: 0,
    competingRenders: 0,
    compileAsyncCalls: 0,
    detachedPreparationChecks: 0,
    livePreparationLeaks: 0,
    adapterActivations: 0,
    adapterCommittedSceneMatches: 0,
    adapterCommittedCameraMatches: 0,
    managerStartedUrls: [],
    managerCompletedUrls: [],
    externalGltfLoads: 0,
    externalTextureDecodeChecks: 0,
    externalTextureInitCalls: 0,
    externalTextureDimensions: null,
    externalTextureImageKind: null,
    samples: [],
    counts: {
      'baseline-blue': 0,
      'partial-red': 0,
      'ready-green': 0,
      other: 0,
    },
    errors: [],
  }
}

window.__r3fAtomicEvidence = {
  ready: false,
  versions: {
    react: '19.0.0',
    reactDom: '19.0.0',
    reactThreeFiber: '9.6.1',
    three: '0.184.0',
  },
  strictMode: {
    reactDomRoot: true,
    r3fSubtree: true,
    reactDomEffectSetups: 0,
    reactDomEffectCleanups: 0,
  },
  cells: {
    'live-gate': makeCell('live-gate'),
    'visibility-gate': makeCell('visibility-gate'),
    'detached-commit': makeCell('detached-commit'),
    'production-adapter': makeCell('production-adapter'),
    'production-external-assets': makeCell('production-external-assets'),
  },
  errors: [],
}

window.addEventListener('error', (event) => {
  window.__r3fAtomicEvidence.errors.push(event.error?.message ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  window.__r3fAtomicEvidence.errors.push(
    event.reason instanceof Error ? event.reason.message : String(event.reason),
  )
})

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count
    const tick = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function classifyPixel([red, green, blue]: readonly number[]): PixelClass {
  if (red > 150 && red > green * 1.8 && red > blue * 1.8) return 'partial-red'
  if (green > 150 && green > red * 1.8 && green > blue * 1.8) return 'ready-green'
  if (blue > 45 && blue > red * 1.5 && blue > green * 1.5) return 'baseline-blue'
  return 'other'
}

function renderOutput(cell: CellEvidence): void {
  const output = document.getElementById(`${cell.mode}-output`)
  if (!output) return
  output.textContent =
    `phase=${cell.phase}\n` +
    `attempt setups/cleanups=${cell.effectSetups}/${cell.effectCleanups}\n` +
    `priority-1 blocks=${cell.gateBlocks}\n` +
    `priority-2 red/green/blue=${cell.counts['partial-red']}/` +
      `${cell.counts['ready-green']}/${cell.counts['baseline-blue']}` +
    (cell.mode === 'production-external-assets'
      ? `\nnetwork starts/ends=${cell.managerStartedUrls.length}/` +
        `${cell.managerCompletedUrls.length}; decode/init=` +
        `${cell.externalTextureDecodeChecks}/${cell.externalTextureInitCalls}`
      : '')
  const timeline = document.getElementById(`${cell.mode}-timeline`)
  if (!timeline) return
  const samples = cell.samples.slice(0, 24)
  timeline.replaceChildren(...samples.map((sample) => {
    const swatch = document.createElement('span')
    swatch.className = sample.classification
    swatch.title = `frame ${sample.frame}: ${sample.phase} ${sample.rgba.join(',')}`
    return swatch
  }))
}

function updateVerdict(): void {
  const evidence = window.__r3fAtomicEvidence
  const cellsSettled = MODES.every((mode) => {
    const cell = evidence.cells[mode]
    return cell.phase === 'ready'
      && cell.effectSetups >= 1
      && cell.counts['ready-green'] >= 3
  })
  const strictModeObserved = evidence.strictMode.reactDomEffectSetups >= 2
    && evidence.strictMode.reactDomEffectCleanups >= 1
  if (!cellsSettled || !strictModeObserved) return
  evidence.ready = true
  const verdict = document.getElementById('verdict')
  if (verdict) {
    verdict.textContent =
      `Observed partial red frames — live=${evidence.cells['live-gate'].counts['partial-red']}, ` +
      `hidden-root=${evidence.cells['visibility-gate'].counts['partial-red']}, ` +
      `detached-control=${evidence.cells['detached-commit'].counts['partial-red']}, ` +
      `production-adapter=${evidence.cells['production-adapter'].counts['partial-red']}, ` +
      `external-assets=${evidence.cells['production-external-assets'].counts['partial-red']}. ` +
      `ReactDOM Strict Effect setups/cleanups=` +
      `${evidence.strictMode.reactDomEffectSetups}/${evidence.strictMode.reactDomEffectCleanups}. ` +
      'The detached control and production adapter kept the application world unchanged until commit.'
  }
}

function makePreparedRoot(color: THREE.Color): {
  root: THREE.Group
  material: THREE.MeshBasicMaterial
  dispose(): void
} {
  const geometry = new THREE.PlaneGeometry(5, 5)
  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
  const root = new THREE.Group()
  root.name = 'PrototypeCompiledRoot'
  root.add(new THREE.Mesh(geometry, material))
  return {
    root,
    material,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

let productionPhaseRef: React.MutableRefObject<Phase> | null = null

function setProductionPhase(phase: Phase): void {
  const cell = window.__r3fAtomicEvidence.cells['production-adapter']
  cell.phase = phase
  if (productionPhaseRef) productionPhaseRef.current = phase
  renderOutput(cell)
}

function productionRootMaterial(root: THREE.Object3D): THREE.MeshBasicMaterial {
  let material: THREE.MeshBasicMaterial | null = null
  root.traverse((object) => {
    if (material || !(object instanceof THREE.Mesh)) return
    if (object.material instanceof THREE.MeshBasicMaterial) material = object.material
  })
  if (!material) throw new Error('Production adapter fixture root has no basic material')
  return material
}

const productionLoadingManager = new THREE.LoadingManager()
const productionLoader = {
  manager: productionLoadingManager,
  async loadAsync() {
    const cell = window.__r3fAtomicEvidence.cells['production-adapter']
    cell.effectSetups += 1
    setProductionPhase('preparing-red')
    await waitFrames(5)
    const prepared = makePreparedRoot(PARTIAL)
    prepared.root.name = 'ProductionAdapterSyntheticGLTFRoot'
    return {
      scene: prepared.root,
      scenes: [prepared.root],
      animations: [],
      cameras: [],
      asset: {},
      parser: {},
      userData: {},
    }
  },
}

const productionColorAdapter = defineThreeComponentAdapter(async ({
  root,
  scene: preparedScene,
  camera: preparedCamera,
}) => {
  const cell = window.__r3fAtomicEvidence.cells['production-adapter']
  const checkDetached = (): void => {
    cell.detachedPreparationChecks += 1
    if (root.parent === productionLiveWorld) cell.livePreparationLeaks += 1
  }
  checkDetached()
  await waitFrames(5)
  checkDetached()
  productionRootMaterial(root).color.copy(READY)
  setProductionPhase('compiling-green')
  return {
    activate(scene, camera) {
      cell.adapterActivations += 1
      if (scene === productionLiveWorld && scene !== preparedScene) {
        cell.adapterCommittedSceneMatches += 1
      } else {
        cell.errors.push('marked adapter did not receive the committed application Scene')
      }
      if (camera === preparedCamera) {
        cell.adapterCommittedCameraMatches += 1
      } else {
        cell.errors.push('marked adapter did not receive the prepared committed camera')
      }
    },
    dispose() {
      cell.effectCleanups += 1
    },
  }
})

const ProductionCompiledScene = createR3FCompiledScene({
  displayName: 'ProductionAtomicFixtureScene',
  descriptor: {
    url: '/synthetic/production-atomic-fixture.glb',
    nodes: {},
    playback: { start: 'manual', loop: 'repeat', speed: 1 },
    look: {
      toneMapping: 'none',
      exposure: 0,
      background: 'application',
    },
    components: [{
      id: 'production-color-preparation',
      type: 'prototype.prepare-color',
      schemaVersion: 1,
      enabled: true,
      target: { kind: 'scene' },
      values: {},
    }],
  },
  loader: productionLoader as unknown as
    import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
  componentAdapters: {
    'prototype.prepare-color': productionColorAdapter,
  },
})

let externalPhaseRef: React.MutableRefObject<Phase> | null = null

function setExternalPhase(phase: Phase): void {
  const cell = window.__r3fAtomicEvidence.cells['production-external-assets']
  cell.phase = phase
  if (externalPhaseRef) externalPhaseRef.current = phase
  renderOutput(cell)
}

function externalRootTexture(root: THREE.Object3D): THREE.Texture {
  let texture: THREE.Texture | null = null
  root.traverse((object) => {
    if (texture || !(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      material.toneMapped = false
      if ('map' in material && material.map instanceof THREE.Texture) {
        texture = material.map
        break
      }
    }
  })
  if (!texture) throw new Error('External GLB fixture did not expose its decoded base-color texture')
  return texture
}

const externalLoadingManager = new THREE.LoadingManager()
const managerItemStart = externalLoadingManager.itemStart.bind(externalLoadingManager)
const managerItemEnd = externalLoadingManager.itemEnd.bind(externalLoadingManager)
externalLoadingManager.itemStart = (url) => {
  const cell = window.__r3fAtomicEvidence.cells['production-external-assets']
  cell.managerStartedUrls.push(url)
  if (url.endsWith('/atomic-green.png')) setExternalPhase('fetching-texture')
  managerItemStart(url)
}
externalLoadingManager.itemEnd = (url) => {
  const cell = window.__r3fAtomicEvidence.cells['production-external-assets']
  cell.managerCompletedUrls.push(url)
  managerItemEnd(url)
  if (url.endsWith('/atomic-green.png')) setExternalPhase('decoded-texture')
}

const externalLoader = new GLTFLoader(externalLoadingManager)
const externalLoadAsync = externalLoader.loadAsync.bind(externalLoader)
externalLoader.loadAsync = async (url, onProgress) => {
  const cell = window.__r3fAtomicEvidence.cells['production-external-assets']
  cell.effectSetups += 1
  setExternalPhase('fetching-glb')
  const gltf = await externalLoadAsync(url, onProgress)
  cell.externalGltfLoads += 1
  return gltf
}

const externalTextureAdapter = defineThreeComponentAdapter(async ({
  root,
  scene: preparedScene,
  camera: preparedCamera,
  renderer,
}) => {
  const cell = window.__r3fAtomicEvidence.cells['production-external-assets']
  const checkDetached = (): void => {
    cell.detachedPreparationChecks += 1
    if (root.parent === externalLiveWorld) cell.livePreparationLeaks += 1
  }
  checkDetached()
  const texture = externalRootTexture(root)
  const image = texture.image as { width?: number; height?: number } | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  cell.externalTextureImageKind = image?.constructor?.name ?? null
  if (width !== 2 || height !== 2) {
    throw new Error(`External PNG decoded to ${width}x${height}; expected 2x2`)
  }
  if (typeof ImageBitmap === 'undefined' || !(image instanceof ImageBitmap)) {
    throw new Error(
      `External PNG used ${cell.externalTextureImageKind ?? 'an unknown image type'}; expected ImageBitmap`,
    )
  }
  cell.externalTextureDecodeChecks += 1
  cell.externalTextureDimensions = [width, height]
  setExternalPhase('uploading-texture')
  renderer.initTexture(texture)
  await waitFrames(5)
  checkDetached()
  setExternalPhase('compiling-textured')
  return {
    activate(scene, camera) {
      cell.adapterActivations += 1
      if (scene === externalLiveWorld && scene !== preparedScene) {
        cell.adapterCommittedSceneMatches += 1
      } else {
        cell.errors.push('external adapter did not receive the committed application Scene')
      }
      if (camera === preparedCamera) {
        cell.adapterCommittedCameraMatches += 1
      } else {
        cell.errors.push('external adapter did not receive the prepared committed camera')
      }
    },
    dispose() {
      cell.effectCleanups += 1
    },
  }
})

const ExternalAssetCompiledScene = createR3FCompiledScene({
  displayName: 'ProductionExternalAssetAtomicFixtureScene',
  descriptor: {
    url: '/external-assets/atomic-scene.glb',
    nodes: {},
    playback: { start: 'manual', loop: 'repeat', speed: 1 },
    look: {
      toneMapping: 'none',
      exposure: 1,
      background: 'application',
    },
    components: [{
      id: 'external-texture-preparation',
      type: 'prototype.prepare-external-texture',
      schemaVersion: 1,
      enabled: true,
      target: { kind: 'scene' },
      values: {},
    }],
  },
  loader: externalLoader,
  componentAdapters: {
    'prototype.prepare-external-texture': externalTextureAdapter,
  },
})

function InstallAttempt({
  mode,
  phase,
}: {
  mode: Mode
  phase: React.MutableRefObject<Phase>
}) {
  const { gl, scene, camera, invalidate } = useThree()
  const cell = window.__r3fAtomicEvidence.cells[mode]

  useEffect(() => {
    const attempt = ++cell.effectSetups
    let cancelled = false
    let committed = false
    const originalBackground = scene.background
    const partialBackground = PARTIAL.clone()
    const readyBackground = READY.clone()
    const prepared = makePreparedRoot(PARTIAL)
    const stagingScene = new THREE.Scene()
    stagingScene.background = partialBackground
    stagingScene.add(prepared.root)
    phase.current = 'preparing-red'
    cell.phase = 'preparing-red'

    if (mode !== 'detached-commit') {
      prepared.root.removeFromParent()
      prepared.root.visible = mode === 'live-gate'
      scene.add(prepared.root)
      // This is the leak a root-only visibility gate cannot contain.
      scene.background = partialBackground
    }
    invalidate()
    renderOutput(cell)

    void (async () => {
      await waitFrames(5)
      if (cancelled) {
        cell.staleAttemptsStopped += 1
        return
      }

      prepared.material.color.copy(READY)
      stagingScene.background = readyBackground
      phase.current = 'compiling-green'
      cell.phase = 'compiling-green'
      cell.compileAsyncCalls += 1
      renderOutput(cell)

      // Three's documented shader barrier can operate on a detached Object3D.
      // It is deliberately not treated as a texture-upload or pixel-ready fence.
      await gl.compileAsync(stagingScene, camera, stagingScene)
      await waitFrames(3)
      if (cancelled) {
        cell.staleAttemptsStopped += 1
        return
      }

      if (mode === 'detached-commit') {
        // The experiment's atomic commit: no await and no yield between
        // root attachment and scene-global publication.
        prepared.root.removeFromParent()
        scene.add(prepared.root)
        scene.background = readyBackground
      } else {
        prepared.root.visible = true
        scene.background = readyBackground
      }
      committed = true
      phase.current = 'ready'
      cell.phase = 'ready'
      cell.completedAttempts += 1
      invalidate()
      renderOutput(cell)
      updateVerdict()
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      cell.errors.push(message)
      window.__r3fAtomicEvidence.errors.push(`${mode}: ${message}`)
    })

    return () => {
      cancelled = true
      cell.effectCleanups += 1
      if (prepared.root.parent === scene) scene.remove(prepared.root)
      else prepared.root.removeFromParent()
      if (scene.background === partialBackground || scene.background === readyBackground) {
        scene.background = originalBackground
      }
      prepared.dispose()
      if (committed) committed = false
      renderOutput(cell)
    }
  }, [camera, cell, gl, invalidate, mode, phase, scene])

  return null
}

function BlendlinkFrameGate({
  mode,
  phase,
}: {
  mode: Mode
  phase: React.MutableRefObject<Phase>
}) {
  const cell = window.__r3fAtomicEvidence.cells[mode]
  useFrame(() => {
    cell.gateCallbacks += 1
    if (phase.current !== 'ready') cell.gateBlocks += 1
  }, 1)
  return null
}

function CompetingApplicationRenderer({
  mode,
  phase,
}: {
  mode: Mode
  phase: React.MutableRefObject<Phase>
}) {
  const cell = window.__r3fAtomicEvidence.cells[mode]
  const pixel = useRef(new Uint8Array(4))
  const frame = useRef(0)

  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)
    cell.competingRenders += 1
    frame.current += 1

    const context = gl.getContext()
    const x = Math.max(0, Math.floor(gl.domElement.width / 2))
    const y = Math.max(0, Math.floor(gl.domElement.height / 2))
    context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel.current)
    const rgba = Array.from(pixel.current) as [number, number, number, number]
    const classification = classifyPixel(rgba)
    cell.counts[classification] += 1
    if (cell.samples.length < 240) {
      cell.samples.push({
        frame: frame.current,
        phase: phase.current,
        rgba,
        classification,
      })
    }
    if (frame.current % 3 === 0) renderOutput(cell)
    updateVerdict()
  }, 2)
  return null
}

function PrototypeCell({ mode }: { mode: Mode }) {
  const phase = useRef<Phase>('initial')
  return (
    <>
      <InstallAttempt mode={mode} phase={phase} />
      <BlendlinkFrameGate mode={mode} phase={phase} />
      <CompetingApplicationRenderer mode={mode} phase={phase} />
    </>
  )
}

function ProductionAdapterCell() {
  const mode: Mode = 'production-adapter'
  const phase = useRef<Phase>('initial')
  const cell = window.__r3fAtomicEvidence.cells[mode]
  productionPhaseRef = phase
  return (
    <>
      <ProductionCompiledScene
        onLoadStateChange={(state) => {
          if ((state.phase === 'loading' || state.phase === 'preparing')
              && cell.phase !== 'compiling-green') {
            setProductionPhase('preparing-red')
          }
        }}
        onReady={() => {
          cell.completedAttempts += 1
          setProductionPhase('ready')
          updateVerdict()
        }}
      />
      <BlendlinkFrameGate mode={mode} phase={phase} />
      <CompetingApplicationRenderer mode={mode} phase={phase} />
    </>
  )
}

function ProductionExternalAssetCell() {
  const mode: Mode = 'production-external-assets'
  const phase = useRef<Phase>('initial')
  const cell = window.__r3fAtomicEvidence.cells[mode]
  externalPhaseRef = phase
  return (
    <>
      <ExternalAssetCompiledScene
        onLoadStateChange={(state) => {
          if (state.phase === 'loading' && cell.phase === 'initial') {
            setExternalPhase('fetching-glb')
          }
        }}
        onReady={() => {
          cell.completedAttempts += 1
          setExternalPhase('ready')
          updateVerdict()
        }}
      />
      <BlendlinkFrameGate mode={mode} phase={phase} />
      <CompetingApplicationRenderer mode={mode} phase={phase} />
    </>
  )
}

function CellCanvas({ mode }: { mode: Mode }) {
  return (
    <Canvas
      frameloop="always"
      dpr={1}
      flat
      camera={{ position: [0, 0, 2], fov: 50, near: 0.1, far: 10 }}
      gl={{ antialias: false, preserveDrawingBuffer: true }}
      onCreated={({ gl, scene }) => {
        gl.setPixelRatio(1)
        scene.background = BASELINE.clone()
        if (mode === 'production-adapter') {
          productionLiveWorld = scene
        }
        if (mode === 'production-external-assets') {
          externalLiveWorld = scene
          const initTexture = gl.initTexture.bind(gl)
          gl.initTexture = (texture) => {
            const cell = window.__r3fAtomicEvidence.cells[mode]
            cell.externalTextureInitCalls += 1
            initTexture(texture)
          }
        }
        if (mode === 'production-adapter' || mode === 'production-external-assets') {
          const compileAsync = gl.compileAsync.bind(gl)
          gl.compileAsync = async (...args) => {
            const cell = window.__r3fAtomicEvidence.cells[mode]
            cell.compileAsyncCalls += 1
            await waitFrames(5)
            return compileAsync(...args)
          }
        }
      }}
    >
      <StrictMode>
        {mode === 'production-adapter'
          ? <ProductionAdapterCell />
          : mode === 'production-external-assets'
            ? <ProductionExternalAssetCell />
          : <PrototypeCell mode={mode} />}
      </StrictMode>
    </Canvas>
  )
}

function App() {
  return (
    <>
      <StrictModeSentinel />
      {MODES.map((mode) => (
        createPortal(
          <CellCanvas mode={mode} />,
          requiredHost(`${mode}-root`),
          mode,
        )
      ))}
    </>
  )
}

function StrictModeSentinel() {
  useEffect(() => {
    window.__r3fAtomicEvidence.strictMode.reactDomEffectSetups += 1
    updateVerdict()
    return () => {
      window.__r3fAtomicEvidence.strictMode.reactDomEffectCleanups += 1
      updateVerdict()
    }
  }, [])
  return null
}

function requiredHost(id: string): HTMLElement {
  const host = document.getElementById(id)
  if (!host) throw new Error(`Missing prototype host ${id}`)
  return host
}

const appHost = document.createElement('div')
appHost.hidden = true
document.body.appendChild(appHost)
createDomRoot(appHost).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
