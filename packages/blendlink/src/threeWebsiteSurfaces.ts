import * as THREE from 'three'

export type WebsiteSurfaceColorTreatment = 'display' | 'surface'

export type WebsiteSurfaceCanvas = HTMLCanvasElement | OffscreenCanvas

export interface ThreeWebsiteSurfaceBinding {
  readonly name: string
  readonly active: boolean
  /** Notify Blendlink after the application changes canvas pixels. This marks
   * the package-owned CanvasTexture dirty and asks a demand renderer for one
   * frame; it never takes ownership of the host render loop. */
  changed(): void
  /** Idempotently restore the authored fallback and release the Three wrapper.
   * The application-owned canvas is never disposed. */
  dispose(): void
}

export interface InstalledThreeWebsiteSurfaces<TName extends string = string> {
  readonly names: readonly TName[]
  bindCanvas(name: TName, canvas: WebsiteSurfaceCanvas): ThreeWebsiteSurfaceBinding
}

export interface ThreeWebsiteSurfaceRegistration {
  componentId: string
  name: string
  target: THREE.Object3D
  colorTreatment: WebsiteSurfaceColorTreatment
}

export type ThreeWebsiteSurfaceErrorCode =
  | 'BL_SURFACE_DISPOSED'
  | 'BL_SURFACE_NAME'
  | 'BL_SURFACE_DUPLICATE'
  | 'BL_SURFACE_TARGET'
  | 'BL_SURFACE_MATERIAL'
  | 'BL_SURFACE_UV'
  | 'BL_SURFACE_UNKNOWN'
  | 'BL_SURFACE_ALREADY_BOUND'
  | 'BL_SURFACE_CANVAS_SIZE'

export class ThreeWebsiteSurfaceError extends Error {
  readonly code: ThreeWebsiteSurfaceErrorCode
  readonly surface: string
  readonly recoverable: boolean

  constructor(
    code: ThreeWebsiteSurfaceErrorCode,
    surface: string,
    message: string,
    recoverable = false,
  ) {
    super(message)
    this.name = 'ThreeWebsiteSurfaceError'
    this.code = code
    this.surface = surface
    this.recoverable = recoverable
  }
}

interface SurfaceEntry {
  readonly componentId: string
  readonly name: string
  readonly mesh: THREE.Mesh
  readonly authoredMaterial: THREE.Material
  readonly ownedMaterial: WebsiteSurfaceMaterial
  readonly colorTreatment: WebsiteSurfaceColorTreatment
  readonly fallbackMap: THREE.Texture | null
  readonly fallbackColor: THREE.Color | null
  binding: ThreeWebsiteSurfaceBinding | null
  disposed: boolean
  dispose(): void
}

type WebsiteSurfaceMaterial = THREE.Material & {
  map: THREE.Texture | null
  color?: THREE.Color
}

export interface ThreeWebsiteSurfaces extends InstalledThreeWebsiteSurfaces {
  /** @internal Portable-component installation seam. */
  register(registration: ThreeWebsiteSurfaceRegistration): { dispose(): void }
  /** @internal Installed scene/component ownership seam. */
  dispose(): void
}

const WEBSITE_SURFACE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Scene-local Website Surface coordinator. A surface is a named receiver,
 * not an input/event system: Blender owns geometry, UVs, and fallback art;
 * the website supplies pixels; Blendlink owns Three mutation and cleanup. */
