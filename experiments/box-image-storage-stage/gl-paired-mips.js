// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2021 NVIDIA Corporation
// SPDX-FileCopyrightText: 2026 Blender Foundation
// Paired power-of-two mip/shared-transfer behavior transcribed from the Apache
// BSL source. UNORM packing below independently follows IEEE binary32 and
// nearest-even integer quantization, avoiding an extra floating multiply.
export async function pairedGlMips(bytes,size){
 const started=performance.now(),canvas=new OffscreenCanvas(1,1),gl=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,premultipliedAlpha:false})
 if(!gl)throw Error('A WebGL2 context is required for typed sRGB mip generation')
 const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu={api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 if(!/apple|metal/i.test(JSON.stringify(gpu)))throw Error('Typed sRGB generator requires its observed Metal profile')
 const textures=[],shaders=[],programs=[],errors=[],levels=[{data:bytes,width:size,height:size}]
 const vertex=`#version 300 es
 precision highp float;
 void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`
 const fragment=`#version 300 es
 precision highp float;precision highp int;
 uniform sampler2D sourceImage;uniform int outputStep;out vec4 outputColor;
 float decode(float c){if(c<0.04045)return c<0.0?0.0:c*(1.0/12.92);return pow((c+0.055)*(1.0/1.055),2.4);}
 float encode(float c){if(c<0.0031308)return c<0.0?0.0:c*12.92;return 1.055*pow(c,1.0/2.4)-0.055;}
 float normalizedByte(float x){
  uint bits=floatBitsToUint(clamp(x,0.0,1.0));uint exponent=(bits>>23u)&255u;
  if(exponent<118u)return 0.0;
  uint product=((bits&0x7fffffu)|0x800000u)*255u;uint integer;
  if(exponent==118u){integer=product>0x80000000u?1u:0u;}
  else{uint shift=150u-exponent;integer=product>>shift;uint remainder=product&((1u<<shift)-1u);uint halfway=1u<<(shift-1u);if(remainder>halfway||(remainder==halfway&&(integer&1u)!=0u))integer++;}
  return float(integer)/255.0;
 }
 vec4 first(ivec2 c){ivec2 p=c*2;vec4 a=texelFetch(sourceImage,p,0);vec4 b=texelFetch(sourceImage,p+ivec2(0,1),0);vec4 c1=texelFetch(sourceImage,p+ivec2(1,0),0);vec4 d=texelFetch(sourceImage,p+ivec2(1,1),0);return 0.5*(0.5*(a+b)+0.5*(c1+d));}
 vec4 intermediate(ivec2 c){vec4 v=first(c);vec4 e=vec4(encode(v.r),encode(v.g),encode(v.b),v.a);vec4 q=vec4(normalizedByte(e.r),normalizedByte(e.g),normalizedByte(e.b),normalizedByte(e.a));return vec4(decode(q.r),decode(q.g),decode(q.b),q.a);}
 void main(){ivec2 c=ivec2(gl_FragCoord.xy);if(outputStep==1)outputColor=first(c);else{c*=2;outputColor=0.5*(0.5*(intermediate(c)+intermediate(c+ivec2(0,1)))+0.5*(intermediate(c+ivec2(1,0))+intermediate(c+ivec2(1,1))));}}`
 let framebuffer,vao,completed=false
 canvas.addEventListener('webglcontextlost',event=>{if(!completed)errors.push('Unexpected WebGL2 generation context loss');event.preventDefault()})
 try{
  const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader}
  const program=gl.createProgram();programs.push(program);gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program))
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'sourceImage'),0)
  framebuffer=gl.createFramebuffer();vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer)
  gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1)
  const make=extent=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texStorage2D(gl.TEXTURE_2D,1,gl.SRGB8_ALPHA8,extent,extent);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return t}
  let input=make(size);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,bytes)
  while(size>1){
   const outputs=[]
   for(let step=1;step<=2&&(size>>step)>0;step++){
    const extent=size>>step,t=make(extent);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0)
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Typed sRGB attachment is not complete')
    if(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING)!==gl.SRGB)throw Error('Attachment is not actual sRGB')
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(gl.getUniformLocation(program,'outputStep'),step);gl.viewport(0,0,extent,extent);gl.drawArrays(gl.TRIANGLES,0,3)
    const data=new Uint8Array(extent*extent*4);gl.readPixels(0,0,extent,extent,gl.RGBA,gl.UNSIGNED_BYTE,data)
    const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('WebGL2 mip operation failed: '+error)
    outputs.push({t,extent});levels.push({data,width:extent,height:extent})
   }
   input=outputs.at(-1).t;size=outputs.at(-1).extent
  }
  if(errors.length)throw Error(errors.join('\n'))
  return{levels,model:'paired-pow2-bsl-shared-srgb-gl2-typed-v1',format:'rgba8unorm-srgb',gpu,vertexShader:vertex,fragmentShader:fragment,errors,ownedTextures:textures.length,readbackBuffers:0,generationMs:performance.now()-started}
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(null);gl.bindVertexArray(null)
  if(framebuffer)gl.deleteFramebuffer(framebuffer);if(vao)gl.deleteVertexArray(vao)
  for(const p of programs)gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);for(const t of textures)gl.deleteTexture(t)
  if(textures.some(t=>gl.isTexture(t)))throw Error('Owned WebGL2 mip texture did not release')
  completed=true;gl.getExtension('WEBGL_lose_context')?.loseContext()
 }
}
