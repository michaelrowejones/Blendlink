import{glsl,wgsl,glslFn,wgslFn,vec4}from'three/tsl';
import{makeBridge as makeGenericBridge,makeHandTsl,parameterContracts}from'../shader-kernel-bridge-next/adapter.mjs';
export{makeHandTsl};
export const availableKinds=Object.freeze(['noise-fbm3-default','voronoi-f1-3d-default']);

export function makeBridge(module,{buildHandTsl,handSourceSha256,projection}={}){
 if(projection!=='scalar')throw Error('Output-specialized bridge requires explicit scalar projection; Color is unqualified');
 if(module?.model!=='native-output-aware-scalar-pilot-v1')throw Error('Wrong specialized source model');
 const hand=makeGenericBridge(module,{buildHandTsl,handSourceSha256}),cache=new WeakMap();
 function nativeFunctions(renderer){
  if(cache.has(renderer))return cache.get(renderer);
  const gpu=renderer?.backend?.isWebGPUBackend===true,gl=renderer?.backend?.isWebGLBackend===true;
  if(!gpu&&!gl)throw Error('Actual initialized renderer required');
  const library=(gpu?wgsl:glsl)(gpu?module.wgslLibrary:module.glslLibrary);
  const functions=Object.fromEntries(Object.entries(gpu?module.wgslFunctions:module.glslFunctions).map(([name,code])=>[name,(gpu?wgslFn:glslFn)(code,[library])]));cache.set(renderer,functions);return functions;
 }
 return{availableKinds,createVariant({renderer,mode,kind,inputs}){
  if(!availableKinds.includes(kind)||!['native-generated','hand-tsl'].includes(mode))throw Error('Unsupported specialized kind or mode');
  if(!inputs?.vector||Object.keys(inputs).some(k=>k!=='vector'))throw Error('Only explicit vector input is admitted; controls are static');
  let node,inner;
  if(mode==='hand-tsl'){inner=hand.createVariant({renderer,mode,kind,inputs});node=inner.node;}
  else{const f=nativeFunctions(renderer),value=(kind==='noise-fbm3-default'?f.bridge_noise_fac:f.bridge_voronoi_distance)(inputs.vector);node=vec4(0,0,0,value);}
  const selected=kind==='noise-fbm3-default'?'Fac':'Distance';
  return{node,update(){inner?.update();},dispose(){inner?.dispose();},metadata:{mode,kind,parameterContract:{...parameterContracts[kind],output:selected},outputContract:'lane3 '+selected+'; otherlanes unqualified',kernelSourceSha256:mode==='native-generated'?module.sourceSha256:handSourceSha256,resourceSignature:{kernelTextures:0,kernelRenderPasses:0},nativeImplementation:mode==='native-generated'?{model:module.model,selectedOutput:selected,compute_color:kind==='noise-fbm3-default'?0:undefined,voronoiDetailZeroLeaf:kind==='voronoi-f1-3d-default'}:undefined,supportCredit:0}};
 }};
}
