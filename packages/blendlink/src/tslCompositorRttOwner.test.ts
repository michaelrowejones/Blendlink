import {expect,it,vi}from'vitest'
import {RenderTarget,FloatType}from'three'
import {rtt,vec4}from'three/tsl'
import Textures from'three/src/renderers/common/Textures.js'
import Info from'three/src/renderers/common/Info.js'
import {ownBlurRtt}from'./tslCompositorBlur.js'
import {CompositorRendererEpoch}from'./tslCompositorRttOwner.js'
function fixture(api:'webgpu'|'webgl2',depth=true,beforeOwnerReset=false){
 const data=new WeakMap<object,any>(),handles:any[]=[],fbos:any[]=[],info=new Info();let created=0,fail=false,drawFailure=false,target:any=new RenderTarget(7,5),face=2,mip=1
 const originalTarget=target,foreign:any={destroys:0,destroy(){this.destroys++}},foreignFbo:any={destroys:0}
 const gl:any={deleteTexture:(h:any)=>h.destroys++,deleteFramebuffer:(h:any)=>h.destroys++,deleteRenderbuffer:(h:any)=>h.destroys++,isContextLost:()=>false}
 const backend:any={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,
  has:(t:object)=>data.has(t),get(t:object){let r=data.get(t);if(!r){created++;r={};data.set(t,r)}return r},delete:(t:object)=>data.delete(t),
  createTexture(t:any){const h={destroys:0,destroy(){this.destroys++}};handles.push(h);Object.assign(this.get(t),api==='webgpu'?{texture:h}:{textureGPU:h,renderTarget:t.renderTarget});if(fail)throw Error('First upload failure')},
  updateTexture(){},generateMipmaps(){throw Error('Unexpected mips')},destroyTexture(t:any){const p=data.get(t);if(!p)return;if(api==='webgpu'){p.texture.destroy();p.msaaTexture?.destroy()}else{gl.deleteTexture(p.textureGPU);const td=data.get(p.renderTarget);if(td){if(td.framebuffers){for(const k in td.framebuffers)gl.deleteFramebuffer(td.framebuffers[k]);delete td.framebuffers}for(const k of ['depthRenderbuffer','stencilRenderbuffer'])if(td[k]){gl.deleteRenderbuffer(td[k]);delete td[k]}if(td.msaaFrameBuffer){gl.deleteFramebuffer(td.msaaFrameBuffer);delete td.msaaFrameBuffer}if(td.msaaRenderbuffers){for(let i=0;i<td.msaaRenderbuffers.length;i++)gl.deleteRenderbuffer(td.msaaRenderbuffers[i]);delete td.msaaRenderbuffers}}}data.delete(t)}}
 const renderer:any={isWebGPURenderer:true,backend,_textures:undefined,getRenderTarget:()=>target,setRenderTarget:(t:any,f=0,m=0)=>{target=t;face=f;mip=m},getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,getPixelRatio:()=>1,getSize:(s:any)=>s.set(4,4),
  render(){manager.updateRenderTarget(target);if(api==='webgl2'){const p=backend.get(target);if(!p.framebuffers){const f={destroys:0};fbos.push(f);p.framebuffers={owned:f}}}if(drawFailure)throw Error('Draw failure')},dispose(){info.dispose();manager.dispose()}}
 const manager=new Textures(renderer,backend,info);renderer._textures=manager
 const node:any=rtt(vec4(1),4,4,{type:FloatType,depthBuffer:depth}),material=node._quadMesh.material,geometry=node._quadMesh.geometry
 if(beforeOwnerReset)node.renderTarget.addEventListener('dispose',()=>{info.dispose();manager.dispose()})
 const owner=ownBlurRtt(node)
 const run=()=>node.updateBefore({renderer})
 return{api,renderer,backend,manager,info,data,handles,fbos,node,owner,material,geometry,foreign,foreignFbo,originalTarget,run,created:()=>created,state:()=>[target,face,mip],fail:(v:boolean)=>{fail=v},drawFailure:(v:boolean)=>{drawFailure=v}}
}
for(const api of['webgpu','webgl2']as const){
 it('owns actual Three RTT attachments and restores target/face/mip '+api,()=>{
  const f=fixture(api),shared=vi.spyOn(f.geometry,'dispose'),material=vi.spyOn(f.material,'dispose');f.run();expect(f.info.memory.textures).toBe(2);expect(f.info.memory.renderTargets).toBe(1);expect(f.state()).toEqual([f.originalTarget,2,1]);f.run();expect(f.handles).toHaveLength(2)
  const created=f.created();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.fbos.map(h=>h.destroys)).toEqual(api==='webgl2'?[1]:[]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0);expect(f.created()).toBe(created);expect(material).toHaveBeenCalledOnce();expect(shared).not.toHaveBeenCalled();expect(()=>f.run()).toThrow(/disposed/);shared.mockRestore();material.mockRestore()
 })
 it('cleans after saved original renderer disposal and rejects stale epoch '+api,()=>{
  const f=fixture(api);const saved=f.renderer.dispose.bind(f.renderer);f.run();saved();expect(()=>f.run()).toThrow(/epoch/);const created=f.created();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.fbos.map(h=>h.destroys)).toEqual(api==='webgl2'?[1]:[]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0);expect(f.created()).toBe(created)
 })
 it('cleans a partial first allocation without negative Three counters and retries '+api,()=>{
  const f=fixture(api);f.fail(true);expect(()=>f.run()).toThrow('First upload failure');expect(f.state()).toEqual([f.originalTarget,2,1]);expect(f.handles.map(h=>h.destroys)).toEqual([1]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0);f.fail(false);f.run();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1,1]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0)
 })
 it('cleans fully allocated draw failure and recovers without losing caller target '+api,()=>{
  const f=fixture(api);f.drawFailure(true);expect(()=>f.run()).toThrow('Draw failure');expect(f.state()).toEqual([f.originalTarget,2,1]);expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0);f.drawFailure(false);f.run();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1,1,1])
 })
 it('owns each resized generation and retains shared geometry '+api,()=>{
  const f=fixture(api);f.run();f.node.setSize(6,5);expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.info.memory.textures).toBe(0);f.run();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1,1,1]);expect(f.fbos.every(h=>h.destroys===1)).toBe(true);expect(f.info.memory.renderTargets).toBe(0)
 })
 it.each(['handle','target','auxiliary','depth-record']as const)('preserves borrowed replacements while cleaning original '+api+' %s',mode=>{
  const f=fixture(api);f.run();const key=api==='webgpu'?'texture':'textureGPU',color=f.node.renderTarget.texture,target=f.node.renderTarget
  if(mode==='handle')f.data.get(color)[key]=f.foreign
  if(mode==='target')f.data.set(target,{framebuffers:{borrowed:f.foreignFbo}})
  if(mode==='auxiliary'&&api==='webgl2')f.data.get(target).framebuffers.owned=f.foreignFbo
  if(mode==='depth-record')f.manager.data.get(target).depthTexture={name:'borrowed depth'}
  f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys),mode).toEqual([1,1]);expect(f.foreign.destroys).toBe(0);expect(f.foreignFbo.destroys).toBe(0);expect(f.fbos.every(h=>h.destroys===1)).toBe(true);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0)
  if(mode==='handle')expect(f.data.get(color)[key]).toBe(f.foreign)
  if(mode==='target')expect(f.data.get(target).framebuffers.borrowed).toBe(f.foreignFbo)
  if(mode==='auxiliary'&&api==='webgl2')expect(f.data.get(target).framebuffers.owned).toBe(f.foreignFbo)
 })
 it.each(['msaaTexture','framebuffer-entry','msaa-entry','msaaFrameBuffer','depthRenderbuffer','stencilRenderbuffer']as const)('preserves newly added destructor-consumed borrowed slots '+api+' %s',mode=>{
  if(api==='webgpu'&&mode!=='msaaTexture'||api==='webgl2'&&mode==='msaaTexture')return
  const f=fixture(api);f.run();const target=f.node.renderTarget,p=f.data.get(target),color=f.data.get(target.texture)
  if(mode==='msaaTexture')color.msaaTexture=f.foreign
  else if(mode==='framebuffer-entry')p.framebuffers.borrowed=f.foreignFbo
  else if(mode==='msaa-entry')p.msaaRenderbuffers=[f.foreignFbo]
  else p[mode]=f.foreignFbo
  expect(()=>f.run()).toThrow(/physical allocation changed/)
  f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.foreign.destroys).toBe(0);expect(f.foreignFbo.destroys).toBe(0);expect(f.fbos.every(h=>h.destroys===1)).toBe(true);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0)
 })
 it('preserves appended entries of an existing native renderbuffer array '+api,()=>{
  if(api!=='webgl2')return
  const owned={destroys:0}
  const g=fixture(api),draw=g.renderer.render;g.renderer.render=()=>{draw();g.data.get(g.node.renderTarget).msaaRenderbuffers=[owned]};g.run();g.data.get(g.node.renderTarget).msaaRenderbuffers.push(g.foreignFbo);expect(()=>g.run()).toThrow(/physical allocation changed/);g.owner.dispose();expect(owned.destroys).toBe(1);expect(g.foreignFbo.destroys).toBe(0)
 })
 it('cleans through an intact original manager after replacement '+api,()=>{
  const f=fixture(api);f.run();f.renderer._textures=new Textures(f.renderer,f.backend,new Info());expect(()=>f.run()).toThrow(/epoch/);f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.info.memory.textures).toBe(0)
 })
 it.each([true,false])('retains consumed-allocation evidence across dispose-listener manager resets '+api+' before=%s',before=>{
  const f=fixture(api,true,before);f.run();if(!before)f.node.renderTarget.addEventListener('dispose',()=>{f.info.dispose();f.manager.dispose()});f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.fbos.every(h=>h.destroys===1)).toBe(true);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0)
 })
 it('retains explicit cleanup when a target disposal observer throws '+api,()=>{
  const f=fixture(api);f.run();f.node.renderTarget.addEventListener('dispose',()=>{throw Error('Caller disposal observer')});expect(()=>f.owner.dispose()).toThrow('Caller disposal observer');expect(()=>f.owner.dispose()).not.toThrow();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.info.memory.textures).toBe(0);expect(f.info.memory.renderTargets).toBe(0)
 })
 it('public owned texture disposal owns the complete target exactly once '+api,()=>{
  const f=fixture(api);f.run();f.node.renderTarget.texture.dispose();f.owner.dispose();f.owner.dispose();expect(f.handles.map(h=>h.destroys)).toEqual([1,1]);expect(f.fbos.every(h=>h.destroys===1)).toBe(true);expect(f.info.memory.renderTargets).toBe(0)
 })
}
it('pins render managers/WeakMap epochs and actual device/context identity',()=>{
 const f=fixture('webgpu'),guard=new CompositorRendererEpoch('Displace');guard.validate(f.renderer);f.renderer._textures.data=new WeakMap();expect(()=>guard.validate(f.renderer)).toThrow(/Displace.*epoch/);guard.clear()
})
