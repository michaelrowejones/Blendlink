import React, { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, type RootState } from '@react-three/fiber'
import * as THREE from 'three'
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  createR3FCompiledScene,
  type R3FCompiledSceneHandle,
} from '../../packages/blendlink/dist/reactThreeFiber.js'
import type { CompiledSceneDescriptor } from '../../packages/blendlink/dist/runtime.js'

type RenderSample = {
  render: number
  atMs: number
  requiresContinuousFrames: boolean
  camera: [number, number, number]
}

type OrbitEvidence = {
  ready: boolean
  loaderCalls: number
  readyCount: number
  renders: number
  coloredPixels: number
  requiresContinuousFrames: boolean
  camera: [number, number, number]
  renderSamples: RenderSample[]
  errors: string[]
}

type OrbitApi = {
  evidence: OrbitEvidence
  snapshot(): Omit<OrbitEvidence, 'renderSamples'> & { renderSamples: number }
}

declare global {
  interface Window {
    __blendlinkOrbitDemand: OrbitApi
  }
}

const evidence: OrbitEvidence = {
  ready: false,
  loaderCalls: 0,
  readyCount: 0,
  renders: 0,
  coloredPixels: 0,
  requiresContinuousFrames: false,
  camera: [0, 0.45, 5.4],
  renderSamples: [],
  errors: [],
}

let liveHandle: R3FCompiledSceneHandle<typeof descriptor> | null = null

function syncEvidence(): void {
  if (liveHandle) {
    evidence.requiresContinuousFrames = liveHandle.requiresContinuousFrames
    evidence.camera = liveHandle.camera.position.toArray() as [number, number, number]
  }
  const facts = document.getElementById('facts')
  if (facts) {
    facts.textContent = [
      `ready=${evidence.ready}  renders=${evidence.renders}`,
      `continuous=${evidence.requiresContinuousFrames}`,
      `camera=[${evidence.camera.map((value) => value.toFixed(4)).join(', ')}]`,
      `visible pixels=${evidence.coloredPixels}`,
    ].join('\n')
  }
  const status = document.getElementById('status')
  if (status && evidence.ready) status.textContent = 'PRODUCTION ORBIT READY'
}

const api: OrbitApi = {
  evidence,
  snapshot() {
    syncEvidence()
    return { ...evidence, camera: [...evidence.camera], renderSamples: evidence.renderSamples.length }
  },
}
window.__blendlinkOrbitDemand = api

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

function fixture(): GLTF {
  const root = new THREE.Group()
  root.name = 'OrbitFixture'

  const geometry = new THREE.TorusKnotGeometry(0.85, 0.26, 120, 18)
  const material = new THREE.MeshStandardMaterial({
    color: 0x35e0b1,
    roughness: 0.28,
    metalness: 0.18,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'HeroObject'
  mesh.rotation.set(0.25, -0.3, 0.1)
  root.add(mesh)

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 40)
  camera.name = 'OrbitCamera'
  camera.position.set(0, 0.45, 5.4)
  camera.lookAt(0, 0, 0)
  camera.userData.blendlink_id = 'orbit-camera-id'
  root.add(camera)

  const target = new THREE.Object3D()
  target.name = 'OrbitTarget'
  target.userData.blendlink_id = 'orbit-target-id'
  root.add(target)

  const key = new THREE.DirectionalLight(0xffffff, 3.5)
  key.position.set(3, 5, 4)
  root.add(key)
  root.add(new THREE.HemisphereLight(0x9dc8ff, 0x18333b, 1.6))

  return {
    scene: root,
    scenes: [root],
    animations: [],
    cameras: [camera],
    asset: { version: '2.0', generator: 'Blendlink Orbit demand fixture' },
    parser: {} as GLTF['parser'],
    userData: {},
  }
}

function fixtureLoader(): GLTFLoader {
  const manager = new THREE.LoadingManager()
  return {
    manager,
    async loadAsync() {
      evidence.loaderCalls += 1
      return fixture()
    },
  } as unknown as GLTFLoader
}

const descriptor = {
  url: '/virtual/orbit-demand.glb',
  nodes: {
    HeroObject: 'HeroObject',
    OrbitCamera: 'OrbitCamera',
    OrbitTarget: 'OrbitTarget',
  },
  nodeIds: {
    OrbitCamera: 'orbit-camera-id',
    OrbitTarget: 'orbit-target-id',
  },
  objectsById: {
    'orbit-camera-id': 'OrbitCamera',
    'orbit-target-id': 'OrbitTarget',
  },
  playback: { start: 'manual', loop: 'repeat', speed: 1 },
  camera: {
    objectId: 'orbit-camera-id',
    objectName: 'OrbitCamera',
    behavior: 'orbit',
    framing: 'authored',
    targetId: 'orbit-target-id',
    targetName: 'OrbitTarget',
    compositions: [
      { name: 'Desktop', width: 1600, height: 900, safeMargin: 0.1 },
    ],
  },
} as const satisfies CompiledSceneDescriptor

const OrbitScene = createR3FCompiledScene({
  descriptor,
  displayName: 'OrbitDemandScene',
  loader: fixtureLoader(),
  prewarm: false,
})

function ReadyBridge() {
  const handle = OrbitScene.useScene()
  useEffect(() => {
    liveHandle = handle
    evidence.ready = true
    evidence.readyCount += 1
    syncEvidence()
    return () => {
      if (liveHandle === handle) liveHandle = null
      evidence.ready = false
    }
  }, [handle])
  return null
}

function countColoredPixels(gl: THREE.WebGLRenderer): number {
  const size = gl.getDrawingBufferSize(new THREE.Vector2())
  const pixels = new Uint8Array(size.x * size.y * 4)
  const context = gl.getContext()
  context.readPixels(0, 0, size.x, size.y, context.RGBA, context.UNSIGNED_BYTE, pixels)
  let count = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]!
    const green = pixels[index + 1]!
    const blue = pixels[index + 2]!
    if (green > 70 && green > red * 1.25 && green > blue * 1.05) count += 1
  }
  return count
}

function instrumentRenderer(state: RootState): void {
  state.gl.setPixelRatio(1)
  state.gl.outputColorSpace = THREE.SRGBColorSpace
  const originalRender = state.gl.render.bind(state.gl)
  state.gl.render = ((scene: THREE.Object3D, camera: THREE.Camera) => {
    originalRender(scene, camera)
    evidence.renders += 1
    evidence.coloredPixels = countColoredPixels(state.gl)
    syncEvidence()
    if (evidence.renderSamples.length < 300) {
      evidence.renderSamples.push({
        render: evidence.renders,
        atMs: performance.now(),
        requiresContinuousFrames: evidence.requiresContinuousFrames,
        camera: [...evidence.camera],
      })
    }
  }) as THREE.WebGLRenderer['render']
}

function App() {
  return (
    <Canvas
      frameloop="demand"
      dpr={1}
      flat
      camera={{ position: [0, 0.45, 5.4], fov: 44, near: 0.1, far: 40 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
      onCreated={(state) => {
        state.scene.background = new THREE.Color(0x07101a)
        instrumentRenderer(state)
      }}
    >
      <OrbitScene>
        <ReadyBridge />
      </OrbitScene>
    </Canvas>
  )
}

const host = document.getElementById('canvas-host')
if (!host) throw new Error('missing #canvas-host')
createRoot(host).render(<StrictMode><App /></StrictMode>)
