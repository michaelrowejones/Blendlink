import * as THREE from 'three'
import { installThreeCompiledScene } from 'blendlink/three'
import { blender40SplashSelectedSky as descriptor } from '../../artifacts/release-dogfood/blender-4-splash/src/generated/blender40SplashSelectedSky.gen'
import { createBakedScene } from '../../artifacts/release-dogfood/blender-4-splash/src/generated/blender40SplashSelectedSky.baked'

type PrototypeVariant = 'baseline' | 'authoring' | 'lit' | 'lit-shadow'

const requested = new URLSearchParams(window.location.search).get('variant')
const variant: PrototypeVariant = (
  requested === 'authoring' || requested === 'lit' || requested === 'lit-shadow'
) ? requested : 'baseline'
const useAuthoringPreview = variant === 'authoring' || variant === 'lit-shadow'
const useLitSelectedFields = variant === 'lit' || variant === 'lit-shadow'

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
  useAuthoringPreview,
})

const createdMaterials: THREE.MeshStandardMaterial[] = []
let convertedMaterials = 0
if (useLitSelectedFields) {
  const replacements = new Map<THREE.MeshBasicMaterial, THREE.MeshStandardMaterial>()
  installed.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const sourceMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    const mapped = sourceMaterials.map((source) => {
      if (!(source instanceof THREE.MeshBasicMaterial)) return source
      if (source.name.includes('DP-SkyPaint.MAT')) return source
      let replacement = replacements.get(source)
      if (!replacement) {
        replacement = new THREE.MeshStandardMaterial({
          name: source.name,
          color: source.color,
          map: source.map,
          alphaMap: source.alphaMap,
          opacity: source.opacity,
          transparent: source.transparent,
          alphaTest: source.alphaTest,
          side: source.side,
          vertexColors: source.vertexColors,
          depthTest: source.depthTest,
          depthWrite: source.depthWrite,
          wireframe: source.wireframe,
          roughness: 1,
          metalness: 0,
        })
        replacement.userData = { ...source.userData }
        replacements.set(source, replacement)
        createdMaterials.push(replacement)
        convertedMaterials += 1
      }
      return replacement
    })
    object.material = Array.isArray(object.material) ? mapped : mapped[0]!
  })
}

const bounds = new THREE.Box3().setFromObject(installed.root)
const size = bounds.getSize(new THREE.Vector3())
const lights: Array<Record<string, unknown>> = []
installed.root.traverse((object) => {
  if (!(object instanceof THREE.Light)) return
  const shadowCamera = (
    object instanceof THREE.DirectionalLight
    || object instanceof THREE.SpotLight
    || object instanceof THREE.PointLight
  ) ? object.shadow.camera : null
  lights.push({
    name: object.name,
    type: object.type,
    intensity: object.intensity,
    castShadow: object.castShadow,
    shadowCamera: shadowCamera ? {
      near: shadowCamera.near,
      far: shadowCamera.far,
      ...(
        shadowCamera instanceof THREE.OrthographicCamera
          ? {
              left: shadowCamera.left,
              right: shadowCamera.right,
              top: shadowCamera.top,
              bottom: shadowCamera.bottom,
            }
          : {}
      ),
    } : null,
  })
})

Object.assign(window, {
  __splashPrototypeEvidence: {
    variant,
    convertedMaterials,
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: size.toArray(),
    },
    shadowMap: {
      enabled: renderer.shadowMap.enabled,
      type: renderer.shadowMap.type,
      autoUpdate: renderer.shadowMap.autoUpdate,
    },
    lights,
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

window.addEventListener('beforeunload', () => {
  installed.dispose()
  for (const material of createdMaterials) material.dispose()
}, { once: true })

