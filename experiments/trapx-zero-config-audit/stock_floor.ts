import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

declare global {
  interface Window {
    __trapxStockFloor?: {
      ready: boolean
      error?: string
      result?: Record<string, unknown>
    }
  }
}

window.__trapxStockFloor = { ready: false }

async function main(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(1080, 1080, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = false
  document.body.append(renderer.domElement)

  const loaded = await new GLTFLoader().loadAsync(
    '/output/blendlink/trapxUntouched.glb',
  )
  const scene = loaded.scene
  scene.background = new THREE.Color(0x000000)
  const camera = scene.getObjectByName('Camera') as THREE.PerspectiveCamera
  if (!camera?.isPerspectiveCamera) {
    throw new Error('The retained stock GLB has no authored perspective camera.')
  }
  camera.aspect = 1
  camera.updateProjectionMatrix()
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)

  const meshes: THREE.Mesh[] = []
  const lights: THREE.Light[] = []
  const textures = new Set<THREE.Texture>()
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh
      meshes.push(mesh)
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value)
        }
      }
    }
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light)
  })
  if (meshes.length !== 1) {
    throw new Error(`Expected one mesh, found ${meshes.length}.`)
  }

  await renderer.compileAsync(scene, camera)
  renderer.render(scene, camera)

  const pixels = new Uint8Array(1080 * 1080 * 4)
  const context = renderer.getContext()
  context.readPixels(
    0,
    0,
    1080,
    1080,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  )
  let nonBlack = 0
  let chromatic = 0
  let nearWhite = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    if (red + green + blue > 30) nonBlack += 1
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 24) {
      chromatic += 1
    }
    if (red > 238 && green > 238 && blue > 238) nearWhite += 1
  }

  const materials = meshes.flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  )
  const materialEvidence = materials.map((material) => {
    const physical = material as THREE.MeshPhysicalMaterial
    return {
      name: material.name,
      type: material.type,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      depthWrite: material.depthWrite,
      side: material.side,
      metalness: physical.metalness ?? null,
      roughness: physical.roughness ?? null,
      transmission: physical.transmission ?? null,
      thickness: physical.thickness ?? null,
      ior: physical.ior ?? null,
      map: physical.map?.name ?? null,
      normalMap: physical.normalMap?.name ?? null,
      mapAndNormalMapShareTexture:
        physical.map !== null && physical.map === physical.normalMap,
      specularIntensity: physical.specularIntensity ?? null,
      specularColor: physical.specularColor?.toArray() ?? null,
    }
  })
  const bounds = new THREE.Box3().setFromObject(meshes[0], true)
  window.__trapxStockFloor = {
    ready: true,
    result: {
      animations: loaded.animations.length,
      camera: {
        name: camera.name,
        position: camera.getWorldPosition(new THREE.Vector3()).toArray(),
        worldMatrixColumnMajor: camera.matrixWorld.toArray(),
        projectionMatrixColumnMajor: camera.projectionMatrix.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
      },
      counts: {
        meshes: meshes.length,
        lights: lights.length,
        materials: materials.length,
        textures: textures.size,
      },
      mesh: {
        name: meshes[0].name,
        bounds: {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
          center: bounds.getCenter(new THREE.Vector3()).toArray(),
          size: bounds.getSize(new THREE.Vector3()).toArray(),
        },
      },
      materials: materialEvidence,
      lights: lights.map((light) => ({
        name: light.name,
        type: light.type,
        intensity: light.intensity,
        color: light.color.toArray(),
        castShadow: light.castShadow,
      })),
      pixels: {
        nonBlack,
        chromatic,
        nearWhite,
        total: 1080 * 1080,
      },
      renderer: {
        webgl2: renderer.capabilities.isWebGL2,
        outputColorSpace: renderer.outputColorSpace,
        toneMapping: renderer.toneMapping,
        shadowsEnabled: renderer.shadowMap.enabled,
        vendor: context.getParameter(context.VENDOR),
        renderer: context.getParameter(context.RENDERER),
      },
    },
  }
}

main().catch((error) => {
  window.__trapxStockFloor = {
    ready: true,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
})
