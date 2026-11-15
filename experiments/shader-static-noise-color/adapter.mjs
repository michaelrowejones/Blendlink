import{glsl,wgsl,glslFn,wgslFn}from'three/tsl';
export const availableKinds=Object.freeze(['noise-fbm3-default','noise-twice','noise-to-voronoi-first']);
const MODEL='native-metal53-m5pro-static-noise-color-3d-fbm-default-v1';
export function makeBridge(module){
 if(module?.model!==MODEL||module.tableProfile?.nativeBuild!=='02f0899d78e3'||module.tableProfile?.backend!=='METAL'||module.tableProfile?.vendor!=='Apple M5 Pro')throw Error('Unsupported static Noise precision profile');
 const cache=new WeakMap();
 return{availableKinds,createVariant({renderer,mode,kind,inputs}){
  if(mode!=='native-generated'||!availableKinds.includes(kind))throw Error('Only declared static Noise variants are available');
  if(!inputs?.vector||Object.keys(inputs).some(k=>k!=='vector'))throw Error('Only explicit vec3 input is allowed; source controls are frozen');
  if(!renderer?.backend)throw Error('Actual initialized renderer required');
  const gpu=renderer.backend.isWebGPUBackend===true,gl=renderer.backend.isWebGLBackend===true;if(!gpu&&!gl)throw Error('Unknown renderer');
  if(!cache.has(renderer)){
   const lib=(gpu?wgsl:glsl)(gpu?module.wgslLibrary:module.glslLibrary);
   const fns=Object.fromEntries(Object.entries(gpu?module.wgslFunctions:module.glslFunctions).map(([n,code])=>[n,(gpu?wgslFn:glslFn)(code,[lib])]));cache.set(renderer,fns);
  }
  const fns=cache.get(renderer),first=fns.bridge_noise_static(inputs.vector);
  const node=kind==='noise-twice'?fns.bridge_noise_static(first.rgb):kind==='noise-to-voronoi-first'?fns.bridge_voronoi_first(first.rgb):first;
  return{node,dispose(){},metadata:{kind,mode,model:MODEL,kernelSourceSha256:module.sourceSha256,sourcePrecisionProfile:module.tableProfile,tableAuthoritySha256:module.tableAuthoritySha256,parameterContract:{dimensions:3,type:'FBM',scale:5,detail:2,roughness:.5,lacunarity:2,distortion:0,normalize:true},outputContract:kind==='noise-to-voronoi-first'?'Color.rgb,Distance':'Color.rgb,Fac',resourceSignature:{kernelTextures:0,kernelRenderPasses:0},staticOffsetWords:true,supportCredit:0}};
 }};
}
