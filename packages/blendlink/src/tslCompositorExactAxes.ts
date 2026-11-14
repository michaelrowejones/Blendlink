/* SPDX-License-Identifier: MIT */
/** Owned O(W+H) native Uniform coordinates, shared by a compositor build. */
import {DataTexture,FloatType,RedFormat,NearestFilter,NoColorSpace,Vector2,Vector4} from 'three'
import {floor,ivec2,screenCoordinate,textureLoad,vec3} from 'three/tsl'
import type {TslEffectNode} from './tslPostEffects.js'
const refuse=(message:string):never=>{throw Error('White Noise exact axes: '+message)}
function extent(width:number,height:number):void{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>8192||height>8192)refuse('physical extents must be integers in [4,8192]')
}
/** Native ((pixel+.5)-size/2)/maxSize*2. All half-integers are
 * exact; power-of-two scaling commutes with normal F32 rounding here. */
export function compositorUniformAxes(width:number,height:number):Float32Array{
 extent(width,height);const maximum=Math.max(width,height),data=new Float32Array(maximum*2)
 for(let i=0;i<width;i++)data[i]=Math.fround((2*i+1-width)/maximum)
 for(let i=0;i<height;i++)data[maximum+i]=Math.fround((2*i+1-height)/maximum)
 return data
}
const owners=new WeakSet<object>()
export const isCompositorExactAxes=(value:unknown):value is CompositorExactAxes=>!!value&&typeof value==='object'&&owners.has(value as object)
type Physical={api:'webgpu'|'webgl2';gl?:any;handle:any;backend:any;backendRecord:any;manager:any;managerRecord:any;epoch:unknown}
/** No public texture/data access. Traversing a built Three node remains subject
 * to the same immutable schema/version checks as other owned resources. */
