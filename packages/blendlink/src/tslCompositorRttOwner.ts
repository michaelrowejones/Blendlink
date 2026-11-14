/* SPDX-License-Identifier: MIT */
/** Internal ownership for Three's private compositor RTTs. No sampling/math. */
import type {TslEffectNode} from './tslPostEffects.js'

export class CompositorRendererEpoch {
 #renderer:any;#backend:any;#manager:any;#epoch:any;#token:any;#api:string|undefined;#lost=false
 constructor(private readonly label:string){}
 static lost(reference:WeakRef<CompositorRendererEpoch>):()=>void{return()=>{const owner=reference.deref();if(owner)owner.#lost=true}}
 validate(renderer:any):void{
  const backend=renderer?.backend,manager=renderer?._textures,api=backend?.isWebGPUBackend?'webgpu':backend?.isWebGLBackend?'webgl2':undefined,token=api==='webgpu'?backend.device:api==='webgl2'?backend.gl:null
  if(this.#lost||!renderer?.isWebGPURenderer||!token||token.isContextLost?.()||!manager?.data?.get)throw Error(this.label+': actual available renderer/device/context required')
  if(this.#renderer&&(renderer!==this.#renderer||backend!==this.#backend||manager!==this.#manager||manager.data!==this.#epoch||token!==this.#token||api!==this.#api))throw Error(this.label+': renderer/device/context/allocation epoch changed')
  if(!this.#renderer){this.#renderer=renderer;this.#backend=backend;this.#manager=manager;this.#epoch=manager.data;this.#token=token;this.#api=api;if(backend.isWebGPUBackend&&token.lost?.then){const lost=CompositorRendererEpoch.lost(new WeakRef(this));void token.lost.then(lost,lost)}}
 }
 clear():void{this.#renderer=this.#backend=this.#manager=this.#epoch=this.#token=undefined;this.#lost=true}
}
type Attachment={texture:any;record:any;physical:any;handles:Array<[string,any]>;msaa:any;renderTarget:any}
type Auxiliary={owner:any;key:string;handle:any;kind:'framebuffer'|'renderbuffer'}
type Allocation={backend:any;manager:any;epoch:any;token:any;targetRecord:any;targetPhysical:any;depth:any;api:'webgpu'|'webgl2';attachments:Attachment[];auxiliary:Auxiliary[];auxiliaryShape:any}

// Match the fields and iteration laws consumed by Three's native destructors,
// including absent optional slots and added entries (which may be borrowed).
function enumerableKeys(value:any):string[]{const keys:string[]=[];if(value)for(const key in value)keys.push(key);return keys}
function auxiliaryShape(p:any):any{return p?{framebuffers:p.framebuffers,framebufferKeys:enumerableKeys(p.framebuffers),msaaRenderbuffers:p.msaaRenderbuffers,msaaLength:p.msaaRenderbuffers?.length,msaaFrameBuffer:p.msaaFrameBuffer,depthRenderbuffer:p.depthRenderbuffer,stencilRenderbuffer:p.stencilRenderbuffer}:undefined}
function sameAuxiliaryShape(p:any,s:any):boolean{if(!s)return !p;const keys=enumerableKeys(p?.framebuffers);return !!p&&p.framebuffers===s.framebuffers&&keys.length===s.framebufferKeys.length&&keys.every((key,i)=>key===s.framebufferKeys[i])&&p.msaaRenderbuffers===s.msaaRenderbuffers&&p.msaaRenderbuffers?.length===s.msaaLength&&p.msaaFrameBuffer===s.msaaFrameBuffer&&p.depthRenderbuffer===s.depthRenderbuffer&&p.stencilRenderbuffer===s.stencilRenderbuffer}

/** RTTNode.dispose does not own its target/material. Our listeners precede
 * Three's and take over only these private target's actual disposal callbacks.
 * Retained old WeakMaps distinguish native consumption from a manager reset. */
export class OwnedCompositorRtt {
 #dead=false;#releasing=false;#allocation:Allocation|undefined;#renderer:any
 #manager:any;#textureEpoch:any;#backend:any;#token:any;#api:'webgpu'|'webgl2'|undefined
 #epoch=new CompositorRendererEpoch('Compositor RTT')
 #target:any;#colors:any[];#quad:any;#material:any;#originalBefore:any;#before:any;#originalSetup:any;#setup:any
 #targetDispose:()=>void;#textureDispose:()=>void;#depths=new Set<any>()
 constructor(private readonly node:TslEffectNode){
  this.#target=node.renderTarget;this.#colors=[...this.#target.textures];this.#quad=node._quadMesh;this.#material=this.#quad.material
  if(!node.isRTTNode||this.#colors.length!==1||this.#target.depthTexture)throw Error('Compositor RTT requires its private color/automatic-depth target')
  this.#targetDispose=()=>{this.#capture();this.#release()};this.#textureDispose=()=>{this.#capture();this.#release()}
  this.#target.addEventListener('dispose',this.#targetDispose)
  for(const texture of this.#colors)texture.addEventListener('dispose',this.#textureDispose)
  this.#originalBefore=node.updateBefore;this.#before=(frame:any)=>this.#update(frame);node.updateBefore=this.#before
  this.#originalSetup=node.setup;this.#setup=(builder:any)=>{if(builder.renderer?._textures)this.#bind(builder.renderer);return this.#originalSetup.call(node,builder)};node.setup=this.#setup
 }
 #schema():void{
  if(this.#dead)throw Error('Compositor RTT resources were disposed')
  if(!this.#target.hasEventListener('dispose',this.#targetDispose)||this.#colors.some(t=>!t.hasEventListener('dispose',this.#textureDispose))||[...this.#depths].some(t=>!t.hasEventListener('dispose',this.#textureDispose))||this.node.renderTarget!==this.#target||this.node._quadMesh!==this.#quad||this.#quad.material!==this.#material||this.#target.depthTexture||this.#target.textures.length!==this.#colors.length||this.#colors.some((t,i)=>this.#target.textures[i]!==t)||this.node.referenceNode!==null||this.node.value!==this.#colors[0])throw Error('Compositor RTT owned target/attachment binding changed')
 }
 #bind(renderer:any):void{this.#schema();this.#epoch.validate(renderer);if(!this.#renderer){this.#renderer=renderer;this.#manager=renderer._textures;this.#textureEpoch=this.#manager.data;this.#backend=renderer.backend;this.#api=this.#backend.isWebGPUBackend?'webgpu':'webgl2';this.#token=this.#backend.isWebGPUBackend?this.#backend.device:this.#backend.gl}this.#checkAllocation()}
 #record(backend:any,object:any):any{return backend.has(object)?backend.get(object):undefined}
 #same(entry:Attachment,backend:any):boolean{const p=this.#record(backend,entry.texture);return entry.record.isDefaultTexture!==true&&p===entry.physical&&p.msaaTexture===entry.msaa&&p.renderTarget===entry.renderTarget&&entry.handles.every(([k,h])=>p[k]===h)}
 #sameAux(a:Allocation):boolean{return this.#record(a.backend,this.#target)===a.targetPhysical&&sameAuxiliaryShape(a.targetPhysical,a.auxiliaryShape)&&a.auxiliary.every(s=>s.owner[s.key]===s.handle)}
 #checkAllocation():void{
  const a=this.#allocation;if(!a)return
  if(a.attachments.some(e=>a.epoch.get(e.texture)===e.record&&!this.#same(e,a.backend))||!this.#sameAux(a))throw Error('Compositor RTT owned physical allocation changed')
 }
 #capture():void{
  const renderer=this.#renderer;if(!renderer)return
  const backend=this.#backend,manager=this.#manager
  // Once pinned, an existing allocation always belongs to its original epoch.
  // Do not adopt new maps or substituted handles during cleanup.
  if(this.#allocation)return
  const epoch=this.#textureEpoch;if(!epoch?.get||!(backend?.isWebGPUBackend||backend?.isWebGLBackend))return
  const targetRecord=epoch.get(this.#target),targetPhysical=this.#record(backend,this.#target),attachments:Attachment[]=[]
  const depth=targetRecord?.depthTexture
  const textures=[...this.#colors,...(depth&&depth.renderTarget===this.#target?[depth]:[])]
  for(const texture of textures){const record=epoch.get(texture),physical=this.#record(backend,texture),key=this.#api==='webgpu'?'texture':'textureGPU',handle=physical?.[key]
   if(!record||record.isDefaultTexture===true||!handle)continue
   attachments.push({texture,record,physical,msaa:physical.msaaTexture,renderTarget:physical.renderTarget,handles:[[key,handle],...(physical.msaaTexture?[['msaaTexture',physical.msaaTexture]as[string,any]]:[])]})
  }
  if(!targetRecord&&!attachments.length&&!targetPhysical)return
  const auxiliary:Auxiliary[]=[]
  if(this.#api==='webgl2'&&targetPhysical){
   for(const key of enumerableKeys(targetPhysical.framebuffers))auxiliary.push({owner:targetPhysical.framebuffers,key,handle:targetPhysical.framebuffers[key],kind:'framebuffer'})
   for(const key of ['msaaFrameBuffer','depthRenderbuffer','stencilRenderbuffer'])if(targetPhysical[key])auxiliary.push({owner:targetPhysical,key,handle:targetPhysical[key],kind:key==='msaaFrameBuffer'?'framebuffer':'renderbuffer'})
   for(let index=0;index<(targetPhysical.msaaRenderbuffers?.length??0);index++)auxiliary.push({owner:targetPhysical.msaaRenderbuffers,key:String(index),handle:targetPhysical.msaaRenderbuffers[index],kind:'renderbuffer'})
  }
  this.#allocation={backend,manager,epoch,token:this.#token,api:this.#api!,targetRecord,targetPhysical,depth,attachments,auxiliary,auxiliaryShape:auxiliaryShape(targetPhysical)}
  // Public texture disposal must reach the complete owner before a native
  // listener can follow a later borrowed/replacement physical handle.
  if(typeof targetRecord?.onDispose==='function')this.#target.removeEventListener('dispose',targetRecord.onDispose)
  for(const e of attachments){if(typeof e.record.onDispose==='function')e.texture.removeEventListener('dispose',e.record.onDispose);if(!this.#colors.includes(e.texture)&&!this.#depths.has(e.texture)){this.#depths.add(e.texture);e.texture.addEventListener('dispose',this.#textureDispose)}}
 }
 #release():void{
  if(this.#releasing)return;const a=this.#allocation;if(!a)return;this.#allocation=undefined;this.#releasing=true
  const sameTarget=this.#record(a.backend,this.#target)===a.targetPhysical
  const sameAux=sameTarget&&this.#sameAux(a)
  const originalInputs=a.targetRecord?.textures?.length===this.#colors.length&&a.targetRecord.textures.every((t:any,i:number)=>t===this.#colors[i])&&a.targetRecord.depthTexture===a.depth
  const delegate=a.manager.data===a.epoch&&a.epoch.get(this.#target)===a.targetRecord&&a.targetRecord?.initialized&&originalInputs&&sameAux&&a.attachments.every(e=>a.epoch.get(e.texture)===e.record&&this.#same(e,a.backend))&&(a.backend.isWebGPUBackend?a.backend.device:a.backend.gl)===a.token&&typeof a.targetRecord.onDispose==='function'
  try{
   if(delegate)a.targetRecord.onDispose()
  }finally{
   try{
    const auxiliaryConsumed=a.attachments.some(e=>!a.epoch.has(e.texture))
    for(const e of a.attachments){
     if(!a.epoch.has(e.texture))continue
     for(const[key,handle]of e.handles){if(a.api==='webgpu')handle.destroy();else a.token.deleteTexture(handle);if(e.physical[key]===handle)delete e.physical[key]}
     const current=this.#record(a.backend,e.texture);if(current===e.physical&&!current.texture&&!current.textureGPU&&!current.msaaTexture)a.backend.delete(e.texture)
     if(e.record.bindGroups)for(const group of e.record.bindGroups){const data=this.#record(a.backend,group);if(data){data.groups=undefined;data.versions=undefined}}
     if(a.epoch.get(e.texture)===e.record){if(a.manager.data===a.epoch&&e.record.initialized)a.manager.info.destroyTexture(e.texture);a.epoch.delete(e.texture)}
    }
    if(a.epoch.get(this.#target)===a.targetRecord){
     if(!auxiliaryConsumed){const freed=new Set<any>();for(const s of a.auxiliary){if(!s.handle||freed.has(s.handle))continue;freed.add(s.handle);if(s.kind==='framebuffer')a.token.deleteFramebuffer(s.handle);else a.token.deleteRenderbuffer(s.handle);if(s.owner[s.key]===s.handle)delete s.owner[s.key]}}
     if(a.manager.data===a.epoch&&a.targetRecord?.initialized)a.manager.info.memory.renderTargets--
     a.epoch.delete(this.#target)
    }
    if(sameAux&&this.#record(a.backend,this.#target)===a.targetPhysical)a.backend.delete(this.#target)
   }finally{for(const depth of this.#depths)depth.removeEventListener('dispose',this.#textureDispose);this.#depths.clear();this.#releasing=false}
  }
 }
 #update(frame:any):void{
  const renderer=frame.renderer;this.#bind(renderer)
  const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace?.()??0,mip=renderer.getActiveMipmapLevel?.()??0
  try{this.#originalBefore.call(this.node,frame);this.#capture();this.#epoch.validate(renderer);this.#checkAllocation()}
  catch(error){this.#capture();this.#release();this.node.textureNeedsUpdate=true;throw error}
  finally{renderer.setRenderTarget(target,face,mip)}
 }
 dispose():void{
  if(this.#dead)return
  try{this.#capture();try{this.#target.dispose()}finally{this.#release()}}
  finally{this.#dead=true;this.#target.removeEventListener('dispose',this.#targetDispose);for(const t of this.#colors)t.removeEventListener('dispose',this.#textureDispose);try{this.#material.dispose()}finally{try{this.node.dispose()}finally{this.#epoch.clear();this.#renderer=this.#backend=this.#manager=this.#textureEpoch=this.#token=undefined}}}
 }
}
