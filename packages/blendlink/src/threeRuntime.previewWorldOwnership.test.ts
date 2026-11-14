import {afterEach,describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {PMREMGenerator as NodePmrem} from 'three/webgpu'
import Textures from 'three/src/renderers/common/Textures.js'
import Info from 'three/src/renderers/common/Info.js'
import {installLoadedThreeCompiledScene,prepareLoadedThreeCompiledScene} from './threeRuntime.js'
import type {CompiledSceneDescriptor} from './runtime.js'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
const descriptor:CompiledSceneDescriptor={url:'/world.glb',nodes:{},playback:{start:'manual',loop:'repeat',speed:1},
 look:{toneMapping:'application',exposure:0,background:'application'},authoringPreview:{look:{toneMapping:'none',exposure:0,sourceViewTransform:'Raw',exact:true},shadows:{enabled:false},world:{color:[.1,.2,.3],strength:2,exact:true,source:'background'}}}
function loaded():GLTF {const root=new THREE.Group();return{scene:root,scenes:[root],animations:[],cameras:[],asset:{},parser:{json:{asset:{version:'2.0'}},plugins:{},extensions:{},options:{}},userData:{}} as unknown as GLTF}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return{promise,resolve}}
function renderer(node=false){
 let target:THREE.RenderTarget|null=new THREE.RenderTarget(7,5),face=2,mip=1,alpha=.75,test=true
 const viewport=new THREE.Vector4(1,2,30,40),scissor=new THREE.Vector4(2,3,20,30)
 let initialized=!node
 return{isWebGLRenderer:!node,isWebGPURenderer:node,domElement:{clientWidth:640,clientHeight:360},toneMapping:THREE.NoToneMapping,toneMappingExposure:.5,
  capabilities:{getMaxAnisotropy:()=>8},shadowMap:{enabled:false,autoUpdate:false,needsUpdate:false,type:0},extensions:{has:()=>false,get:()=>null},xr:{enabled:true},autoClear:true,
  setClearAlpha:(v:number)=>{alpha=v},getClearAlpha:()=>alpha,getContextAttributes:()=>({alpha:true}),setSize:vi.fn(),render:vi.fn(),initTexture:vi.fn(),compileAsync:vi.fn(async()=>{}),
  hasInitialized:()=>initialized,init:vi.fn(async()=>{initialized=true}),
  getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget:vi.fn((v:THREE.RenderTarget|null,f=0,m=0)=>{target=v;face=f;mip=m}),
  getViewport:(v:THREE.Vector4)=>v.copy(viewport),setViewport:vi.fn((v:THREE.Vector4)=>{viewport.copy(v)}),
  getScissor:(v:THREE.Vector4)=>v.copy(scissor),setScissor:vi.fn((v:THREE.Vector4)=>{scissor.copy(v)}),getScissorTest:()=>test,setScissorTest:vi.fn((v:boolean)=>{test=v})}
}
function result(){const t=new THREE.WebGLRenderTarget(336,64,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,colorSpace:THREE.LinearSRGBColorSpace,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:false});t.texture.mapping=THREE.CubeUVReflectionMapping;t.texture.name='PMREM.cubeUv';return t}
function fixture(node=false){
 const render=renderer(node),scene=new THREE.Scene(),hostEnvironment=new THREE.Texture(),hostBackground=new THREE.Color(0x123456)
 scene.environment=hostEnvironment;scene.background=hostBackground;scene.environmentIntensity=.25
 const sources:THREE.DataTexture[]=[],targets:THREE.RenderTarget[]=[],sourceDisposes=vi.fn(),targetDisposes=vi.fn()
 const proto=node?NodePmrem.prototype:THREE.PMREMGenerator.prototype
 const compile=vi.spyOn(proto,'compileEquirectangularShader').mockImplementation(()=>undefined as never)
 const scratch=vi.spyOn(proto,'dispose').mockImplementation(()=>{})
 const generate=vi.spyOn(proto,'fromEquirectangular').mockImplementation((input,destination)=>{
  const source=input as THREE.DataTexture;sources.push(source);source.addEventListener('dispose',sourceDisposes)
  const target=destination??result();targets.push(target);target.addEventListener('dispose',targetDisposes)
  render.setRenderTarget(target as THREE.RenderTarget);render.xr.enabled=false;render.autoClear=false
  return target as never
 })
 const options={descriptor,renderer:render as unknown as THREE.WebGLRenderer,scene,useAuthoringPreview:true,prewarm:false}
 return{render,scene,hostEnvironment,hostBackground,sources,targets,sourceDisposes,targetDisposes,compile,scratch,generate,options}
}
afterEach(()=>vi.restoreAllMocks())
describe('owned preview-world PMREM',()=>{
 it.each([false,true])('owns the exact source/result/scratch and restores public state (node=%s)',async node=>{
  const f=fixture(node),before=Object.getOwnPropertyDescriptor(f.render,'setRenderTarget'),hostTarget=f.render.getRenderTarget(),hostDispose=vi.spyOn(hostTarget!,'dispose')
  const installed=await installLoadedThreeCompiledScene(loaded(),f.options)
  expect(f.generate).toHaveBeenCalledOnce();expect(f.compile).not.toHaveBeenCalled();expect(f.scratch).toHaveBeenCalledOnce();expect(f.sourceDisposes).toHaveBeenCalledOnce()
  const source=f.sources[0]!;expect(source).toMatchObject({name:'SceneToWeb Preview World',type:THREE.FloatType,format:THREE.RGBAFormat,mapping:THREE.EquirectangularReflectionMapping,colorSpace:THREE.LinearSRGBColorSpace,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false})
  expect(source.image).toMatchObject({width:64,height:32});expect(source.image.data).toEqual(new Float32Array(Array.from({length:2048},()=>[.2,.4,.6,1]).flat()))
  expect(f.scene.environment).toBe(f.targets[0]!.texture);expect(f.scene.background).toBeInstanceOf(node?THREE.Color:THREE.CubeTexture)
  expect(f.render.getRenderTarget()).toBe(hostTarget);expect(f.render.getActiveCubeFace()).toBe(2);expect(f.render.getActiveMipmapLevel()).toBe(1);expect(f.render.xr.enabled).toBe(true);expect(f.render.autoClear).toBe(true)
  expect(Object.getOwnPropertyDescriptor(f.render,'setRenderTarget')).toEqual(before)
  if(node){expect(f.render.init).toHaveBeenCalledOnce();expect(f.render.setViewport).not.toHaveBeenCalled();expect(f.render.setScissor).not.toHaveBeenCalled();expect(f.generate.mock.calls[0]![1]).toBe(f.targets[0])}
  installed.dispose();installed.dispose();expect(f.targetDisposes).toHaveBeenCalledOnce();expect(hostDispose).not.toHaveBeenCalled();expect(f.scene.environment).toBe(f.hostEnvironment);expect(f.scene.background).toBe(f.hostBackground)
 })
 it('shares one ready output across detached and live ownership without commit-time generation',async()=>{
  const f=fixture(),seen:unknown[]=[];f.options.prewarm=true;f.render.compileAsync.mockImplementation(async(...args:unknown[])=>{seen.push((args[0] as THREE.Scene).environment)})
  const prepared=await prepareLoadedThreeCompiledScene(loaded(),f.options)
  expect(f.scene.environment).toBe(f.hostEnvironment);expect(seen).toEqual([f.targets[0]!.texture]);expect(f.generate).toHaveBeenCalledOnce()
  const installed=prepared.commit();expect(f.scene.environment).toBe(f.targets[0]!.texture);expect(f.generate).toHaveBeenCalledOnce();installed.dispose();prepared.dispose();expect(f.targetDisposes).toHaveBeenCalledOnce()
 })
 it('cancels awaited node renderer initialization before generation or publication',async()=>{
  const f=fixture(true),wait=deferred(),controller=new AbortController(),sourceDisposes=vi.fn()
  const original=THREE.DataTexture.prototype.dispose
  vi.spyOn(THREE.DataTexture.prototype,'dispose').mockImplementation(function(){if(this.name==='SceneToWeb Preview World')sourceDisposes();original.call(this)})
  f.render.init.mockImplementation(async()=>wait.promise)
  const preparing=prepareLoadedThreeCompiledScene(loaded(),{...f.options,signal:controller.signal});await vi.waitFor(()=>expect(f.render.init).toHaveBeenCalledOnce());controller.abort();wait.resolve()
  await expect(preparing).rejects.toMatchObject({code:'preparation-cancelled'});expect(f.generate).not.toHaveBeenCalled();expect(f.scratch).not.toHaveBeenCalled();expect(sourceDisposes).toHaveBeenCalledOnce();expect(f.scene.environment).toBe(f.hostEnvironment)
 })
 it.each([false,true])('retires a partially drawn result and restores host state on throw (node=%s)',async node=>{
  const f=fixture(node),hostTarget=f.render.getRenderTarget(),original=Object.getOwnPropertyDescriptor(f.render,'setRenderTarget'),foreignDispose=vi.spyOn(hostTarget!,'dispose'),generate=f.generate.getMockImplementation()!
  f.generate.mockImplementation((...args)=>{generate(...args);throw Error('GPU upload failed')})
  await expect(installLoadedThreeCompiledScene(loaded(),f.options)).rejects.toThrow('GPU upload failed')
  expect(f.targetDisposes).toHaveBeenCalledOnce();expect(f.sourceDisposes).toHaveBeenCalledOnce();expect(f.scratch).toHaveBeenCalledOnce();expect(foreignDispose).not.toHaveBeenCalled();expect(f.render.getRenderTarget()).toBe(hostTarget);expect(f.render.getActiveCubeFace()).toBe(2);expect(f.render.getActiveMipmapLevel()).toBe(1);expect(f.render.xr.enabled).toBe(true);expect(f.render.autoClear).toBe(true);expect(Object.getOwnPropertyDescriptor(f.render,'setRenderTarget')).toEqual(original)
 })
 it('retires the output if scratch cleanup fails before publication',async()=>{
  const f=fixture();f.scratch.mockImplementation(()=>{throw Error('Scratch cleanup failed')})
  await expect(installLoadedThreeCompiledScene(loaded(),f.options)).rejects.toThrow('Scratch cleanup failed')
  expect(f.targetDisposes).toHaveBeenCalledOnce();expect(f.sourceDisposes).toHaveBeenCalledOnce();expect(f.scratch).toHaveBeenCalledOnce();expect(f.scene.environment).toBe(f.hostEnvironment)
 })
 it('does not destroy an unexpected foreign returned target or a later renderer wrapper',async()=>{
  const f=fixture(),foreign=result(),disposeForeign=vi.spyOn(foreign,'dispose'),generate=f.generate.getMockImplementation()!,later=vi.fn()
  f.generate.mockImplementation((...args)=>{generate(...args);f.render.setRenderTarget=later;return foreign as never})
  await expect(installLoadedThreeCompiledScene(loaded(),f.options)).rejects.toThrow('different output target');expect(f.render.setRenderTarget).toBe(later);expect(disposeForeign).not.toHaveBeenCalled();expect(f.targetDisposes).toHaveBeenCalledOnce();expect(f.scratch).toHaveBeenCalledOnce()
 })
 it.each(['intensity','background'] as const)('hands a claimed %s environment to its later owner',async claim=>{
  const f=fixture(),installed=await installLoadedThreeCompiledScene(loaded(),f.options),texture=f.scene.environment!
  if(claim==='intensity')f.scene.environmentIntensity=.375
  else{f.scene.background=texture;f.scene.environment=new THREE.Texture()}
  installed.dispose();expect(f.targetDisposes).not.toHaveBeenCalled();texture.dispose();texture.dispose();expect(f.targetDisposes).toHaveBeenCalledOnce()
 })
 it('cleans an abandoned ready preparation and a generation aborted after drawing',async()=>{
  const f=fixture(),prepared=await prepareLoadedThreeCompiledScene(loaded(),f.options);prepared.dispose();prepared.dispose();expect(f.targetDisposes).toHaveBeenCalledOnce();expect(f.scene.environment).toBe(f.hostEnvironment)
  vi.restoreAllMocks();const g=fixture(),controller=new AbortController(),generate=g.generate.getMockImplementation()!;g.generate.mockImplementation((...args)=>{const target=generate(...args);controller.abort();return target})
  await expect(installLoadedThreeCompiledScene(loaded(),{...g.options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(g.targetDisposes).toHaveBeenCalledOnce();expect(g.scratch).toHaveBeenCalledOnce();expect(g.sourceDisposes).toHaveBeenCalledOnce()
 })
 it.each([false,true])('uses real Three attachment cleanup exactly once after adoption=%s',async adopt=>{
  const f=fixture(true),info=new Info(),records=new WeakMap<object,object>(),destroys=new Map<object,number>()
  const backend:any={get(t:object){let r=records.get(t);if(!r){r={};records.set(t,r)}return r},has:(t:object)=>records.has(t),delete:(t:object)=>records.delete(t),createTexture(t:object){records.set(t,{})},updateTexture(){},destroyTexture(t:object){destroys.set(t,(destroys.get(t)??0)+1);records.delete(t)},generateMipmaps(){throw Error('Unexpected mips')}}
  const manager=new Textures(f.render as any,backend,info),generate=f.generate.getMockImplementation()!
  f.generate.mockImplementation((...args)=>{const target=generate(...args);manager.updateRenderTarget(target as any);return target})
  const installed=await installLoadedThreeCompiledScene(loaded(),f.options),texture=f.scene.environment!
  expect(info.memory.textures).toBe(2);expect(info.memory.renderTargets).toBe(1)
  if(adopt)f.scene.environmentIntensity=.375
  installed.dispose();installed.dispose()
  if(adopt){expect(info.memory.textures).toBe(2);texture.dispose();texture.dispose()}
  expect(info.memory.textures).toBe(0);expect(info.memory.renderTargets).toBe(0);expect([...destroys.values()]).toEqual([1,1]);expect(manager.has(f.targets[0])).toBe(false)
 })

 it('preserves node background takeover, Film Transparent and explicit site ownership',async()=>{
  const f=fixture(true),priorNode={isNode:true};Object.assign(f.scene,{backgroundNode:priorNode})
  const installed=await installLoadedThreeCompiledScene(loaded(),f.options)
  expect(f.scene.background).toBeInstanceOf(THREE.Color);expect((f.scene as any).backgroundNode).toBe(priorNode)
  expect((f.scene.background as THREE.Color).toArray()).toEqual(Array.from(new Float32Array([.2,.4,.6])))
  const later=new THREE.Color(.75,.5,.25);f.scene.background=later;installed.dispose();expect(f.scene.background).toBe(later);expect((f.scene as any).backgroundNode).toBe(priorNode)
  vi.restoreAllMocks();const g=fixture(true),transparent={...descriptor,authoringPreview:{...descriptor.authoringPreview!,world:{...descriptor.authoringPreview!.world!,backgroundVisible:false}}}
  const hidden=await installLoadedThreeCompiledScene(loaded(),{...g.options,descriptor:transparent});expect(g.scene.background).toBe(g.hostBackground);expect(g.scene.environment).toBe(g.targets[0]!.texture);hidden.dispose()
  vi.restoreAllMocks();const h=fixture(true),site={...descriptor,look:{toneMapping:'application' as const,exposure:0,background:'color' as const,backgroundColor:[.75,.5,.25] as const}}
  const published=await installLoadedThreeCompiledScene(loaded(),{...h.options,descriptor:site});expect((h.scene.background as THREE.Color).toArray()).toEqual([.75,.5,.25]);published.dispose()
 })

 it.each(['webgpu','webgl2'] as const)('owns ready attachments across manager epochs and borrowed replacements (%s)',async api=>{
  for(const mode of['normal','reset','old-manager-intact','reset-after-normal','reset-before-normal','foreign-handle','foreign-target','adopt-normal','adopt-reset','adopt-foreign-handle','adopt-foreign-target']){
   vi.restoreAllMocks();const f=fixture(true),info=new Info(),data=new WeakMap<object,any>(),handles:any[]=[],foreign:any={destroys:0,destroy(){this.destroys++}},aux:any={destroys:0},foreignAux:any={destroys:0}
   const gl:any={deleteTexture:(h:any)=>{h.destroys++},deleteFramebuffer:(h:any)=>{h.destroys++},deleteRenderbuffer:(h:any)=>{h.destroys++}}
   const backend:any={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,
    get(t:object){let r=data.get(t);if(!r){r={};data.set(t,r)}return r},has:(t:object)=>data.has(t),delete:(t:object)=>data.delete(t),
    createTexture(t:any){const handle={destroys:0,destroy(){this.destroys++}};handles.push(handle);Object.assign(this.get(t),api==='webgpu'?{texture:handle}:{textureGPU:handle,renderTarget:t.renderTarget})},updateTexture(){},
    destroyTexture(t:any){const r=this.get(t);if(api==='webgpu')r.texture.destroy();else{gl.deleteTexture(r.textureGPU);const targetData=data.get(r.renderTarget);if(targetData?.framebuffers){for(const h of Object.values(targetData.framebuffers))gl.deleteFramebuffer(h);delete targetData.framebuffers}}data.delete(t)},generateMipmaps(){throw Error('Unexpected mips')}}
   const manager=new Textures(f.render as any,backend,info);Object.assign(f.render,{backend,_textures:manager})
   const generate=f.generate.getMockImplementation()!
   f.generate.mockImplementation((...args)=>{const target=generate(...args) as THREE.RenderTarget
    if(mode==='reset-before-normal')target.addEventListener('dispose',()=>{info.dispose();manager.dispose()})
    manager.updateRenderTarget(target)
    backend.get(target.texture).renderTarget=target
    if(api==='webgl2')backend.get(target).framebuffers={owned:aux}
    if(mode==='reset-after-normal')target.addEventListener('dispose',()=>{info.dispose();manager.dispose()})
    return target as never
   })
   const installed=await installLoadedThreeCompiledScene(loaded(),f.options),target=f.targets[0]!,texture=f.scene.environment!,key=api==='webgpu'?'texture':'textureGPU'
   expect(info.memory.textures,mode).toBe(2);expect(info.memory.renderTargets,mode).toBe(1)
   if(mode.startsWith('adopt-'))f.scene.environmentIntensity=.375
   if(mode.endsWith('foreign-handle'))backend.get(texture)[key]=foreign
   if(mode.endsWith('foreign-target'))data.set(target,{framebuffers:{borrowed:foreignAux}})
   if(mode==='old-manager-intact')Object.assign(f.render,{_textures:new Textures(f.render as any,backend,new Info())})
   if(mode==='reset'){info.dispose();manager.dispose()}
   installed.dispose();installed.dispose()
   if(mode.startsWith('adopt-')){
    expect(handles.map(h=>h.destroys),mode).toEqual([0,0]);if(mode==='adopt-reset'){info.dispose();manager.dispose()};texture.dispose();texture.dispose()
   }
   expect(handles.map(h=>h.destroys),mode).toEqual([1,1]);expect(foreign.destroys,mode).toBe(0);expect(foreignAux.destroys,mode).toBe(0)
   expect(info.memory.textures,mode).toBe(0);expect(info.memory.renderTargets,mode).toBe(0)
   if(api==='webgl2')expect(aux.destroys,mode).toBe(1)
   if(mode.endsWith('foreign-handle'))expect(data.get(texture)[key]).toBe(foreign)
   else expect(data.has(texture),mode).toBe(false)
   if(mode.endsWith('foreign-target'))expect(data.get(target).framebuffers.borrowed).toBe(foreignAux)
   else expect(data.has(target),mode).toBe(false)
  }
 })

})
