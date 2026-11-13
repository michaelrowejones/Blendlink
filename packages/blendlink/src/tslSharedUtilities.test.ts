import { describe, expect, it } from 'vitest'
import { bool, int, float } from 'three/tsl'
import { buildTslScalarNode } from './tslNodeRecipe.js'
import { buildSharedInteger, buildSharedBoolean, buildSharedCompare, sharedTypedConstant, sharedTypedConversion } from './tslSharedUtilities.js'

describe('shared typed function nodes', () => {
  it('retains exact int32 constants instead of routing them through a float constant', () => {
    const node = sharedTypedConstant('INT', 16777217)
    expect(node.node.value).toBe(16777217)
    expect(node.node.nodeType).toBe('int')
    expect(sharedTypedConstant('BOOLEAN', false).node.value).toBe(false)
    for (const value of [2147483648, -2147483649, 0.5, Infinity, NaN, '1', true])
      expect(() => sharedTypedConstant('INT', value)).toThrow('Invalid shared utility')
    expect(() => sharedTypedConstant('BOOLEAN', 1)).toThrow('Invalid shared utility')
  })

  it('requires explicit supported types, operation arity and native evaluation models', () => {
    expect(() => sharedTypedConversion(float(1), 'VALUE', 'INT_VECTOR')).toThrow('Unsupported shared utility conversion')
    expect(() => sharedTypedConversion(float(1), 'RGBA', 'INT')).toThrow('Unsupported shared utility conversion')
    expect(() => buildSharedInteger('ADD', [int(1)])).toThrow('input count')
    expect(() => buildSharedInteger('ADD', [int(1), int(1)], 'unknown')).toThrow('evaluation model')
    expect(() => buildSharedInteger('unknown', [int(1), int(1)])).toThrow('Unknown Integer Math')
    expect(() => buildSharedBoolean('unknown', bool(true), bool(false))).toThrow('Unknown Boolean Math')
    expect(() => buildSharedCompare({ data_type: 'OBJECT', operation: 'EQUAL' }, {}, [1, 0, 0])).toThrow('Unsupported Compare')
  })

  it('accepts native typed IR at the production scalar builder boundary', () => {
    const document = { schemaVersion: 1 as const, model: 'blendlink-tsl-ir-v1' as const, output: {
      op: 'typed_convert', fromType: 'INT', toType: 'VALUE', input: {
        op: 'integer_math', operation: 'ADD', model: 'CPU',
        a: { op: 'typed_const', type: 'INT', value: 16777217 },
        b: { op: 'typed_const', type: 'INT', value: 1 },
      },
    } }
    expect(buildTslScalarNode(document)).toBeTruthy()
    document.output.input.model = 'future-unknown-model'
    expect(() => buildTslScalarNode(document)).toThrow('evaluation model')
  })
})
