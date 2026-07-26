import * as THREE from 'three'
import {
  installThreeFixedCameraAppearance,
  type ThreeFixedCameraAppearanceContract,
} from '../../packages/blendlink/src/threeFixedCameraAppearance.js'

declare global {
  interface Window {
    __fixedCameraSurfaceReady?: boolean
    __fixedCameraSurfaceEvidence?: Record<string, unknown>
    __disposeFixedCameraSurface?: () => Record<string, unknown>
  }
}

const width = 800
const height = 400
const canvas = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvas) throw new Error('Fixed-camera surface fixture needs its Canvas.')

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  preserveDrawingBuffer: true,
})
renderer.setPixelRatio(1)
renderer.setSize(width, height, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NoToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x071019)
const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
camera.name = 'Authored fixed camera'
camera.userData.blendlink_id = 'fixture-camera'
camera.position.set(0, 0, 5)
camera.updateProjectionMatrix()
camera.updateMatrixWorld(true)

const receiver = new THREE.Group()
receiver.name = 'Selected surface receiver'
receiver.userData.blendlink_id = 'fixture-receiver'
const receiverGeometry = new THREE.PlaneGeometry(1.5, 1.5)
const receiverMaterial = new THREE.MeshBasicMaterial({ color: 0xef762f, toneMapped: false })
receiverMaterial.name = 'Fixture authored material'
receiverMaterial.userData.blendlink_source_material_id = 'fixture-material'
const receiverMesh = new THREE.Mesh(receiverGeometry, receiverMaterial)
receiverMesh.name = 'Selected surface primitive'
receiverMesh.position.x = -1
receiver.add(receiverMesh)
scene.add(receiver)

const foregroundMaterial = new THREE.MeshBasicMaterial({ color: 0xe62bd0, toneMapped: false })
const foreground = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), foregroundMaterial)
foreground.name = 'Untouched foreground primitive'
foreground.position.x = 1
scene.add(foreground)

scene.updateMatrixWorld(true)
camera.updateMatrixWorld(true)
const capture = new THREE.DataTexture(
  new Uint8Array([26, 196, 235, 255, 26, 196, 235, 255]),
  2,
  1,
  THREE.RGBAFormat,
)
capture.name = 'Display-referred synthetic Eevee surface'
capture.colorSpace = THREE.SRGBColorSpace
capture.needsUpdate = true

const sceneHash = 'a'.repeat(64)
const sourceHash = 'b'.repeat(64)
const captureHash = 'c'.repeat(64)
const contract: ThreeFixedCameraAppearanceContract = {
  schemaVersion: 1,
  sceneHash,
  sourceHash,
  frame: 7,
  capture: {
    hash: captureHash,
    width: 2,
    height: 1,
    aspect: 2,
    colorSpace: 'srgb-display',
  },
  camera: {
    objectId: 'fixture-camera',
    matrixWorld: camera.matrixWorld.toArray(),
    projectionMatrix: camera.projectionMatrix.toArray(),
  },
  surfaces: [{
    receiverId: 'fixture-receiver',
    sourceMaterialId: 'fixture-material',
    primitiveCount: 1,
  }],
}

const originalGeometry = receiverMesh.geometry
const originalForegroundMaterial = foreground.material
const handle = installThreeFixedCameraAppearance({
  root: scene,
  camera,
  texture: capture,
  contract,
  evidence: { sceneHash, sourceHash, captureHash, frame: 7 },
  viewport: { width, height },
})
const installedMaterial = receiverMesh.material
let installedMaterialDisposed = false
installedMaterial.addEventListener('dispose', () => {
  installedMaterialDisposed = true
})
await renderer.compileAsync(scene, camera)
renderer.render(scene, camera)

const raycaster = new THREE.Raycaster()
const receiverNdc = receiverMesh.getWorldPosition(new THREE.Vector3()).project(camera)
raycaster.setFromCamera(new THREE.Vector2(receiverNdc.x, receiverNdc.y), camera)
const raycast = raycaster.intersectObject(receiverMesh, false)[0]
const screen = (object: THREE.Object3D) => {
  const ndc = object.getWorldPosition(new THREE.Vector3()).project(camera)
  return {
    x: Math.round((ndc.x * 0.5 + 0.5) * width),
    y: Math.round((-ndc.y * 0.5 + 0.5) * height),
  }
}

let wrongAspectError = ''
try {
  handle.assertCompatible({ width: 400, height: 400 })
} catch (error) {
  wrongAspectError = error instanceof Error ? error.message : String(error)
}
camera.position.x += 0.25
camera.updateMatrixWorld(true)
let movedCameraError = ''
try {
  handle.assertCompatible({ width, height })
} catch (error) {
  movedCameraError = error instanceof Error ? error.message : String(error)
}
camera.position.x -= 0.25
camera.updateMatrixWorld(true)

window.__fixedCameraSurfaceEvidence = {
  ready: true,
  webgl2: renderer.capabilities.isWebGL2,
  geometryPreserved: receiverMesh.geometry === originalGeometry,
  foregroundMaterialPreserved: foreground.material === originalForegroundMaterial,
  installedMaterialChanged: receiverMesh.material !== receiverMaterial,
  installedMaterialType: receiverMesh.material.type,
  bindingCount: handle.bindingCount,
  materialCount: handle.materialCount,
  raycast: raycast ? { object: raycast.object.name, distance: raycast.distance } : null,
  wrongAspectError,
  movedCameraError,
  samplePoints: {
    receiver: screen(receiverMesh),
    foreground: screen(foreground),
  },
  render: {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  },
}
window.__disposeFixedCameraSurface = () => {
  handle.dispose()
  renderer.render(scene, camera)
  const result = {
    materialRestored: receiverMesh.material === receiverMaterial,
    foregroundMaterialPreserved: foreground.material === originalForegroundMaterial,
    geometryPreserved: receiverMesh.geometry === originalGeometry,
    installedMaterialDisposed,
  }
  window.__fixedCameraSurfaceEvidence = {
    ...window.__fixedCameraSurfaceEvidence,
    disposed: result,
  }
  return result
}
window.__fixedCameraSurfaceReady = true
