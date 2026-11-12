import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(selected: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'switch', kind: 'switch', type: 'RGBA', source: {
      path: ['Compositor'], node: 'Artist Look Switch', nodeType: 'CompositorNodeSwitch', output: 'Image',
    }, properties: { switch_model: 'fixed-choice-v1', switch_selected: selected }, inputs: {
      Selected: { name: selected, socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [-.25,.5,2,0] } },
    },
  }], output: { kind: 'ref', type: 'RGBA', node: 'switch' } }
}

describe('native fixed compositor Switch', () => {
  it.each(['Off','On'])('builds only the selected %s dependency', selected => {
    const built=buildSourceCompositor(program(selected), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })
  it('refuses unversioned or unknown choices with the artist node name', () => {
    const graph=program('On'); graph.ops[0]!.properties.switch_model=undefined
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Look Switch.*fixed-choice model/)
    expect(() => buildSourceCompositor(program('Unknown'), () => null)).toThrow(/Artist Look Switch.*fixed-choice model/)
  })
})
