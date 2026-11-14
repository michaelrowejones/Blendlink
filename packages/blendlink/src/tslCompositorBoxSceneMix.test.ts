import {readFileSync} from 'node:fs'
import {describe,it,expect,vi} from 'vitest'
import {vec4} from 'three/tsl'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {boxSceneMixContract,ellipseSceneMixContract,sceneMaskMixContract,validateSceneMaskMixMarkers,ELLIPSE_SCENE_MIX_MODEL,ELLIPSE_SCENE_FRAME_MODEL} from './tslCompositorEllipseSceneMix.js'
import {validateEllipsePresentation} from './tslCompositorMaskDomains.js'
import type {SourceCompositorProgram,SourcePresentation} from './sourceDisplay.js'
const fail=(message:string):never=>{throw Error(message)}
const word=(n:number)=>new Uint32Array(new Float32Array([n]).buffer)[0]!
function program():SourceCompositorProgram{
 const graph=JSON.parse(readFileSync(new URL('../../../experiments/box-scene-feasibility/generic-program.fixture.json',import.meta.url),'utf8'))
 const mix=graph.ops.find((op:any)=>op.kind==='mix'),mask=graph.ops.find((op:any)=>op.kind==='box-mask'),render=graph.ops.find((op:any)=>op.kind==='render-pass')
 mix.properties={...mix.properties,box_scene_mix_model:ELLIPSE_SCENE_MIX_MODEL,box_scene_mix_frame_model:ELLIPSE_SCENE_FRAME_MODEL,box_scene_mix_owner:[render.pass.scene,render.pass.viewLayer],box_scene_mix_direction:'A',box_scene_mix_background_words:mix.inputs.B_Color.value.value.map(word)}
 mask.properties.box_mask_requested_precision='FULL';graph.passes=[render.pass]
 return graph
}
describe('closed exact Box/current-scene Mix ABI',()=>{
 it('admits both native pass routes/source sides and keeps all zero-size Boxes field-valued',()=>{
  for(const alpha of[false,true])for(const side of['A','B'])for(const size of[[.5,.5],[0,.5],[.5,0],[0,0]]){
   const p=program(),render=p.ops.find(op=>op.kind==='render-pass')!,mask=p.ops.find(op=>op.kind==='box-mask')!,mix=p.ops.find(op=>op.kind==='mix')!
   mask.properties.box_mask_size=size
   if(alpha){render.type='VALUE';render.source.output='Alpha';Object.assign(render.pass!,{pass:'Alpha',name:'Alpha',type:'VALUE'});mix.inputs.A_Color!.value={kind:'convert',fromType:'VALUE',type:'RGBA',input:{kind:'ref',type:'VALUE',node:render.id}}}
   if(side==='B'){[mix.inputs.A_Color,mix.inputs.B_Color]=[mix.inputs.B_Color!,mix.inputs.A_Color!];mix.properties.box_scene_mix_direction='B'}
   expect(boxSceneMixContract(p)?.side).toBe(side);expect(sceneMaskMixContract(p)?.family).toBe('box');expect(ellipseSceneMixContract(p)).toBeNull();expect(mask.properties.single_value).not.toBe(true)
   expect(()=>validateSceneMaskMixMarkers(p,fail)).not.toThrow()
  }
 })
 it('refuses malformed or crossed exact tags instead of silently taking generic Mix',()=>{
  const mutations:Array<(p:SourceCompositorProgram)=>void>=[
   p=>p.ops.find(o=>o.kind==='mix')!.properties.box_scene_mix_model='unknown',
   p=>p.ops.find(o=>o.kind==='mix')!.properties.ellipse_scene_mix_model=ELLIPSE_SCENE_MIX_MODEL,
   p=>p.ops.find(o=>o.kind==='mix')!.properties.box_scene_mix_extra='unknown',
   p=>p.ops.find(o=>o.kind==='render-pass')!.properties.box_scene_mix_model=ELLIPSE_SCENE_MIX_MODEL,
   p=>p.ops.find(o=>o.kind==='box-mask')!.source.nodeType='CompositorNodeEllipseMask',
   p=>p.ops.find(o=>o.kind==='box-mask')!.properties.box_mask_requested_precision='HALF',
   p=>p.ops.find(o=>o.kind==='box-mask')!.properties.box_mask_mask=.5,
   p=>p.ops.find(o=>o.kind==='mix')!.properties.box_scene_mix_owner=['wrong','owner'],
   p=>p.ops.find(o=>o.kind==='mix')!.properties.box_scene_mix_direction='B',
   p=>p.ops.find(o=>o.kind==='mix')!.properties.box_scene_mix_background_words=[0,0,0,0],
   p=>p.ops.find(o=>o.kind==='mix')!.properties.clamp_result=true,
   p=>{(p.ops.find(o=>o.kind==='box-mask')! as any).properties=undefined},
   p=>{p.ops.find(o=>o.kind==='box-mask')!.properties.box_scene_mix_model=ELLIPSE_SCENE_MIX_MODEL;(p.ops.find(o=>o.kind==='mix')! as any).properties=undefined},
   p=>p.output={kind:'ref',type:'RGBA',node:p.ops.find(o=>o.kind==='render-pass')!.id},
  ]
  for(const mutate of mutations){const p=program();mutate(p);expect(boxSceneMixContract(p)).toBeNull();expect(()=>validateSceneMaskMixMarkers(p,fail)).toThrow(/malformed/);const resolver=vi.fn();expect(()=>buildSourceCompositor(p,resolver)).toThrow(/malformed|native source class/);expect(resolver).not.toHaveBeenCalled()}
 })
 it('requires the opaque calibrated frame without calling a generic resolver',()=>{const resolve=vi.fn();expect(()=>buildSourceCompositor(program(),resolve)).toThrow(/renderer-owned/);expect(resolve).not.toHaveBeenCalled()})
 it('retains the old unmarked generic Box finite Mix route',()=>{
  const p=program(),mix=p.ops.find(o=>o.kind==='mix')!;for(const key of Object.keys(mix.properties))if(key.startsWith('box_scene_mix_'))delete mix.properties[key]
  const resolve=vi.fn(()=>vec4(.125,.25,.5,1)),built=buildSourceCompositor(p,resolve);expect(sceneMaskMixContract(p)).toBeNull();expect(resolve).toHaveBeenCalledTimes(1);built.dispose()
  const presentation={compositor:p,display:{ops:Array.from({length:12},()=>({type:'Lut1DTransform'}))}}as unknown as SourcePresentation
  expect(()=>validateEllipsePresentation(presentation,1,fail,1)).not.toThrow()
 })
 it('reserves one frame plus seven display samplers and refuses extra registered effects',()=>{
  const p=program(),presentation={compositor:p,display:{ops:Array.from({length:7},()=>({type:'Lut1DTransform'}))}}as unknown as SourcePresentation
  expect(()=>validateEllipsePresentation(presentation,0,fail,0)).not.toThrow();(presentation.display!.ops as any[]).push({type:'Lut3DTransform'});expect(()=>validateEllipsePresentation(presentation,0,fail,0)).toThrow(/eight/);(presentation.display!.ops as any[]).pop();expect(()=>validateEllipsePresentation(presentation,1,fail,0)).toThrow(/post-LDR/);expect(()=>validateEllipsePresentation(presentation,0,fail,1)).toThrow(/pre-HDR/)
 })
})
