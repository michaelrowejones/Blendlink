import {expect,it,vi} from 'vitest'
import Textures from 'three/src/renderers/common/Textures.js'
import Info from 'three/src/renderers/common/Info.js'
import WebGPUTextureUtils from 'three/src/renderers/webgpu/utils/WebGPUTextureUtils.js'
import WebGLTextureUtils from 'three/src/renderers/webgl-fallback/utils/WebGLTextureUtils.js'
import {OwnedCompositorRowTable} from './tslCompositorRowTable.js'
const textureOf=(node:any):any=>{const all=new Set<any>();node.traverse((n:any)=>{if(n.isTextureNode)all.add(n.value)});expect(all.size).toBe(1);return [...all][0]}
function host(){const state={width:13,height:9},target:any={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(state.width,state.height),getRenderTarget:()=>target}
 return{renderer,resize(w:number,h:number){state.width=w;state.height=h;target.width=w;target.height=h;target.viewport.z=w;target.viewport.w=h}}
}
it('one-row and two-row builders retain a valid allocation until a fully validated replacement exists',()=>{
 for(const rows of[1,2]){
  let bad=false;const build=vi.fn((w:number,h:number)=>{const data=new Float32Array(Math.max(w,h)*rows);data.fill(bad?NaN:.25);return data}),table=new OwnedCompositorRowTable(rows,build,{label:'Test rows',name:'Owned test'}),node=table.guard(table.sample('X',0).toVar()),texture=textureOf(node),frame=host()
  table.validate(frame.renderer);const first=texture.image.data,version=texture.version
  for(let i=0;i<3;i++)table.validate(frame.renderer);expect(build).toHaveBeenCalledTimes(1);expect(texture.image.height).toBe(rows)
  frame.resize(3,9);expect(()=>table.validate(frame.renderer)).toThrow(/physical extents/);expect(build).toHaveBeenCalledTimes(1)
  frame.resize(9,13);bad=true;expect(()=>table.validate(frame.renderer)).toThrow(/nonnormal/);expect(texture.image.data).toBe(first);expect(texture.version).toBe(version)
  bad=false;table.validate(frame.renderer);expect(texture.image.data).not.toBe(first);expect(texture.version).toBe(version+1);expect(texture.image.width).toBe(13)
  table.dispose();table.dispose();expect(()=>table.sample('X',0)).toThrow(/disposed/)
 }
})
it('internal row plans cannot smuggle wrong dimensions, shared buffers or nonnormal words',()=>{
 for(const build of[()=>new Float32Array(1),()=>new Float32Array(new SharedArrayBuffer(13*4)),()=>new Float32Array(13).fill(-0),()=>new Float32Array(13).fill(2**-149)]){
  const table=new OwnedCompositorRowTable(1,build,{label:'Test rows',name:'Owned test'});expect(()=>table.validate(host().renderer)).toThrow(/storage|nonnormal/);table.dispose()
 }
 expect(()=>new OwnedCompositorRowTable(9,()=>new Float32Array(),{label:'Test rows',name:'Owned test'})).toThrow(/one to eight/)
 const table=new OwnedCompositorRowTable(1,()=>new Float32Array(13),{label:'Test rows',name:'Owned test'});expect(()=>table.sample('X',1)).toThrow(/selector/);table.dispose()
})

