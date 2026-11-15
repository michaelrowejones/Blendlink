// Test-only forwarding observers. Counts actual source-payload objects and backend
// work separately; no decoder/kernel/state/resource ownership is replaced.
import {DataTexture,FloatType} from 'three'
export function observeFinitePayloadCosts(renderer){
 const backend=renderer.backend,states=new WeakMap(),disposed=[];let restored=false
 const state=texture=>{let value=states.get(texture);if(!value){value={creations:0,uploads:0,handles:new Set(),sampled:new Set(),samplers:new Set()};states.set(texture,value)}return value}
 for(const name of['createTexture','updateTexture','createBindings','updateBindings'])if(typeof backend[name]!=='function')throw Error('Actual backend cost observer method missing: '+name)
 const originalDispose=DataTexture.prototype.dispose,ownDispose=Object.getOwnPropertyDescriptor(DataTexture.prototype,'dispose')
 const dispose=function(){
  if(this.type===FloatType&&this.image?.data instanceof Float32Array){const data=this.image.data;disposed.push({texture:this,width:this.image.width,height:this.image.height,raw:new Uint8Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)),buffer:data.buffer})}
  return originalDispose.call(this)
 }
 DataTexture.prototype.dispose=dispose
 const originals={},wrappers={}
 for(const name of['createTexture','updateTexture','createBindings','updateBindings']){
  const original=backend[name];if(typeof original!=='function')throw Error('Actual backend cost observer method missing: '+name)
  originals[name]=original
  const wrapper=function(...args){
   if(name==='createTexture'&&args[0]?.isDataTexture)state(args[0]).creations++
   if(name==='updateTexture'&&args[0]?.isDataTexture)state(args[0]).uploads++
   if(name==='createBindings'||name==='updateBindings')for(const group of args[1]??[])for(const binding of group.bindings??[]){const texture=binding.texture;if(!texture?.isDataTexture)continue;const value=state(texture);if(binding.isSampledTexture)value.sampled.add(binding);if(binding.isSampler)value.samplers.add(binding)}
   try{return original.apply(this,args)}finally{
    const texture=args[0]
    if(name==='createTexture'&&texture?.isDataTexture&&backend.has(texture)){const physical=backend.get(texture),handle=backend.isWebGPUBackend?physical.texture:physical.textureGPU;if(handle)state(texture).handles.add(handle)}
   }
  }
  wrappers[name]=wrapper;backend[name]=wrapper
 }
 const count=texture=>{const value=state(texture);return{creations:value.creations,uploads:value.uploads,physicalHandles:value.handles.size,sampledTextureBindings:value.sampled.size,samplerBindings:value.samplers.size}}
 return{
  mark:()=>disposed.length,
  canary(texture){const value=count(texture);if(value.creations<1||value.uploads<1||value.physicalHandles<1||value.sampledTextureBindings<1)throw Error('Actual DataTexture/backend cost observation canary failed '+JSON.stringify(value));return value},
  async finish(mark,entry,exclude,hash){
   const sourceImage=['png','float'].includes(entry.producer),[width,height]=entry.size??[0,0]
   const matches=sourceImage?disposed.slice(mark).filter(row=>!exclude.includes(row.texture)&&row.width===width&&row.height===height):[]
   const buffers=new Map(),objects=new Set(),rows=[]
   for(const row of matches){if(objects.has(row.texture))throw Error('Source payload CPU object disposed more than once');objects.add(row.texture);buffers.set(row.buffer,row.raw.byteLength);rows.push({uuid:row.texture.uuid,width:row.width,height:row.height,observedCpuBytes:row.raw.byteLength,rawSha256:await hash(row.raw),...count(row.texture)})}
   return{scope:'matched-actual-source-payload-objects-and-backend-bindings',cpuObjects:rows.length,distinctCpuBuffers:buffers.size,observedCpuBytes:[...buffers.values()].reduce((n,x)=>n+x,0),gpuCreations:rows.reduce((n,x)=>n+x.creations,0),gpuUploads:rows.reduce((n,x)=>n+x.uploads,0),physicalGpuHandles:rows.reduce((n,x)=>n+x.physicalHandles,0),sampledTextureBindings:rows.reduce((n,x)=>n+x.sampledTextureBindings,0),samplerBindings:rows.reduce((n,x)=>n+x.samplerBindings,0),rows}
  },
  restore(){if(restored)return;restored=true;if(DataTexture.prototype.dispose===dispose){if(ownDispose)Object.defineProperty(DataTexture.prototype,'dispose',ownDispose);else delete DataTexture.prototype.dispose}for(const[name,original]of Object.entries(originals))if(backend[name]===wrappers[name])backend[name]=original;disposed.length=0},
 }
}
