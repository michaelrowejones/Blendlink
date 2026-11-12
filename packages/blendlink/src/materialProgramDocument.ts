import type * as THREE from 'three'
import type { MaterialProgramChannel } from './tslMaterialProgram.js'

/** Exporter-owned glTF object node; geometry children may read this exact
 * direct owner, never an arbitrary application/scene ancestor. */
export function materialProgramObjectOwner(value: unknown): { schemaVersion: 1; objectName: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const marker = value as Record<string, unknown>
  return marker.schemaVersion === 1 && typeof marker.objectName === 'string' && marker.objectName.length > 0
    ? marker as { schemaVersion: 1; objectName: string } : null
}

export function materialProgramObjectOwnerNode(object: THREE.Object3D): THREE.Object3D {
  if (materialProgramObjectOwner(object.userData?.blendlink_tsl_object)) return object
  const parent = object.parent
  if (parent && !(parent as THREE.Mesh).isMesh && materialProgramObjectOwner(parent.userData?.blendlink_tsl_object)) return parent
  return object
}

export interface MaterialProgramImage {
  /** Basename beside the sidecar; resolved against the sidecar URL. */
  file: string
  bytes: number
  hash: string
  mime: string
  width: number
  height: number
  colorSpace: string
}

export interface MaterialProgramsDocument {
  schemaVersion: 1
  model: 'blendlink-material-programs-v1'
  materials: Record<string, { channels: Record<string, MaterialProgramChannel>; skipped?: { channel?: string; reason: string }[] }>
  /** texture_ref source images published beside the sidecar. */
  images?: Record<string, MaterialProgramImage>
}

export async function fetchMaterialPrograms(pointer: {
  url: string
  bytes: number
  hash: string
}): Promise<MaterialProgramsDocument> {
  const response = await fetch(pointer.url)
  if (!response.ok) {
    throw new Error(
      `Blendlink material programs fetch failed (${response.status}) for ${pointer.url}`,
    )
  }
  const payload = new Uint8Array(await response.arrayBuffer())
  if (payload.byteLength !== pointer.bytes) {
    throw new Error(
      `Blendlink material programs at ${pointer.url} are ${payload.byteLength} bytes; ` +
        `the descriptor pins ${pointer.bytes}. Re-run blendlink compile and republish together.`,
    )
  }
  const digest = await crypto.subtle.digest(
    'SHA-256', payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const hash = [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 16)
  if (hash !== pointer.hash) {
    throw new Error(
      `Blendlink material programs at ${pointer.url} hash ${hash}; the descriptor pins ` +
        `${pointer.hash}. Re-run blendlink compile and republish together.`,
    )
  }
  const document = JSON.parse(new TextDecoder().decode(payload)) as MaterialProgramsDocument
  if (document?.schemaVersion !== 1
    || document.model !== 'blendlink-material-programs-v1') {
    throw new Error(
      `Blendlink material programs at ${pointer.url} use unsupported model ` +
        `${JSON.stringify({ schemaVersion: document?.schemaVersion, model: document?.model })}.`,
    )
  }
  return document
}

/** Legacy WebGLRenderer cannot apply a live Base Color graph. Refuse only
 * when an actually matched shipped program would otherwise leave its surface
 * on glTF's white default; portable textured/factored carriers remain usable.
 * Required native normal fields also need the node renderer, even with a
 * portable base color. Ordinary portable-only scenes retain their no-fetch path.
 */
export async function assertLegacyMaterialCarriers(
  options: {
    root: THREE.Object3D
    descriptor: { materialPrograms?: { url: string; bytes: number; hash: string } }
    loadPrograms?: () => Promise<MaterialProgramsDocument>
  },
): Promise<void> {
  const pointer = options.descriptor.materialPrograms
  if (!pointer) return
  const missing = new Map<string, Set<string>>()
  const primaryNormals = new Map<string,Set<string>>()
  options.root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of list) {
      const source = material?.userData?.blendlink_source_material
      if (typeof source !== 'string') continue
      const context=mesh.userData?.blendlink_tsl_runtime?.geometryContext
      if(Array.isArray(context)&&context.includes('normal')){
        const names=primaryNormals.get(source)??new Set<string>()
        names.add(material.name||source);primaryNormals.set(source,names)
      }
      const surface = material as THREE.MeshStandardMaterial
      if (surface.map || (surface.color &&
          [surface.color.r, surface.color.g, surface.color.b].some(value => value !== 1)) ||
          (surface.vertexColors && mesh.geometry.hasAttribute('color'))) continue
      const names = missing.get(source) ?? new Set<string>()
      names.add(material.name || source)
      missing.set(source, names)
    }
  })
  if (!missing.size&&!primaryNormals.size) return
  const programs = options.loadPrograms ? await options.loadPrograms() : await fetchMaterialPrograms(pointer)
  const nativeNormal=(value:unknown):boolean=>{
    if(Array.isArray(value))return value.some(nativeNormal)
    if(!value||typeof value!=='object')return false
    return ['normal_map_native','normal_view_native','normal_map_tangent_native','bump_height_native'].includes(String((value as Record<string,unknown>).op))||Object.values(value).some(nativeNormal)
  }
  const normalNames=[...primaryNormals].filter(([source])=>Object.hasOwn(programs.materials,source)&&nativeNormal(programs.materials[source]?.channels))
    .flatMap(([,names])=>[...names]).sort()
  if(normalNames.length)throw new Error(`Legacy WebGLRenderer cannot render the shipped live native normal program for ${normalNames.map(name=>JSON.stringify(name)).join(', ')}. `+
    'Its portable base color does not carry the native normal function. Use WebGPURenderer (including its WebGL2 fallback).')
  const unsupported = [...missing].filter(([source]) =>
    Object.hasOwn(programs.materials, source) && programs.materials[source]?.channels?.['Base Color']?.tslIr)
  if (!unsupported.length) return
  const names = unsupported.flatMap(([, names]) => [...names]).sort()
  throw new Error(
    `Legacy WebGLRenderer cannot render the shipped live Base Color program for ${names.map(name => JSON.stringify(name)).join(', ')} ` +
    'because its glTF material has no portable base-color carrier. Use WebGPURenderer ' +
    '(including its WebGL2 fallback), or export a baked/portable base color.',
  )
}
