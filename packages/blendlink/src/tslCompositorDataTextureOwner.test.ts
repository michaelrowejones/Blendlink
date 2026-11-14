import{expect,it}from'vitest'
import{DataTexture,FloatType,RGBAFormat}from'three'
import Textures from'three/src/renderers/common/Textures.js'
import Info from'three/src/renderers/common/Info.js'
import{OwnedCompositorDataTexture}from'./tslCompositorDataTextureOwner.js'
function host(api:'webgpu'|'webgl2',beforeOwnerReset=false){
 const map=new WeakMap<object,any>(),handles:any[]=[],info=new Info();let createCount=0,fail=false,uploadFail=false
 const gl:any={deleteTexture:(h:any)=>h.destroys++,isContextLost:()=>false},foreign={destroys:0,destroy(){this.destroys++}}
 const backend:any={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,has:(t:any)=>map.has(t),get(t:any){let p=map.get(t);if(!p){createCount++;p={};map.set(t,p)}return p},delete:(t:any)=>map.delete(t),
 createTexture(t:any){const h={destroys:0,destroy(){this.destroys++}};handles.push(h);Object.assign(this.get(t),api==='webgpu'?{texture:h}:{textureGPU:h});if(fail)throw Error('Allocation failure')},updateTexture(){if(uploadFail)throw Error('Upload failure')},generateMipmaps(){throw Error('Unexpected mipmaps')},destroyTexture(t:any){const p=map.get(t);if(api==='webgpu'){p.texture.destroy();p.msaaTexture?.destroy()}else gl.deleteTexture(p.textureGPU);map.delete(t)}}
 const renderer:any={isWebGPURenderer:true,backend,_textures:undefined,dispose(){info.dispose();manager.dispose()}}
 const manager=new Textures(renderer,backend,info);renderer._textures=manager
 const texture=new DataTexture(new Float32Array(16),2,2,RGBAFormat,FloatType);texture.needsUpdate=true
 if(beforeOwnerReset)texture.addEventListener('dispose',()=>{info.dispose();manager.dispose()})
 const owner=new OwnedCompositorDataTexture(texture)
 const upload=()=>{owner.bind(renderer);manager.updateTexture(texture)}
 return{map,handles,info,backend,renderer,manager,texture,owner,upload,foreign,count:()=>createCount,fail:(v:boolean)=>{fail=v},uploadFail:(v:boolean)=>{uploadFail=v}}
}
for(const api of['webgpu','webgl2']as const){
 it('owns warm and data-reupload lifetime with actual Three counters '+api,()=>{
  const f=host(api);f.upload();f.upload();f.texture.image.data[0]=.25;f.texture.needsUpdate=true;f.upload();expect(f.handles.length).toBe(1);const n=f.count();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.manager.has(f.texture)).toBe(false);expect(f.count()).toBe(n)
 })
 it('cleans captured table after saved renderer dispose with unchanged external device '+api,()=>{
  const f=host(api),saved=f.renderer.dispose.bind(f.renderer);f.upload();saved();expect(()=>f.owner.bind(f.renderer)).toThrow(/epoch/);const n=f.count();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.count()).toBe(n)
 })
 it.each(['create','upload','callback']as const)('owns first partial allocation without native registration/count '+api+' %s',mode=>{
  const f=host(api);if(mode==='create')f.fail(true);if(mode==='upload')f.uploadFail(true)
  if(mode==='callback'){const original=f.backend.updateTexture;f.backend.updateTexture=()=>{original();f.renderer._textures.data=new WeakMap()}}
  expect(()=>f.upload()).toThrow();const n=f.count();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.count()).toBe(n)
 })
 it.each(['create','upload']as const)('retires failed partial generation before retry without owner disposal '+api+' %s',mode=>{
  const f=host(api);if(mode==='create')f.fail(true);else f.uploadFail(true);expect(()=>f.upload()).toThrow();f.fail(false);f.uploadFail(false);f.upload();expect(f.handles.map(h=>h.destroys)).toEqual([1,0]);expect(f.info.memory.textures).toBe(1);f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.info.memory.textures).toBe(0)
 })
 it.each(['handle','record','msaa','target']as const)('preserves borrowed allocation slots '+api+' %s',mode=>{
  const f=host(api);f.upload();const p=f.map.get(f.texture),key=api==='webgpu'?'texture':'textureGPU'
  if(mode==='handle')p[key]=f.foreign
  if(mode==='record')f.map.set(f.texture,{[key]:f.foreign})
  if(mode==='msaa')p.msaaTexture=f.foreign
  if(mode==='target')p.renderTarget={borrowed:true}
  expect(()=>f.owner.bind(f.renderer)).toThrow(/physical allocation/);const n=f.count();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.foreign.destroys).toBe(0);expect(f.info.memory.textures).toBe(0);expect(f.count()).toBe(n)
  if(mode==='handle'||mode==='record')expect(f.map.get(f.texture)[key]).toBe(f.foreign)
  if(mode==='msaa')expect(f.map.get(f.texture).msaaTexture).toBe(f.foreign)
 })
 it.each([true,false])('retains original-map consumption proof across disposal observers '+api+' before=%s',before=>{
  const f=host(api,before)
  f.upload();if(!before)f.texture.addEventListener('dispose',()=>{f.info.dispose();f.manager.dispose()});f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0)
 })
 it('owns public texture disposal and rejects lost binding without destroying borrowed defaults '+api,()=>{
  const f=host(api);f.upload();f.texture.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0)
  const g=host(api);g.owner.bind(g.renderer);g.manager.get(g.texture).isDefaultTexture=true;g.map.set(g.texture,{[api==='webgpu'?'texture':'textureGPU']:g.foreign});g.owner.dispose();expect(g.foreign.destroys).toBe(0)
 })
}
