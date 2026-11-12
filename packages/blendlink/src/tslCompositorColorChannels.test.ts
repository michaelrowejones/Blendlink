import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(kind: 'separate-color' | 'combine-color', mode: string, output = 'Red'): SourceCompositorProgram {
  const input = (type: string, value: unknown) => ({ name: '', socketType: type,
    value: { kind: 'constant' as const, type, value } })
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'channels', kind, type: kind === 'separate-color' ? 'VALUE' : 'RGBA',
      source: { path: ['Compositor'], node: 'Artist channels', nodeType: kind, output },
      properties: { mode, color_conversion_device: 'CPU', legacy_hsv_clamp: false, legacy_hsl_clamp: false,
        ycc_mode: 'ITUBT601' },
      inputs: { Image: input('RGBA', [0.2, 0.4, 1.2, 0.3]),
        Red: input('VALUE', 0.2), Green: input('VALUE', 0.4), Blue: input('VALUE', 1.2), Alpha: input('VALUE', 0.3) } }],
    output: { kind: 'ref', node: 'channels', type: kind === 'separate-color' ? 'VALUE' : 'RGBA' } }
}

describe('native compositor color channels', () => {
  it.each(['RGB', 'HSV', 'HSL', 'YUV', 'YCC'])('builds separate/combine %s, including independent Alpha', mode => {
    for (const kind of ['separate-color', 'combine-color'] as const) {
      for (const output of kind === 'separate-color' ? ['Red', 'Green', 'Blue', 'Alpha'] : ['Image']) {
        const built = buildSourceCompositor(program(kind, mode, output), () => null)
        expect(built.node.isNode).toBe(true)
        built.dispose()
      }
    }
  })

  it.each(['LAB', 'UNKNOWN'])('refuses the unknown %s mapping instead of treating it as RGB', mode => {
    for (const kind of ['separate-color', 'combine-color'] as const)
      expect(() => buildSourceCompositor(program(kind, mode), () => null))
        .toThrow(/Artist channels.*unknown color model/)
  })

  it('accepts legacy RGBA output identifiers without changing alpha semantics', () => {
    for (const name of ['R', 'G', 'B', 'A']) {
      const built = buildSourceCompositor(program('separate-color', 'RGB', name), () => null)
      expect(built.node.isNode).toBe(true)
      built.dispose()
    }
  })

  it('refuses missing HSV device/clamp semantics', () => {
    const input = program('combine-color', 'HSV')
    delete input.ops[0]!.properties.color_conversion_device
    expect(() => buildSourceCompositor(input, () => null)).toThrow(/no verified compositor device/)
    input.ops[0]!.properties.color_conversion_device = 'CPU'
    delete input.ops[0]!.properties.legacy_hsv_clamp
    expect(() => buildSourceCompositor(input, () => null)).toThrow(/no verified clamp model/)
  })

  it('refuses missing HSL device/clamp semantics', () => {
    const input = program('combine-color', 'HSL')
    delete input.ops[0]!.properties.color_conversion_device
    expect(() => buildSourceCompositor(input, () => null)).toThrow(/no verified compositor device/)
    input.ops[0]!.properties.color_conversion_device = 'CPU'
    delete input.ops[0]!.properties.legacy_hsl_clamp
    expect(() => buildSourceCompositor(input, () => null)).toThrow(/no verified clamp model/)
  })

  it('refuses unknown YCC standards', () => {
    const input = program('combine-color', 'YCC')
    input.ops[0]!.properties.ycc_mode = 'UNKNOWN'
    expect(() => buildSourceCompositor(input, () => null)).toThrow(/YCC requires/)
  })
})