export function createThreeWebsiteSurfaces(
  options: { requestFrame?(): unknown } = {},
): ThreeWebsiteSurfaces {
  const entries = new Map<string, SurfaceEntry>()
  let disposed = false

  const assertActive = (name = ''): void => {
    if (disposed) {
      throw new ThreeWebsiteSurfaceError(
        'BL_SURFACE_DISPOSED', name,
        'These Blendlink Website Surfaces have been disposed. Remount the compiled scene before binding again.',
      )
    }
  }

  const api: ThreeWebsiteSurfaces = {
    get names() { return Object.freeze([...entries.keys()]) },
    register(registration) {
      assertActive(registration.name)
      const name = registration.name.trim()
      if (!WEBSITE_SURFACE_NAME.test(name) || name.length > 64) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_NAME', name,
          `Website Surface name ${JSON.stringify(registration.name)} must be a lowercase kebab-case developer name up to 64 characters (for example "monitor-screen").`,
        )
      }
      if (entries.has(name)) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_DUPLICATE', name,
          `Website Surface "${name}" is already registered. Give every application-facing surface a unique name in Blender.`,
        )
      }
      const mesh = singleRenderableMesh(name, registration.target)
      if (mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.SkinnedMesh) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_TARGET', name,
          `Website Surface "${name}" targets ${mesh.name || 'an unnamed mesh'}, but v1 needs an ordinary dedicated Mesh. Separate the display into its own Realtime mesh.`,
        )
      }
      validateWebsiteSurfaceUv0(name, mesh.geometry)
      if (Array.isArray(mesh.material)) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_MATERIAL', name,
          `Website Surface "${name}" must use exactly one material. Separate the screen faces into a dedicated single-material Realtime mesh.`,
        )
      }
      const authoredMaterial = mesh.material
      const ownedMaterial = websiteSurfaceMaterial(
        name, authoredMaterial, registration.colorTreatment,
      )
      const fallbackMap = ownedMaterial.map
      const fallbackColor = ownedMaterial.color?.clone() ?? null
      mesh.material = ownedMaterial

      const entry: SurfaceEntry = {
        componentId: registration.componentId,
        name,
        mesh,
        authoredMaterial,
        ownedMaterial,
        colorTreatment: registration.colorTreatment,
        fallbackMap,
        fallbackColor,
        binding: null,
        disposed: false,
        dispose() {
          if (entry.disposed) return
          entry.disposed = true
          entry.binding?.dispose()
          entry.binding = null
          if (mesh.material === ownedMaterial) mesh.material = authoredMaterial
          ownedMaterial.dispose()
          if (entries.get(name) === entry) entries.delete(name)
        },
      }
      entries.set(name, entry)
      return { dispose: () => entry.dispose() }
    },
    bindCanvas(name, canvas) {
      assertActive(name)
      const entry = entries.get(name)
      if (!entry) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_UNKNOWN', name,
          `Unknown Website Surface "${name}". Available surfaces: ${[...entries.keys()].join(', ') || 'none'}. Add or rename it in Blender, then republish.`,
        )
      }
      if (entry.binding?.active) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_ALREADY_BOUND', name,
          `Website Surface "${name}" is already bound. Dispose the existing binding before assigning another application owner.`,
          true,
        )
      }
      const width = Number(canvas.width)
      const height = Number(canvas.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new ThreeWebsiteSurfaceError(
          'BL_SURFACE_CANVAS_SIZE', name,
          `Website Surface "${name}" needs a canvas with positive finite dimensions; received ${width} x ${height}.`,
          true,
        )
      }

      const texture = new THREE.CanvasTexture(canvas)
      texture.name = `Blendlink Website Surface: ${name}`
      texture.colorSpace = THREE.SRGBColorSpace
      configureLiveCanvasTexture(texture)
      const hadMap = entry.ownedMaterial.map !== null
      if (entry.colorTreatment === 'display') {
        entry.ownedMaterial.color?.set(0xffffff)
      }
      entry.ownedMaterial.map = texture
      if (!hadMap) entry.ownedMaterial.needsUpdate = true
      let active = true
      const binding: ThreeWebsiteSurfaceBinding = {
        name,
        get active() { return active },
        changed() {
          assertActive(name)
          if (!active || entry.binding !== binding) {
            throw new ThreeWebsiteSurfaceError(
              'BL_SURFACE_DISPOSED', name,
              `Website Surface binding "${name}" has been disposed. Bind the current compiled scene before presenting more pixels.`,
            )
          }
          texture.needsUpdate = true
          options.requestFrame?.()
        },
        dispose() {
          if (!active) return
          active = false
          const stillOwned = entry.ownedMaterial.map === texture
          if (stillOwned) {
            entry.ownedMaterial.map = entry.fallbackMap
            if (entry.colorTreatment === 'display' && entry.fallbackColor) {
              entry.ownedMaterial.color?.copy(entry.fallbackColor)
            }
            // A first canvas introduces Three's USE_MAP shader define. Restoring
            // a map-less authored fallback must compile that define back out;
            // changing only the property leaves stale sampling code installed.
            if (!hadMap) entry.ownedMaterial.needsUpdate = true
          }
          if (entry.binding === binding) entry.binding = null
          texture.dispose()
          if (!disposed) options.requestFrame?.()
        },
      }
      entry.binding = binding
      options.requestFrame?.()
      return binding
    },
    dispose() {
      if (disposed) return
      // Marking disposed first prevents binding cleanup from scheduling frames
      // against a scene generation that is already leaving the Canvas.
      disposed = true
      for (const entry of [...entries.values()].reverse()) entry.dispose()
      entries.clear()
    },
  }
  return api
}

