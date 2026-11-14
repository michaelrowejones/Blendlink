import {expect,it,vi} from 'vitest'
import {DataTexture,FloatType,RedFormat} from 'three'
import {NodeBuilder} from 'three/webgpu'
import {ivec2} from 'three/tsl'
import {CompositorExactAxes,compositorUniformAxes} from './tslCompositorExactAxes.js'
const textureOf=(axes:CompositorExactAxes):any=>{const textures=new Set<any>();axes.node.traverse((n:any)=>{if(n.isTextureNode)textures.add(n.value)});expect(textures.size).toBe(1);return[...textures][0]}
function renderer(){const records=new WeakMap(),state={width:13,height:9,ratio:1},target:any={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},manager:any={data:new WeakMap()},backend:any={isWebGPUBackend:true,device:{},get:(value:any)=>records.get(value),has:(value:any)=>records.has(value),delete:(value:any)=>records.delete(value)}
 manager.has=(value:any)=>manager.data.has(value);manager.get=(value:any)=>manager.data.get(value);manager.delete=(value:any)=>manager.data.delete(value)
 const r:any={isWebGPURenderer:true,backend,_textures:manager,getDrawingBufferSize:(v:any)=>v.set(state.width,state.height),getRenderTarget:()=>target,getViewport:(v:any)=>v.set(0,0,state.width/state.ratio,state.height/state.ratio),getPixelRatio:()=>state.ratio,getScissorTest:()=>false}
 return{r,state,target,records,manager,resize(w:number,h:number){state.width=w;state.height=h;Object.assign(target,{width:w,height:h});target.viewport.z=w;target.viewport.w=h}}
}
const upload=(axes:CompositorExactAxes,m:ReturnType<typeof renderer>)=>{
 axes.validate(m.r);const t=textureOf(axes),handle={width:t.image.width,height:2,format:'r32float',destroy:vi.fn()},record:any={isDefaultTexture:false}
 m.records.set(t,{texture:handle,textureDescriptorGPU:{format:'r32float'}});m.manager.data.set(t,record);t.onUpdate(t)
 record.initialized=true;record.onDispose=()=>{t.removeEventListener('dispose',record.onDispose);if(m.manager.has(t)){handle.destroy();m.records.delete(t);m.manager.delete(t)}};t.addEventListener('dispose',record.onDispose)
 return{t,handle}
}
it('matches the ordered native Float32 coordinate arithmetic for odd/aspect/extreme dimensions',()=>{
 const f=Math.fround
 for(const[w,h]of[[13,9],[9,13],[16,8],[8,8],[127,65],[65,127],[8192,4],[4,8192]]){
  const data=compositorUniformAxes(w!,h!),maximum=Math.max(w!,h!);expect(data.byteLength).toBeLessThanOrEqual(65536)
  for(const[dimension,offset]of[[w!,0],[h!,maximum]])for(let i=0;i<dimension!;i++)expect(Object.is(data[offset!+i],f(f(f(f(i+.5)-f(dimension!/2))/maximum)*2))).toBe(true)
 }
 for(const pair of[[3,9],[13,8193],[13.5,9],[NaN,9],[Infinity,9]])expect(()=>compositorUniformAxes(pair[0]!,pair[1]!)).toThrow(/physical extents/)
})
it('reuses one opaque binding and array until a valid physical extent changes; invalid frames recover',()=>{
 const a=new CompositorExactAxes(),m=renderer(),t=textureOf(a);a.validate(m.r);const data=t.image.data,version=t.version
 for(let i=0;i<5;i++)a.validate(m.r);expect(t.image.data).toBe(data);expect(t.version).toBe(version)
 m.resize(3,9);expect(()=>a.validate(m.r)).toThrow(/physical extents/);expect(t.image.data).toBe(data);expect(t.version).toBe(version)
 m.resize(9,13);a.validate(m.r);expect(textureOf(a)).toBe(t);expect(t.image.data).not.toBe(data);expect(t.version).toBe(version+1)
 m.target.viewport.x=1;expect(()=>a.validate(m.r)).toThrow(/zero-origin/);m.target.viewport.x=0;m.target.scissorTest=true;expect(()=>a.validate(m.r)).toThrow(/scissor/);m.target.scissorTest=false;a.validate(m.r)
 a.dispose();a.dispose();expect(()=>a.validate(m.r)).toThrow(/disposed/)
})
it('refuses schema/data/version mutation in constant time and physical-handle substitution',()=>{
 for(const mutate of[(t:any)=>t.image.data=new Float32Array(t.image.data),(t:any)=>t.needsUpdate=true,(t:any)=>t.flipY=true,(t:any)=>t.source.dataReady=false,(t:any)=>t.onUpdate=()=>{}]){
  const a=new CompositorExactAxes(),m=renderer();a.validate(m.r);mutate(textureOf(a));expect(()=>a.validate(m.r)).toThrow(/schema/);a.dispose()
 }
 const a=new CompositorExactAxes(),m=renderer(),{t}=upload(a,m);m.records.get(t).texture={};expect(()=>a.validate(m.r)).toThrow(/physical texture/);a.dispose()
})
it('destroys the exact owned handle once when a saved original dispose resets managers',()=>{
 const a=new CompositorExactAxes(),m=renderer(),{handle}=upload(a,m);m.manager.data=new WeakMap();expect(()=>a.validate(m.r)).toThrow(/epoch/);a.dispose();a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(1)
})
it('leaves normal manager cleanup ownership intact and rejects unknown allocation formats',()=>{
 const a=new CompositorExactAxes(),m=renderer(),{handle}=upload(a,m);a.dispose();a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(1)
 const b=new CompositorExactAxes(),n=renderer();b.validate(n.r);const image=textureOf(b),bad={width:13,height:2,format:'rgba16float',destroy:vi.fn()};n.records.set(image,{texture:bad,textureDescriptorGPU:{format:'r32float'}});n.manager.data.set(image,{isDefaultTexture:false});expect(()=>image.onUpdate(image)).toThrow(/R32F/);expect(n.manager.has(image)).toBe(false);expect(n.records.has(image)).toBe(false);b.dispose();expect(bad.destroy).toHaveBeenCalledTimes(1)
})
it('keeps a weak device-loss callback and revokes a lost device before further updates',async()=>{
 let lost!:()=>void;const a=new CompositorExactAxes(),m=renderer();m.r.backend.device.lost=new Promise<void>(resolve=>{lost=resolve});a.validate(m.r);lost();await Promise.resolve();expect(()=>a.validate(m.r)).toThrow(/device was lost/);a.dispose()
})
it('does not double-destroy when the renderer replaces an intact texture manager',()=>{
 const a=new CompositorExactAxes(),m=renderer(),{handle}=upload(a,m);m.r._textures={data:new WeakMap()}
 expect(()=>a.validate(m.r)).toThrow(/epoch/);a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(1)
})
it('retires a valid allocation before resize and owns only the replacement afterward',()=>{
 const a=new CompositorExactAxes(),m=renderer(),{handle}=upload(a,m)
 m.resize(9,13);a.validate(m.r);expect(handle.destroy).toHaveBeenCalledTimes(1)
 const next=upload(a,m).handle;a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(1);expect(next.destroy).toHaveBeenCalledTimes(1)
})
it('rejects viewport or physical target changes without poisoning an existing DPR binding',()=>{
 const a=new CompositorExactAxes(),m=renderer();m.r.getRenderTarget=()=>null;m.state.ratio=2;a.validate(m.r)
 m.r.getViewport=(v:any)=>v.set(0,0,13,9);expect(()=>a.validate(m.r)).toThrow(/DPR/)
 m.r.getViewport=(v:any)=>v.set(0,0,m.state.width/m.state.ratio,m.state.height/m.state.ratio);a.validate(m.r);a.dispose()
})

