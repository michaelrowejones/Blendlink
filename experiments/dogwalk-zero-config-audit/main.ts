import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

declare global {
  interface Window {
    __dogwalkEvidence?: {
      ready: boolean
      error?: string
      result?: Record<string, unknown>
    }
  }
}

window.__dogwalkEvidence = { ready: false }

async function main() {
  const params = new URLSearchParams(location.search)
  const glb = params.get('glb') ??
    'stock-needle-core-floor.glb'
  const shadowsEnabled = params.get('shadows') !== 'off'
  const hideShadowCasters = params.get('shadowCasters') === 'hide'
  const maximizeAnisotropy = params.get('anisotropy') === 'max'
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(1000, 500, false)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = shadowsEnabled
  document.body.append(renderer.domElement)

  const loaded = await new GLTFLoader().loadAsync(
    `/output/${glb}`,
  )
  const scene = loaded.scene
  scene.background = new THREE.Color(0xdce8ef)
  let meshes = 0
  let skinnedMeshes = 0
  let lights = 0
  let textures = new Set<THREE.Texture>()
  const shadowCasterMeshes: {
    name: string
    materials: string[]
    visibleBeforeControl: boolean
  }[] = []
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh
      meshes += 1
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes += 1
      mesh.castShadow = shadowsEnabled
      mesh.receiveShadow = shadowsEnabled
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const materialNames = materials.map((material) => material.name)
      if (materialNames.some((name) => name.toLowerCase().includes('shadow_caster'))) {
        shadowCasterMeshes.push({
          name: mesh.name,
          materials: materialNames,
          visibleBeforeControl: mesh.visible,
        })
        if (hideShadowCasters) mesh.visible = false
      }
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            textures.add(value)
            if (maximizeAnisotropy) {
              value.anisotropy = renderer.capabilities.getMaxAnisotropy()
              value.needsUpdate = true
            }
          }
        }
      }
    }
    if ((object as THREE.Light).isLight) {
      const light = object as THREE.Light
      lights += 1
      light.castShadow = shadowsEnabled
    }
  })
  const camera = scene.getObjectByName('CAM-Camera') as THREE.PerspectiveCamera
  if (!camera?.isPerspectiveCamera) {
    throw new Error('Stock GLB did not contain the authored perspective camera')
  }
  camera.aspect = 2
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)

  await renderer.compileAsync(scene, camera)
  renderer.render(scene, camera)
  const pixels = new Uint8Array(1000 * 500 * 4)
  const context = renderer.getContext()
  context.readPixels(
    0,
    0,
    1000,
    500,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  )
  let nonBackground = 0
  let chromatic = 0
  let nearBlack = 0
  const background = [220, 232, 239]
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const difference =
      Math.abs(pixels[offset] - background[0]) +
      Math.abs(pixels[offset + 1] - background[1]) +
      Math.abs(pixels[offset + 2] - background[2])
    if (difference > 18) nonBackground += 1
    const spread = Math.max(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
    ) - Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    if (spread > 24) chromatic += 1
    if (
      pixels[offset] < 24 &&
      pixels[offset + 1] < 24 &&
      pixels[offset + 2] < 24
    ) {
      nearBlack += 1
    }
  }
  const blackOwnerCounts = new Map<string, number>()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  for (let y = 12; y < 500; y += 25) {
    for (let x = 12; x < 1000; x += 25) {
      const offset = (y * 1000 + x) * 4
      if (
        pixels[offset] >= 24 ||
        pixels[offset + 1] >= 24 ||
        pixels[offset + 2] >= 24
      ) {
        continue
      }
      pointer.set((x / 1000) * 2 - 1, (y / 500) * 2 - 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(scene.children, true).find(({ object }) => {
        for (let current: THREE.Object3D | null = object; current; current = current.parent) {
          if (!current.visible) return false
        }
        return true
      })
      if (!hit || !(hit.object as THREE.Mesh).isMesh) continue
      const mesh = hit.object as THREE.Mesh
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const materialNames = materials.map((material) => material.name).join(',')
      const owner = `${mesh.name} [${materialNames}]`
      blackOwnerCounts.set(owner, (blackOwnerCounts.get(owner) ?? 0) + 1)
    }
  }
  const sampledBlackPixelOwners = [...blackOwnerCounts.entries()]
    .map(([owner, samples]) => ({ owner, samples }))
    .sort((left, right) => right.samples - left.samples)

  const frustumMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  )
  const frustum = new THREE.Frustum().setFromProjectionMatrix(frustumMatrix)
  const familyEvidence = (needle: string) => {
    const matches: THREE.Object3D[] = []
    scene.traverse((object) => {
      if (object.name.toLowerCase().includes(needle)) matches.push(object)
    })
    const familyMeshes = matches.filter(
      (object): object is THREE.Mesh => (object as THREE.Mesh).isMesh,
    )
    const bounds = new THREE.Box3()
    for (const mesh of familyMeshes) {
      bounds.union(new THREE.Box3().setFromObject(mesh, true))
    }
    const finiteBounds = !bounds.isEmpty()
    return {
      matchingObjects: matches.length,
      meshes: familyMeshes.length,
      skinnedMeshes: familyMeshes.filter(
        (mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh,
      ).length,
      visibleMeshes: familyMeshes.filter((mesh) => {
        for (let current: THREE.Object3D | null = mesh; current; current = current.parent) {
          if (!current.visible) return false
        }
        return true
      }).length,
      inCameraFrustum: finiteBounds ? frustum.intersectsBox(bounds) : false,
      bounds: finiteBounds
        ? {
            min: bounds.min.toArray(),
            max: bounds.max.toArray(),
            center: bounds.getCenter(new THREE.Vector3()).toArray(),
            size: bounds.getSize(new THREE.Vector3()).toArray(),
          }
        : null,
      meshNames: familyMeshes.map((mesh) => mesh.name).sort(),
    }
  }

  window.__dogwalkEvidence = {
    ready: true,
    result: {
      animations: loaded.animations.length,
      glb,
      camera: camera.name,
      cameraPosition: camera.getWorldPosition(new THREE.Vector3()).toArray(),
      cameraWorldMatrixColumnMajor: camera.matrixWorld.toArray(),
      cameraProjectionMatrixColumnMajor: camera.projectionMatrix.toArray(),
      cameraParameters: {
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        filmGauge: camera.filmGauge,
        filmOffset: camera.filmOffset,
      },
      animationPlayback: {
        mixerCreated: false,
        actionsPlayed: 0,
      },
      families: {
        pinda: familyEvidence('pinda'),
        chocomel: familyEvidence('chocomel'),
        snowman: familyEvidence('snowman'),
      },
      lights,
      meshes,
      skinnedMeshes,
      textures: textures.size,
      shadowCasterControl: {
        hidden: hideShadowCasters,
        matchingMeshes: shadowCasterMeshes,
      },
      textureControl: {
        maximizeAnisotropy,
        maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
        observedAnisotropy: [...textures]
          .map((texture) => texture.anisotropy)
          .sort((left, right) => left - right),
      },
      pixels: {
        nonBackground,
        chromatic,
        nearBlack,
        sampledBlackPixelOwners,
        ownerSampleGridStep: 25,
      },
      renderer: {
        shadowsEnabled,
        webgl2: renderer.capabilities.isWebGL2,
        vendor: context.getParameter(context.VENDOR),
        renderer: context.getParameter(context.RENDERER),
      },
    },
  }
}

main().catch((error) => {
  console.error(error)
  window.__dogwalkEvidence = {
    ready: true,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
})
