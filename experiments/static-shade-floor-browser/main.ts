import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  installThreeStaticShadeFloorTextureSharing,
} from '../../packages/blendlink/src/threeMaterialCarriers.ts'

declare global {
  interface Window {
    __staticShadeFloorEvidence?: Record<string, unknown>
    __setStaticShadeFloorLight?: (enabled: boolean) => void
  }
}

const SIZE = 640

function changedPixels(left: Uint8Array, right: Uint8Array, threshold = 2) {
  let changed = 0
  let absolute = 0
  for (let offset = 0; offset < left.length; offset += 4) {
    const red = Math.abs(left[offset]! - right[offset]!)
    const green = Math.abs(left[offset + 1]! - right[offset + 1]!)
    const blue = Math.abs(left[offset + 2]! - right[offset + 2]!)
    absolute += red + green + blue
    if (red > threshold || green > threshold || blue > threshold) changed += 1
  }
  return {
    changed,
    meanAbsoluteRgb: absolute / (left.length / 4) / 3,
  }
}

function visiblePixels(bytes: Uint8Array, threshold = 3) {
  let visible = 0
  let luma = 0
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const value = (
      bytes[offset]! * 0.2126
      + bytes[offset + 1]! * 0.7152
      + bytes[offset + 2]! * 0.0722
    )
    if (value > threshold) {
      visible += 1
      luma += value
    }
  }
  return {
    count: visible,
    meanLuma: visible ? luma / visible : 0,
  }
}

async function sha256(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function main() {
  const response = await fetch('/output/static-shade-floor.glb')
  if (!response.ok) throw new Error(`GLB request failed with HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const gltf = await new GLTFLoader().parseAsync(bytes, '/output/')

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  document.body.append(renderer.domElement)

  const scene = gltf.scene
  scene.background = new THREE.Color(0, 0, 0)
  const textureSharing = installThreeStaticShadeFloorTextureSharing(scene)
  const meshes: THREE.Mesh[] = []
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  if (meshes.length !== 1) {
    throw new Error(`Expected one generated carrier mesh, found ${meshes.length}`)
  }
  const mesh = meshes[0]!
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  if (!(material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`Generated carrier loaded as ${material?.type ?? 'missing'}, not MeshStandardMaterial`)
  }
  if (!material.map || !material.emissiveMap || material.map !== material.emissiveMap) {
    throw new Error('Base Color and Emission did not load as one shared Three Texture')
  }

  const bounds = new THREE.Box3().setFromObject(mesh)
  const center = bounds.getCenter(new THREE.Vector3())
  const dimensions = bounds.getSize(new THREE.Vector3())
  const half = Math.max(dimensions.x, dimensions.z, 0.01) * 0.65
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100)
  camera.up.set(0, 0, 1)
  camera.position.set(center.x, center.y + 5, center.z)
  camera.lookAt(center)

  const light = new THREE.DirectionalLight(0xffffff, 1)
  const target = new THREE.Object3D()
  light.position.set(center.x, center.y + 4, center.z)
  target.position.copy(center)
  light.target = target
  scene.add(light, target)
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)

  const renderTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  })
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace
  function pixels(lightEnabled: boolean) {
    light.visible = lightEnabled
    const result = new Uint8Array(SIZE * SIZE * 4)
    renderer.setRenderTarget(renderTarget)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(renderTarget, 0, 0, SIZE, SIZE, result)
    return result
  }
  const lightOff = pixels(false)
  const lightOn = pixels(true)

  window.__setStaticShadeFloorLight = (enabled: boolean) => {
    light.visible = enabled
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(scene, camera)
  }
  window.__setStaticShadeFloorLight(true)

  const mapImage = material.map.image as { width?: number; height?: number } | undefined
  const gl = renderer.getContext()
  window.__staticShadeFloorEvidence = {
    ready: true,
    glbSha256: await sha256(bytes),
    glbBytes: bytes.byteLength,
    material: {
      type: material.type,
      isMeshStandardMaterial: material.isMeshStandardMaterial,
      sharedMapIdentity: material.map === material.emissiveMap,
      mapSize: [mapImage?.width ?? null, mapImage?.height ?? null],
      baseColorFactor: material.color.toArray(),
      emissiveFactor: material.emissive.toArray(),
      metallicFactor: material.metalness,
      roughnessFactor: material.roughness,
    },
    textureSharing: {
      materials: textureSharing.materials,
      alreadyShared: textureSharing.alreadyShared,
      normalized: textureSharing.normalized,
    },
    lightOff: visiblePixels(lightOff),
    lightOn: visiblePixels(lightOn),
    directResponse: changedPixels(lightOff, lightOn),
    renderer: {
      threeRevision: THREE.REVISION,
      webglVersion: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      canvas: [renderer.domElement.width, renderer.domElement.height],
    },
  }
}

main().catch((error) => {
  window.__staticShadeFloorEvidence = {
    ready: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  throw error
})