// Real manager ordering matters: create/update may throw before onUpdate,
// initialized, the info count and native dispose listener are installed.
function allocationHost(api:'webgpu'|'webgl2'){
 const records=new WeakMap<object,any>(),handles:any[]=[],info=new Info();let failure:string|undefined,createdRecords=0
 const gl:any={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture:(handle:any)=>handle.destroys++,deleteFramebuffer:(handle:any)=>handle.destroys++,deleteRenderbuffer:(handle:any)=>handle.destroys++}
 const backend:any={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,
  has:(object:object)=>records.has(object),get(object:object){let value=records.get(object);if(!value){createdRecords++;value={};records.set(object,value)}return value},delete:(object:object)=>records.delete(object),
  createTexture(texture:any){const handle={width:texture.image.width,height:texture.image.height,format:'r32float',destroys:0,destroy(){this.destroys++}};handles.push(handle);Object.assign(this.get(texture),api==='webgpu'?{texture:handle,textureDescriptorGPU:{format:'r32float'}}:{textureGPU:handle,glInternalFormat:gl.R32F,glFormat:gl.RED,glType:gl.FLOAT});if(failure==='create')throw Error('Allocated then create failed')},
  updateTexture(){if(failure==='upload')throw Error('Upload failed before onUpdate')},generateMipmaps(){throw Error('Unexpected mipmaps')},destroyTexture(texture:any,isDefault=false){if(api==='webgpu')new WebGPUTextureUtils(this).destroyTexture(texture,isDefault);else WebGLTextureUtils.prototype.destroyTexture.call({backend:this,gl:this.gl,deallocateRenderBuffers:WebGLTextureUtils.prototype.deallocateRenderBuffers},texture,isDefault)}}
 const target:any={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false}
 const renderer:any={isWebGPURenderer:true,backend,_textures:undefined,getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>target}
 const manager=new Textures(renderer,backend,info);renderer._textures=manager
 const owner=new OwnedCompositorRowTable(2,(w,h)=>new Float32Array(Math.max(w,h)*2).fill(.25),{label:'Actual manager rows',name:'Owned partial upload rows'})
 const texture=textureOf(owner.sample('X',0)),upload=()=>{owner.validate(renderer);manager.updateTexture(texture)}
 return{owner,texture,renderer,manager,backend,records,handles,info,gl,upload,fail:(mode:string|undefined)=>{failure=mode},created:()=>createdRecords}
}
for(const api of['webgpu','webgl2']as const){
 for(const mode of['none','create','upload']as const)for(const route of['dispose','retry']as const)it('retains actual row allocation through '+api+' '+mode+' '+route,()=>{
  const f=allocationHost(api);if(mode!=='none')f.fail(mode)
  if(mode==='none')f.upload();else expect(()=>f.upload()).toThrow(/failed/)
  if(route==='retry'){f.fail(undefined);f.upload()}
  const records=f.created();f.owner.dispose();f.owner.dispose()
  expect(f.handles.every(handle=>handle.destroys===1)).toBe(true)
  expect(f.handles.length).toBe(mode==='none'||route==='dispose'?1:2)
  expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0);expect(f.created()).toBe(records)
 })
 it('uses the original allocation map for late partial cleanup after manager reset '+api,()=>{
  const f=allocationHost(api);f.fail('create');expect(()=>f.upload()).toThrow(/failed/);f.manager.dispose();f.info.dispose()
  const counters=vi.spyOn(f.info,'destroyTexture'),records=f.created();f.owner.dispose();f.owner.dispose()
  expect(f.handles.map(handle=>handle.destroys)).toEqual([1]);expect(counters).not.toHaveBeenCalled();expect(f.info.memory.textures).toBe(0);expect(f.created()).toBe(records)
 })
 it('late ownership capture never claims a shared default placeholder '+api,()=>{
  const f=allocationHost(api);f.owner.validate(f.renderer);const shared={destroys:0,destroy(){this.destroys++}}
  f.manager.get(f.texture).isDefaultTexture=true;f.records.set(f.texture,api==='webgpu'?{texture:shared}:{textureGPU:shared})
  const records=f.created();f.owner.dispose();expect(shared.destroys).toBe(0);expect(f.created()).toBe(records);expect(f.records.has(f.texture)).toBe(true)
 })
}

for(const api of['webgpu','webgl2']as const){
 it.each([true,false])('retains native cleanup consumption across public observer reset '+api+' before=%s',before=>{
  const f=allocationHost(api),reset=()=>{f.manager.dispose();f.info.dispose()}
  if(before)f.texture.addEventListener('dispose',reset)
  f.upload();if(!before)f.texture.addEventListener('dispose',reset)
  const records=f.created();f.owner.dispose();f.owner.dispose()
  expect(f.handles.map(handle=>handle.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.created()).toBe(records)
 })
 it('never delegates owned row cleanup through a mutated native default flag '+api,()=>{
  const f=allocationHost(api);f.upload();f.manager.data.get(f.texture).isDefaultTexture=true
  f.owner.dispose();f.owner.dispose();expect(f.handles.map(handle=>handle.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0)
 })
 it('preserves added borrowed native destructor fields '+api,()=>{
  const f=allocationHost(api);f.upload();const borrowed={destroys:0,destroy(){this.destroys++}},record=f.records.get(f.texture)
  if(api==='webgpu')record.msaaTexture=borrowed
  else{record.renderTarget={};f.records.set(record.renderTarget,{framebuffers:{borrowed}})}
  const records=f.created();f.owner.dispose();f.owner.dispose()
  expect(f.handles.map(handle=>handle.destroys)).toEqual([1]);expect(borrowed.destroys).toBe(0);expect(f.info.memory.textures).toBe(0);expect(f.created()).toBe(records)
  if(api==='webgpu'){expect(f.records.get(f.texture).msaaTexture).toBe(borrowed);expect(f.records.get(f.texture).texture).toBeUndefined()}
  else expect(f.records.get(record.renderTarget).framebuffers.borrowed).toBe(borrowed)
 })
}
it.each(['create','upload'])('late partial capture uses pinned GL context after reset and replacement %s',mode=>{
 const f=allocationHost('webgl2');f.fail(mode);expect(()=>f.upload()).toThrow(/failed/)
 const original=vi.spyOn(f.gl,'deleteTexture'),replacement={...f.gl,deleteTexture:vi.fn()}
 f.manager.dispose();f.info.dispose();f.backend.gl=replacement
 const records=f.created();f.owner.dispose();f.owner.dispose()
 expect(original).toHaveBeenCalledExactlyOnceWith(f.handles[0]);expect(replacement.deleteTexture).not.toHaveBeenCalled();expect(f.handles.map(handle=>handle.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.created()).toBe(records)
})
