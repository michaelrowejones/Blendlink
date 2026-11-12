import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(mode: string, schema='modern', device='CPU'): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'filter', kind: 'filter', type: 'RGBA', source: {
      path: ['Compositor'], node: 'Artist Filter', nodeType: 'CompositorNodeFilter', output: 'Image',
    }, properties: { spatial_model: 'native-filter-v1', filter_type: mode, filter_schema: schema, evaluation_device: device },
    inputs: {
      Image: {name:'Image',socketType:'RGBA',value:{kind:'constant',type:'RGBA',value:[-.25,.5,2,0]}},
      Fac: {name:'Factor',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:1.5}},
    },
  }], output: {kind:'ref',type:'RGBA',node:'filter'} }
}

describe('native image enhancement Filter contract', () => {
  it.each(['Soften','Box Sharpen','Diamond Sharpen','Laplace','Sobel','Prewitt','Kirsch','Shadow'])('builds %s across native schemas/devices', mode=>{
    for(const schema of ['legacy','modern'])for(const device of ['CPU','GPU']) {
      const built=buildSourceCompositor(program(mode,schema,device),()=>null)
      expect(built.node.isNode).toBe(true)
      expect(()=>{built.dispose();built.dispose()}).not.toThrow()
    }
  })
  it('rejects unknown kernels, schemas, devices and missing inputs with the artist node name', ()=>{
    for(const patch of [{filter_type:'Unknown'},{filter_type:'__proto__'},{filter_type:'toString'},
      {filter_schema:'future'},{spatial_model:undefined},{evaluation_device:'ASIC'}]) {
      const graph=program('Soften');Object.assign(graph.ops[0]!.properties,patch)
      expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Filter.*verified native|Artist Filter.*native compositor device/)
    }
    const graph=program('Soften');delete graph.ops[0]!.inputs.Image
    expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Filter.*Missing input Image/)
  })
})
