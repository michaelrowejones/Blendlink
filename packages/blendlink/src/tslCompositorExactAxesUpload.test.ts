import {expect,it} from 'vitest'
import Textures from 'three/src/renderers/common/Textures.js'
import Info from 'three/src/renderers/common/Info.js'
import {CompositorExactAxes} from './tslCompositorExactAxes.js'
// Real pinned Three updateTexture ordering and counters; only physical GPU
// operations are mocked. Callback failure occurs before registration/accounting.
it.each(['webgpu','webgl2'])('owns normal/failed/substituted allocations with real Three %s upload ordering',api=>{
 for(const mode of['normal','bad-format','foreign-handle']){
  const allocations:any[]=[],records=new WeakMap(),events:string[]=[],info=new Info()
  const gl={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture:(handle:any)=>{handle.destroys++;events.push('physical-destroy')}}
  const backend:any={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,
   has:(t:any)=>records.has(t),get(t:any){let d=records.get(t);if(!d){d={};records.set(t,d)}return d},delete:(t:any)=>records.delete(t),
   createTexture(t:any){const handle={width:t.image.width,height:2,format:mode==='bad-format'?'rgba16float':'r32float',destroys:0,destroy(){this.destroys++;events.push('physical-destroy')}};allocations.push(handle);Object.assign(this.get(t),api==='webgpu'?{texture:handle,textureDescriptorGPU:{format:handle.format}}:{textureGPU:handle,glInternalFormat:mode==='bad-format'?34842:gl.R32F,glFormat:gl.RED,glType:gl.FLOAT});events.push('physical-create')},
   updateTexture:()=>events.push('upload'),destroyTexture(t:any,isDefault:boolean){expect(isDefault).toBe(false);const d=this.get(t);if(api==='webgpu')d.texture.destroy();else gl.deleteTexture(d.textureGPU);records.delete(t)},generateMipmaps(){throw Error('Unexpected mips')}}
  const target={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer:any={isWebGPURenderer:true,backend,getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>target}
  const manager=new Textures(renderer,backend,info);renderer._textures=manager
  const axes=new CompositorExactAxes();axes.validate(renderer);const found=new Set<any>();axes.node.traverse((n:any)=>{if(n.isTextureNode)found.add(n.value)});const texture=[...found][0]
  const foreign={destroys:0,destroy(){this.destroys++}}
  if(mode==='bad-format'){
   expect(()=>manager.updateTexture(texture)).toThrow(/R32F/);expect(info.memory.textures).toBe(0);expect(manager.has(texture)).toBe(false);expect(records.has(texture)).toBe(false);expect(allocations[0].destroys).toBe(1)
  }else{
   manager.updateTexture(texture);expect(info.memory.textures).toBe(1);expect(manager.get(texture).initialized).toBe(true)
   if(mode==='foreign-handle'){
    const data=records.get(texture);data[api==='webgpu'?'texture':'textureGPU']=foreign
    expect(()=>axes.validate(renderer)).toThrow(/physical texture/)
   }
  }
  axes.dispose();axes.dispose()
  expect(allocations[0].destroys).toBe(1);expect(foreign.destroys).toBe(0);expect(info.memory.textures).toBe(0);expect(manager.has(texture)).toBe(false)
  if(mode==='foreign-handle')expect(records.get(texture)[api==='webgpu'?'texture':'textureGPU']).toBe(foreign)
  else expect(records.has(texture)).toBe(false)
 }
})
