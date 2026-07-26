import * as THREE from 'three'
import {
  installThreeComponents,
  type InstalledThreeComponents,
} from '../../packages/blendlink/dist/threeComponents.js'
import type { PortableComponentRecord } from '../../packages/blendlink/dist/components.js'
import type { SceneBindings } from '../../packages/blendlink/dist/runtime.js'

type PixelEvidence = {
  width: number
  height: number
  transparent: number
  partialAlpha: number
  opaque: number
  nonzeroRgb: number
  center: [number, number, number, number]
  left: [number, number, number, number]
}

type CellEvidence = PixelEvidence & {
  components: number
  requiresContinuousFrames: boolean
  materialTypes: string[]
  layerMasksBefore: number[]
  layerMasksInstalled: number[]
}

type OwnedCell = {
  name: string
  renderer: THREE.WebGLRenderer
  installed: InstalledThreeComponents
  targets: THREE.Mesh[]
  originals: Array<THREE.Material | THREE.Material[]>
  generatedTarget?: THREE.Object3D
}

declare global {
  interface Window {
    __shadowCatcherEvidence?: {
      ready: boolean
      cells: Record<string, CellEvidence>
      errors: string[]
      dispose(): Record<string, {
        materialsRestored: boolean
        generatedChildren: number | null
      }>
    }
  }
}

const WIDTH = 400
const HEIGHT = 300
const cells: OwnedCell[] = []
const errors: string[] = []

function canvas(id: string): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(`#${id}`)
  if (!element) throw new Error(`Missing #${id} canvas`)
  return element
}

function renderer(id: string): THREE.WebGLRenderer {
  const result = new THREE.WebGLRenderer({
    canvas: canvas(id),
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  result.setPixelRatio(1)
  result.setSize(WIDTH, HEIGHT, false)
  result.setClearColor(0x000000, 0)
  result.outputColorSpace = THREE.SRGBColorSpace
  result.toneMapping = THREE.NoToneMapping
  result.shadowMap.enabled = true
  result.shadowMap.type = THREE.PCFSoftShadowMap
  return result
}

function component(
  objectId: string,
  mode: 'mask' | 'additive' | 'occluder',
  includeDescendants = true,
): PortableComponentRecord {
  return {
    id: `browser-${objectId}-${mode}`,
    type: 'blendlink.shadow-catcher',
    schemaVersion: 1,
    enabled: true,
    target: { kind: 'object', objectId, objectName: objectId },
    values: {
      mode,
      color: [0.08, 0.14, 0.22],
      opacity: 0.5,
      lightStrength: 6.6,
      includeDescendants,
    },
  }
}

function bindings(
  target: THREE.Object3D,
  objectId: string,
): SceneBindings<THREE.Object3D> {
  return {
    byId: { [objectId]: target },
    byName: { [objectId]: target },
    object(name: string) {
      return name === objectId ? target : undefined
    },
    dispose() {},
  }
}

function pixelEvidence(result: THREE.WebGLRenderer): PixelEvidence {
  const gl = result.getContext()
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  let transparent = 0
  let partialAlpha = 0
  let opaque = 0
  let nonzeroRgb = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3]!
    if (alpha === 0) transparent += 1
    else if (alpha === 255) opaque += 1
    else partialAlpha += 1
    if (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]! > 0) nonzeroRgb += 1
  }
  const sample = (x: number, y: number): [number, number, number, number] => {
    const offset = ((HEIGHT - 1 - y) * WIDTH + x) * 4
    return [
      pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!,
    ]
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    transparent,
    partialAlpha,
    opaque,
    nonzeroRgb,
    center: sample(Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2)),
    left: sample(Math.floor(WIDTH * 0.25), Math.floor(HEIGHT / 2)),
  }
}

function directionalRig(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x29313d, 1.1))
  const light = new THREE.DirectionalLight(0xffffff, 3)
  light.position.set(-3, 6, 4)
  light.castShadow = true
  light.shadow.mapSize.set(512, 512)
  light.shadow.camera.left = -4
  light.shadow.camera.right = 4
  light.shadow.camera.top = 4
  light.shadow.camera.bottom = -4
  light.shadow.camera.near = 0.1
  light.shadow.camera.far = 20
  light.target.position.set(0, 0, 0)
  scene.add(light, light.target)
}

