import{afterEach,describe,expect,it,vi}from'vitest'
import{Color,DataTexture,HalfFloatType,FloatType,RenderTarget,Scene,PerspectiveCamera,Vector4}from'three'
import{QuadMesh}from'three/webgpu'
import{pass}from'three/tsl'
import{prepareEllipseSceneDecoder,ellipseHalfDecodedWord,ELLIPSE_HALF_DECODER_MODELS,type EllipseHalfDecoderModel,createEllipseSceneFrameBinding,assertEllipseSceneFrameBinding,resolveEllipseSceneFrame,disposeEllipseSceneFrameBinding}from'./tslCompositorSceneFrame.js'
const deferred=()=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const decoded=(model:EllipseHalfDecoderModel='half-decoder-canonical-nan-v1')=>{const words=new Uint32Array(256*256*4);for(let i=0;i<65536;i++)for(let c=0;c<4;c++)words[i*4+c]=ellipseHalfDecodedWord(c===0?i:c===1?(i+21845)&65535:c===2?(i+43690)&65535:i^32768,model);return words.buffer}
function rendererBase(backend:any){
 let target:any={name:'prior target'},viewport=new Vector4(3,4,21,22),scissor=new Vector4(5,6,11,12),pixelRatio=2,mrt:any={name:'prior MRT'},object:any=()=>{},clear=new Color(.2,.3,.4),alpha=.25,scissorTest=true
 const renderer:any={_textures:{data:new WeakMap(),has:()=>true,get:()=>({isDefaultTexture:false})},backend,isWebGPURenderer:true,domElement:new EventTarget(),toneMapping:7,toneMappingExposure:.75,outputColorSpace:'prior',autoClear:false,dispose:vi.fn(),getOutputBufferType:()=>HalfFloatType,xr:{isPresenting:false},getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>target,setRenderTarget:(v:any)=>{target=v},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getRenderObjectFunction:()=>object,setRenderObjectFunction:(v:any)=>{object=v},getPixelRatio:()=>pixelRatio,setPixelRatio:(v:number)=>{pixelRatio=v},getMRT:()=>mrt,setMRT:(v:any)=>{mrt=v},getClearColor:(v:Color)=>v.copy(clear),getClearAlpha:()=>alpha,setClearColor:(v:any,a:number)=>{clear.set(v);alpha=a},getScissorTest:()=>scissorTest,setScissorTest:(v:boolean)=>{scissorTest=v},getViewport:(v:Vector4)=>v.copy(viewport),getScissor:(v:Vector4)=>v.copy(scissor),setViewport:(...v:any[])=>{viewport=v[0]?.isVector4?v[0].clone():new Vector4(...v as[number,number,number,number])},setScissor:(...v:any[])=>{scissor=v[0]?.isVector4?v[0].clone():new Vector4(...v as[number,number,number,number])}}
 const snapshot=()=>({target,viewport:viewport.toArray(),scissor:scissor.toArray(),pixelRatio,mrt,object,clear:clear.toArray(),alpha,scissorTest,toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,autoClear:renderer.autoClear})
 return{renderer,snapshot}
}
// Lifecycle mutations below wait for actual mocked readback entry, rather than
// assuming the bounded CPU table fill never yields under parallel test load.
function gpu(model:EllipseHalfDecoderModel='half-decoder-canonical-nan-v1'){const gate=deferred(),lost=deferred(),mapStarted=deferred(),buffer={mapAsync:vi.fn(()=>{mapStarted.resolve();return gate.promise}),getMappedRange:vi.fn(()=>decoded(model)),destroy:vi.fn()},device={lost:lost.promise,createBuffer:vi.fn(()=>buffer),createCommandEncoder:()=>({copyTextureToBuffer:vi.fn(),finish:()=>({})}),queue:{submit:vi.fn()}},allocations:any[]=[],allocated=new WeakMap(),backend={isWebGPUBackend:true,device,get:(texture:any)=>{if(!allocated.has(texture)){const data={texture:{destroy:vi.fn()},textureDescriptorGPU:{format:texture?.type===HalfFloatType?'rgba16float':'rgba32float'}};allocated.set(texture,data);allocations.push(data)}return allocated.get(texture)}};return{...rendererBase(backend),gate,lost,mapStarted:mapStarted.promise,buffer,device,allocations}}
function glRenderer(){const readStarted=deferred();let lost=false,ready=false;const slots=new Map<any,any>(),gl:any={};for(const key of['READ_FRAMEBUFFER_BINDING','PIXEL_PACK_BUFFER_BINDING','PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS','READ_FRAMEBUFFER','COLOR_ATTACHMENT0','TEXTURE_2D','FRAMEBUFFER_COMPLETE','PIXEL_PACK_BUFFER','STREAM_READ','RGBA','FLOAT','SYNC_GPU_COMMANDS_COMPLETE','WAIT_FAILED','TIMEOUT_EXPIRED','CONDITION_SATISFIED','RGBA32F','RGBA16F','HALF_FLOAT'])gl[key]=key
 slots.set(gl.READ_FRAMEBUFFER_BINDING,{name:'prior read framebuffer'});slots.set(gl.PIXEL_PACK_BUFFER_BINDING,{name:'prior pack buffer'});for(const[k,n]of[[gl.PACK_ALIGNMENT,8],[gl.PACK_ROW_LENGTH,17],[gl.PACK_SKIP_PIXELS,3],[gl.PACK_SKIP_ROWS,2]])slots.set(k,n)
 Object.assign(gl,{isContextLost:()=>lost,getParameter:(n:any)=>slots.get(n),createFramebuffer:vi.fn(()=>({name:'owned read framebuffer'})),createBuffer:vi.fn(()=>({name:'owned PBO'})),deleteFramebuffer:vi.fn(),deleteBuffer:vi.fn(),deleteSync:vi.fn(),framebufferTexture2D:vi.fn(),checkFramebufferStatus:()=>gl.FRAMEBUFFER_COMPLETE,bindBuffer:(_:any,v:any)=>slots.set(gl.PIXEL_PACK_BUFFER_BINDING,v),bufferData:vi.fn(),pixelStorei:(n:any,v:any)=>slots.set(n,v),readPixels:vi.fn(),fenceSync:vi.fn(()=>{readStarted.resolve();return{name:'owned fence'}}),flush:vi.fn(),clientWaitSync:()=>ready?gl.CONDITION_SATISFIED:gl.TIMEOUT_EXPIRED,getBufferSubData:vi.fn((_:any,_offset:number,out:Float32Array)=>out.set(new Float32Array(decoded())))})
 const backend={isWebGLBackend:true,gl,state:{bindFramebuffer:(_:any,value:any)=>slots.set(gl.READ_FRAMEBUFFER_BINDING,value)},get:()=>({textureGPU:{},glInternalFormat:gl.RGBA32F,glFormat:gl.RGBA,glType:gl.FLOAT})}
 return{...rendererBase(backend),gl,slots,readStarted:readStarted.promise,ready:()=>{ready=true},lose:()=>{lost=true},packing:()=>Object.fromEntries([...slots])}
}
afterEach(()=>vi.restoreAllMocks())
describe('owned scene-frame Half decoder calibration',()=>{
 it('declares exact signed zeros, normal/subnormal-half values, infinities and canonical NaNs',()=>{for(const[h,f]of[[0,0],[0x8000,0x80000000],[1,0x33800000],[0x3ff,0x387fc000],[0x400,0x38800000],[0x3c00,0x3f800000],[0x7bff,0x477fe000],[0x7c00,0x7f800000],[0xfc00,0xff800000],[0x7c01,0x7fc00000],[0xfe55,0x7fc00000]])expect(ellipseHalfDecodedWord(h!)).toBe(f)})
 it.each(ELLIPSE_HALF_DECODER_MODELS)('certifies only the complete %s table and expires its immutable certificate',async model=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(model),pending=prepareEllipseSceneDecoder(g.renderer);g.gate.resolve();const certificate=await pending;expect(certificate.report.model).toBe(model);expect(Object.isFrozen(certificate)).toBe(true);expect(Object.isFrozen(certificate.report)).toBe(true);expect(await prepareEllipseSceneDecoder(g.renderer)).toBe(certificate)
  const p=pass(new Scene(),new PerspectiveCamera(),{samples:0}),binding=createEllipseSceneFrameBinding(g.renderer,p,certificate);assertEllipseSceneFrameBinding(binding);g.lost.resolve();await Promise.resolve();expect(()=>assertEllipseSceneFrameBinding(binding)).toThrow(/expired/);p.dispose()
 })
 it('preserves the exact sign/payload/signaling mapping while finite/zero/Inf words remain unchanged',()=>{
  for(const raw of[0,0x8000,1,0x3ff,0x400,0x3c00,0x7bff,0x7c00,0xfc00])expect(ellipseHalfDecodedWord(raw,'half-decoder-payload-sign-signaling-v1')).toBe(ellipseHalfDecodedWord(raw))
  for(const[h,f]of[[0x7c01,0x7f802000],[0x7dff,0x7fbfe000],[0x7e00,0x7fc00000],[0x7fff,0x7fffe000],[0xfc01,0xff802000],[0xffff,0xffffe000]])expect(ellipseHalfDecodedWord(h!,'half-decoder-payload-sign-signaling-v1')).toBe(f)
  expect(()=>ellipseHalfDecodedWord(0,'any-nan' as any)).toThrow(/unknown exact/)
 })
 it('rejects mixed NaN tables, quieted/unknown payloads and finite/zero/Inf drift without a certificate',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{})
  const changes=[(a:Uint32Array)=>{a[0x7c01*4]=0x7fc00000},(a:Uint32Array)=>{a[0x7c01*4]=0x7fc02000},(a:Uint32Array)=>{a[0x7c01*4]^=1},(a:Uint32Array)=>{a[4]^=1},(a:Uint32Array)=>{a[0]=0x80000000},(a:Uint32Array)=>{a[3]=0},(a:Uint32Array)=>{a[0x7c00*4]=0x7f7fffff}]
  for(const change of changes){const g=gpu('half-decoder-payload-sign-signaling-v1'),data=new Uint32Array(decoded('half-decoder-payload-sign-signaling-v1'));change(data);g.buffer.getMappedRange.mockReturnValue(data.buffer);const original=g.renderer.dispose,pending=prepareEllipseSceneDecoder(g.renderer);g.gate.resolve();await expect(pending).rejects.toThrow(/unqualified HalfFloat decoder/);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);expect(g.renderer.dispose).toBe(original)}
 })
 it('shares concurrent work, restores state before awaiting, and detaches a canceled caller',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{})
  const g=gpu(),before=g.snapshot(),original=g.renderer.dispose,controller=new AbortController(),canceled=prepareEllipseSceneDecoder(g.renderer,controller.signal),survivor=prepareEllipseSceneDecoder(g.renderer),same=prepareEllipseSceneDecoder(g.renderer);expect(survivor).toBe(same)
  await g.mapStarted
  expect(g.snapshot()).toEqual(before);expect(g.buffer.destroy).not.toHaveBeenCalled();const rejection=expect(canceled).rejects.toThrow();controller.abort();await rejection
  g.renderer.setRenderTarget({name:'prior pipeline kept rendering'});g.renderer.setViewport(1,2,3,4);const during=g.snapshot();g.gate.resolve();const certificate=await survivor
  expect(g.snapshot()).toEqual(during);expect(certificate.report.words).toBe(262144);expect(certificate.report.nominalTransientBytes).toBe(4194304);expect(g.device.createBuffer).toHaveBeenCalledTimes(1);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);expect(await prepareEllipseSceneDecoder(g.renderer)).toBe(certificate)
  g.renderer.dispose();expect(original).toHaveBeenCalledTimes(1);expect(g.renderer.dispose).toBe(original)
 })
 it('destroys pending owned draw/readback resources before an external-device renderer resets its managers',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu();let managerAlive=true
  const resourceDispose=vi.spyOn(DataTexture.prototype,'dispose').mockImplementation(()=>{expect(managerAlive).toBe(true)})
  g.buffer.destroy.mockImplementation(()=>{expect(managerAlive).toBe(true);g.gate.reject(Error('owned staging destroyed'))})
  const original=vi.fn(()=>{expect(resourceDispose).toHaveBeenCalledTimes(1);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);managerAlive=false});g.renderer.dispose=original
  const pending=prepareEllipseSceneDecoder(g.renderer);await g.mapStarted;g.renderer.dispose();await expect(pending).rejects.toThrow(/destroyed|expired/);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);expect(resourceDispose).toHaveBeenCalledTimes(1);expect(original).toHaveBeenCalledTimes(1);expect(g.renderer.dispose).toBe(original)
 })
 it('detects a saved original dispose and destroys captured physical allocations after the manager epoch resets',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu();let alive=true
  g.renderer.dispose=vi.fn(()=>{alive=false;g.renderer._textures.data=new WeakMap()});const saved=g.renderer.dispose.bind(g.renderer),pending=prepareEllipseSceneDecoder(g.renderer)
  await g.mapStarted;saved();expect(alive).toBe(false);g.gate.resolve();await expect(pending).rejects.toThrow(/allocation-epoch|expired/);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);expect(g.allocations).toHaveLength(2);for(const data of g.allocations)expect(data.texture.destroy).toHaveBeenCalledTimes(1)
 })
 it('does not double-destroy physical handles when an intact captured manager is replaced',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(),captured=g.renderer._textures,pending=prepareEllipseSceneDecoder(g.renderer)
  await g.mapStarted
  vi.spyOn(DataTexture.prototype,'dispose').mockImplementation(()=>g.allocations[0].texture.destroy());vi.spyOn(RenderTarget.prototype,'dispose').mockImplementation(()=>g.allocations[1].texture.destroy())
  g.renderer._textures={...captured,data:new WeakMap()};g.gate.resolve();await expect(pending).rejects.toThrow(/allocation-epoch|expired/);for(const data of g.allocations)expect(data.texture.destroy).toHaveBeenCalledTimes(1);expect(g.buffer.destroy).toHaveBeenCalledTimes(1)
 })
 it('destroys staging on map failure and restores its owned dispose hook',async()=>{vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(),before=g.snapshot(),original=g.renderer.dispose,p=prepareEllipseSceneDecoder(g.renderer);await g.mapStarted;g.gate.reject(Error('map failed'));await expect(p).rejects.toThrow('map failed');expect(g.snapshot()).toEqual(before);expect(g.buffer.destroy).toHaveBeenCalledTimes(1);expect(g.renderer.dispose).toBe(original)})
 it('invalidates existing bindings on device loss and refuses payload-only certificates',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(),promise=prepareEllipseSceneDecoder(g.renderer);g.gate.resolve();const certificate=await promise,p=pass(new Scene(),new PerspectiveCamera(),{samples:0}),binding=createEllipseSceneFrameBinding(g.renderer,p,certificate)
  expect(()=>assertEllipseSceneFrameBinding({model:'renderer-owned-half-frame-v1'})).toThrow(/renderer-owned/)
  expect(()=>createEllipseSceneFrameBinding(g.renderer,p,{report:certificate.report})).toThrow(/certificate/)
  assertEllipseSceneFrameBinding(binding);g.lost.resolve();await Promise.resolve();expect(()=>assertEllipseSceneFrameBinding(binding)).toThrow(/expired/);p.dispose()
 })
 it('keeps replacement dispose wrappers intact while invalidating their previous certificate',async()=>{vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(),pending=prepareEllipseSceneDecoder(g.renderer);g.gate.resolve();const certificate=await pending,p=pass(new Scene(),new PerspectiveCamera(),{samples:0}),binding=createEllipseSceneFrameBinding(g.renderer,p,certificate),owned=g.renderer.dispose,replacement=vi.fn(function(this:any){return owned.call(this)});g.renderer.dispose=replacement;expect(()=>assertEllipseSceneFrameBinding(binding)).toThrow(/expired/);g.renderer.dispose();expect(g.renderer.dispose).toBe(replacement);p.dispose()})
 it('uses raw integer pass texels, rejects changed attachment/extent, and disposes the binding',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=gpu(),pending=prepareEllipseSceneDecoder(g.renderer);g.gate.resolve();const certificate=await pending,p=pass(new Scene(),new PerspectiveCamera(),{samples:0}),binding=createEllipseSceneFrameBinding(g.renderer,p,certificate);p.setSize(13,9);const node=resolveEllipseSceneFrame(binding,{scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA'});node.update({renderer:g.renderer});p.renderTarget.texture.type=FloatType;expect(()=>node.update({renderer:g.renderer})).toThrow(/HalfFloat/);p.renderTarget.texture.type=HalfFloatType;p.setSize(17,13);expect(()=>node.update({renderer:g.renderer})).toThrow(/extents/);disposeEllipseSceneFrameBinding(binding);expect(()=>assertEllipseSceneFrameBinding(binding)).toThrow(/disposed/);p.dispose();g.renderer.dispose()
 })
 it('restores WebGL read/PACK state before its fence and the then-current PBO after extraction',async()=>{
  vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=glRenderer(),before=g.snapshot(),packing=g.packing(),pending=prepareEllipseSceneDecoder(g.renderer);await g.readStarted;expect(g.snapshot()).toEqual(before);expect(g.packing()).toEqual(packing)
  const current={name:'current frame PBO'};g.slots.set(g.gl.PIXEL_PACK_BUFFER_BINDING,current);const read={name:'current frame read framebuffer'};g.slots.set(g.gl.READ_FRAMEBUFFER_BINDING,read);g.ready();await pending;expect(g.slots.get(g.gl.PIXEL_PACK_BUFFER_BINDING)).toBe(current);expect(g.slots.get(g.gl.READ_FRAMEBUFFER_BINDING)).toBe(read);expect(g.gl.deleteBuffer).toHaveBeenCalledTimes(1);expect(g.gl.deleteSync).toHaveBeenCalledTimes(1);expect(g.gl.deleteFramebuffer).toHaveBeenCalledTimes(1);g.renderer.dispose()
 })
 it('closes all WebGL staging objects after context loss during the asynchronous wait',async()=>{vi.spyOn(QuadMesh.prototype,'render').mockImplementation(()=>{});const g=glRenderer(),pending=prepareEllipseSceneDecoder(g.renderer);await g.readStarted;g.lose();g.renderer.domElement.dispatchEvent(new Event('webglcontextlost'));await expect(pending).rejects.toThrow(/context lost|expired/);expect(g.gl.deleteBuffer).toHaveBeenCalledTimes(1);expect(g.gl.deleteSync).toHaveBeenCalledTimes(1);expect(g.gl.deleteFramebuffer).toHaveBeenCalledTimes(1)})
})
