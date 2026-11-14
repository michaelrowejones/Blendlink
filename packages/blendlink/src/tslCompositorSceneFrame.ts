/* SPDX-License-Identifier: MIT */
import {DataTexture,FloatType,HalfFloatType,NearestFilter,NoColorSpace,RGBAFormat,RenderTarget,Vector2,Vector4} from 'three'
import {NodeMaterial,PassNode,QuadMesh,RendererUtils} from 'three/webgpu'
import * as TSL from 'three/tsl'
import type {TslEffectNode} from './tslPostEffects.js'
import type {SourceCompositorOperation} from './sourceDisplay.js'
const {floor,ivec2,textureLoad,uniform,uv}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
const SIZE=256,WORDS=SIZE*SIZE*4
const refuse=(message:string):never=>{throw Error('Ellipse scene frame: '+message)}
export interface EllipseSceneDecoderReport {model:'half-decoder-canonical-nan-v1';words:number;milliseconds:number;nominalTransientBytes:number;readbackFlipped:boolean}
export interface EllipseSceneDecoder {readonly report:Readonly<EllipseSceneDecoderReport>}
interface Entry {backend:any;token:any;invalid:boolean;promise:Promise<EllipseSceneDecoder>;detach:()=>void;epoch:symbol;disposeHook:(...args:any[])=>unknown;cleanups:Set<()=>void>;textureManager:any;textureEpoch:any}
const cache=new WeakMap<object,Entry>(),certificates=new WeakMap<object,Entry>()
const now=()=>performance.now()
/** Exact declared decode model. No host float16 conversion or NaN arithmetic. */
export function ellipseHalfDecodedWord(raw:number):number{
 const sign=(raw&0x8000)<<16,exponent=(raw>>>10)&31,mantissa=raw&1023
 if(exponent===31)return mantissa?0x7fc00000:(sign|0x7f800000)>>>0
 if(exponent)return(sign|((exponent+112)<<23)|(mantissa<<13))>>>0
 if(!mantissa)return sign>>>0
 const leading=31-Math.clz32(mantissa)
 return(sign|((leading+103)<<23)|((mantissa^(1<<leading))<<(23-leading)))>>>0
}
function token(renderer:any):any{
 if(!renderer?.isWebGPURenderer||!renderer.backend)return refuse('requires an initialized Three node renderer')
 const backend=renderer.backend
 if(backend.isWebGPUBackend&&backend.device)return backend.device
 if(backend.isWebGLBackend&&backend.gl&&!backend.gl.isContextLost())return backend.gl
 return refuse('requires an available WebGPU device or WebGL2 context')
}
function assertEntry(renderer:any,entry:Entry):void{
 if(entry.invalid||renderer.dispose!==entry.disposeHook||renderer.backend!==entry.backend||token(renderer)!==entry.token||renderer._textures!==entry.textureManager||renderer._textures?.data!==entry.textureEpoch){expire(renderer,entry);return refuse('decoder certificate expired after device/context/dispose/allocation-epoch change')}
}
function rawHalf(i:number,c:number):number{return c===0?i:c===1?(i+21845)&65535:c===2?(i+43690)&65535:i^32768}
/** Calibration-only readback: all borrowed binding state is restored before
 * awaiting the fence/map, and every owned staging resource closes on failure. */
