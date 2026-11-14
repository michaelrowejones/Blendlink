import { expect, it } from 'vitest'
import { vec3, vec4, float, int, bool } from 'three/tsl'
import { NodeBuilder } from 'three/webgpu'
import { buildNativeVector2, SHADER_VECTOR2_MODEL } from './tslShaderVector2.js'
import { buildTslColorNode } from './tslNodeRecipe.js'
const input = { op: 'const_vec3', value: [0.1, -0.8, 7] }
const expression = { op: 'native_vector2', model: SHADER_VECTOR2_MODEL, input }
const fail = (reason: string): never => { throw new Error(reason) }
it('projects one evaluation of XY and writes exact zero in Z', () => {
  let calls = 0
  const node = buildNativeVector2(expression, child => {
    calls++; expect(child).toBe(input); return vec3(...input.value as [number, number, number])
  }, fail)
  expect(calls).toBe(1)
  expect(node.isNode).toBe(true)
  const builder = new NodeBuilder(null, null, null)
  expect(node.getNodeType(builder)).toBe('vec3')
  const elements = node.node.shaderNode.jsFunc(builder).node.nodes
  expect(elements[0].components).toBe('x')
  expect(elements[1].components).toBe('y')
  expect(elements[2].value).toBe(0)
  expect(buildTslColorNode({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: expression })).toBeTruthy()
})
it('refuses stale or malformed boundary contracts', () => {
  for (const patch of [{op: 'other'}, {model: 'other'}, {input: null}, {input: {}}, {input: []}, {width: 4}])
    expect(() => buildNativeVector2({...expression, ...patch}, () => vec3(1), fail)).toThrow(/Native shader float2/)
})

it('rejects actual scalar, boolean and integer node types before component swizzling', () => {
  for (const source of [float(.25), int(1), bool(true)]) {
    const node = buildNativeVector2(expression, () => source, fail)
    expect(() => node.getNodeType(new NodeBuilder(null, null, null))).toThrow(/scalar\/INT\/BOOLEAN casts remain unqualified/)
  }
  const color = buildNativeVector2(expression, () => vec4(.1, .8, 7, .125), fail)
  expect(color.getNodeType(new NodeBuilder(null, null, null))).toBe('vec3')
})
it('rejects malformed scalar payloads through the production builder', () => {
  for (const child of [
    {op: 'const_float', value: .25},
    {op: 'typed_const', type: 'BOOLEAN', value: true},
    {op: 'typed_const', type: 'INT', value: 1},
    {op: 'separate', channel: 'x', input},
    {op: 'rgb_to_bw', input},
  ]) {
    const node = buildTslColorNode({schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: {...expression, input: child}})
    expect(() => node.getNodeType(new NodeBuilder(null, null, null))).toThrow(/Native shader float2/)
  }
})