function singleRenderableMesh(name: string, target: THREE.Object3D): THREE.Mesh {
  const meshes: THREE.Mesh[] = []
  target.traverse((candidate) => {
    if (candidate instanceof THREE.Mesh) meshes.push(candidate)
  })
  if (meshes.length !== 1) {
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_TARGET', name,
      `Website Surface "${name}" resolves to ${meshes.length} renderable meshes. Version 1 needs one dedicated Realtime screen mesh so material and UV ownership stay unambiguous.`,
    )
  }
  return meshes[0]!
}

const WEBSITE_SURFACE_UV_BOUND_TOLERANCE = 1e-5
const WEBSITE_SURFACE_UV_EDGE_TOLERANCE = 1e-4
const WEBSITE_SURFACE_UV_AREA_TOLERANCE = 1e-10

function validateWebsiteSurfaceUv0(name: string, geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv')
  if (!uv || uv.itemSize < 2 || uv.count === 0) {
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_UV', name,
      `Website Surface "${name}" has no usable UV0. Unwrap the dedicated screen mesh to fill 0-1 UV space, then publish again.`,
    )
  }
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index)
    const v = uv.getY(index)
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      throw new ThreeWebsiteSurfaceError(
        'BL_SURFACE_UV', name,
        `Website Surface "${name}" has non-finite UV0 coordinates. Reset and unwrap the dedicated screen mesh to fill 0-1 UV space, then publish again.`,
      )
    }
    minU = Math.min(minU, u)
    minV = Math.min(minV, v)
    maxU = Math.max(maxU, u)
    maxV = Math.max(maxV, v)
  }
  const outOfBounds = minU < -WEBSITE_SURFACE_UV_BOUND_TOLERANCE
    || minV < -WEBSITE_SURFACE_UV_BOUND_TOLERANCE
    || maxU > 1 + WEBSITE_SURFACE_UV_BOUND_TOLERANCE
    || maxV > 1 + WEBSITE_SURFACE_UV_BOUND_TOLERANCE
  const missesEdges = minU > WEBSITE_SURFACE_UV_EDGE_TOLERANCE
    || minV > WEBSITE_SURFACE_UV_EDGE_TOLERANCE
    || maxU < 1 - WEBSITE_SURFACE_UV_EDGE_TOLERANCE
    || maxV < 1 - WEBSITE_SURFACE_UV_EDGE_TOLERANCE
  if (outOfBounds || missesEdges) {
    const extent = `U ${minU.toFixed(4)}..${maxU.toFixed(4)}, V ${minV.toFixed(4)}..${maxV.toFixed(4)}`
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_UV', name,
      `Website Surface "${name}" UV0 must fill ordinary 0-1 space; found ${extent}. In Blender, select the dedicated screen faces and reset or unwrap them to fill the UV square.`,
    )
  }
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) {
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_UV', name,
      `Website Surface "${name}" has no renderable triangle positions. Restore its dedicated screen geometry in Blender, then publish again.`,
    )
  }
  const index = geometry.getIndex()
  const elementCount = index?.count ?? position.count
  const start = Math.max(0, Math.floor(geometry.drawRange.start))
  const count = Number.isFinite(geometry.drawRange.count)
    ? Math.max(0, geometry.drawRange.count)
    : elementCount - start
  const end = Math.min(elementCount, start + count)
  let uvArea = 0
  for (let offset = start; offset + 2 < end; offset += 3) {
    const a = index?.getX(offset) ?? offset
    const b = index?.getX(offset + 1) ?? offset + 1
    const c = index?.getX(offset + 2) ?? offset + 2
    if (![a, b, c].every((vertex) => (
      Number.isInteger(vertex) && vertex >= 0
      && vertex < position.count && vertex < uv.count
    ))) {
      throw new ThreeWebsiteSurfaceError(
        'BL_SURFACE_UV', name,
        `Website Surface "${name}" has triangle topology without matching UV0 coordinates. Restore or unwrap the dedicated screen mesh in Blender, then publish again.`,
      )
    }
    const au = uv.getX(a)
    const av = uv.getY(a)
    const bu = uv.getX(b)
    const bv = uv.getY(b)
    const cu = uv.getX(c)
    const cv = uv.getY(c)
    uvArea += 0.5 * Math.abs((bu - au) * (cv - av) - (bv - av) * (cu - au))
  }
  if (uvArea <= WEBSITE_SURFACE_UV_AREA_TOLERANCE) {
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_UV', name,
      `Website Surface "${name}" UV0 has no usable texture area; every renderable triangle is collapsed in UV space. In the UV Editor, select all screen faces and unwrap them so the triangles fill the 0-1 square with visible area.`,
    )
  }
}

