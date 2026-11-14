/* SPDX-License-Identifier: MIT */
// Experiment only. No SDK admission or new support declaration.
import {DataTexture,FloatType,RedFormat,NearestFilter,NoColorSpace,Vector2} from 'three'
import {floor,ivec2,screenCoordinate,textureLoad,vec3} from 'three/tsl'
const refuse=message=>{throw Error('Exact axis table: '+message)}
export function axisWords(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>8192||height>8192)return refuse('physical extents must be integers 4..8192')
 const maximum=Math.max(width,height),data=new Float32Array(maximum*2)
 for(let i=0;i<width;i++)data[i]=Math.fround((2*i+1-width)/maximum)
 for(let i=0;i<height;i++)data[maximum+i]=Math.fround((2*i+1-height)/maximum)
 return data
}

/** One pipeline owns one table, shared by every exact-coordinate consumer. */
export class ExactAxisTable {
 #texture;#image;#data;#version;#size=new Vector2();#drawing=new Vector2();#key='';#dead=false;#binding=null;#node;#epoch=null;#physical=null;#uploads=0;#rebuilds=0;#validations=0;#disposals=0;#axisMilliseconds=0;#uploadHook
 constructor({existingSamplers=0}={}){
  if(!Number.isInteger(existingSamplers)||existingSamplers<0||existingSamplers>=8)return refuse('combined sampler budget is eight; one shared table binding is required')
  this.#data=new Float32Array(2)
  this.#texture=new DataTexture(this.#data,1,2,RedFormat,FloatType)
  this.#texture.name='Research shared exact Uniform axes'
  this.#texture.colorSpace=NoColorSpace;this.#texture.minFilter=this.#texture.magFilter=NearestFilter;this.#texture.generateMipmaps=false;this.#texture.flipY=false;this.#texture.unpackAlignment=1
  this.#uploadHook=()=>{this.#uploads++};this.#texture.onUpdate=this.#uploadHook
  this.#image=this.#texture.image;this.#version=this.#texture.version
  const pixel=ivec2(floor(screenCoordinate))
  // Three compositor QuadGeometry stores UV row0 at screen top. Uniform fields
  // and image textureLoad use this logical image-storage convention, independent
  // of the native EXR's physical bottom-left raster origin. ScreenNode agrees.
  const x=textureLoad(this.#texture,ivec2(pixel.x,0)).r,y=textureLoad(this.#texture,ivec2(pixel.y,1)).r
  this.#node=vec3(x,y,0).toVar()
  this.#node.onRenderUpdate(frame=>this.validate(frame.renderer))
 }
 get node(){if(this.#dead)return refuse('pipeline was disposed');return this.#node}
 // Explicitly proof-only access; the eventual production API must stay opaque.
 get proofTexture(){return this.#texture}
 get statistics(){return Object.freeze({uploads:this.#uploads,rebuilds:this.#rebuilds,validations:this.#validations,disposals:this.#disposals,axisMilliseconds:this.#axisMilliseconds,bytes:this.#data.byteLength,key:this.#key})}
 #schema(){
  const t=this.#texture
  if(t.image!==this.#image||t.image.data!==this.#data||t.image.width!==Math.max(1,this.#size.x,this.#size.y)||t.image.height!==2
   ||!(this.#data instanceof Float32Array)||this.#data.length!==t.image.width*2||t.type!==FloatType||t.format!==RedFormat
   ||t.colorSpace!==NoColorSpace||t.minFilter!==NearestFilter||t.magFilter!==NearestFilter||t.generateMipmaps||t.flipY||t.unpackAlignment!==1
   ||t.version!==this.#version||t.onUpdate!==this.#uploadHook)return refuse('owned texture schema/data/version changed')
 }
 validate(renderer){
  if(this.#dead)return refuse('pipeline was disposed')
  this.#validations++;this.#schema()
  const backend=renderer?.backend,manager=renderer?._textures,token=backend?.isWebGPUBackend?backend.device:backend?.isWebGLBackend?backend.gl:null
  if(!renderer?.isWebGPURenderer||!token||token.isContextLost?.())return refuse('actual available renderer/device/context required')
  if(this.#binding&&(this.#binding!==renderer||this.#epoch.backend!==backend||this.#epoch.token!==token||this.#epoch.manager!==manager||this.#epoch.data!==manager.data))return refuse('renderer/device/context/allocation epoch changed')
  renderer.getDrawingBufferSize(this.#drawing);const width=this.#drawing.x,height=this.#drawing.y,target=renderer.getRenderTarget()
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>8192||height>8192
   ||target&&(target.width!==width||target.height!==height||target.viewport.x!==0||target.viewport.y!==0||target.viewport.z!==width||target.viewport.w!==height||target.scissorTest))return refuse('matching full-frame physical extents 4..8192 required')
  if(!this.#binding){this.#binding=renderer;this.#epoch={backend,token,manager,data:manager.data}}
  const key=width+':'+height
  if(key!==this.#key){
   // Three cannot resize an existing DataTexture allocation in place. Dispose
   // its physical allocation, retain JS identity, then publish the new owned data.
   if(this.#key)this.#texture.dispose()
   this.#physical=null;const started=performance.now();this.#data=axisWords(width,height);this.#axisMilliseconds+=performance.now()-started
   this.#image={data:this.#data,width:Math.max(width,height),height:2};this.#texture.image=this.#image
   this.#size.set(width,height);this.#key=key;this.#texture.needsUpdate=true;this.#version=this.#texture.version;this.#rebuilds++
  }
 }
 /** Actual allocation proof after draw; descriptor tags alone cannot attest R32F. */
 attest(renderer){
  this.validate(renderer)
  const backend=renderer.backend,manager=renderer._textures
  if(!manager.has(this.#texture)||manager.get(this.#texture).isDefaultTexture)return refuse('actual nondefault owned allocation required')
  const data=backend.get(this.#texture)
  if(backend.isWebGPUBackend){
   if(data.textureDescriptorGPU?.format!=='r32float'||data.texture.width!==this.#image.width||data.texture.height!==2)return refuse('actual WebGPU R32F allocation required')
   this.#physical={backend,handle:data.texture,manager,epoch:manager.data}
  }else{
   const gl=backend.gl
   if(data.glInternalFormat!==gl.R32F||data.glFormat!==gl.RED||data.glType!==gl.FLOAT)return refuse('actual WebGL R32F allocation required')
   this.#physical={backend,handle:data.textureGPU,manager,epoch:manager.data}
  }
  return {format:'R32F',width:this.#image.width,height:2,bytes:this.#data.byteLength,textureBindingCount:1,unfilteredLoads:2}
 }
 dispose(){
  if(this.#dead)return
  this.#dead=true;this.#disposals++
  const physical=this.#physical
  this.#texture.dispose()
  // A saved renderer.dispose can erase manager data without destroying an
  // external-device allocation. This fallback owns only this table handle.
  if(physical&&physical.manager.data!==physical.epoch){if(physical.backend.isWebGPUBackend)physical.handle.destroy();else physical.backend.gl.deleteTexture(physical.handle)}
  this.#physical=null
 }
}