function ownedCleanup(entry:Entry,cleanup:()=>void):()=>void{let closed=false;const dispose=()=>{if(closed)return;closed=true;entry.cleanups.delete(dispose);cleanup()};entry.cleanups.add(dispose);return dispose}
async function readCalibration(renderer:any,target:RenderTarget,entry:Entry):Promise<Float32Array>{
 const backend=renderer.backend
 if(backend.isWebGPUBackend){
  const device=backend.device,source=backend.get(target.texture)
  if(source.textureDescriptorGPU?.format!=='rgba32float')return refuse('calibration target is not an actual RGBA32F attachment')
  const buffer=device.createBuffer({size:WORDS*4,usage:9}),close=ownedCleanup(entry,()=>buffer.destroy())
  let timeout:ReturnType<typeof setTimeout>|undefined
  try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:source.texture},{buffer,bytesPerRow:SIZE*16},{width:SIZE,height:SIZE});device.queue.submit([encoder.finish()]);await Promise.race([buffer.mapAsync(1),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{close();reject(Error('Ellipse scene frame: decoder calibration map timed out'))},5000)})]);return new Float32Array(buffer.getMappedRange().slice())}finally{if(timeout!==undefined)clearTimeout(timeout);close()}
 }
 const gl=backend.gl,source=backend.get(target.texture)
 if(source.glInternalFormat!==gl.RGBA32F||source.glFormat!==gl.RGBA||source.glType!==gl.FLOAT)return refuse('calibration requires an actual WebGL RGBA32F attachment')
 const fb=gl.createFramebuffer(),buffer=gl.createBuffer()
 let sync:any=null
 if(!fb||!buffer){if(fb)gl.deleteFramebuffer(fb);if(buffer)gl.deleteBuffer(buffer);return refuse('cannot allocate bounded calibration readback')}
 const close=ownedCleanup(entry,()=>{if(sync)gl.deleteSync(sync);gl.deleteBuffer(buffer);gl.deleteFramebuffer(fb)})
 try{
  const beforeRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),beforePack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),names=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS],packing=names.map(n=>gl.getParameter(n))
  try{backend.state.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,source.textureGPU,0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)return refuse('calibration read framebuffer is incomplete');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,WORDS*4,gl.STREAM_READ);names.forEach((n,i)=>gl.pixelStorei(n,i===0?1:0));gl.readPixels(0,0,SIZE,SIZE,gl.RGBA,gl.FLOAT,0);sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush()}
  finally{backend.state.bindFramebuffer(gl.READ_FRAMEBUFFER,beforeRead);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,beforePack);names.forEach((n,i)=>gl.pixelStorei(n,packing[i]))}
  if(!sync)return refuse('cannot create decoder calibration fence')
  const deadline=now()+5000
  await new Promise<void>((resolve,reject)=>{const poll=()=>{if(entry.invalid){reject(Error('Ellipse scene frame: decoder certificate expired during calibration'));return}if(gl.isContextLost()){reject(Error('Ellipse scene frame: context lost during decoder calibration'));return}const status=gl.clientWaitSync(sync,0,0);if(status===gl.WAIT_FAILED){reject(Error('Ellipse scene frame: decoder calibration fence failed'));return}if(status===gl.TIMEOUT_EXPIRED){if(now()>deadline){reject(Error('Ellipse scene frame: decoder calibration timed out'));return}setTimeout(poll,4);return}resolve()};poll()})
  const result=new Float32Array(WORDS),thenPack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
  try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,result)}finally{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,thenPack)}
  return result
 }finally{close()}
}
/** A previously saved original dispose can bypass our hook. Retain only
 * actual owned allocations so an erased Three manager cannot strand them. */
