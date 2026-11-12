import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'flip', kind: 'flip', type: 'RGBA', source: {
      path: ['Compositor'], node: 'Artist Flip', nodeType: 'CompositorNodeFlip', output: 'Image',
    }, properties: { spatial_model: 'native-flip-v1', flip_x: true, flip_y: false },
    inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [-.25,.5,2,0] } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'flip' } }
}

describe('native Flip mode contract', () => {
  it.each([[false,false],[true,false],[false,true],[true,true]])('builds fixed axes %s/%s', (x,y) => {
    const graph = program(); graph.ops[0]!.properties.flip_x=x; graph.ops[0]!.properties.flip_y=y
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    expect(() => { built.dispose(); built.dispose() }).not.toThrow()
  })
  it('refuses missing/unknown pixel models and malformed flags with the artist node name', () => {
    for (const patch of [{spatial_model:undefined},{spatial_model:'future'},{flip_x:1},{flip_y:'false'}]) {
      const graph=program(); Object.assign(graph.ops[0]!.properties,patch)
      expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Flip.*fixed-axis pixel model/)
    }
  })
})