function websiteSurfaceMaterial(
  name: string,
  source: THREE.Material,
  treatment: WebsiteSurfaceColorTreatment,
): WebsiteSurfaceMaterial {
  if (treatment !== 'display' && treatment !== 'surface') {
    throw new ThreeWebsiteSurfaceError(
      'BL_SURFACE_MATERIAL', name,
      `Website Surface "${name}" has unsupported color treatment ${JSON.stringify(treatment)}. Republish it as display or surface.`,
    )
  }
  if (treatment === 'surface') {
    const clone = source.clone()
    if (!('map' in clone)) {
      clone.dispose()
      throw new ThreeWebsiteSurfaceError(
        'BL_SURFACE_MATERIAL', name,
        `Website Surface "${name}" uses ${source.type}, which has no base-color texture slot. Use a standard Blender surface material or choose Display treatment.`,
      )
    }
    clone.name = `${source.name || 'Material'}.BLENDLINK_WEBSITE_SURFACE.${name}`
    return clone as WebsiteSurfaceMaterial
  }

  const sourceWithMaps = source as THREE.Material & {
    color?: THREE.Color
    map?: THREE.Texture | null
    emissive?: THREE.Color
    emissiveMap?: THREE.Texture | null
    alphaMap?: THREE.Texture | null
    alphaTest?: number
  }
  const fallbackMap = sourceWithMaps.map ?? sourceWithMaps.emissiveMap ?? null
  const color = sourceWithMaps.map
    ? sourceWithMaps.color?.clone() ?? new THREE.Color(0xffffff)
    : sourceWithMaps.emissiveMap
      ? sourceWithMaps.emissive?.clone() ?? new THREE.Color(0xffffff)
      : sourceWithMaps.color?.clone()
        ?? sourceWithMaps.emissive?.clone()
        ?? new THREE.Color(0xffffff)
  const material = new THREE.MeshBasicMaterial({
    name: `${source.name || 'Material'}.BLENDLINK_WEBSITE_SURFACE.${name}`,
    color,
    map: fallbackMap,
    alphaMap: sourceWithMaps.alphaMap ?? null,
    alphaTest: sourceWithMaps.alphaTest ?? 0,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    visible: source.visible,
    toneMapped: false,
  })
  material.blending = source.blending
  material.blendSrc = source.blendSrc
  material.blendDst = source.blendDst
  material.blendEquation = source.blendEquation
  material.colorWrite = source.colorWrite
  material.stencilWrite = source.stencilWrite
  return material
}

function configureLiveCanvasTexture(texture: THREE.Texture): void {
  // Match Three's live VideoTexture policy: dynamic sources have no authored
  // mip chain, so a non-mip minifier is both complete and avoids rebuilding a
  // full pyramid after every application-owned pixel update. Website Surface
  // UV0 follows glTF orientation and is explicitly full-range, leaving wrap
  // and transforms at safe identity.
  texture.flipY = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.anisotropy = 1
  texture.generateMipmaps = false
}
