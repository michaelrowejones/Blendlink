import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(output = 'Normal', schema = 'modern', device = 'CPU'): SourceCompositorProgram {
  return {version:1,status:'extracted',passes:[],diagnostics:[],ops:[{
    id:'normal',kind:'normal-direction',type:output === 'Normal' ? 'VECTOR' : 'VALUE',
    source:{path:['Compositor'],node:'Artist Normal',nodeType:'CompositorNodeNormal',output},
    value:[0,0,1],properties:{normal_model:'native-normal-direction-v1',normal_schema:schema,evaluation_device:device},
    inputs:{Normal:{name:'Normal',socketType:'VECTOR',value:{kind:'constant',type:'VECTOR',value:[2,-3,4]}}},
  }],output:{kind:'ref',type:output === 'Normal' ? 'VECTOR' : 'VALUE',node:'normal'}}
}
describe('native compositor Normal contract', () => {
  it('builds both schemas and the unnormalized legacy Dot', () => {
    for (const device of ['CPU','GPU']) for (const [output,schema] of [['Normal','modern'],['Normal','legacy'],['Dot','legacy']]) {
      const built=buildSourceCompositor(program(output,schema,device),()=>null)
      expect(built.node.isNode).toBe(true);expect(()=>{built.dispose();built.dispose()}).not.toThrow()
    }
  })
  it('refuses unknown models, outputs and nonunit or malformed directions with the artist node', () => {
    for (const patch of [{normal_model:undefined},{normal_schema:'future'},{evaluation_device:'ASIC'}]) {
      const graph=program();Object.assign(graph.ops[0]!.properties,patch)
      expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Normal.*verified/)
    }
    for (const value of [[1,1,1],[.5,0,0],[NaN,0,1],[0,1]]) {
      const graph=program();graph.ops[0]!.value=value
      expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Normal.*native|Artist Normal.*normalization/)
    }
    expect(()=>buildSourceCompositor(program('Dot'),()=>null)).toThrow(/Artist Normal.*verified output/)
  })
  it('keeps defined zero constants and refuses the undefined legacy GPU normalization', () => {
    for (const [schema,device,refused] of [['modern','CPU',false],['modern','GPU',false],['legacy','CPU',false],['legacy','GPU',true]] as const) {
      const graph=program('Normal',schema,device);graph.ops[0]!.value=[0,0,0]
      if (refused) expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Normal.*nonzero/)
      else buildSourceCompositor(graph,()=>null).dispose()
    }
  })
})
