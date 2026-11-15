import {glsl, wgsl, glslFn, wgslFn,vec4} from 'three/tsl';

export const parameterContracts = Object.freeze({
 'gradient-radial':{mode:4,output:'Color.rgb,Fac'},
 'checker':{scale:3,color1:[.125,.25,.5,.75],color2:[.875,.625,.375,.125],output:'Color.rgb,Fac'},
 'white-three':{dimensions:3,output:'Color.rgb,Value'},
 'noise-fbm3-default':{dimensions:3,type:'FBM',scale:5,detail:2,roughness:.5,lacunarity:2,offset:0,gain:1,distortion:0,normalize:true,output:'Color.rgb,Fac'},
 'voronoi-f1-3d-default':{dimensions:3,feature:'F1',scale:5,detail:0,roughness:.5,lacunarity:2,smoothness:1,exponent:.5,randomness:1,metric:0,normalize:false,output:'Color.rgb,Distance'},
 'voronoi-f2-3d-default':{dimensions:3,feature:'F2',scale:5,detail:0,roughness:.5,lacunarity:2,smoothness:1,exponent:.5,randomness:1,metric:0,normalize:false,output:'Color.rgb,Distance'},
 'noise-to-voronoi-first':{first:'noise-fbm3-default',second:'voronoi-f1-3d-default',coordinate:'first.rgb',output:'second.Color.rgb,Distance'},
 'noise-twice':{first:'noise-fbm3-default',second:'noise-fbm3-default',coordinate:'first.rgb',output:'second.Color.rgb,Fac'},
});
const names={'gradient-radial':'bridge_gradient',checker:'bridge_checker','white-three':'bridge_white','noise-fbm3-default':'bridge_noise','voronoi-f1-3d-default':'bridge_voronoi_first','voronoi-f2-3d-default':'bridge_voronoi_second'};
export const availableKinds=Object.freeze(Object.keys(parameterContracts));

// Bind the actual existing SDK builders. The benchmark supplies the pinned
// production module namespace and retained emitter offsets; no kernel is copied.
export function makeHandTsl(production,{colorOffsets}={}){
 if(typeof production?.buildTslColorNode!=='function'||typeof production?.buildTslScalarNode!=='function')throw Error('Actual production TSL module required');
 if(!Array.isArray(colorOffsets)||colorOffsets.length!==2)throw Error('Source-emitter Noise offsets required');
 const document=output=>({schemaVersion:1,model:'blendlink-tsl-ir-v1',output});
 return (kind,vector)=>{
  const coordinate={op:'attribute_object',name:'bridgeVector',output:'color'};
  const options={objectAttribute:name=>{if(name!=='bridgeVector')throw Error('Unexpected coordinate binding');return vector;}};
  let expression;
  if(kind==='noise-fbm3-default')expression={op:'noise_normalized',perlinModel:'native-standard-f32',normalize:true,noiseType:'FBM',dimensions:3,input:coordinate,scale:{op:'const_float',value:5},detail:2,roughness:.5,lacunarity:2,colorOffsets};
  else if(kind==='voronoi-f1-3d-default')expression={op:'tex_voronoi',dimensions:3,feature:'f1',vector:coordinate,scale:{op:'const_float',value:5},randomness:{op:'const_float',value:1}};
  else throw Error('No source-matched existing TSL comparison for '+kind);
  const color=production.buildTslColorNode(document({...expression,output:'color'}),options);
  const scalar=kind==='noise-fbm3-default'?color.r:production.buildTslScalarNode(document({...expression,output:'distance'}),options);
  return vec4(color,scalar);
 };
}

// One module CodeNode per renderer, shared by all six wrappers and all calls.
// No identifier substitution, resource allocation or runtime shader translation.
export function makeBridge(module,{buildHandTsl,handSourceSha256}={}){
 if(!module||!['glslLibrary','wgslLibrary','glslFunctions','wgslFunctions'].every(k=>module[k]))throw Error('Missing generated combined module');
 const cache=new WeakMap();
 function functions(renderer){
  if(!renderer?.backend)throw Error('Initialized actual renderer required');
  if(cache.has(renderer))return cache.get(renderer);
  const gpu=renderer.backend.isWebGPUBackend===true,gl=renderer.backend.isWebGLBackend===true;
  if(!gpu&&!gl)throw Error('Unknown actual renderer backend');
  const library=(gpu?wgsl:glsl)(gpu?module.wgslLibrary:module.glslLibrary);
  const fns=Object.fromEntries(Object.entries(gpu?module.wgslFunctions:module.glslFunctions).map(([name,source])=>[name,(gpu?wgslFn:glslFn)(source,[library])]));
  cache.set(renderer,fns);return fns;
 }
 return {availableKinds,createVariant({renderer,mode,kind,inputs}){
  if(!availableKinds.includes(kind))throw Error('Unknown bridge kind: '+kind);
  if(!['hand-tsl','native-generated'].includes(mode))throw Error('Explicit bridge implementation mode required');
  if(!inputs?.vector||Object.keys(inputs).some(k=>k!=='vector'))throw Error('Bridge requires only an explicit vec3 input; settings are frozen');
  if(mode==='hand-tsl'&&typeof buildHandTsl!=='function')throw Error('No production TSL builder supplied; no fallback');
  const fns=mode==='native-generated'?functions(renderer):null;
  const build=(name,vector)=>mode==='native-generated'?fns[names[name]](vector):buildHandTsl(name,vector,parameterContracts[name]);
  let node;
  if(kind==='noise-to-voronoi-first'||kind==='noise-twice'){
   const first=build('noise-fbm3-default',inputs.vector);
   node=build(kind==='noise-twice'?'noise-fbm3-default':'voronoi-f1-3d-default',first.rgb);
  }else node=build(kind,inputs.vector);
  return {node,update(){},dispose(){},metadata:{mode,kind,parameterContract:parameterContracts[kind],outputContract:parameterContracts[kind].output,kernelSourceSha256:mode==='native-generated'?module.sourceSha256:handSourceSha256,resourceSignature:{kernelTextures:0,kernelRenderPasses:0},libraryScope:'one shared combined module per actual renderer',composed:kind==='noise-to-voronoi-first'||kind==='noise-twice',supportCredit:0}};
 }};
}
