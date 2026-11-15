import * as THREE from'three'
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu'
import{textureLoad,ivec2,screenCoordinate,texture}from'three/tsl'
import{createDisplaceCpuRgbaStages}from'@precision'
import{resampleCompositorField as oldResample}from'@old-resample'
import{resampleCompositorField as newResample}from'@new-resample'
const assert=(v,m)=>{if(!v)throw Error(m)},F=Math.fround,word=n=>new Uint32Array(new Float32Array([n]).buffer)[0]
window.runStagingControls=async wanted=>{
 const adapter=wanted==='webgpu'?await navigator.gpu.requestAdapter({powerPreference:'high-performance'}):null,supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend,gl=backend.gl,api=backend.isWebGPUBackend?'webgpu':'webgl2';assert(api===wanted,'Actual backend changed');const debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)},errors=[],uncaptured=[];let ending=false
 renderer.debug.onShaderError=(g,p,v,f)=>errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].join('\n'));supplied?.addEventListener('uncapturederror',e=>uncaptured.push(String(e.error)));supplied?.lost.then(e=>{if(!ending)uncaptured.push(e.message)})
 renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const samples=[
 {a:[.037506103515625,.03692626953125,.011138916015625,.0062255859375],b:[.039886474609375,.05218505859375,.01136016845703125,.00501251220703125],c:[.021148681640625,.0196075439453125,.0049285888671875,0],d:[.0321044921875,.019989013671875,.0049285888671875,.00635528564453125],x:F(1-2**-20),y:0},
 {a:[.037506103515625,.03692626953125,.011138916015625,.0062255859375],b:[.039886474609375,.05218505859375,.01136016845703125,.00501251220703125],c:[.021148681640625,.0196075439453125,.0049285888671875,0],d:[.0321044921875,.019989013671875,.0049285888671875,.00635528564453125],x:F(1-2**-20),y:2**-20},
 {a:[-8,16,-4,1],b:[16,-8,8,.25],c:[4,-16,2,0],d:[-16,8,-2,.75],x:.25,y:.75},
 {a:[-0,-0,-0,-0],b:[-0,-0,-0,-0],c:[-0,-0,-0,-0],d:[-0,-0,-0,-0],x:.5,y:.5},
 {a:[0,-0,8,-8],b:[-0,0,-16,16],c:[0,-0,4,-4],d:[-0,0,-2,2],x:0,y:1},
 {a:[.1,-.3,1/3,1],b:[-.2,.7,-1/3,.5],c:[.4,-.8,2/3,.25],d:[-.6,.9,-2/3,.75],x:F(.37),y:F(.81)}
 ].map(row=>({...row,a:row.a.map(F),b:row.b.map(F),c:row.c.map(F),d:row.d.map(F)}))
 const data=new Float32Array(samples.length*5*4);samples.forEach((s,i)=>{for(const[j,name]of['a','b','c','d'].entries())data.set(s[name],(i*5+j)*4);data.set([s.x,s.y,0,0],(i*5+4)*4)})
 const input=new THREE.DataTexture(data,5,samples.length,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true
 const expected=[];for(const s of samples){const left=F(1-s.x),bottom=F(1-s.y),w=[F(left*bottom),F(s.x*bottom),F(left*s.y),F(s.x*s.y)];for(let ch=0;ch<4;ch++){const p=['a','b','c','d'].map((k,i)=>F(s[k][ch]*w[i]));expected.push(word(F(F(p[0]+p[1])+F(p[2]+p[3]))))}}
 const output=new THREE.RenderTarget(samples.length,1,{type:THREE.FloatType,depthBuffer:false}),materials=[],resources=[]
 const draw=quad=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(output);quad.render(renderer);resolve()}catch(e){reject(e)}}).catch(reject))
 const read=async(w,h)=>{const a=await renderer.readRenderTargetPixelsAsync(output,0,0,w,h),padded=Math.ceil(w*16/256)*16,stride=a.length===w*h*4?w:api==='webgpu'&&[padded*h*4,(padded*(h-1)+w)*4].includes(a.length)?padded:0;assert(a instanceof Float32Array&&stride,'Actual RGBA32F required');const result=new Uint32Array(w*h*4),words=new Uint32Array(a.buffer,a.byteOffset,a.length);for(let y=0;y<h;y++)result.set(words.subarray(y*stride*4,(y*stride+w)*4),y*w*4);return result}
 const material=node=>{const m=new NodeMaterial();m.fragmentNode=node;m.blending=THREE.NoBlending;materials.push(m);return m}
 try{
  supplied?.pushErrorScope('validation');renderer.setSize(samples.length,1)
  const row=ivec2(screenCoordinate.xy).x,load=i=>textureLoad(input,ivec2(i,row)),xy=load(4),stage=createDisplaceCpuRgbaStages(),node=stage(load(0),load(1),load(2),load(3),xy.r,xy.g),quad=new QuadMesh(material(node));await draw(quad);const actual=await read(samples.length,1);assert(actual.length===expected.length&&actual.every((n,i)=>n===expected[i]),'Native F32-stage finite HDR/signed-zero microcontrol differs '+JSON.stringify([...actual].map((n,i)=>n===expected[i]?null:{i,actual:n,expected:expected[i]}).filter(Boolean)))
  const zeros=new Set();node.traverse(child=>{if(child.isUniformNode&&child.nodeType==='uint'&&child.value===0)zeros.add(child)});assert(zeros.size===1,'Expected one private staging zero');const zero=[...zeros][0];zero.value=1;let mutationRefusal;try{await draw(quad)}catch(e){mutationRefusal=String(e)}assert(/Displace.*private rounding uniform/.test(mutationRefusal),'Actual rounding-uniform mutation guard missing');zero.value=0;await draw(quad);assert((await read(samples.length,1)).every((n,i)=>n===expected[i]),'Private rounding uniform did not recover')
  renderer.setSize(13,9);output.setSize(13,9)
  const shaders=[],pixels=[]
  for(const build of[oldResample,newResample]){const owned=[],source=textureLoad(input,ivec2(0,0)),n=build(source,[.25,-.5],[0,0],{model:'modern-cpu-v1',interpolation:'Bilinear'},owned,()=>{},m=>{throw Error(m)}),q=new QuadMesh(material(n));resources.push(...owned);await draw(q);pixels.push(await read(13,9));shaders.push((await renderer.debug.getShaderAsync(q,q.camera,q)).fragmentShader);for(const o of owned)o.dispose()}
  assert(shaders[0]===shaders[1],'Unchanged generic default branch shader bytes differ');assert(pixels[0].every((n,i)=>n===pixels[1][i]),'Generic default branch output changed')
  const validation=await supplied?.popErrorScope();if(validation)errors.push(validation.message);assert(!errors.length&&!uncaptured.length,JSON.stringify({errors,uncaptured}));return{status:'PASSED_DISPLACE_STAGING_MICROCONTROLS',backend:api,gpu,privateUniformMutationRefusal:mutationRefusal,finiteHdrSignedZeroWords:actual.length,actualWords:[...actual],expectedWords:expected,signedZeroControlWords:[...actual].slice(12,16),genericDefaultShaderByteIdentical:true,genericDefaultShaderBytes:new TextEncoder().encode(shaders[0]).length,genericDefaultPixelWords:pixels[0].length,errors,uncaptured,nativeRenders:0,qualificationCredit:0}
 }finally{ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);for(const o of resources)o.dispose();for(const m of materials)m.dispose();input.dispose();output.dispose();renderer.dispose();supplied?.destroy()}
}
