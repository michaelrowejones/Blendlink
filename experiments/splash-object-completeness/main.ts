import * as THREE from 'three'
import { installThreeCompiledScene } from 'blendlink/three'
import { blender40SplashSelectedSky as descriptor } from '../../artifacts/release-dogfood/blender-4-splash/src/generated/blender40SplashSelectedSky.gen'
import { createBakedScene } from '../../artifacts/release-dogfood/blender-4-splash/src/generated/blender40SplashSelectedSky.baked'

const variant = new URLSearchParams(window.location.search).get('variant')
  === 'opaque-alpha'
  ? 'opaque-alpha'
  : 'baseline'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvas) throw new Error('Prototype canvas is missing.')

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const scene = new THREE.Scene()
const installed = await installThreeCompiledScene({
  renderer,
  scene,
  descriptor,
  createBakedScene,
})

type MaterialEvidence = {
  material: THREE.Material
  allPrimitiveAlphaOpaque: boolean
  meshCount: number
}
const generatedMaterials = new Map<THREE.Material, MaterialEvidence>()
installed.root.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material]
  for (const material of materials) {
    if (!material.name.startsWith('BLENDLINK_WEB.')) continue
    let evidence = generatedMaterials.get(material)
    if (!evidence) {
      evidence = {
        material,
        allPrimitiveAlphaOpaque: true,
        meshCount: 0,
      }
      generatedMaterials.set(material, evidence)
    }
    evidence.meshCount += 1
    if (!('opacity' in material) || material.opacity < 1) {
      evidence.allPrimitiveAlphaOpaque = false
      continue
    }
    const color = object.geometry.getAttribute('color')
    if (!color || color.itemSize < 4) {
      evidence.allPrimitiveAlphaOpaque = false
      continue
    }
    for (let index = 0; index < color.count; index += 1) {
      if (Math.abs(color.getW(index) - 1) > 1e-6) {
        evidence.allPrimitiveAlphaOpaque = false
        break
      }
    }
  }
})

const promotedMaterials: string[] = []
if (variant === 'opaque-alpha') {
  for (const evidence of generatedMaterials.values()) {
    const material = evidence.material
    if (
      !evidence.allPrimitiveAlphaOpaque
      || !('transparent' in material)
      || !material.transparent
    ) {
      continue
    }
    material.transparent = false
    material.depthWrite = true
    material.needsUpdate = true
    promotedMaterials.push(material.name)
  }
}

Object.assign(window, {
  __splashOpacityEvidence: {
    variant,
    generatedMaterialCount: generatedMaterials.size,
    promotedMaterialCount: promotedMaterials.length,
    promotedMaterials,
  },
})

let lastWidth = 0
let lastHeight = 0
let previousTime = performance.now()
function frame(now: number) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
    installed.resize(width, height)
    lastWidth = width
    lastHeight = height
  }
  const deltaSeconds = Math.max(0, (now - previousTime) / 1000)
  previousTime = now
  installed.update(deltaSeconds)
  installed.render(deltaSeconds)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.addEventListener('beforeunload', () => installed.dispose(), { once: true })

