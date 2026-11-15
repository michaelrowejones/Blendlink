import * as THREE from 'three';
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu';
import {screenCoordinate,ivec2,textureLoad,vec4}from'three/tsl';
import{makeBridge,availableKinds}from'./adapter.mjs';

window.captureStaticNoiseColor=async({backend:wanted,module,inputWords})=>{
 const renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false});
 const result={backend:wanted,status:'running',rows:[],errors:[],supportCredit:0};window.staticNoiseFailure=result;
 await renderer.init();const gpu=renderer.backend.isWebGPUBackend===true;
 if((gpu?'webgpu':'webgl2')!==wanted)throw Error('Actual API fallback');
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=renderer.backend.device?.adapterInfo;
 result.gpu=gpu?{vendor:info?.vendor,architecture:info?.architecture,description:info?.description}:{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};
 renderer.debug.onShaderError=(g,p,v,f)=>result.errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'));
 renderer.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)));
 renderer.setSize(8,8);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 const data=new Float32Array(new Uint32Array(inputWords).buffer),input=new THREE.DataTexture(data,8,8,THREE.RGBAFormat,THREE.FloatType);
 input.colorSpace=THREE.NoColorSpace;input.minFilter=input.magFilter=THREE.NearestFilter;input.flipY=false;input.generateMipmaps=false;input.needsUpdate=true;
 const p=textureLoad(input,ivec2(screenCoordinate.xy)).rgb,bridge=makeBridge(module);
 try{for(const kind of ['input',...availableKinds]){
  const row={case:kind,status:'running'};result.rows.push(row);
  const material=new NodeMaterial();material.blending=THREE.NoBlending;material.depthTest=false;material.depthWrite=false;
  const variant=kind==='input'?null:bridge.createVariant({renderer,mode:'native-generated',kind,inputs:{vector:p}});
  material.fragmentNode=variant?.node??vec4(p,1);
  const target=new THREE.RenderTarget(8,8,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;
  const quad=new QuadMesh(material),device=renderer.backend.device;device?.pushErrorScope('validation');
  try{
   renderer.setRenderTarget(target);
   const t=performance.now();let timeout;
   const shaders=await Promise.race([renderer.debug.getShaderAsync(quad,quad.camera,quad),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Predeclared 20 second compile ceiling')),20000)})]).finally(()=>clearTimeout(timeout));row.compileMs=performance.now()-t;
   row.vertexShader=shaders.vertexShader;row.fragmentShader=shaders.fragmentShader;row.fragmentBytes=new TextEncoder().encode(shaders.fragmentShader).length;
   if(row.fragmentBytes>262144)throw Error('Predeclared 256 KiB shader ceiling');
   quad.render(renderer);
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8);if(!(pixels instanceof Float32Array))throw Error('F32 readback required');
   const stride=pixels.length===256?8:gpu&&pixels.length===480?16:0;if(!stride)throw Error('Unexpected row padding');
   const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length);row.words=[];
   for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++)row.words.push(words[(y*stride+x)*4+c]);
   row.metadata=variant?.metadata;row.status='compiled-and-drawn';
   if(kind!=='input'){
    const regex=gpu?/^fn (\w+)\s*\(/gm:/^\w+ (\w+)\s*\(/gm;
    const names=[...shaders.fragmentShader.matchAll(regex)].map(m=>m[1]);
    const generated=names.filter(n=>n.startsWith('bridge_'));row.wrapperDefinitionCounts=Object.fromEntries([...new Set(generated)].map(n=>[n,generated.filter(x=>x===n).length]));
    if(Object.values(row.wrapperDefinitionCounts).some(n=>n!==1))throw Error('Duplicate shared wrapper definition');
   }
  }catch(error){row.status='failed';row.error=String(error);}
  const error=await device?.popErrorScope();if(error){row.status='failed';row.validation=error.message;}
  renderer.setRenderTarget(null);target.dispose();material.dispose();variant?.dispose();row.remainingTextures=renderer.info.memory.textures;
  if(row.status==='failed')throw Error('Kernel case failed: '+kind);
 }}finally{input.dispose();result.remainingTextures=renderer.info.memory.textures;renderer.dispose();}
 if(result.errors.length)throw Error('Shader diagnostics');if(result.remainingTextures!==0)throw Error('Owned input/target leak');
 result.status='STATIC_NOISE_COLOR_CAPTURED';return result;
};
