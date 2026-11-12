import { Vector3, type Object3D, type Material } from 'three'
import { uniform } from 'three/tsl'
import { materialProgramObjectOwner, materialProgramObjectOwnerNode } from './materialProgramDocument.js'
import { TslIrError, type TslExpression } from './tslNodeRecipe.js'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function collectObjectInfoOutputs(value: unknown, outputs: Set<string>): void {
  if (Array.isArray(value)) { value.forEach(item => collectObjectInfoOutputs(item, outputs)); return }
  if (!record(value)) return
  if (value.op === 'object_info') outputs.add(String(value.output))
  Object.values(value).forEach(item => collectObjectInfoOutputs(item, outputs))
}

function vector(value: unknown, size: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== size || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new TslIrError(`Object Info ${label} needs an explicitly exported finite ${size}-component value`)
  }
  return value
}

function index(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 32767) {
    throw new TslIrError(`Object Info ${label} needs an exported Blender pass index (0..32767)`)
  }
  return value
}

function ownerInfo(marker: unknown): Record<string, unknown> {
  const data = record(marker) ? marker.objectInfo : null
  if (!materialProgramObjectOwner(marker) || !record(data) || data.schemaVersion !== 1) {
    throw new TslIrError('Object Info needs verified versioned object-owner metadata')
  }
  return data
}

export function validateObjectInfoBinding(
  outputs: ReadonlySet<string>, marker: unknown, material: unknown, instanced = false,
): void {
  if (!outputs.size) return
  if (instanced) throw new TslIrError('Object Info on GPU instances needs verified per-instance metadata; one object uniform cannot represent individual instances')
  const data = ownerInfo(marker)
  for (const output of outputs) {
    switch (output) {
      case 'location':
        vector(data.nativeLocation, 3, 'Location')
        if (!['gltf-y-up', 'blender-z-up'].includes(String(data.coordinateBasis))) {
          throw new TslIrError('Object Info Location needs an explicit exported coordinate basis')
        }
        break
      case 'color': case 'alpha': vector(data.color, 4, 'Color/Alpha'); break
      case 'object_index': index(data.objectIndex, 'Object Index'); break
      case 'material_index':
        if (!record(material) || material.schemaVersion !== 1) throw new TslIrError('Object Info Material Index needs exported material metadata')
        index(material.materialIndex, 'Material Index')
        break
      default: throw new TslIrError(`Object Info output ${JSON.stringify(output)} is unsupported`)
    }
  }
}

type Frame = { object: Object3D; material?: Material }
function objectUniform(initial: Vector3 | number, read: (frame: Frame) => Vector3 | number): TslExpression {
  const node = typeof initial === 'number' ? uniform(initial) : uniform(initial)
  ;(node as unknown as { onObjectUpdate(callback: typeof read): unknown }).onObjectUpdate(read)
  return node as unknown as TslExpression
}

/** Initial values come from pinned glTF metadata. Each draw resolves the
 * actual exported owner, including animated parent transforms. No names,
 * arbitrary ancestors, fixture constants or zero-value fallbacks are used.
 */
export function createObjectInfoResolver(marker: unknown, material: unknown): (output: string) => TslExpression {
  return output => {
    validateObjectInfoBinding(new Set([output]), marker, material)
    const initial = ownerInfo(marker)
    const current = (frame: Frame): Record<string, unknown> => {
      const owner = materialProgramObjectOwnerNode(frame.object)
      return ownerInfo(owner.userData?.blendlink_tsl_object)
    }
    if (output === 'location') {
      return objectUniform(new Vector3(...vector(initial.nativeLocation, 3, 'Location') as [number, number, number]), frame => {
        const data = current(frame)
        const owner = materialProgramObjectOwnerNode(frame.object)
        owner.updateWorldMatrix(true, false)
        const elements = owner.matrixWorld.elements
        const value = [elements[12], elements[13], elements[14]]
        vector(value, 3, 'world Location')
        if (data.coordinateBasis === 'gltf-y-up') return new Vector3(value[0], -value[2], value[1])
        if (data.coordinateBasis === 'blender-z-up') return new Vector3(...value as [number, number, number])
        throw new TslIrError('Object Info Location has no verified coordinate basis')
      })
    }
    if (output === 'color') {
      const value = vector(initial.color, 4, 'Color')
      return objectUniform(new Vector3(value[0], value[1], value[2]), frame => {
        const color = vector(current(frame).color, 4, 'Color')
        return new Vector3(color[0], color[1], color[2])
      })
    }
    if (output === 'alpha') return objectUniform(vector(initial.color, 4, 'Alpha')[3], frame => vector(current(frame).color, 4, 'Alpha')[3])
    if (output === 'object_index') return objectUniform(index(initial.objectIndex, 'Object Index'), frame => index(current(frame).objectIndex, 'Object Index'))
    return objectUniform(index((material as Record<string, unknown>).materialIndex, 'Material Index'), frame => {
      const data = frame.material?.userData?.blendlink_tsl_material ?? material
      if (!record(data) || data.schemaVersion !== 1) throw new TslIrError('Object Info Material Index has no verified material binding')
      return index(data.materialIndex, 'Material Index')
    })
  }
}
