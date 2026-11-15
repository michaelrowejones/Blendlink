/* SPDX-License-Identifier: MIT */
import {readFileSync}from'node:fs'
import {describe,expect,it,vi}from'vitest'
import {DataTexture,WebGLRenderTarget}from'three'
import {prepareStaticCompositorImages}from'./tslCompositorStaticImage.js'
import {buildSourceCompositor}from'./tslSourceCompositor.js'
import {finiteMetadataConsumerGraph}from'./tslCompositorImageInfo.js'
import type{SourceCompositorProgram}from'./sourceDisplay.js'
const rows=JSON.parse(readFileSync(new URL('../../../experiments/compositor-finite-image-info/source-programs.json',import.meta.url),'utf8'))as{case:string;program:SourceCompositorProgram}[]
const source=(label='blank-Dimensions')=>structuredClone(rows.find(row=>row.case===label)!.program)
const info=(p:SourceCompositorProgram)=>p.ops.find(op=>op.kind==='image-info')!
const build=(p:SourceCompositorProgram)=>buildSourceCompositor(p,()=>{throw Error('Finite metadata never resolves a scene pass')})
describe('finite identity Image Info',()=>{
 it('accepts all actual native source graphs, preserving typed metadata arithmetic and payloads',()=>{
  for(const row of rows){
   const p=structuredClone(row.program),before=JSON.stringify(p),built=build(p)
   expect(built.node.isNode).toBe(true);expect(JSON.stringify(p)).toBe(before);built.dispose();built.dispose()
  }
 })
 it('keeps Blank finite data size independent of render dimensions without a realization texture',()=>{
  const disposed=vi.spyOn(DataTexture.prototype,'dispose'),targets=vi.spyOn(WebGLRenderTarget.prototype,'dispose')
  try{
   const p=source(),built=build(p);expect(info(p).properties.image_info_finite_size).toEqual([5,3]);built.dispose()
   expect(disposed).toHaveBeenCalledTimes(0);expect(targets).toHaveBeenCalledTimes(0)
  }finally{disposed.mockRestore();targets.mockRestore()}
 })
 it('loads and owns each existing static payload once; metadata is not a new image decoder',()=>{
  const p=source('image-Dimensions'),disposed=vi.spyOn(DataTexture.prototype,'dispose')
  try{const built=build(p);built.dispose();built.dispose();expect(Object.keys(p.images!)).toHaveLength(1);expect(disposed).toHaveBeenCalledTimes(1)}finally{disposed.mockRestore()}
 })
 it('keeps cooperative prepared image ownership and one payload decode for metadata',async()=>{
  const p=source('image-summary'),before=JSON.stringify(p),handle=await prepareStaticCompositorImages(p)
  expect(handle.statistics.images).toBe(1)
  const old=vi.spyOn(globalThis,'atob').mockImplementation(()=>{throw Error('Prepared metadata may not decode twice')})
  try{const built=buildSourceCompositor(p,()=>null,{preparedImages:handle});handle.dispose();handle.dispose();built.dispose();built.dispose();expect(JSON.stringify(p)).toBe(before)}finally{old.mockRestore();handle.dispose()}
 })
 it('refuses forged size/domain/profile/record schemas before metadata can alias a transformed or single input',()=>{
  const mutations:((p:SourceCompositorProgram)=>void)[]=[
   p=>{info(p).properties.image_info_finite_size=[13,9]},p=>{info(p).properties.image_info_finite_size=[-0,3]},
   p=>{info(p).properties.image_info_source_profile='unknown'},p=>{info(p).properties.image_info_reference_model='transformed'},
   p=>{info(p).properties.image_info_transform=[2,0,0,2]},p=>{info(p).properties.evaluation_device='GPU'},
   p=>{info(p).inputs.Image!.value={kind:'constant',type:'RGBA',value:[0,0,0,1]}},
   p=>{info(p).inputs.Image!.name='Other'},p=>{(info(p).inputs.Image as any).extra=true},
   p=>{p.ops[0]!.kind='rgb'},p=>{p.ops[0]!.source.nodeType='CompositorNodeRGB'},
  ]
  for(const mutate of mutations){const p=source();mutate(p);expect(()=>build(p)).toThrow(/Image Info|Blank Image/)}
  const image=source('image-Dimensions');image.images![Object.keys(image.images!)[0]!]!.width=13;expect(()=>build(image)).toThrow(/Static Image|Image Info/)
 })
 it('requires every operation to contribute and never lets the finite Color branch escape through a cast',()=>{
  const p=source(),id=p.ops[0]!.id;expect(finiteMetadataConsumerGraph(p,id)).toBe(true)
  p.ops.push({...p.ops[0]!,id:'unused'});expect(finiteMetadataConsumerGraph(p,id)).toBe(false);expect(()=>build(p)).toThrow(/Blank Image/)
  const converted=source();converted.output={kind:'convert',fromType:'RGBA',type:'RGBA',input:{kind:'ref',node:id,type:'RGBA'}}
  expect(finiteMetadataConsumerGraph(converted,id)).toBe(false);expect(()=>build(converted)).toThrow(/Blank Image/)
 })
 it('retains the actual Blank full-frame/renderer-epoch guard even for constant metadata',()=>{
  const built=build(source()),renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>({width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false})}
  expect(built.node.updateType).not.toBe('none');expect(()=>built.node.update({renderer})).not.toThrow()
  const old=renderer._textures;renderer._textures={data:new WeakMap()};expect(()=>built.node.update({renderer})).toThrow(/epoch|context|renderer/)
  renderer._textures=old;expect(()=>built.node.update({renderer})).not.toThrow()
  built.dispose();built.dispose();expect(()=>built.node.update({renderer})).toThrow(/Blank Image: actual available renderer\/device\/context required/)
 })
})