it('accepts the pinned renderer floor convention for fractional DPR full viewports',()=>{
 const a=new CompositorExactAxes(),m=renderer();m.r.getRenderTarget=()=>null;m.state.width=16;m.state.height=11;m.state.ratio=1.25;m.r.getViewport=(v:any)=>v.set(0,0,13,9)
 expect(()=>a.validate(m.r)).not.toThrow();expect(textureOf(a).image.width).toBe(16);a.dispose()
})

it('rejects mipmapped/cube/layered targets whose actual raster differs from nominal width',()=>{
 const a=new CompositorExactAxes(),m=renderer();m.r.getActiveMipmapLevel=()=>1;expect(()=>a.validate(m.r)).toThrow(/mip0/)
 m.r.getActiveMipmapLevel=()=>0;m.target.texture={isCubeTexture:true};expect(()=>a.validate(m.r)).toThrow(/two-dimensional/)
 m.target.texture={};m.target.depth=2;expect(()=>a.validate(m.r)).toThrow(/two-dimensional/);m.target.depth=1;a.validate(m.r);a.dispose()
})

it('destroys a lost-epoch GL handle through its original context after backend context replacement',()=>{
 const a=new CompositorExactAxes(),m=renderer(),original={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture:vi.fn()},replacement={...original,deleteTexture:vi.fn()}
 Object.assign(m.r.backend,{isWebGPUBackend:false,isWebGLBackend:true,gl:original});a.validate(m.r)
 const t=textureOf(a),handle={};m.manager.data.set(t,{isDefaultTexture:false});m.records.set(t,{textureGPU:handle,glInternalFormat:original.R32F,glFormat:original.RED,glType:original.FLOAT});t.onUpdate(t)
 m.manager.data=new WeakMap();m.r.backend.gl=replacement;expect(()=>a.validate(m.r)).toThrow(/epoch/);a.dispose();expect(original.deleteTexture).toHaveBeenCalledExactlyOnceWith(handle);expect(replacement.deleteTexture).not.toHaveBeenCalled()
})
it('cleans same-epoch failed first GPU/GL uploads before disposal without uncreated info counters',()=>{
 for(const api of['webgpu','webgl2']){
  const a=new CompositorExactAxes(),m=renderer(),gl={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture:vi.fn()},destroy=vi.fn()
  if(api==='webgl2')Object.assign(m.r.backend,{isWebGPUBackend:false,isWebGLBackend:true,gl})
  m.manager.info={memoryMap:new WeakMap(),destroyTexture:vi.fn()};a.validate(m.r);const t=textureOf(a),handle=api==='webgpu'?{width:13,height:2,format:'rgba16float',destroy}:{}
  const data=api==='webgpu'?{texture:handle,textureDescriptorGPU:{format:'r32float'}}:{textureGPU:handle,glInternalFormat:999,glFormat:gl.RED,glType:gl.FLOAT}
  m.records.set(t,data);m.manager.data.set(t,{isDefaultTexture:false})
  expect(()=>t.onUpdate(t)).toThrow(/R32F/)
  expect(api==='webgpu'?destroy:gl.deleteTexture).toHaveBeenCalledTimes(1);expect(m.manager.has(t)).toBe(false);expect(m.records.has(t)).toBe(false);expect(m.manager.info.destroyTexture).not.toHaveBeenCalled()
  expect(()=>a.validate(m.r)).toThrow(/failed upload validation/);a.dispose();a.dispose();expect(api==='webgpu'?destroy:gl.deleteTexture).toHaveBeenCalledTimes(1)
 }
})
it('captures first-upload ownership before schema checks and never destroys borrowed defaults',()=>{
 for(const borrowed of[false,true]){
  const a=new CompositorExactAxes(),m=renderer();a.validate(m.r);const t=textureOf(a),handle={width:13,height:2,format:'r32float',destroy:vi.fn()}
  m.records.set(t,{texture:handle,textureDescriptorGPU:{format:'r32float'}});m.manager.data.set(t,{isDefaultTexture:borrowed});t.source.dataReady=false
  expect(()=>t.onUpdate(t)).toThrow(/schema/);a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(borrowed?0:1)
 }
})

