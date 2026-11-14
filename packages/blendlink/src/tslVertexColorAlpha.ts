import { irInspectionChildren } from './tslIrInspection.js'
import type { BufferAttribute, InterleavedBufferAttribute, Mesh } from 'three'
import { TslIrError, type BuildTslOptions } from './tslNodeRecipe.js'
import type { TslRuntimeMeshExtras } from './tslMaterialProgram.js'

export const VERTEX_ALPHA_MODEL = 'eevee53-float-color-alpha-scalar-v1'
export const VERTEX_ALPHA_PROFILE = 'blender53-eevee-metal-float-color-alpha-v1'
export interface VertexAlphaBinding {
  model: string; sourceProfile: string; semantic: string; attribute: string; sourceLayer: string
  domain: string; materials: string[]
}

export function vertexAlphaLayers(value: unknown): Set<string> {
  // Existing admission owns whole-IR limits. This leaf dependency scan adds
  // no refusal based on unrelated numeric LUT/image payload sizes.
  const result = new Set<string>(), seen = new Set<object>(), pending: unknown[] = [value]
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object' || seen.has(item) || ArrayBuffer.isView(item)) continue
    seen.add(item)
    if (!Array.isArray(item)) {
      const record = item as Record<string, unknown>
      if (record.op === 'vertex_color_alpha') {
        if (record.model !== VERTEX_ALPHA_MODEL || record.sourceProfile !== VERTEX_ALPHA_PROFILE || typeof record.layer !== 'string')
          throw new TslIrError('Vertex Color Alpha source model is unqualified')
        result.add(record.layer)
        if (result.size > 4) throw new TslIrError('Vertex Color Alpha layer budget exceeded')
      }
    }
    for (const child of Array.isArray(item) ? item : irInspectionChildren(item))
      if (child && typeof child === 'object') pending.push(child)
  }
  return result
}

/** Run for every actual candidate before any installation/resource mutation. */
export function assertVertexAlphaOpacity(mesh: Mesh, channels: unknown, material: Mesh['material']): void {
  const alpha = channels && typeof channels === 'object' && !Array.isArray(channels)
    ? (channels as Record<string, unknown>).Alpha : undefined
  if (!vertexAlphaLayers(alpha).size || mesh.geometry.getAttribute('color')?.itemSize !== 4) return
  if (!(Array.isArray(material) ? material : [material]).some(item => (item as typeof item & {vertexColors?:boolean}).vertexColors === true)) return
  const color=mesh.geometry.getAttribute('color')!, position=mesh.geometry.getAttribute('position')
  if (!position || color.count!==position.count || color.count>300000)
    throw new TslIrError('Vertex Color Alpha opacity needs bounded actual unit-alpha COLOR_0 storage')
  for(let index=0;index<color.count;index++)if(color.getW(index)!==1)
    throw new TslIrError('Vertex Color Alpha opacity with stock VEC4 COLOR_0 is unqualified; implicit vertex alpha would multiply opacity twice')
}

