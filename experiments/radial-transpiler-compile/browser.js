import*as THREE from'three'
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu'
import{bool,float,floor,select,sqrt,uv,vec2,vec4}from'three/tsl'
import{calculate_out_variables}from'./candidate.js'
const hash=async source=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),b=>b.toString(16).padStart(2,'0')).join('')
window.compileRadialResearch=async({backend:wanted,variant,maximumShaderBytes,maximumCompileMs})=>{
 const webgl=wanted==='webgl2',adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw Error('Research requires actual WebGPU adapter')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]});const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Actual renderer fallback')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??renderer.backend.device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.setSize(8,8);renderer.setPixelRatio(1);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
 const rows=[],uncaptured=[];renderer.debug.onShaderError=(g,p,v,f)=>uncaptured.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'));renderer.backend.device?.addEventListener('uncapturederror',event=>uncaptured.push(String(event.error)))
 const programs=[{case:'independent-input-control',control:true},...['fractional','demo-stepped'].flatMap(field=>[false,true].map(normalize=>({case:field+'-'+(normalize?'normalized':'raw'),field,normalize})))]
 try{for(const spec of programs){
  const material=new NodeMaterial(),target=new THREE.RenderTarget(8,8,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
  const p=spec.field==='demo-stepped'?uv().mul(2).sub(1).mul(vec2(1.000370979309082,1.0028247833251953)):uv().mul(4).sub(2)
  const radius=sqrt(p.x.mul(p.x).add(p.y.mul(p.y))),mapped=floor(radius.mul(2)).mul(4).add(4),sides=spec.field==='demo-stepped'?select(mapped.greaterThan(4),mapped,float(3)):uv().x.mul(5).add(3)
  const value=spec.control?null:calculate_out_variables(bool(true),bool(false),bool(spec.normalize),sides,float(1),p)
  material.fragmentNode=spec.control?vec4(p,0,1):vec4(value.y,value.x,0,1)
  const quad=new QuadMesh(material),row={case:spec.case,field:spec.field,normalize:spec.normalize,status:'running',errors:[]};rows.push(row);const device=renderer.backend.device;device?.pushErrorScope('validation')
  try{
   const start=performance.now();let timeout;const shaders=await Promise.race([renderer.debug.getShaderAsync(quad,quad.camera,quad),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Predeclared build and compile time ceiling exceeded')),maximumCompileMs)})]).finally(()=>clearTimeout(timeout));row.buildAndCompileMs=performance.now()-start;row.vertexShader=shaders.vertexShader;row.fragmentShader=shaders.fragmentShader;row.fragmentBytes=new TextEncoder().encode(shaders.fragmentShader).length;row.fragmentSha256=await hash(shaders.fragmentShader)
   if(row.fragmentBytes>maximumShaderBytes)throw Error('Predeclared shader cost ceiling exceeded')
   // getShaderAsync already compiles; no second cached compile is a performance claim.
   renderer.setRenderTarget(target);quad.render(renderer);const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8);if(!(pixels instanceof Float32Array))throw Error('Float32 diagnostic readback required')
   const stride=pixels.length===256?8:backend==='webgpu'&&pixels.length===480?16:0;if(!stride)throw Error('Unknown diagnostic row layout')
   const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),selected=[];let nonfinite=0
   for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++){const index=(y*stride+x)*4+c;selected.push(words[index]);if(!Number.isFinite(pixels[index]))nonfinite++}
   row.readbackWords=selected;row.nonfiniteComponents=nonfinite;row.status='compiled-and-drawn'
  }catch(error){row.status='compile-failed';row.error=String(error);row.stack=String(error.stack)}
  const validation=await device?.popErrorScope();if(validation){row.errors.push(validation.message);row.status='compile-failed'}
  renderer.setRenderTarget(null);target.dispose();material.dispose();row.remainingTextures=renderer.info.memory.textures;row.remainingRenderTargets=renderer.info.memory.renderTargets
  if(row.remainingTextures!==0)throw Error('Research retained owned textures')
  if(row.status==='compile-failed')break
 }}finally{renderer.dispose();supplied?.destroy()}
 return{variant,backend,gpu,rows,uncaptured,numericalCases:0,supportCredit:0,officialSceneAcceptance:false}
}
