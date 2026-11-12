import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const input = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })

function program(kind: string): SourceCompositorProgram {
  const inputs: SourceCompositorProgram['ops'][number]['inputs'] = {
    Image: input('RGBA', [-0.2, 0.4, 1.5, 0.25]), Exposure: input('VALUE', -0.75),
    Steps: input('VALUE', 2.5), Hue: input('VALUE', 3.25), Saturation: input('VALUE', 1.4),
    Value: input('VALUE', 0.65), Fac: input('VALUE', -0.25), Mask: input('VALUE', 1.5),
    'Midtones Start': input('VALUE', 0.65), 'Midtones End': input('VALUE', 0.35),
  }
  for (const region of ['Master', 'Shadows', 'Midtones', 'Highlights'])
    for (const parameter of ['Saturation', 'Contrast', 'Gamma', 'Gain', 'Offset'])
      inputs[region + ' ' + parameter] = input('VALUE', parameter === 'Offset' ? -0.15 : 1.2)
  for (const channel of ['Red', 'Green', 'Blue']) inputs['Apply On ' + channel] = input('BOOLEAN', channel !== 'Green')
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'color', kind, type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Grade',
      nodeType: 'CompositorNodeColorCorrection', output: 'Image' }, inputs,
      properties: { color_correction_model: 'modern', color_conversion_device: 'CPU', legacy_hue_wrap: false } }],
    output: { kind: 'ref', node: 'color', type: 'RGBA' } }
}

describe('native compositor pointwise color controls', () => {
  it.each(['exposure', 'posterize', 'hue-saturation-value'])('builds %s with scene-linear HDR and independent alpha', kind => {
    const built = buildSourceCompositor(program(kind), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it.each(['legacy', 'modern'])('builds the complete %s Color Correction model', model => {
    const graph = program('color-correction')
    graph.ops[0]!.properties.color_correction_model = model
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('refuses an unspecified Color Correction gamut model with the artist node name', () => {
    const graph = program('color-correction')
    delete graph.ops[0]!.properties.color_correction_model
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Grade.*verified negative-color model/)
  })
  it.each(['METAL','OPENGL',undefined])('retains the native %s Color Correction division model across collapsed tonal ranges', backend => {
    const graph=program('color-correction')
    Object.assign(graph.ops[0]!.properties,{evaluation_device:'GPU',single_value_device:'GPU',native_gpu_backend:backend})
    graph.ops[0]!.inputs['Midtones Start']=input('VALUE',.5)
    graph.ops[0]!.inputs['Midtones End']=input('VALUE',.5)
    const built=buildSourceCompositor(graph,()=>null)
    expect(built.node.isNode).toBe(true);built.dispose()
  })
  it('refuses an unverified fresh native GPU arithmetic backend by artist node name', () => {
    const graph=program('color-correction')
    Object.assign(graph.ops[0]!.properties,{evaluation_device:'GPU',single_value_device:'GPU',native_gpu_backend:'UNVERIFIED'})
    expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Grade.*native GPU arithmetic/)
  })
})
