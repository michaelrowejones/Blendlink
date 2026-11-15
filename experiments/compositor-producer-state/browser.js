import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {pass} from 'three/tsl'
import {realizeCompositorOrigin} from '@image-domain'
import {buildSourceCompositor} from '@source-compositor'
const assert=(v,m)=>{if(!v)throw Error(m)}
const fail=m=>{throw Error(m)}
const compare=(a,b,label)=>{assert(a.length===b.length,label+' extent');const x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);let diff=0;const examples=[];for(let i=0;i<x.length;i++)if(x[i]!==y[i]){diff++;if(examples.length<12)examples.push({i,actual:a[i],expected:b[i],actualWord:x[i],expectedWord:y[i]})}assert(diff===0,label+' word differences '+diff+' '+JSON.stringify(examples));return x.length}
window.runProducerStateControls=async wanted=>{
 const adapter=wanted==='webgpu'?await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}):null
 if(wanted==='webgpu'&&!adapter)throw Error('Actual adapter required')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(supplied?{device:supplied}:{})})
 await renderer.init();const backend=renderer.backend,gl=backend.gl,api=backend.isWebGPUBackend?'webgpu':'webgl2';assert(api===wanted,'Unexpected actual backend fallback')
 const debug=gl?.getExtension('WEBGL_debug_renderer_info'),identity=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],uncaptured=[],rows=[];let ending=false
 renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));supplied?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));supplied?.lost.then(e=>{if(!ending)uncaptured.push(String(e.message))})
 const w=13,h=9,sourceScene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10),geo=new THREE.PlaneGeometry(1,1),mat=new THREE.MeshBasicMaterial({color:new THREE.Color(.25,.5,.75),side:THREE.DoubleSide}),mesh=new THREE.Mesh(geo,mat)
 sourceScene.add(mesh);camera.position.z=2
 renderer.setSize(w,h);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.LinearSRGBColorSpace
 const output=new THREE.RenderTarget(w,h,{type:THREE.FloatType,depthBuffer:false}),sourcePass=pass(sourceScene,camera),source=sourcePass.getTextureNode(),entries=[]
 let expectedHook=null,hookCalls=0
 const originalPass=sourcePass.updateBefore.bind(sourcePass)
 sourcePass.updateBefore=frame=>{entries.push({alpha:renderer.getClearAlpha(),color:renderer.getClearColor(new THREE.Color()).toArray(),tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,hook:renderer.getRenderObjectFunction()===expectedHook,frame:frame.frameId});return originalPass(frame)}
 const hook=(...args)=>{hookCalls++;const old=mat.color.clone();mat.color.setRGB(.75,.125,.375);try{return renderer.renderObject(...args)}finally{mat.color.copy(old)}}
 const read=async target=>{const a=await renderer.readRenderTargetPixelsAsync(target,0,0,w,h);assert(a instanceof Float32Array,'Actual Float32 readback required');const padded=Math.ceil(w*16/256)*16,stride=a.length===w*h*4?w:api==='webgpu'&&[padded*h*4,(padded*(h-1)+w)*4].includes(a.length)?padded:0;assert(stride,'Readback layout');const dense=new Float32Array(w*h*4);for(let y=0;y<h;y++)dense.set(a.subarray(y*stride*4,(y*stride+w)*4),y*w*4);return dense}
 const draw=quad=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(output);quad.render(renderer);resolve()}catch(e){reject(e)}}).catch(reject))
 const rawMaterial=new NodeMaterial();rawMaterial.fragmentNode=source;const rawQuad=new QuadMesh(rawMaterial)
 const constant=(type,value)=>({name:'',socketType:type,value:{kind:'constant',type,value}})
 try{
  supplied?.pushErrorScope('validation')
  for(const state of[{name:'transparent',alpha:0,color:[0,0,0],tone:THREE.NoToneMapping,exposure:1,hook:null},{name:'custom-clear-hook',alpha:.25,color:[.125,.25,.5],tone:THREE.ACESFilmicToneMapping,exposure:2,hook}]){
   renderer.setClearColor(new THREE.Color(...state.color),state.alpha);renderer.toneMapping=state.tone;renderer.toneMappingExposure=state.exposure;expectedHook=state.hook;renderer.setRenderObjectFunction(expectedHook)
   await draw(rawQuad);const reference=await read(output),referenceHooks=hookCalls;assert(reference.some((v,i)=>i%4===3&&v<1),'Independent clear-alpha reference missing')
   for(const mode of['integer','fractional','affine','crop','wrapped-relative-blur']){
    const resources=[],before=entries.length,beforeHooks=hookCalls;let built,node
    if(mode==='wrapped-relative-blur'){
     const p={scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA'},src=(nodeType,node,output)=>({path:['Compositor'],node,nodeType,output}),ref=id=>({kind:'ref',type:'RGBA',node:id})
     const program={version:1,status:'extracted',passes:[p],diagnostics:[],ops:[{id:'pass',kind:'render-pass',type:'RGBA',source:src('CompositorNodeRLayers','Render Layers','Image'),properties:{},inputs:{},pass:p},{id:'exposure',kind:'exposure',type:'RGBA',source:src('CompositorNodeExposure','Exposure','Image'),properties:{},inputs:{Image:{name:'Image',socketType:'RGBA',value:ref('pass')},Exposure:constant('VALUE',0)}},{id:'blur',kind:'blur',type:'RGBA',source:src('CompositorNodeBlur','Artist Blur','Image'),properties:{blur_model:'legacy-cpu-f32-v1',blur_weights:[[.5,.25],[.5,.25]],blur_relative_model:'legacy-percent-f32-v1',blur_relative_percent:[12.5,25],blur_relative_aspect:'NONE',blur_relative_multiplier:1},inputs:{Image:{name:'Image',socketType:'RGBA',value:ref('exposure')},Size:constant('VECTOR',[1,1]),Type:constant('MENU','Tent'),'Extend Bounds':constant('BOOLEAN',false),Separable:constant('BOOLEAN',true)}}],output:ref('blur')}
     built=buildSourceCompositor(program,()=>source);node=built.node
    }else{
     const origin={x:mode==='fractional'?.25:0,y:0,maxPixels:4194304,roots:[{node:source,extent:()=>[w,h]}],sampling:{model:'modern-cpu-v1',interpolation:'Nearest'},...(mode==='affine'?{affineMatrix:[1.1,0,0,0,1,0,0,0,1]}:mode==='crop'?{croppedWindow:{resolve:()=>({width:w,height:h,model:'modern-cpu-v1',dataSize:[w,h],displaySize:[w,h],dataOffset:[0,0]})}}:{})}
     node=realizeCompositorOrigin(source,origin,[0,0],resources,fail)
    }
    const material=new NodeMaterial();material.fragmentNode=node;const quad=new QuadMesh(material)
    try{
     await draw(quad);const actual=await read(output),fresh=entries.slice(before);assert(fresh.length===1,'Actual FRAME producer rendered '+fresh.length+' times: '+mode)
     const e=fresh[0];assert(e.alpha===state.alpha&&JSON.stringify(e.color)===JSON.stringify(state.color)&&e.tone===state.tone&&e.exposure===state.exposure&&e.hook,'Producer observed reset state: '+JSON.stringify(e));assert(!state.hook||hookCalls>beforeHooks,'Forwarded render hook did not run')
     assert(renderer.getClearAlpha()===state.alpha&&renderer.getRenderObjectFunction()===expectedHook&&renderer.getRenderTarget()===output&&renderer.toneMapping===state.tone&&renderer.toneMappingExposure===state.exposure,'Caller state not restored')
     const copied=mode==='integer'?compare(actual,reference,'Independent public PassTexture sampler copy RGBA'):0
     assert(actual.every(Number.isFinite),'Nonfinite state control output')
     rows.push({state:state.name,mode,producerFrames:fresh.length,entry:e,exactIdentityWords:copied,forwardedHookCalls:hookCalls-beforeHooks,callerStateRestored:true,referenceStage:'public-PassTexture-default-sampler-copy',samplingQualificationCredit:0})
    }finally{built?.dispose();for(const owner of resources.reverse())owner.dispose();material.dispose()}
   }
   assert(!state.hook||referenceHooks>0,'Independent reference did not exercise hook')
  }
  const validation=await supplied?.popErrorScope();if(validation)errors.push(validation.message);assert(!errors.length&&!uncaptured.length,JSON.stringify({errors,uncaptured}))
  return{status:'ACTUAL_PRODUCER_STATE_CONTROLS_PASSED',backend:api,gpu:identity,rows,errors,uncaptured,nativeRenders:0,productionCases:0,qualificationCredit:0}
 }finally{ending=true;renderer.setAnimationLoop(null);renderer.setRenderObjectFunction(null);renderer.setRenderTarget(null);sourcePass.dispose();output.dispose();rawMaterial.dispose();geo.dispose();mat.dispose();renderer.dispose();supplied?.destroy()}
}