async function installCell(options: {
  name: string
  scene: THREE.Scene
  root: THREE.Object3D
  camera: THREE.Camera
  target: THREE.Object3D
  targetMeshes: THREE.Mesh[]
  mode: 'mask' | 'additive' | 'occluder'
  includeDescendants?: boolean
  generatedTarget?: THREE.Object3D
}): Promise<CellEvidence> {
  const id = `${options.name}-receiver`
  const result = renderer(options.name)
  const layerMasksBefore = options.targetMeshes.map((mesh) => mesh.layers.mask)
  const originals = options.targetMeshes.map((mesh) => mesh.material)
  const installed = await installThreeComponents({
    components: [component(id, options.mode, options.includeDescendants)],
    root: options.root,
    scene: options.scene,
    camera: options.camera,
    renderer: result,
    bindings: bindings(options.target, id),
  })
  options.scene.updateMatrixWorld(true)
  options.camera.updateMatrixWorld(true)
  installed.render()
  const evidence = {
    ...pixelEvidence(result),
    components: installed.count,
    requiresContinuousFrames: installed.requiresContinuousFrames,
    materialTypes: options.targetMeshes.map((mesh) =>
      Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.type).join(',')
        : mesh.material.type),
    layerMasksBefore,
    layerMasksInstalled: options.targetMeshes.map((mesh) => mesh.layers.mask),
  }
  cells.push({
    name: options.name,
    renderer: result,
    installed,
    targets: options.targetMeshes,
    originals,
    ...(options.generatedTarget ? { generatedTarget: options.generatedTarget } : {}),
  })
  const output = document.querySelector<HTMLOutputElement>(`#${options.name}-output`)
  if (output) {
    output.textContent =
      `${evidence.transparent.toLocaleString()} transparent · ` +
      `${evidence.partialAlpha.toLocaleString()} partial · idle=${!evidence.requiresContinuousFrames}`
  }
  return evidence
}

async function maskCell(): Promise<CellEvidence> {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 4),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  )
  receiver.rotation.x = -Math.PI / 2
  receiver.layers.set(6)
  const caster = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.15, 1.15),
    new THREE.MeshStandardMaterial({ color: 0xf08c56, roughness: 0.65 }),
  )
  caster.position.y = 0.7
  caster.castShadow = true
  root.add(receiver, caster)
  directionalRig(scene)
  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 30)
  camera.layers.enableAll()
  camera.position.set(4.2, 3.6, 5.2)
  camera.lookAt(0, 0.45, 0)
  return installCell({
    name: 'mask', scene, root, camera, target: receiver,
    targetMeshes: [receiver], mode: 'mask',
  })
}

async function descendantCell(): Promise<CellEvidence> {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const receiverGroup = new THREE.Group()
  root.add(receiverGroup)
  scene.add(root)
  const left = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 3.2),
    new THREE.MeshStandardMaterial(),
  )
  const right = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 3.2),
    new THREE.MeshStandardMaterial(),
  )
  left.rotation.x = right.rotation.x = -Math.PI / 2
  left.position.x = -1.2
  right.position.x = 1.2
  left.layers.set(7)
  right.layers.set(10)
  receiverGroup.add(left, right)
  for (const x of [-1.2, 1.2]) {
    const caster = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 28, 18),
      new THREE.MeshStandardMaterial({ color: x < 0 ? 0x65a7e8 : 0xe8bd65 }),
    )
    caster.position.set(x, 0.65, 0)
    caster.castShadow = true
    root.add(caster)
  }
  directionalRig(scene)
  const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 30)
  camera.layers.enableAll()
  camera.position.set(4, 4.5, 6)
  camera.lookAt(0, 0.2, 0)
  return installCell({
    name: 'descendants', scene, root, camera, target: receiverGroup,
    targetMeshes: [left, right], mode: 'mask',
  })
}

async function occluderCell(): Promise<CellEvidence> {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.2),
    new THREE.MeshBasicMaterial({ color: 0xe95f62 }),
  )
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  )
  receiver.position.z = 1
  receiver.layers.set(12)
  root.add(back, receiver)
  const camera = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 10)
  camera.layers.enableAll()
  camera.position.z = 5
  return installCell({
    name: 'occluder', scene, root, camera, target: receiver,
    targetMeshes: [receiver], mode: 'occluder',
  })
}

async function additiveCell(): Promise<CellEvidence> {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x93b6ff, roughness: 0.72, metalness: 0 }),
  )
  receiver.layers.set(15)
  root.add(receiver)
  const point = new THREE.PointLight(0xffd5a3, 14, 10, 2)
  point.position.set(-0.4, 0.3, 2.3)
  scene.add(point)
  const camera = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.1, 10)
  camera.layers.enableAll()
  camera.position.z = 5
  return installCell({
    name: 'additive', scene, root, camera, target: receiver,
    targetMeshes: [receiver], mode: 'additive',
  })
}

async function main(): Promise<void> {
  window.__shadowCatcherEvidence = {
    ready: false,
    cells: {},
    errors,
    dispose() {
      const disposed: Record<string, {
        materialsRestored: boolean
        generatedChildren: number | null
      }> = {}
      for (const cell of cells) {
        try {
          cell.installed.dispose()
          disposed[cell.name] = {
            materialsRestored: cell.targets.every(
              (target, index) => target.material === cell.originals[index],
            ),
            generatedChildren: cell.generatedTarget?.children.length ?? null,
          }
        } catch (error) {
          errors.push(`${cell.name}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          cell.renderer.dispose()
        }
      }
      return disposed
    },
  }
  try {
    window.__shadowCatcherEvidence.cells.mask = await maskCell()
    window.__shadowCatcherEvidence.cells.descendants = await descendantCell()
    window.__shadowCatcherEvidence.cells.occluder = await occluderCell()
    window.__shadowCatcherEvidence.cells.additive = await additiveCell()
  } catch (error) {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    window.__shadowCatcherEvidence.ready = true
  }
}

void main()