function capturePhysical(renderer:any,entry:Entry,source:DataTexture,target:RenderTarget):()=>void{
 const backend=renderer.backend,manager=entry.textureManager,owned:any[]=[]
 for(const texture of[source,target.texture]){
  if(manager.has?.(texture)!==true||manager.get(texture).isDefaultTexture)return refuse('calibration requires actual owned texture allocations')
  owned.push(backend.get(texture))
 }
 if(backend.isWebGPUBackend){const handles=new Set(owned.flatMap(data=>[data.texture,data.msaaTexture]).filter(Boolean));return()=>{for(const handle of handles)handle.destroy()}}
 const gl=backend.gl,handles=new Set(owned.map(data=>data.textureGPU).filter(Boolean)),rt=backend.get(target),framebuffers=new Set([...Object.values(rt.framebuffers??{}),...(rt.msaaFrameBuffer?[rt.msaaFrameBuffer]:[])].filter(Boolean))
 return()=>{for(const framebuffer of framebuffers)gl.deleteFramebuffer(framebuffer);for(const handle of handles)gl.deleteTexture(handle)}
}
async function calibrate(renderer:any,entry:Entry):Promise<EllipseSceneDecoder>{
 const start=now(),raw=new Uint16Array(WORDS);let sweep=now()
 for(let i=0;i<SIZE*SIZE;i++){for(let c=0;c<4;c++)raw[i*4+c]=rawHalf(i,c);if((i&4095)===4095&&now()-sweep>4){await new Promise<void>(done=>setTimeout(done,0));assertEntry(renderer,entry);sweep=now()}}
 const texture=new DataTexture(raw,SIZE,SIZE,RGBAFormat,HalfFloatType),target=new RenderTarget(SIZE,SIZE,{type:FloatType,format:RGBAFormat,depthBuffer:false}),material=new NodeMaterial(),viewport=new Vector4(),scissor=new Vector4()
 texture.colorSpace=NoColorSpace;texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.flipY=false;texture.needsUpdate=true;target.texture.colorSpace=NoColorSpace
 material.fragmentNode=textureLoad!(texture,ivec2!(floor!(uv!().mul(SIZE))));material.toneMapped=false
 const quad=new QuadMesh(material)
 let fallbackPhysical=()=>{}
 const close=ownedCleanup(entry,()=>{const lost=entry.textureManager?.data!==entry.textureEpoch;try{material.dispose()}finally{try{texture.dispose()}finally{try{target.dispose()}finally{if(lost)fallbackPhysical()}}}})
 try{
  assertEntry(renderer,entry);renderer.getViewport(viewport);renderer.getScissor(scissor)
  const state=RendererUtils.resetRendererState(renderer,undefined as never)
  let pending:Promise<any>
  try{renderer.setRenderTarget(target);renderer.setViewport(0,0,SIZE,SIZE);renderer.setScissor(0,0,SIZE,SIZE);renderer.setScissorTest(false);quad.render(renderer);fallbackPhysical=capturePhysical(renderer,entry,texture,target);pending=readCalibration(renderer,target,entry)}
  finally{RendererUtils.restoreRendererState(renderer,state);renderer.setViewport(viewport);renderer.setScissor(scissor)}
  // Renderer state is restored synchronously, before this first GPU await.
  const data=await pending!;assertEntry(renderer,entry)
  if(!(data instanceof Float32Array)||data.length!==WORDS)return refuse('decoder calibration requires exact RGBA32F readback extent')
  const words=new Uint32Array(data.buffer,data.byteOffset,data.length);let normal=true,flipped=true;sweep=now()
  for(let i=0;i<SIZE*SIZE;i++){
   const x=i%SIZE,y=Math.floor(i/SIZE),opposite=(SIZE-1-y)*SIZE+x
   for(let c=0;c<4;c++){const expected=ellipseHalfDecodedWord(rawHalf(i,c));if(words[i*4+c]!==expected)normal=false;if(words[opposite*4+c]!==expected)flipped=false}
   if(!normal&&!flipped)return refuse('unqualified HalfFloat decoder: NaN/sign/encoding words differ from the closed model')
   if((i&4095)===4095&&now()-sweep>4){await new Promise<void>(done=>setTimeout(done,0));assertEntry(renderer,entry);sweep=now()}
  }
  const certificate=Object.freeze({report:Object.freeze({model:'half-decoder-canonical-nan-v1' as const,words:WORDS,milliseconds:now()-start,nominalTransientBytes:4_194_304,readbackFlipped:!normal&&flipped})})
  certificates.set(certificate,entry);return certificate
 }finally{close()}
}
function expire(renderer:any,entry:Entry):void{entry.invalid=true;if(cache.get(renderer)===entry)cache.delete(renderer);entry.detach();for(const cleanup of [...entry.cleanups]){try{cleanup()}catch{ /* Release the remaining owned objects even after device/context loss. */ }}}
function lifecycleInvalidator(weak:WeakRef<any>,epoch:symbol):()=>void{return()=>{const owner=weak.deref(),active=owner&&cache.get(owner);if(active&&active.epoch===epoch&&!active.invalid)expire(owner,active)}}
/** One owned calibration per actual renderer/device/context lifecycle. Cancellation
 * detaches the caller; shared GPU work still restores state and disposes resources. */
