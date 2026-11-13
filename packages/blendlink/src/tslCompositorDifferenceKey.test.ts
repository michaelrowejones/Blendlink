import { describe, expect, it } from 'vitest'
import * as TSL from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import { isMeasuredDifferenceRneProfile, buildCompositorDifferenceKey } from './tslCompositorDifferenceKey.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  const color = { kind: 'constant' as const, type: 'RGBA', value: [.25, .5, .75, -.5] }
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'difference-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Difference Key',
      nodeType: 'CompositorNodeDiffMatte', output: 'Image' }, properties: {
      difference_key_model: 'native-difference-key-v1', difference_key_schema: 'modern', difference_key_settings: [.125, .25],
      evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: { 'Image 1': { name: 'Image 1', socketType: 'RGBA', value: color },
      'Image 2': { name: 'Image 2', socketType: 'RGBA', value: color } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('Difference Key document admission', () => {
  it('admits both source models, outputs and an actual zero-falloff node', () => {
    for (const schema of ['modern', 'legacy-cpu']) for (const name of ['Image', 'Matte']) for (const falloff of [0, .25]) {
      const document = program(), operation = document.ops[0]!
      operation.properties.difference_key_schema = schema; operation.properties.difference_key_settings = [.125, falloff]
      operation.source.output = name; operation.type = document.output!.type = name === 'Image' ? 'RGBA' : 'VALUE'
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('refuses unknown semantics or malformed/narrow controls at the named artist node', () => {
    for (const properties of [
      { difference_key_model: undefined }, { difference_key_schema: 'future' },
      { difference_key_settings: [.125, 1/128] }, { difference_key_settings: [.125, -1] },
      { difference_key_settings: [Infinity, .25] }, { difference_key_settings: [0] },
    ]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Difference Key.*native model/)
    }
  })
})

function exactProgram(): SourceCompositorProgram {
  const result=program()
  Object.assign(result.ops[0]!.properties,{difference_key_model:'native-difference-key-cpu-exact-v2',
    difference_key_native_version:[5,2,0],difference_key_settings:[.125,.25]})
  return result
}
describe('fresh exact CPU Difference Key profile',()=>{
  it('requires measured release/evaluator, positive native Float32 controls and actual output/input shapes',()=>{
    for(const properties of [{difference_key_native_version:[5,2,1]}, {difference_key_native_version:[5,3]},
      {difference_key_native_version:[4,2,0]}, {difference_key_schema:['modern']},
      {difference_key_settings:[0,.125]}, {difference_key_settings:[2**-60,.125]},
      {difference_key_settings:[.1,.1]}, {difference_key_settings:new Array(2)},
      {evaluation_device:'GPU',single_value_device:'GPU'}, {evaluation_device:['CPU']}]) {
      const graph=exactProgram();Object.assign(graph.ops[0]!.properties,properties)
      expect(()=>buildSourceCompositor(graph,()=>null)).toThrow(/Artist Difference Key/)
    }
    const wrongOutput=exactProgram();wrongOutput.ops[0]!.source.output='Matte'
    expect(()=>buildSourceCompositor(wrongOutput,()=>null)).toThrow(/matching Image/)
    const valid=exactProgram();Object.assign(valid.ops[0]!.properties,{evaluation_device:'GPU',single_value_device:'CPU',native_gpu_backend:'OPENGL'})
    const built=buildSourceCompositor(valid,()=>null);built.dispose();built.dispose()
  })
  it('owns fixed controls/output/input nodes before deferred construction while leaving source IR mutable',()=>{
    const op=exactProgram().ops[0]!, image=TSL.vec4(.15,.15,.15,2), names:string[]=[]
    op.source.output='Matte';op.type='VALUE'
    let active=true
    const node=buildCompositorDifferenceKey(op,name=>{if(!active)throw new Error('Deferred caller access');names.push(name);return image},'CPU',message=>{throw new Error(message)})
    expect(names).toEqual(['Image 1','Image 2']);active=false
    op.source.output='Image';op.properties.difference_key_settings=[0,0]
    const previous=TSL.getCurrentStack();TSL.setCurrentStack(TSL.stack())
    try{expect(node.node.shaderNode.jsFunc().isVarNode).toBe(true)}finally{TSL.setCurrentStack(previous)}
  })
})


// Captured from actual Blender 5.2 GPU execution, not inferred from CI flags.
const measuredProfile={platform:'linux',architecture:'x86_64',blenderVersion:[5,2,0],blenderHash:'fbe6228777e7',
  requestedBackend:'OPENGL',renderer:'llvmpipe (LLVM 20.1.2, 256 bits)',vendor:'Mesa',
  version:'4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4',deviceType:'SOFTWARE',backend:'OPENGL'}
const profiled=():SourceCompositorProgram=>{
  const document=program()
  Object.assign(document.ops[0]!.properties,{difference_key_model:'native-difference-key-rne-v1',
    evaluation_device:'GPU',single_value_device:'GPU',native_gpu_backend:'OPENGL',difference_key_gpu_profile:structuredClone(measuredProfile)})
  return document
}
describe('fresh measured llvmpipe Difference Key model',()=>{
  it('admits its field evaluator and modern native constant-fold evaluator',()=>{
    for(const single of ['CPU','GPU'])for(const output of ['Image','Matte']) {
      const document=profiled();document.ops[0]!.properties.single_value_device=single
      document.ops[0]!.source.output=output
      const built=buildSourceCompositor(document,()=>null)
      expect(built.node.isNode).toBe(true);built.dispose()
    }
  })
  it('checks every actual context field independently; flags cannot certify a profile',()=>{
    expect(isMeasuredDifferenceRneProfile(measuredProfile)).toBe(true)
    for(const field of Object.keys(measuredProfile)) {
      const profile={...measuredProfile,[field]:field==='blenderVersion'?[5,3,0]:'unmeasured'}
      expect(isMeasuredDifferenceRneProfile(profile)).toBe(false)
      const document=profiled();document.ops[0]!.properties.difference_key_gpu_profile=profile
      expect(()=>buildSourceCompositor(document,()=>null)).toThrow(/Artist Difference Key.*measured Blender 5.2/)
    }
    const inherited={...measuredProfile,extra:'claim'} as Record<string,unknown>
    delete inherited.renderer
    Object.setPrototypeOf(inherited,{renderer:measuredProfile.renderer})
    expect(isMeasuredDifferenceRneProfile(inherited)).toBe(false)
    for(const profile of [null,[],{backend:'OPENGL',software:true},
      {...measuredProfile,certified:true},{...measuredProfile,blenderVersion:[5,2,false]},
      {...measuredProfile,blenderVersion:[5,2,0,0]},{...measuredProfile,blenderVersion:[5,2,,]},
      Object.assign(Object.create({renderer:measuredProfile.renderer}),{...measuredProfile,renderer:undefined,extra:'claim'})])expect(isMeasuredDifferenceRneProfile(profile)).toBe(false)
  })
  it('requires the new model/backend/device/schema together and preserves old v1 admission',()=>{
    for(const changed of [
      {difference_key_model:'native-difference-key-v1'}, {difference_key_schema:'legacy-cpu'},
      {native_gpu_backend:'METAL'}, {evaluation_device:'CPU'}, {difference_key_gpu_profile:undefined},
    ]) {
      const document=profiled();Object.assign(document.ops[0]!.properties,changed)
      expect(()=>buildSourceCompositor(document,()=>null)).toThrow(/Artist Difference Key/)
    }
    const old=program();Object.assign(old.ops[0]!.properties,{evaluation_device:'GPU',single_value_device:'GPU',native_gpu_backend:'OPENGL'})
    const built=buildSourceCompositor(old,()=>null);expect(built.node.isNode).toBe(true);built.dispose()
  })
})
