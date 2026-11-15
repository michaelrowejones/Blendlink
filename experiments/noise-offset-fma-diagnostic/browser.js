import * as THREE from'three';
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu';
import{glsl,wgsl,glslFn,wgslFn,vec3,vec4,float,uint,uniform,select,screenCoordinate}from'three/tsl';
import{compositorCpuUintRne}from'@diagnostic-rne';
import{buildNativeNoiseFma}from'@diagnostic-fma';
import{roundCompositorNoiseF32}from'@diagnostic-round';

const planes=['seed','hash-low','hash-high','uint-float','unit','offset','fma','unit-rne','fma-rne','separate'];
window.offsetDiagnostic=async({backend:wanted,module})=>{
 const renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false});
 const result={backend:wanted,status:'running',rows:[],errors:[],supportCredit:0};window.offsetFailure=result;
 await renderer.init();const gpu=renderer.backend.isWebGPUBackend===true;if((gpu?'webgpu':'webgl2')!==wanted)throw Error('Actual API fallback');
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=renderer.backend.device?.adapterInfo;
 result.gpu=gpu?{vendor:info?.vendor,architecture:info?.architecture,description:info?.description}:{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};
 renderer.debug.onShaderError=(g,p,v,f)=>result.errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'));
 renderer.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)));
 renderer.setSize(2,1);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 const library=(gpu?wgsl:glsl)(gpu?module.wgslLibrary:module.glslLibrary),fn=(gpu?wgslFn:glslFn);
 const sources=gpu?{
  hash:'fn offset_diag_hash(seed:f32)->vec3<u32>{return vec3<u32>(hash_uint2_(bitcast<u32>(seed),0u),hash_uint2_(bitcast<u32>(seed),1065353216u),hash_uint2_(bitcast<u32>(seed),1073741824u));}',
  unit:'fn offset_diag_unit(seed:f32)->vec3<f32>{return vec3<f32>(hash_vec2_to_float(vec2<f32>(seed,0f)),hash_vec2_to_float(vec2<f32>(seed,1f)),hash_vec2_to_float(vec2<f32>(seed,2f)));}',
  offset:'fn offset_diag_original(seed:f32)->vec3<f32>{return random_vec3_offset(seed);}'
 }:{
  hash:'uvec3 offset_diag_hash(float seed){return uvec3(hash_uint2_(floatBitsToUint(seed),0u),hash_uint2_(floatBitsToUint(seed),1065353216u),hash_uint2_(floatBitsToUint(seed),1073741824u));}',
  unit:'vec3 offset_diag_unit(float seed){return vec3(hash_vec2_to_float(vec2(seed,0.0)),hash_vec2_to_float(vec2(seed,1.0)),hash_vec2_to_float(vec2(seed,2.0)));}',
  offset:'vec3 offset_diag_original(float seed){return random_vec3_offset(seed);}'
 };
 const functions=Object.fromEntries(Object.entries(sources).map(([key,code])=>[key,fn(code,[library])]));
 const seeds=uniform(new THREE.Vector2(3,4)),left=screenCoordinate.x.lessThan(1);
 function stage(plane,seed){
  if(plane==='seed')return vec4(seed,0,0,1);
  const h=functions.hash(seed),unitValue=functions.unit(seed);
  if(plane==='hash-low')return vec4(vec3(h.bitAnd(uint(65535))),1);
  if(plane==='hash-high')return vec4(vec3(h.x.shiftRight(uint(16)),h.y.shiftRight(uint(16)),h.z.shiftRight(uint(16))),1);
  if(plane==='uint-float')return vec4(vec3(h),1);
  if(plane==='unit')return vec4(unitValue,1);
  if(plane==='offset')return vec4(functions.offset(seed),1);
  const rne=vec3(compositorCpuUintRne(h.x),compositorCpuUintRne(h.y),compositorCpuUintRne(h.z));
  if(plane==='unit-rne')return vec4(rne,1);
  if(plane==='fma'||plane==='fma-rne'){
   const v=plane==='fma'?unitValue:rne;
   return vec4(vec3(...['x','y','z'].map(c=>buildNativeNoiseFma(v[c],float(100),float(100)))),1);
  }
  if(plane==='separate')return vec4(vec3(...['x','y','z'].map(c=>roundCompositorNoiseF32(roundCompositorNoiseF32(unitValue[c].mul(100)).add(100)))),1);
  throw Error('Unknown diagnostic plane');
 }
 try{for(const mode of['literal','uniform'])for(const plane of planes){
  const row={mode,plane,status:'running'};result.rows.push(row);
  const material=new NodeMaterial();material.blending=THREE.NoBlending;material.depthTest=false;material.depthWrite=false;
  material.fragmentNode=select(left,stage(plane,mode==='literal'?float(3):seeds.x),stage(plane,mode==='literal'?float(4):seeds.y));
  const target=new THREE.RenderTarget(2,1,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;
  const quad=new QuadMesh(material),device=renderer.backend.device;device?.pushErrorScope('validation');
  try{
   renderer.setRenderTarget(target);const t=performance.now();let timeout;
   const shaders=await Promise.race([renderer.debug.getShaderAsync(quad,quad.camera,quad),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('20 second compile ceiling')),20000)})]).finally(()=>clearTimeout(timeout));row.compileMs=performance.now()-t;
   row.fragmentShader=shaders.fragmentShader;row.vertexShader=shaders.vertexShader;quad.render(renderer);
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,2,1);if(!(pixels instanceof Float32Array)||pixels.length!==8)throw Error('Expected2×1F32');row.words=[...new Uint32Array(pixels.buffer,pixels.byteOffset,8)];row.status='captured';
  }catch(error){row.status='failed';row.error=String(error);}
  const error=await device?.popErrorScope();if(error){row.status='failed';row.validation=error.message;}
  renderer.setRenderTarget(null);target.dispose();material.dispose();row.remainingTextures=renderer.info.memory.textures;
  if(row.status!=='captured'||row.remainingTextures!==0)throw Error('Diagnostic failed: '+mode+'/'+plane);
 }}finally{renderer.dispose();}
 if(result.errors.length)throw Error('GPU diagnostics');result.status='OFFSET_STAGES_CAPTURED';return result;
};
