import {expect,it,vi} from 'vitest'
import * as THREE from 'three'
import AnalyticLightNode from 'three/src/nodes/lighting/AnalyticLightNode.js'
import PointShadowNode from 'three/src/nodes/lighting/PointShadowNode.js'
import ShadowNode from 'three/src/nodes/lighting/ShadowNode.js'
import {installThreeCompiledScene,installLoadedThreeCompiledScene,startThreeCompiledScenePreparation} from './threeRuntime.js'
import type {CompiledSceneDescriptor} from './runtime.js'
const descriptor:CompiledSceneDescriptor={url:'/private-lights.glb',nodes:{},playback:{start:'manual',loop:'repeat',speed:1},look:{toneMapping:'application',exposure:0,background:'application'}}
function renderer(node=true){let alpha=0;return{isWebGPURenderer:node,isWebGLRenderer:!node,domElement:{clientWidth:13,clientHeight:9},toneMapping:THREE.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:true,type:THREE.PCFShadowMap,autoUpdate:true,needsUpdate:false},capabilities:{getMaxAnisotropy:()=>8},extensions:{has:()=>false,get:()=>null},setClearAlpha:(v:number)=>{alpha=v},getClearAlpha:()=>alpha,getContextAttributes:()=>({alpha:true}),setSize:vi.fn(),render:vi.fn(),compileAsync:vi.fn(async()=>{}),getRenderTarget:()=>null,setRenderTarget:vi.fn(),getViewport:(v:THREE.Vector4)=>v.set(0,0,13,9),setViewport:vi.fn(),getScissor:(v:THREE.Vector4)=>v.set(0,0,13,9),setScissor:vi.fn(),getScissorTest:()=>false,setScissorTest:vi.fn()}}
function lightFixture(kind:'point'|'spot'|'directional'='point'){
 const light=kind==='point'?new THREE.PointLight():kind==='spot'?new THREE.SpotLight():new THREE.DirectionalLight()
 const analytic:any=new AnalyticLightNode(light),shadow:any=kind==='point'?new PointShadowNode(light):new ShadowNode(light),target=new THREE.RenderTarget(4,4),disposed=vi.fn(),event=vi.fn()
 target.addEventListener('dispose',disposed);light.addEventListener('dispose',event);shadow.shadowMap=target;light.shadow.map=target;analytic.shadowNode=shadow
 return{light,analytic,shadow,target,disposed,event}
}
function graph(...lights:THREE.Light[]){const root=new THREE.Group();root.add(...lights);return{scene:root,scenes:[root,root],animations:[],cameras:[],asset:{},parser:{json:{asset:{version:'2.0'}},plugins:{},extensions:{},options:{}},userData:{}} as any}
const options=(loaded:any,scene=new THREE.Scene(),render=renderer())=>({descriptor,renderer:render as unknown as THREE.WebGLRenderer,scene,loader:{loadAsync:vi.fn(async()=>loaded)} as any,prewarm:false,useAuthoringPreview:false})
for(const kind of ['point','spot','directional'] as const){
 it('retires actual analytic '+kind+' ShadowNode once through private public install',async()=>{
  const f=lightFixture(kind),g=graph(f.light),ownSubclass=vi.spyOn(f.light,'dispose'),installed=await installThreeCompiledScene(options(g));installed.dispose();installed.dispose()
  expect(f.event).toHaveBeenCalledOnce();expect(f.disposed).toHaveBeenCalledOnce();expect(f.shadow.shadowMap).toBeNull();expect(f.analytic.shadowNode).toBeNull();expect(ownSubclass).not.toHaveBeenCalled()
 })
 it('preserves late borrowed '+kind+' shadow-map replacement while retiring original node target',async()=>{
  const f=lightFixture(kind),g=graph(f.light),installed=await installThreeCompiledScene(options(g)),borrowed=new THREE.RenderTarget(2,2),borrowedDispose=vi.spyOn(borrowed,'dispose')
  f.light.shadow.map=borrowed;f.light.shadow.mapPass=borrowed;installed.dispose();installed.dispose();expect(f.disposed).toHaveBeenCalledOnce();expect(borrowedDispose).not.toHaveBeenCalled();expect(f.light.shadow.map).toBe(borrowed);expect(f.light.shadow.mapPass).toBe(borrowed)
 })
}
it('keeps preexisting caller lights and lights added after load outside ownership',async()=>{
 const owned=lightFixture(),host=lightFixture(),late=lightFixture(),scene=new THREE.Scene();scene.add(host.light)
 const g=graph(owned.light);g.scenes.push(scene)
 const prepared=await startThreeCompiledScenePreparation(options(g,scene)).promise;g.scene.add(late.light)
 const installed=prepared.commit();installed.dispose();prepared.dispose()
 expect(owned.disposed).toHaveBeenCalledOnce();for(const f of[host,late]){expect(f.event).not.toHaveBeenCalled();expect(f.disposed).not.toHaveBeenCalled();expect(f.shadow.shadowMap).toBe(f.target)}
})
it('leaves all lights caller-owned at the already-loaded cache seam',async()=>{
 const f=lightFixture(),g=graph(f.light),o=options(g);const installed=await installLoadedThreeCompiledScene(g,o);installed.dispose();expect(f.event).not.toHaveBeenCalled();expect(f.disposed).not.toHaveBeenCalled()
})
it('detached private preparation cleanup owns lights without committing a scene',async()=>{
 const f=lightFixture(),g=graph(f.light),scene=new THREE.Scene(),prepared=await startThreeCompiledScenePreparation(options(g,scene)).promise
 expect(g.scene.parent).not.toBe(scene);expect(scene.children).toEqual([]);prepared.dispose();prepared.dispose();expect(f.disposed).toHaveBeenCalledOnce();expect(scene.children).toEqual([])
})
it('cancellation during awaited compile retires private node shadows once',async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve}),f=lightFixture(),g=graph(f.light),r=renderer();r.compileAsync.mockImplementation(async()=>wait)
 const task=startThreeCompiledScenePreparation({...options(g,new THREE.Scene(),r),prewarm:true});await vi.waitFor(()=>expect(r.compileAsync).toHaveBeenCalledOnce());task.cancel();release();await expect(task.promise).rejects.toMatchObject({name:'AbortError'});expect(f.disposed).toHaveBeenCalledOnce()
})
it('separate private reapplications own exactly their imported light instances',async()=>{
 const scene=new THREE.Scene(),host=lightFixture();scene.add(host.light)
 for(let i=0;i<3;i++){const f=lightFixture(),installed=await installThreeCompiledScene(options(graph(f.light),scene));installed.dispose();expect(f.disposed).toHaveBeenCalledOnce();expect(scene.children).toEqual([host.light])}
 expect(host.disposed).not.toHaveBeenCalled()
})
it('does not introduce unproven legacy WebGLRenderer shadow cleanup',async()=>{
 const f=lightFixture(),installed=await installThreeCompiledScene(options(graph(f.light),new THREE.Scene(),renderer(false)));installed.dispose();expect(f.event).not.toHaveBeenCalled();expect(f.disposed).not.toHaveBeenCalled()
})

it('dispatches the original node cleanup without disposing a borrowed replacement shadow object',async()=>{
 const f=lightFixture(),installed=await installThreeCompiledScene(options(graph(f.light))),other=new THREE.PointLight(),borrowed=new THREE.RenderTarget(2,2),borrowedDispose=vi.spyOn(borrowed,'dispose');other.shadow.map=borrowed;f.light.shadow=other.shadow;installed.dispose();expect(f.disposed).toHaveBeenCalledOnce();expect(borrowedDispose).not.toHaveBeenCalled();expect(f.light.shadow).toBe(other.shadow)
})
it('failed awaited compilation still retires captured private node lights',async()=>{
 const f=lightFixture(),r=renderer();r.compileAsync.mockRejectedValue(Error('Compilation failed'))
 await expect(installThreeCompiledScene({...options(graph(f.light),new THREE.Scene(),r),prewarm:true})).rejects.toThrow('Compilation failed');expect(f.disposed).toHaveBeenCalledOnce()
})