export function prepareEllipseSceneDecoder(renderer:any,signal?:AbortSignal):Promise<EllipseSceneDecoder>{
 signal?.throwIfAborted();const currentToken=token(renderer);let entry=cache.get(renderer)
 if(entry&&(entry.invalid||renderer.dispose!==entry.disposeHook||entry.backend!==renderer.backend||entry.token!==currentToken||renderer._textures!==entry.textureManager||renderer._textures?.data!==entry.textureEpoch)){expire(renderer,entry);entry=undefined}
 if(!entry){
  const original=renderer.dispose,weak=new WeakRef(renderer),element=renderer.domElement,epoch=Symbol('ellipse-decoder')
  const fresh={} as Entry
  // Device.lost can remain pending for an application's entire device lifetime.
  // Its callback captures only a WeakRef and an epoch, never this cache entry.
  const invalidate=lifecycleInvalidator(weak,epoch)
  const wrapped=function(this:any,...args:any[]){invalidate();return original.apply(this,args)}
  const contextLost=()=>invalidate()
  fresh.backend=renderer.backend;fresh.token=currentToken;fresh.invalid=false;fresh.epoch=epoch;fresh.disposeHook=wrapped;fresh.cleanups=new Set();fresh.textureManager=renderer._textures;fresh.textureEpoch=renderer._textures?.data
  fresh.detach=()=>{const owner=weak.deref();if(owner?.dispose===wrapped)owner.dispose=original;element?.removeEventListener?.('webglcontextlost',contextLost)}
  renderer.dispose=wrapped;element?.addEventListener?.('webglcontextlost',contextLost)
  if(renderer.backend.isWebGPUBackend)void currentToken.lost?.then(invalidate,invalidate)
  cache.set(renderer,fresh);fresh.promise=calibrate(renderer,fresh).catch(error=>{invalidate();throw error});entry=fresh
 }
 if(!signal)return entry.promise
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason??new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});entry!.promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort()})
}
export interface EllipseSceneFrameBinding {readonly model:'renderer-owned-half-frame-v1'}
interface Frame {renderer:any;pass:any;decoder:EllipseSceneDecoder;entry:Entry;image:TslEffectNode;size:any;drawing:Vector2;disposed:boolean}
const frames=new WeakMap<object,Frame>()
function frame(binding:EllipseSceneFrameBinding):Frame{return frames.get(binding)??refuse('requires a renderer-owned frame binding, not a resolver or payload flag')}
function assertFrame(value:Frame,renderer:any,checkExtent=false):void{
 if(value.disposed||renderer!==value.renderer)return refuse('frame binding was disposed or belongs to another renderer')
 assertEntry(renderer,value.entry)
 const pass=value.pass,target=pass.renderTarget
 if(!(pass instanceof PassNode)||(pass as any).options.samples!==0||target.samples!==0||target.texture.type!==HalfFloatType||target.texture.format!==RGBAFormat||target.texture.colorSpace!==NoColorSpace||renderer.getOutputBufferType()!==HalfFloatType||renderer.xr?.isPresenting)return refuse('requires the owned HalfFloat RGBA, MSAA0, linear full-frame ScenePass')
 if(checkExtent){
  const allocation=renderer.backend.get(target.texture),gl=renderer.backend.gl
  if(target.textures.length!==1||(renderer.backend.isWebGPUBackend?(allocation.textureDescriptorGPU?.format!=='rgba16float'||allocation.msaaTexture):(allocation.glInternalFormat!==gl.RGBA16F||allocation.glFormat!==gl.RGBA||allocation.glType!==gl.HALF_FLOAT)))return refuse('ScenePass actual attachment is outside its single-sample RGBA16F decoder profile')
  renderer.getDrawingBufferSize(value.drawing);if(!Number.isInteger(value.drawing.x)||!Number.isInteger(value.drawing.y)||value.drawing.x<2||value.drawing.y<2||value.drawing.x>8192||value.drawing.y>8192||target.width!==value.drawing.x||target.height!==value.drawing.y)return refuse('ScenePass and physical output extents must match within [2,8192]');value.size.copy(value.drawing)}
}
/** The cloned PassTextureNode retains native pass scheduling and backend flip,
 * while integer load forbids filtering across exceptional or neighboring pixels. */
export function createEllipseSceneFrameBinding(renderer:any,pass:any,decoder:EllipseSceneDecoder):EllipseSceneFrameBinding{
 const entry=certificates.get(decoder)??refuse('missing immutable decoder certificate'),binding=Object.freeze({model:'renderer-owned-half-frame-v1' as const}),size=new Vector2(),value={renderer,pass,decoder,entry,size,drawing:new Vector2(),disposed:false,image:null as TslEffectNode}
 assertFrame(value,renderer);const dimensions=uniform!(size,'ivec2').onRenderUpdate((f:any)=>{assertFrame(value,f.renderer,true);return size})
 value.image=textureLoad!(pass.getTextureNode(),ivec2!(floor!(uv!().mul(dimensions)))).toVar().onRenderUpdate((f:any)=>{assertFrame(value,f.renderer,true)})
 frames.set(binding,value);return binding
}
export function assertEllipseSceneFrameBinding(binding:EllipseSceneFrameBinding|undefined):asserts binding is EllipseSceneFrameBinding{if(!binding)return refuse('requires a renderer-owned frame binding');const value=frame(binding);assertFrame(value,value.renderer)}
export function resolveEllipseSceneFrame(binding:EllipseSceneFrameBinding,request:NonNullable<SourceCompositorOperation['pass']>):TslEffectNode{
 const value=frame(binding);assertFrame(value,value.renderer);return request.pass==='Image'?value.image:request.pass==='Alpha'?value.image.a:refuse('only direct Image or Alpha is qualified')
}
export function disposeEllipseSceneFrameBinding(binding:EllipseSceneFrameBinding):void{const value=frame(binding);value.disposed=true}
