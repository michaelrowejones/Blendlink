import { expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(index: unknown = 0): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'component', kind: 'separate-vector', type: 'VALUE', source: {
      path: ['Compositor'], node: 'Artist Component', nodeType: 'FunctionNodeGetVectorComponent', output: 'Value' },
    properties: { vector_component_model: 'native-fixed-vector-component-v1', vector_component_source_version: [5, 3, 0] },
    inputs: { Vector: { name: 'Vector', socketType: 'VECTOR', value: { kind: 'constant', type: 'VECTOR', value: [-2, .25, 8] } },
      Index: { name: 'Index', socketType: 'INT', value: { kind: 'constant', type: 'INT', value: index } } },
  }], output: { kind: 'ref', type: 'VALUE', node: 'component' } }
}

it('accepts all three fixed typed selectors and actual integer literal references without resources', () => {
  for (const index of [0, 1, 2]) for (const linked of [false, true]) {
    const graph = program(index)
    if (linked) {
      graph.ops.unshift({ id: 'index', kind: 'utility-constant', type: 'INT', value: index,
        source: { path: ['Compositor'], node: 'Fixed Index', nodeType: 'FunctionNodeInputInt', output: 'Integer' }, properties: {}, inputs: {} })
      graph.ops[1]!.inputs.Index!.value = { kind: 'ref', type: 'INT', node: 'index' }
    }
    const result = buildSourceCompositor(graph, () => null)
    expect(result.node.isNode).toBe(true); result.dispose(); result.dispose()
  }
})

it('refuses unqualified selector values, source models, versions and socket shapes by artist name', () => {
  for (const index of [-2147483648, -1, 3, 2147483647, .5, NaN, Infinity, true, '1', null]) {
    expect(() => buildSourceCompositor(program(index), () => null)).toThrow(/Artist Component.*fixed typed integer/)
  }
  for (const mutate of [
    (g: SourceCompositorProgram) => { g.ops[0]!.properties.vector_component_model = undefined },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Index!.value.value = undefined },
    (g: SourceCompositorProgram) => { g.ops[0]!.properties.vector_component_source_version = [5, 3, 1] },
    (g: SourceCompositorProgram) => { g.ops[0]!.properties.vector_component_source_version = new Array(3) },
    (g: SourceCompositorProgram) => { g.ops[0]!.source.output = 'X' },
    (g: SourceCompositorProgram) => { g.ops[0]!.type = 'RGBA' },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Vector!.value.type = 'RGBA' },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Vector!.socketType = 'RGBA' },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Extra = g.ops[0]!.inputs.Vector! },
    (g: SourceCompositorProgram) => { g.ops[0]!.source.nodeType = 'ShaderNodeSeparateXYZ'; g.ops[0]!.source.output = 'X' },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Index!.value.type = 'VALUE' },
    (g: SourceCompositorProgram) => { g.ops[0]!.inputs.Index!.value = { kind: 'convert', type: 'INT', fromType: 'VALUE', input: { kind: 'constant', type: 'VALUE', value: 1 } } },
  ]) {
    const graph = program(); mutate(graph)
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Component/)
  }
})

it('retains ordinary Separate XYZ documents and rejects computed references posing as typed literals', () => {
  const legacy = program(); delete legacy.ops[0]!.properties.vector_component_model
  legacy.ops[0]!.source.nodeType = 'ShaderNodeSeparateXYZ'; legacy.ops[0]!.source.output = 'Y'
  delete legacy.ops[0]!.inputs.Index
  const built = buildSourceCompositor(legacy, () => null); expect(built.node.isNode).toBe(true); built.dispose()
  const graph = program()
  graph.ops.unshift({ id: 'index', kind: 'integer-math', type: 'INT', value: 1,
    source: { path: [], node: 'Computed Index', nodeType: 'FunctionNodeIntegerMath', output: 'Integer' }, properties: { operation: 'ADD' }, inputs: {
      Integer: { name: 'Integer', socketType: 'INT', value: { kind: 'constant', type: 'INT', value: 0 } },
      Integer_001: { name: 'Integer', socketType: 'INT', value: { kind: 'constant', type: 'INT', value: 1 } },
    } })
  graph.ops[1]!.inputs.Index!.value = { kind: 'ref', type: 'INT', node: 'index' }
  expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Component.*fixed typed integer/)
})