const loadsOf=(axes:CompositorExactAxes):any[]=>{const loads:any[]=[];axes.node.traverse((node:any)=>{if(node.isTextureNode)loads.push(node)});expect(loads.length).toBe(2);return loads}
it('refuses borrowed TextureNode value/reference/sampling changes before first or resize allocation',()=>{
 const mutations=[
  (n:any,t:any)=>n.value=t,
  (n:any)=>n.referenceNode=n,
  (n:any,t:any)=>n.referenceNode={value:t},
  (n:any)=>n.uvNode=ivec2(0,0),
  (n:any)=>n.sampler=true,
  (n:any)=>n.updateMatrix=true,
  ...['levelNode','biasNode','compareNode','depthNode','gradNode','offsetNode'].map(key=>(n:any)=>n[key]=ivec2(0,0)),
 ]
 for(const mutate of mutations)for(const warm of[false,true]){
  const a=new CompositorExactAxes(),m=renderer(),loads=loadsOf(a),owned=textureOf(a),borrowed=new DataTexture(new Float32Array([.75,.75]),1,2,RedFormat,FloatType)
  const borrowedDispose=vi.spyOn(borrowed,'dispose'),ownedDispose=vi.spyOn(owned,'dispose')
  if(warm)a.validate(m.r);const image=owned.image,version=owned.version;mutate(loads[0],borrowed);m.resize(9,13)
  expect(()=>a.validate(m.r)).toThrow(/texture-node binding/);expect(owned.image).toBe(image);expect(owned.version).toBe(version)
  a.dispose();a.dispose();expect(ownedDispose).toHaveBeenCalledTimes(1);expect(borrowedDispose).not.toHaveBeenCalled();borrowed.dispose()
 }
})
it('checks captured bindings on first upload and destroys only the owned physical allocation',()=>{
 const a=new CompositorExactAxes(),m=renderer(),loads=loadsOf(a);a.validate(m.r)
 const owned=textureOf(a),borrowed=new DataTexture(new Float32Array([.75,.75]),1,2,RedFormat,FloatType),borrowedDispose=vi.spyOn(borrowed,'dispose')
 const handle={width:13,height:2,format:'r32float',destroy:vi.fn()}
 m.records.set(owned,{texture:handle,textureDescriptorGPU:{format:'r32float'}});m.manager.data.set(owned,{isDefaultTexture:false});loads[1].value=borrowed
 expect(()=>owned.onUpdate(owned)).toThrow(/texture-node binding/);expect(handle.destroy).toHaveBeenCalledTimes(1);expect(m.records.has(owned)).toBe(false)
 a.dispose();expect(handle.destroy).toHaveBeenCalledTimes(1);expect(borrowedDispose).not.toHaveBeenCalled();borrowed.dispose()
})
it('admits actual Three TextureNode setup caches without traversing the graph on updates',()=>{
 for(const flipY of[false,true]){
  const a=new CompositorExactAxes(),m=renderer(),loads=loadsOf(a),builder=new NodeBuilder(null,null,null)
  builder.isFlipY=()=>flipY
  for(const load of loads){
   load.setup(builder)
   // Evaluate the actual Three UV setup closure, including its WebGL flip
   // uniform and updateType changes; authored sampling fields stay intact.
   builder.getNodeProperties(load).uvNode.node.shaderNode.jsFunc(builder)
  }
  expect(loads.every(n=>n.updateType===(flipY?'object':'none'))).toBe(true)
  const traverse=vi.spyOn(a.node,'traverse').mockImplementation(()=>{throw Error('unexpected frame traversal')})
  expect(()=>a.validate(m.r)).not.toThrow();m.resize(9,13);expect(()=>a.validate(m.r)).not.toThrow();expect(traverse).not.toHaveBeenCalled()
  a.dispose()
 }
})
