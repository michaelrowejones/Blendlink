import { describe, expect, it } from 'vitest'
import { irInspectionChildren } from './tslIrInspection.js'
import { collectObjectAttributeNames, requiresActiveUv } from './tslMaterialProgram.js'
import { collectObjectInfoOutputs } from './tslObjectInfo.js'
import { collectGeometryContextOutputs } from './tslGeometryContext.js'
import { collectVectorTransformRequirements } from './tslVectorTransform.js'
import { collectBumpHeights } from './tslBumpHeight.js'
import { collectNormalMapRequirements } from './tslNormalNodes.js'
import { collectTangentRequirements } from './tslTangentNodes.js'
import { collectTangentNormalMaps } from './tslTangentNormalMap.js'
import type { TslIrExpression } from './tslNodeRecipe.js'

function image(vector: unknown): object {
  return { op: 'tex_image', width: 128, height: 128, vector,
    get pixels(): never { throw new Error('Binding inspection accessed numeric image data') } }
}
const wrap = (value: unknown) => ({ channels: { 'Base Color': { tslIr: {
  op: 'noise_field_nearest', profile: 'finite-nearest-f32-v1', kernel: { op: 'noise_fractal', input: image(value) },
} } } })

describe('binding inspection excludes embedded pixel payloads', () => {
  it('keeps all non-pixel fields, including unknown future dependencies, without reading the data', () => {
    const vector = { op: 'uv_active' }, future = { op: 'object_info', output: 'location' }
    const value = { ...Object.getOwnPropertyDescriptors(image(vector)), futureDependency: { value: future, enumerable: true } }
    const record = Object.defineProperties({}, value)
    const children = irInspectionChildren(record)
    expect(children).toContain(vector); expect(children).toContain(future)
    expect(irInspectionChildren({ child: future })).toEqual([future])
    expect(requiresActiveUv(wrap(vector))).toBe(true)
    expect(requiresActiveUv(wrap({ op: 'uv', uvMap: 'Artist UV' }))).toBe(false)
  })
  it('finds object, geometry and transform requirements inside the original kernel image coordinates', () => {
    const names = new Set<string>(), info = new Set<string>(), geometry = new Set<'normal'>(), transforms: Parameters<typeof collectVectorTransformRequirements>[1] = []
    collectObjectAttributeNames(wrap({ op: 'attribute_object', name: 'artistMask' }), names)
    collectObjectInfoOutputs(wrap({ op: 'object_info', output: 'location' }), info)
    collectGeometryContextOutputs(wrap({ op: 'geometry_context', output: 'normal' }), geometry)
    collectVectorTransformRequirements(wrap({ op: 'vector_transform', from: 'OBJECT', to: 'WORLD', kind: 'POINT' }), transforms)
    expect([...names]).toEqual(['artistMask']); expect([...info]).toEqual(['location']); expect([...geometry]).toEqual(['normal'])
    expect(transforms).toEqual([{ from: 'OBJECT', to: 'WORLD', kind: 'POINT' }])
  })
  it('retains original normal, tangent and Height objects for independent binding validation', () => {
    for (const [op, collect] of [
      ['bump_height_native', collectBumpHeights], ['normal_map_native', collectNormalMapRequirements],
      ['tangent_native', collectTangentRequirements], ['normal_map_tangent_native', collectTangentNormalMaps],
    ] as const) {
      const expression: TslIrExpression = { op }, result: TslIrExpression[] = []
      collect(wrap(expression), result)
      expect(result).toHaveLength(1); expect(result[0]).toBe(expression)
    }
  })
})
