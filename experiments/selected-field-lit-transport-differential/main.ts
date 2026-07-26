import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

declare global {
  interface Window {
    __selectedFieldSurfaceEvidence?: Record<string, unknown>
  }
}

const WIDTH = 800
const HEIGHT = 500
const variant = new URLSearchParams(location.search).get('variant') === 'lit'
  ? 'lit'
  : 'unlit'

function changedPixels(left: Uint8Array, right: Uint8Array, threshold = 3) {
  let changed = 0
  let absolute = 0
  for (let offset = 0; offset < left.length; offset += 4) {
    const delta = (
      Math.abs(left[offset] - right[offset])
      + Math.abs(left[offset + 1] - right[offset + 1])
      + Math.abs(left[offset + 2] - right[offset + 2])
    )
    absolute += delta
    if (
      Math.abs(left[offset] - right[offset]) > threshold
      || Math.abs(left[offset + 1] - right[offset + 1]) > threshold
      || Math.abs(left[offset + 2] - right[offset + 2]) > threshold
    ) changed += 1
  }
  return {
    changed,
    meanAbsoluteRgb: absolute / (left.length / 4) / 3,
  }
}

async function loadScene(url: string) {
  return await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject)
  })
}

async function main() {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.append(renderer.domElement)

  const gltf = await loadScene(`/output/${variant}.glb`)
  const scene = gltf.scene
  scene.background = new THREE.Color(0.04, 0.045, 0.055)

  const camera = gltf.cameras.find((candidate) => candidate.name === 'PROTOTYPE_Camera')
    ?? gltf.cameras[0]
  if (!(camera instanceof THREE.OrthographicCamera)) {
    throw new Error(`Fixture camera is not orthographic: ${camera?.type ?? 'missing'}`)
  }

  const meshes = new Map<string, THREE.Mesh>()
  const lights: THREE.Light[] = []
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.set(object.name, object)
    if (object instanceof THREE.Light) lights.push(object)
  })
  const receiver = meshes.get('PROTOTYPE_SelectedReceiver')
  const caster = meshes.get('PROTOTYPE_SelectedCaster')
  const floor = meshes.get('PROTOTYPE_Floor')
  const occluder = meshes.get('PROTOTYPE_Occluder')
  if (!receiver || !caster || !floor || !occluder) {
    throw new Error(`Fixture meshes are incomplete: ${JSON.stringify([...meshes.keys()])}`)
  }
  const selectedMaterial = Array.isArray(receiver.material)
    ? receiver.material[0]
    : receiver.material

  for (const importedLight of lights) importedLight.visible = false
  const prototypeSun = new THREE.DirectionalLight(0xffffff, 3)
  const prototypeSunTarget = new THREE.Object3D()
  prototypeSun.position.set(-4.8, 10, -2.4)
  prototypeSunTarget.position.set(0, 0, 0)
  prototypeSun.target = prototypeSunTarget
  scene.add(prototypeSun, prototypeSunTarget)
  lights.splice(0, lights.length, prototypeSun)

  floor.receiveShadow = true
  receiver.receiveShadow = true
  receiver.castShadow = false
  caster.castShadow = true
  caster.receiveShadow = true
  occluder.castShadow = true
  occluder.receiveShadow = true

  for (const light of lights) {
    if (light instanceof THREE.DirectionalLight) {
      light.castShadow = true
      light.shadow.mapSize.set(2048, 2048)
      light.shadow.bias = -0.0002
      light.shadow.normalBias = 0.015
      light.shadow.camera.left = -6
      light.shadow.camera.right = 6
      light.shadow.camera.top = 6
      light.shadow.camera.bottom = -6
      light.shadow.camera.near = 0.01
      light.shadow.camera.far = 30
      light.shadow.camera.updateProjectionMatrix()
    }
  }

  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)

  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: true,
    stencilBuffer: false,
  })
  target.texture.colorSpace = THREE.SRGBColorSpace
  function pixels() {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4)
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, bytes)
    return bytes
  }

  const full = pixels()

  const receiverVisibility = new Map<THREE.Object3D, boolean>()
  for (const mesh of meshes.values()) {
    receiverVisibility.set(mesh, mesh.visible)
    mesh.visible = mesh === receiver || mesh === occluder
  }
  occluder.castShadow = true
  const receiverWithOccluderShadow = pixels()
  occluder.castShadow = false
  const receiverWithoutOccluderShadow = pixels()
  occluder.castShadow = true
  for (const [mesh, visible] of receiverVisibility) mesh.visible = visible

  caster.castShadow = false
  const withoutSelectedCasterShadow = pixels()
  caster.castShadow = true

  const visibility = new Map<THREE.Object3D, boolean>()
  for (const mesh of meshes.values()) {
    visibility.set(mesh, mesh.visible)
    mesh.visible = mesh === receiver
  }
  const selectedWithLight = pixels()
  for (const light of lights) light.visible = false
  const selectedWithoutLight = pixels()
  for (const light of lights) light.visible = true
  for (const [mesh, visible] of visibility) mesh.visible = visible

  renderer.setRenderTarget(null)
  renderer.clear()
  renderer.render(scene, camera)

  const map = 'map' in selectedMaterial
    ? (selectedMaterial as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial).map
    : null
  const mapImage = map?.image as { width?: number; height?: number } | undefined
  const gl = renderer.getContext()
  window.__selectedFieldSurfaceEvidence = {
    ready: true,
    variant,
    material: {
      type: selectedMaterial.type,
      isMeshBasicMaterial: selectedMaterial instanceof THREE.MeshBasicMaterial,
      isMeshStandardMaterial: selectedMaterial instanceof THREE.MeshStandardMaterial,
      mapWidth: mapImage?.width ?? null,
      mapHeight: mapImage?.height ?? null,
      mapColorSpace: map?.colorSpace ?? null,
    },
    receivedShadow: changedPixels(
      receiverWithOccluderShadow,
      receiverWithoutOccluderShadow,
    ),
    castShadow: changedPixels(full, withoutSelectedCasterShadow),
    directLightResponse: changedPixels(selectedWithLight, selectedWithoutLight),
    renderer: {
      threeRevision: THREE.REVISION,
      webglVersion: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      canvas: [renderer.domElement.width, renderer.domElement.height],
    },
    objects: Object.fromEntries([...meshes].map(([name, mesh]) => ({
      name,
      value: {
        visible: mesh.visible,
        position: mesh.getWorldPosition(new THREE.Vector3()).toArray(),
        bounds: (() => {
          const bounds = new THREE.Box3().setFromObject(mesh)
          return [bounds.min.toArray(), bounds.max.toArray()]
        })(),
        material: Array.isArray(mesh.material)
          ? mesh.material.map((entry) => entry.type)
          : mesh.material.type,
      },
    })).map(({ name, value }) => [name, value])),
  }
}

main().catch((error) => {
  window.__selectedFieldSurfaceEvidence = {
    ready: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  throw error
})
