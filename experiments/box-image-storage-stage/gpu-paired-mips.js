// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2021 NVIDIA Corporation
// SPDX-FileCopyrightText: 2026 Blender Foundation
// Source-specialized research: paired POT reduction, SharedSRGB and Metal
// typed sRGB IO. No values or transforms are derived from native answers.
export async function pairedMips(bytes,size,srgb,device){
 const format=srgb?'rgba8unorm-srgb':'rgba8unorm',levels=[{data:bytes,width:size,height:size}],owned=[],buffers=[]
 const errors=[];device.pushErrorScope('validation');let scopeOpen=true
 try{
 const common=`
 @group(0) @binding(0) var source:texture_2d<f32>;
 fn decode(c:f32)->f32 {if(c<0.04045f){return select(c*(1.0f/12.92f),0.0f,c<0.0f);}return pow((c+0.055f)*(1.0f/1.055f),2.4f);}
 fn encode(c:f32)->f32 {if(c<0.0031308f){return select(c*12.92f,0.0f,c<0.0f);}return 1.055f*pow(c,1.0f/2.4f)-0.055f;}
 fn first(c:vec2<i32>)->vec4<f32>{let p=c*2;let a=textureLoad(source,p,0);let b=textureLoad(source,p+vec2<i32>(0,1),0);let c1=textureLoad(source,p+vec2<i32>(1,0),0);let d=textureLoad(source,p+vec2<i32>(1,1),0);return 0.5*(0.5*(a+b)+0.5*(c1+d));}
 fn shared_sample(c:vec2<i32>)->vec4<f32>{let value=first(c);let encoded=vec4<f32>(encode(value.r),encode(value.g),encode(value.b),value.a);let stored=unpack4x8unorm(pack4x8unorm(encoded));return vec4<f32>(decode(stored.r),decode(stored.g),decode(stored.b),stored.a);}
 @vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4<f32>(x*2.0-1.0,y*2.0-1.0,0.0,1.0);}
 @fragment fn one(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{return first(vec2<i32>(p.xy));}
 @fragment fn two(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let c=vec2<i32>(p.xy)*2;return 0.5*(0.5*(shared_sample(c)+shared_sample(c+vec2<i32>(0,1)))+0.5*(shared_sample(c+vec2<i32>(1,0))+shared_sample(c+vec2<i32>(1,1))));}`
 const module=device.createShaderModule({code:common});const compilation=await module.getCompilationInfo()
 if(compilation.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(compilation.messages.map(m=>({message:m.message,type:m.type,lineNum:m.lineNum,linePos:m.linePos,offset:m.offset,length:m.length}))))
 const pipelines=Object.fromEntries(await Promise.all(['one','two'].map(async entry=>[entry,await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:entry,targets:[{format}]},primitive:{topology:'triangle-list'}})])))
 const make=extent=>{const t=device.createTexture({size:[extent,extent],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});owned.push(t);return t}
 const read=async(texture,extent)=>{
  const stride=Math.ceil(extent*4/256)*256,b=device.createBuffer({size:stride*extent,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});buffers.push(b)
  const command=device.createCommandEncoder();command.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:stride},[extent,extent]);device.queue.submit([command.finish()]);await b.mapAsync(GPUMapMode.READ)
  const raw=new Uint8Array(b.getMappedRange()),data=new Uint8Array(extent*extent*4);for(let y=0;y<extent;y++)data.set(raw.subarray(y*stride,y*stride+extent*4),y*extent*4);b.unmap();return data
 }
  let input=make(size);device.queue.writeTexture({texture:input},bytes,{bytesPerRow:size*4},[size,size])
  for(let base=0;size>1;base+=2){
   const encoder=device.createCommandEncoder(),next=[]
   for(let step=1;step<=2&&size>>step;step++){
    const extent=size>>step,t=make(extent),pipeline=pipelines[step===1?'one':'two']
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:input.createView()}]})
    const pass=encoder.beginRenderPass({colorAttachments:[{view:t.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();next.push({t,extent})
   }
   device.queue.submit([encoder.finish()])
   for(const{t,extent}of next)levels.push({data:await read(t,extent),width:extent,height:extent})
   input=next.at(-1).t;size=next.at(-1).extent
  }
  const error=await device.popErrorScope();scopeOpen=false;if(error)errors.push(error.message);if(errors.length)throw Error(errors.join('\n'))
  return {levels,model:'paired-pow2-bsl-shared-srgb-typed-attachment-v1',format,shader:common,errors,ownedTextures:owned.length,readbackBuffers:buffers.length}
 }finally{try{if(scopeOpen)await device.popErrorScope()}finally{for(const b of buffers)b.destroy();for(const t of owned)t.destroy()}}
}
