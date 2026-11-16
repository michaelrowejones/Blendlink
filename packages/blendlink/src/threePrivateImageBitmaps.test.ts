import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import type {CompiledSceneDescriptor} from './runtime.js'
import {ownPrivateGltfImageBitmaps} from './threePrivateImageBitmaps.js'

const image='data:image/png;base64,AQ=='
function fixture(two=false,required=false){
 const bytes=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{uri:'data:application/octet-stream;base64,'+bytes.toString('base64'),byteLength:bytes.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bytes.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],images:two?[{uri:image},{uri:'data:image/png;base64,Ag=='}]:[{uri:image}],textures:two?[{source:0},{source:1}]:[{source:0}],materials:[{extras:{blendlink_source_material:'Artist'},pbrMetallicRoughness:{baseColorTexture:{index:0}},...(two?{normalTexture:{index:1}}:{})}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}],...(required?{extras:{blendlink_tsl_runtime:{requiresNodeRenderer:{schemaVersion:1,model:'live-material-programs-v1',programs:[{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1'}]}}}}:{})}]}
 return 'data:model/gltf+json;base64,'+Buffer.from(JSON.stringify(json)).toString('base64')
}
function renderer(){let alpha=0;return{isWebGLRenderer:true,domElement:{clientWidth:8,clientHeight:8},toneMapping:T.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:false,type:0,autoUpdate:true,needsUpdate:false},capabilities:{getMaxAnisotropy:()=>8},extensions:{has:()=>false,get:()=>null},setClearAlpha:(v:number)=>{alpha=v},getClearAlpha:()=>alpha,getContextAttributes:()=>({alpha:true}),setSize:vi.fn(),render:vi.fn(),compileAsync:vi.fn(async()=>{}),getRenderTarget:()=>null,setRenderTarget:vi.fn(),getViewport:(v:T.Vector4)=>v.set(0,0,8,8),setViewport:vi.fn(),getScissor:(v:T.Vector4)=>v.set(0,0,8,8),setScissor:vi.fn(),getScissorTest:()=>false,setScissorTest:vi.fn()}}
const descriptor=(url=fixture()):CompiledSceneDescriptor=>({url,nodes:{},playback:{start:'manual',loop:'repeat',speed:1},look:{toneMapping:'application',exposure:0,background:'application'}})
const options=()=>({descriptor:descriptor(),renderer:renderer() as unknown as T.WebGLRenderer,scene:new T.Scene(),prewarm:false,useAuthoringPreview:false})
const bitmap=()=>({width:1,height:1,close:vi.fn()})
let savedCache: {enabled:boolean;files:typeof T.Cache.files},decoded:ReturnType<typeof bitmap>[]
beforeEach(()=>{
 savedCache={enabled:T.Cache.enabled,files:T.Cache.files};T.Cache.enabled=false;T.Cache.files={};decoded=[]
 vi.stubGlobal('self',globalThis)
 vi.stubGlobal('ProgressEvent',class extends Event{constructor(type:string,readonly init:unknown){super(type)}})
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>{const b=bitmap();decoded.push(b);return b}))
})
afterEach(()=>{T.Cache.enabled=savedCache.enabled;T.Cache.files=savedCache.files;vi.unstubAllGlobals();vi.restoreAllMocks()})
const texture=(loaded:any):T.Texture=>{let result!:T.Texture;loaded.scene.traverse((o:any)=>{if(o.isMesh)result=o.material.map});return result}

it('public dynamic default-loader disposal closes each decode once and clears only its private shared Source',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js')
 const installed=await installThreeCompiledScene(options()),map=texture(installed.loaded),source=map.source,copy=map.clone(),dispose=vi.fn()
 map.addEventListener('dispose',dispose);expect(copy.source).toBe(source);expect(source.data).toBe(decoded[0])
 installed.dispose();installed.dispose();expect(dispose).toHaveBeenCalledOnce();expect(decoded[0].close).toHaveBeenCalledOnce();expect(source.data).toBeNull();expect(copy.source.data).toBeNull();copy.dispose()
})
it('separate default reloads own independent decodes',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js')
 for(let i=0;i<3;i++){const h=await installThreeCompiledScene(options());h.dispose();expect(decoded[i].close).toHaveBeenCalledOnce()}
 expect(decoded).toHaveLength(3)
})
it('owns packed bufferView image decodes and detached preparations before any scene commit',async()=>{
 const {startThreeCompiledScenePreparation}=await import('./threeRuntime.js')
 const json=JSON.parse(Buffer.from(fixture().split(',')[1],'base64').toString())
 const bytes=Buffer.concat([Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),Buffer.from([1])])
 json.buffers=[{uri:'data:application/octet-stream;base64,'+bytes.toString('base64'),byteLength:bytes.length}]
 json.bufferViews.push({buffer:0,byteOffset:36,byteLength:1});json.images=[{bufferView:1,mimeType:'image/png'}]
 const o=options();o.descriptor.url='data:model/gltf+json;base64,'+Buffer.from(JSON.stringify(json)).toString('base64')
 const prepared=await startThreeCompiledScenePreparation(o).promise;expect(o.scene.children).toEqual([])
 prepared.dispose();prepared.dispose();expect(decoded).toHaveLength(1);expect(decoded[0].close).toHaveBeenCalledOnce()
})
it('preserves globally cached/shared images even after Cache.clear',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js');T.Cache.enabled=true
 const a=await installThreeCompiledScene(options()),b=await installThreeCompiledScene(options()),first=texture(a.loaded),second=texture(b.loaded)
 expect(decoded).toHaveLength(1);expect(first.image).toBe(second.image);T.Cache.clear();T.Cache.enabled=false;a.dispose();b.dispose()
 expect(decoded[0].close).not.toHaveBeenCalled();expect(first.image).toBe(decoded[0]);expect(second.image).toBe(decoded[0])
})
it('does not take a cache-enabled decode when cache ownership disappears mid-flight',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js');let finish!:(b:unknown)=>void
 vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve})));T.Cache.enabled=true
 const promise=installThreeCompiledScene(options());await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 T.Cache.clear();T.Cache.enabled=false;const b=bitmap();finish(b);const installed=await promise;installed.dispose();expect(b.close).not.toHaveBeenCalled()
})
it('does not close a decode published to Cache while loading',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js');let finish!:(b:unknown)=>void
 vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve})))
 const promise=installThreeCompiledScene(options());await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 T.Cache.enabled=true;const b=bitmap();finish(b);const installed=await promise;T.Cache.clear();T.Cache.enabled=false;installed.dispose();expect(b.close).not.toHaveBeenCalled()
})
it('preserves caller loaders and manager-handler images',async()=>{
 const {installThreeCompiledScene,installLoadedThreeCompiledScene}=await import('./threeRuntime.js')
 const borrowedLoader=new GLTFLoader(),a=await installThreeCompiledScene({...options(),loader:borrowedLoader});a.dispose();expect(decoded[0].close).not.toHaveBeenCalled()
 const loaded=await borrowedLoader.loadAsync(fixture()),b=await installLoadedThreeCompiledScene(loaded,options());b.dispose();expect(decoded[1].close).not.toHaveBeenCalled()
 const borrowed=bitmap(),manager=new T.LoadingManager();manager.addHandler(/^data:image/,{isImageBitmapLoader:true,load(_url:string,onLoad:(b:unknown)=>void){queueMicrotask(()=>onLoad(borrowed))}} as any)
 const c=await installThreeCompiledScene({...options(),loadingManager:manager}),map=texture(c.loaded);c.dispose();expect(borrowed.close).not.toHaveBeenCalled();expect(map.image).toBe(borrowed)
})
it('keeps later caller Source/data replacements outside cleanup ownership',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js')
 const a=await installThreeCompiledScene(options()),map=texture(a.loaded),old=map.source,borrowed=bitmap(),replacement=new T.Source(borrowed)
 map.source=replacement;a.dispose();expect(decoded[0].close).toHaveBeenCalledOnce();expect(old.data).toBeNull();expect(replacement.data).toBe(borrowed);expect(borrowed.close).not.toHaveBeenCalled()
 const b=await installThreeCompiledScene(options()),other=texture(b.loaded).source;other.data=borrowed;b.dispose();expect(decoded[1].close).toHaveBeenCalledOnce();expect(other.data).toBe(borrowed);expect(borrowed.close).not.toHaveBeenCalled()
})
it('cleans default GLTF decodes on a real legacy-material preparation refusal',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js'),o=options()
 o.descriptor.url=fixture(false,true);o.descriptor.materialPrograms={url:'/program.json',bytes:1,hash:'x',materials:1}
 await expect(installThreeCompiledScene({...o,loadMaterialPrograms:async()=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{Alpha:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1',sourceProfile:'blender53-macos-metal-shadow-transparent-v1',visibleAlpha:.25,input:{op:'const_float',value:.25}}}}}}}})})).rejects.toThrow(/Legacy WebGLRenderer cannot render.*Light Path/)
 expect(decoded).toHaveLength(1);expect(decoded[0].close).toHaveBeenCalledOnce()
})
it('cancellation during non-abortable decode releases its eventual private bitmap',async()=>{
 const {startThreeCompiledScenePreparation}=await import('./threeRuntime.js');let finish!:(b:unknown)=>void
 vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve})))
 const task=startThreeCompiledScenePreparation(options());const rejection=expect(task.promise).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 task.cancel();const b=bitmap();finish(b);await rejection;expect(b.close).toHaveBeenCalledOnce()
})
it('late default GLTF settlement after KTX2 CSP failure releases its decode and owned Source',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js');let finish!:(b:unknown)=>void
 vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve})))
 const target=new EventTarget();vi.stubGlobal('addEventListener',target.addEventListener.bind(target));vi.stubGlobal('removeEventListener',target.removeEventListener.bind(target))
 const o=options();o.descriptor.requiresKtx2=true
 const promise=installThreeCompiledScene(o),rejection=expect(promise).rejects.toThrow(/KTX2 decoder worker was blocked/)
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 const event=new Event('securitypolicyviolation');Object.defineProperties(event,{blockedURI:{value:'blob:http://localhost/worker'},disposition:{value:'enforce'},effectiveDirective:{value:'worker-src'}});target.dispatchEvent(event)
 await rejection;const b=bitmap();finish(b);await vi.waitFor(()=>expect(b.close).toHaveBeenCalledOnce());await new Promise(resolve=>setTimeout(resolve,10));expect(b.close).toHaveBeenCalledOnce()
})
it('attempts every close after GPU disposal errors and never double-closes a failed bitmap',async()=>{
 const {installThreeCompiledScene}=await import('./threeRuntime.js'),o=options();o.descriptor.url=fixture(true)
 const h=await installThreeCompiledScene(o),map=texture(h.loaded);decoded[0].close.mockImplementation(()=>{throw Error('close failed')});map.addEventListener('dispose',()=>{throw Error('texture failed')})
 expect(()=>h.dispose()).toThrow(/texture failed.*close failed/);expect(decoded).toHaveLength(2);for(const b of decoded)expect(b.close).toHaveBeenCalledOnce();h.dispose();for(const b of decoded)expect(b.close).toHaveBeenCalledOnce()
})
it('helper closes decodes even if parsing fails before any root graph is returned',async()=>{
 const loader=new GLTFLoader(),owner=ownPrivateGltfImageBitmaps(loader);loader.register(()=>({name:'reject-after-root',afterRoot:async()=>{throw Error('plugin refused')}}))
 await expect(loader.loadAsync(fixture())).rejects.toThrow('plugin refused');expect(owner.dispose()).toEqual([]);owner.dispose();expect(decoded[0].close).toHaveBeenCalledOnce()
})
it('a disposed helper clears a late parser-owned Source without retaining a closed bitmap',async()=>{
 let finish!:(b:unknown)=>void;vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{finish=resolve})))
 const loader=new GLTFLoader(),owner=ownPrivateGltfImageBitmaps(loader),promise=loader.loadAsync(fixture())
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(owner.dispose()).toEqual([])
 const b=bitmap();finish(b);const loaded=await promise
 expect(texture(loaded).source.data).toBeNull();expect(b.close).toHaveBeenCalledOnce();owner.dispose();expect(b.close).toHaveBeenCalledOnce()
})
