/* SPDX-License-Identifier: MIT */
/** Lifetime only for explicitly created compositor tables. No numerical data
 * changes, implicit texture traversal, or ownership of borrowed inputs. */
import type {DataTexture} from 'three'
import type {TslEffectNode} from './tslPostEffects.js'
import {CompositorRendererEpoch} from './tslCompositorRttOwner.js'
type Allocation={backend:any;manager:any;epoch:any;record:any;physical:any;handle:any;msaa:any;renderTarget:any;token:any;gpu:boolean}
export class OwnedCompositorDataTexture {
 #renderer:any;#backend:any;#manager:any;#epoch:any;#token:any;#allocation:Allocation|undefined;#dead=false;#releasing=false
 #guard=new CompositorRendererEpoch('Compositor table')
 #upload:()=>void;#dispose:()=>void
 constructor(private readonly texture:DataTexture){
  if(texture.onUpdate)throw Error('Compositor table requires an exclusively owned new texture')
  this.#upload=()=>{try{this.#capture();this.#validate()}catch(error){this.#release();throw error}}
  this.#dispose=()=>{this.#capture();this.#release()}
  texture.onUpdate=this.#upload;texture.addEventListener('dispose',this.#dispose)
 }
 bind(renderer:any):void{
  if(this.#dead)throw Error('Compositor table resources were disposed')
  this.#guard.validate(renderer)
  if(!this.#renderer){this.#renderer=renderer;this.#backend=renderer.backend;this.#manager=renderer._textures;this.#epoch=this.#manager.data;this.#token=this.#backend.isWebGPUBackend?this.#backend.device:this.#backend.gl}
  // A backend may allocate and throw before onUpdate is reached. Retire that
  // incomplete generation before a retry can overwrite its only native handle.
  if(!this.#allocation){this.#capture();const partial=this.#allocation as Allocation|undefined;if(partial&&!partial.record.initialized)this.#release()}
  this.#validate()
 }
 #record():any{return this.#backend?.has(this.texture)?this.#backend.get(this.texture):undefined}
 #same(a:Allocation):boolean{const p=this.#record();return a.record.isDefaultTexture!==true&&p===a.physical&&(a.gpu?p.texture:p.textureGPU)===a.handle&&p.msaaTexture===a.msaa&&p.renderTarget===a.renderTarget}
 #validate():void{
  if(this.#dead||this.texture.onUpdate!==this.#upload||!this.texture.hasEventListener('dispose',this.#dispose))throw Error('Compositor table owned callback binding changed or disposed')
  if(!this.#renderer)throw Error('Compositor table requires a bound actual renderer before upload')
  this.#guard.validate(this.#renderer)
  const a=this.#allocation;if(a&&(!this.#same(a)||a.epoch.get(this.texture)!==a.record))throw Error('Compositor table owned physical allocation changed')
 }
 #capture():void{
  if(this.#allocation||!this.#backend)return
  const record=this.#epoch.get(this.texture),physical=this.#record(),gpu=!!this.#backend.isWebGPUBackend,handle=gpu?physical?.texture:physical?.textureGPU
  if(!record||record.isDefaultTexture===true||!handle)return
  this.#allocation={backend:this.#backend,manager:this.#manager,epoch:this.#epoch,record,physical,handle,msaa:physical.msaaTexture,renderTarget:physical.renderTarget,token:this.#token,gpu}
 }
 #release():void{
  if(this.#releasing)return;const a=this.#allocation;if(!a)return;this.#allocation=undefined;this.#releasing=true
  const native=a.record.onDispose
  // Native DataTexture listeners are registered AFTER onUpdate and info count.
  // A partial upload must never delegate to _destroyTexture's counted path.
  const delegate=a.manager.data===a.epoch&&a.epoch.get(this.texture)===a.record&&a.record.initialized===true&&this.#same(a)&&a.msaa===undefined&&a.renderTarget===undefined&&typeof native==='function'
  if(typeof native==='function')this.texture.removeEventListener('dispose',native)
  try{if(delegate)native()}
  finally{
   try{
    // Retained old maps distinguish a native listener's completed cleanup from
    // a reset manager that merely lost the allocation record.
    if(a.epoch.get(this.texture)===a.record){
     if(a.gpu)a.handle.destroy();else a.token.deleteTexture(a.handle)
     if(a.manager.data===a.epoch&&a.record.initialized===true)a.manager.info.destroyTexture(this.texture)
     a.epoch.delete(this.texture)
     if(a.record.bindGroups)for(const group of a.record.bindGroups)if(a.backend.has(group)){const p=a.backend.get(group);p.groups=undefined;p.versions=undefined}
     const current=this.#record(),key=a.gpu?'texture':'textureGPU'
     if(current===a.physical&&current[key]===a.handle){delete current[key];if(current.msaaTexture===undefined&&current.renderTarget===undefined)a.backend.delete(this.texture)}
    }
   }finally{this.#releasing=false}
  }
 }
 dispose():void{
  if(this.#dead)return
  try{this.#capture();try{this.texture.dispose()}finally{this.#release()}}
  finally{this.#dead=true;this.texture.removeEventListener('dispose',this.#dispose);if(this.texture.onUpdate===this.#upload)this.texture.onUpdate=null;this.#guard.clear();this.#renderer=this.#backend=this.#manager=this.#epoch=this.#token=undefined}
 }
}

/** Bind before both compilation uploads and actual RTT draws. The consuming
 * RTT remains the numerical owner; this wrapper only pins table lifetime. */
export function bindCompositorDataTextures(node:TslEffectNode,owners:readonly OwnedCompositorDataTexture[]):void{
 const setup=node.setup,before=node.updateBefore
 node.setup=function(builder:any){if(builder.renderer?._textures)for(const owner of owners)owner.bind(builder.renderer);return setup.call(this,builder)}
 node.updateBefore=function(frame:any){for(const owner of owners)owner.bind(frame.renderer);return before.call(this,frame)}
}