/** Binds the actual loaded primitive, never an extras-only attribute promise. */
export function vertexAlphaBinding(mesh: Mesh, channels: unknown, extras: TslRuntimeMeshExtras | null,
  source: string): { options: Pick<BuildTslOptions, 'vertexColorAlpha'>; validate: () => void } {
  const layers = vertexAlphaLayers(channels)
  if (!layers.size) return { options: {}, validate() {} }
  if ((mesh as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean }).isSkinnedMesh ||
      (mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh || Object.keys(mesh.geometry.morphAttributes).length)
    throw new TslIrError('Vertex Color Alpha requires a static primary mesh primitive')
  const geometry = mesh.geometry, position = geometry.getAttribute('position')
  const snapshot = (value: BufferAttribute | InterleavedBufferAttribute | null) => value ? {
    value, array: 'isInterleavedBufferAttribute' in value ? value.data.array : value.array,
    version: 'isInterleavedBufferAttribute' in value ? value.data.version : value.version,
    count: value.count, itemSize: value.itemSize, normalized: value.normalized,
    offset: 'isInterleavedBufferAttribute' in value ? value.offset : 0,
    stride: 'isInterleavedBufferAttribute' in value ? value.data.stride : value.itemSize,
  } : null
  assertVertexAlphaOpacity(mesh,channels,mesh.material)
  const opacityChannel=channels&&typeof channels==='object'&&!Array.isArray(channels)?(channels as Record<string,unknown>).Alpha:undefined
  const usesUnitColorException=vertexAlphaLayers(opacityChannel).size>0&&geometry.getAttribute('color')?.itemSize===4
    &&(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(item=>(item as typeof item & {vertexColors?:boolean}).vertexColors===true)
  const colorState=usesUnitColorException?snapshot(geometry.getAttribute('color')):null
  const positionState = snapshot(position ?? null), indexState = snapshot(geometry.index)
  if (geometry.groups.length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity)
    throw new TslIrError('Vertex Color Alpha requires a complete single primitive draw range without groups')
  const drawRange = { ...geometry.drawRange }
  const unchanged = (value: BufferAttribute | InterleavedBufferAttribute | null, state: ReturnType<typeof snapshot>): boolean => {
    const now = snapshot(value)
    return now === null ? state === null : !!state && Object.keys(state).every(key => now[key as keyof typeof now] === state[key as keyof typeof state])
  }
  if (!position || position.itemSize !== 3 || position.count < 3 || position.count > 300000)
    throw new TslIrError('Vertex Color Alpha requires bounded actual primitive positions')
  const accepted = new Map<string, { name: string; state: ReturnType<typeof snapshot> }>()
  for (const layer of layers) {
    const binding = extras?.vertexColorAlpha?.[layer]
    if (!binding || binding.model !== VERTEX_ALPHA_MODEL || binding.sourceProfile !== VERTEX_ALPHA_PROFILE || !/^_SCENETOWEB_VCOL_ALPHA_[0-9A-F]{16}$/.test(binding.semantic)
      || binding.attribute !== binding.semantic.toLowerCase() || !binding.sourceLayer
      || !['POINT', 'CORNER'].includes(binding.domain) || !Array.isArray(binding.materials) || !binding.materials.includes(source))
      throw new TslIrError('Vertex Color Alpha has no attested source-layer/material binding')
    const attribute = geometry.getAttribute(binding.attribute)
    const array = attribute && ('isInterleavedBufferAttribute' in attribute ? attribute.data.array : attribute.array)
    if (!attribute || !(array instanceof Float32Array) || attribute.itemSize !== 1 || attribute.normalized || attribute.count !== position.count)
      throw new TslIrError('Vertex Color Alpha requires actual count-matched non-normalized Float32 SCALAR data')
    for (let index = 0; index < attribute.count; index++) {
      const value = attribute.getX(index)
      if (!Number.isFinite(value) || value < 0 || value > 1 || Object.is(value, -0) || (value !== 0 && value < 2 ** -126))
        throw new TslIrError('Vertex Color Alpha source needs +0 or normal Float32 in [0,1]')
    }
    accepted.set(layer, { name: binding.attribute, state: snapshot(attribute) })
  }
  const validate = (): void => {
    if (colorState&&!unchanged(geometry.getAttribute('color')??null,colorState))
      throw new TslIrError('Vertex Color Alpha unit-alpha COLOR_0 changed after binding')
    if (mesh.geometry !== geometry || !unchanged(geometry.getAttribute('position') ?? null, positionState)
      || !unchanged(geometry.index, indexState) || geometry.drawRange.start !== drawRange.start
      || geometry.drawRange.count !== drawRange.count || geometry.groups.length !== 0)
      throw new TslIrError('Vertex Color Alpha primitive geometry changed after binding')
    for (const { name, state } of accepted.values()) {
      if (!unchanged(geometry.getAttribute(name) ?? null, state))
        throw new TslIrError('Vertex Color Alpha scalar attribute changed after binding')
    }
  }
  return { validate, options: { vertexColorAlpha(layer) {
    validate(); const result = accepted.get(layer)
    if (!result) throw new TslIrError('Vertex Color Alpha layer has no actual primitive binding')
    return result.name
  } } }
}