export class CompositorExactAxes {
 #node:TslEffectNode
 #bindings:ReadonlyArray<{node:any;uvNode:unknown}>
 get node():TslEffectNode{if(this.#dead)refuse('pipeline resources were disposed');return this.#node}
 #texture:DataTexture;#data:Float32Array=new Float32Array(2);#image:any;#source:any;#version=0;#sourceVersion=0
 #drawing=new Vector2();#viewport=new Vector4();#width=0;#height=0;#dead=false;#lost=false;#invalid=false
 #renderer:any;#backend:any;#token:any;#manager:any;#epoch:any;#physical:Physical|undefined
 #upload:()=>void
 constructor(){
  this.#texture=new DataTexture(this.#data,1,2,RedFormat,FloatType)
  this.#texture.name='SceneToWeb exact compositor Uniform axes'
  this.#texture.minFilter=this.#texture.magFilter=NearestFilter;this.#texture.colorSpace=NoColorSpace
  this.#texture.generateMipmaps=false;this.#texture.flipY=false;this.#texture.unpackAlignment=1;this.#texture.matrixAutoUpdate=false
  this.#image=this.#texture.image;this.#source=this.#texture.source;this.#version=this.#texture.version;this.#sourceVersion=this.#source.version
  this.#upload=()=>this.#capture();this.#texture.onUpdate=this.#upload
  const pixel=ivec2(floor(screenCoordinate))
  // QuadGeometry and integer textureLoad share top-first logical storage.
  const x=textureLoad(this.#texture,ivec2(pixel.x,0)),y=textureLoad(this.#texture,ivec2(pixel.y,1))
  this.#bindings=[x,y].map(node=>({node,uvNode:node.uvNode}))
  this.#node=vec3(x.r,y.r,0).toVar()
  this.#node.onRenderUpdate((frame:any)=>{this.validate(frame.renderer)})
  owners.add(this)
 }
 #schema():void{
  // Two authored loads only: Three keeps generated UV/flip/update caches on
  // the builder/node separately. Check reference before value, whose getter
  // follows referenceNode (a substituted self-reference would recurse).
  for(const {node,uvNode}of this.#bindings){
   if(node.referenceNode!==null||node.value!==this.#texture||node.uvNode!==uvNode
    ||node.sampler!==false||node.updateMatrix!==false||node.levelNode!==null||node.biasNode!==null
    ||node.compareNode!==null||node.depthNode!==null||node.gradNode!==null||node.offsetNode!==null)refuse('owned texture-node binding changed')
  }
  const t=this.#texture,image=t.image
  if(t.source!==this.#source||t.source.version!==this.#sourceVersion||t.source.dataReady!==true||image!==this.#image||image.data!==this.#data||image.width!==Math.max(1,this.#width,this.#height)||image.height!==2
   ||this.#data.length!==image.width*2||t.version!==this.#version||t.type!==FloatType||t.format!==RedFormat
   ||t.minFilter!==NearestFilter||t.magFilter!==NearestFilter||t.colorSpace!==NoColorSpace||t.generateMipmaps||t.flipY
   ||t.unpackAlignment!==1||t.matrixAutoUpdate||t.onUpdate!==this.#upload)refuse('owned texture schema/data/version changed')
 }
 #release():void{
  const physical=this.#physical;this.#physical=undefined
  const manager=physical?.manager,record=physical&&manager.data===physical.epoch?manager.data.get(this.#texture):undefined
  const backendRecord=physical?.backend.has(this.#texture)?physical.backend.get(this.#texture):undefined
  const sameAllocation=!!physical&&backendRecord===physical.backendRecord
   &&(physical.api==='webgpu'?backendRecord.texture===physical.handle:backendRecord.textureGPU===physical.handle&&physical.backend.gl===physical.gl)
  const delegated=sameAllocation&&record===physical?.managerRecord&&typeof record?.onDispose==='function'&&this.#texture.hasEventListener('dispose',record.onDispose)
  // A changed backend record may point at a foreign allocation. Prevent the
  // old Three listener from destroying that replacement during our disposal.
  if(!delegated&&record===physical?.managerRecord&&typeof record?.onDispose==='function')this.#texture.removeEventListener('dispose',record.onDispose)
  try{this.#texture.dispose()}finally{
   if(physical){
    const current=manager.data===physical.epoch?manager.data.get(this.#texture):undefined
    // Three registers onDispose only AFTER the first onUpdate returns. A
    // refusing first upload therefore owns an allocation with no listener and
    // no info.createTexture count. Never call _destroyTexture on that partial.
    const handled=delegated&&manager.data===physical.epoch&&current===undefined
    if(!handled){
     if(physical.api==='webgpu')physical.handle.destroy()
     else physical.gl.deleteTexture(physical.handle)
     if(current===physical.managerRecord){
      if(typeof current.onDispose==='function')this.#texture.removeEventListener('dispose',current.onDispose)
      if(current.initialized===true)manager.info?.destroyTexture(this.#texture)
      manager.delete(this.#texture)
     }
     // Do not create a new backend/manager map entry while disposing, and do
     // not remove a replacement allocation we never owned.
     if(sameAllocation&&physical.backend.has(this.#texture)&&physical.backend.get(this.#texture)===physical.backendRecord)physical.backend.delete(this.#texture)
    }
   }
  }
 }
 #capture():void{
  const renderer=this.#renderer,backend=this.#backend,manager=this.#manager
  const managerRecord=manager?.data.get(this.#texture)
  const data=backend?.has(this.#texture)?backend.get(this.#texture):undefined
  const handle=backend?.isWebGPUBackend?data?.texture:data?.textureGPU
  // Capture the actual nondefault owned allocation before any refusing schema
  // check. Default placeholders are shared and must never be destroyed here.
  if(managerRecord?.isDefaultTexture===false&&handle)this.#physical={api:backend.isWebGPUBackend?'webgpu':'webgl2',gl:backend.isWebGLBackend?backend.gl:undefined,handle,backend,backendRecord:data,manager,managerRecord,epoch:manager.data}
  try{
   if(this.#dead)refuse('pipeline resources were disposed')
   this.#schema()
   if(!renderer||renderer.backend!==backend||renderer._textures!==manager||manager.data!==this.#epoch)refuse('renderer allocation epoch changed during upload')
   if(managerRecord?.isDefaultTexture!==false||!handle)refuse('actual nondefault owned R32F allocation required')
   if(backend.isWebGPUBackend){
    if(data.textureDescriptorGPU?.format!=='r32float'||handle.format!=='r32float'||handle.width!==this.#image.width||handle.height!==2)refuse('actual WebGPU R32F allocation required')
   }else{
    const gl=backend.gl
    if(data.glInternalFormat!==gl.R32F||data.glFormat!==gl.RED||data.glType!==gl.FLOAT)refuse('actual WebGL R32F allocation required')
   }
  }catch(error){this.#invalid=true;this.#release();throw error}
 }
 static #lostCallback(reference:WeakRef<CompositorExactAxes>):()=>void{return()=>{const axes=reference.deref();if(axes)axes.#lost=true}}
 validate(renderer:any):void{
  if(this.#invalid)refuse('owned allocation failed upload validation; rebuild the pipeline')
  if(this.#lost)refuse('renderer device was lost')
  if(this.#dead)refuse('pipeline resources were disposed')
  this.#schema()
  const backend=renderer?.backend,manager=renderer?._textures,token=backend?.isWebGPUBackend?backend.device:backend?.isWebGLBackend?backend.gl:null
  if(!renderer?.isWebGPURenderer||!manager||!token||token.isContextLost?.())refuse('actual available renderer/device/context required')
  if(this.#renderer&&(renderer!==this.#renderer||backend!==this.#backend||token!==this.#token||manager!==this.#manager||manager.data!==this.#epoch))refuse('renderer/device/context/allocation epoch changed')
  renderer.getDrawingBufferSize(this.#drawing);const width=this.#drawing.x,height=this.#drawing.y,target=renderer.getRenderTarget()
  extent(width,height)
  if((renderer.getActiveMipmapLevel?.()??0)!==0||target&&(target.texture?.isCubeTexture||target.depth!==undefined&&target.depth!==1))refuse('full-frame two-dimensional mip0 target required')
  if(target){
   if(target.width!==width||target.height!==height||target.viewport.x!==0||target.viewport.y!==0||target.viewport.z!==width||target.viewport.w!==height||target.scissorTest)refuse('zero-origin full-frame target viewport without scissor required')
  }else{
   renderer.getViewport(this.#viewport);const ratio=renderer.getPixelRatio()
   if(!Number.isFinite(ratio)||ratio<=0||this.#viewport.x!==0||this.#viewport.y!==0||Math.floor(this.#viewport.z*ratio)!==width||Math.floor(this.#viewport.w*ratio)!==height||renderer.getScissorTest())refuse('zero-origin full physical viewport including DPR required')
  }
  if(!this.#renderer){this.#renderer=renderer;this.#backend=backend;this.#token=token;this.#manager=manager;this.#epoch=manager.data;if(backend.isWebGPUBackend&&token.lost?.then){const lost=CompositorExactAxes.#lostCallback(new WeakRef(this));void token.lost.then(lost,lost)}}
  if(width!==this.#width||height!==this.#height){
   // Complete every potentially refusing computation before replacing the
   // current valid allocation. Invalid extents never allocate or poison cache.
   const data=compositorUniformAxes(width,height)
   if(this.#width)this.#release()
   this.#data=data;this.#image={data,width:Math.max(width,height),height:2};this.#texture.image=this.#image
   this.#width=width;this.#height=height;this.#texture.needsUpdate=true;this.#version=this.#texture.version;this.#sourceVersion=this.#source.version
  }else if(this.#physical){
   const current=backend.get(this.#texture),handle=backend.isWebGPUBackend?current.texture:current.textureGPU
   if(handle!==this.#physical.handle)refuse('owned physical texture allocation changed')
  }
 }
 dispose():void{
  if(this.#dead)return
  this.#dead=true
  try{this.#release()}finally{this.#renderer=this.#backend=this.#token=this.#manager=this.#epoch=undefined;this.#data=new Float32Array();this.#image=undefined}
 }
}
