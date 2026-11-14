import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {float,textureLoad,ivec2,uv,vec2,vec3,vec4,uniform} from 'three/tsl'
import {compositorWhiteNoiseHash} from '@exact-hash'
import {buildFullFrameFloatCoordinateKernel} from '@old-coordinates'
import {ExactAxisTable} from './axis-table.mjs'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const fetchPinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Missing pinned input '+url);const data=await response.arrayBuffer();if(await hash(data)!==pin)throw Error('Changed input '+url);return data}
window.runAxisTablePrototype=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2',adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw Error('Actual WebGPU adapter required')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})})
 await renderer.init();const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Requested API fell back')
 const device=renderer.backend.device,gl=renderer.backend.gl,extension=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const live=new Set(),manager=renderer._textures,update=manager.updateTexture.bind(manager),destroy=manager._destroyTexture.bind(manager)
 manager.updateTexture=(texture,options)=>{live.add(texture);return update(texture,options)};manager._destroyTexture=texture=>{live.delete(texture);return destroy(texture)}
 const errors=[],rows=[],direct=[],negatives=[],cycles=[];renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program))
 let target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false}),lastDrawCalls=0;target.texture.colorSpace=THREE.NoColorSpace
 const materials=new Set();let table=new ExactAxisTable({existingSamplers:7}),lastKey='',rowFlip
 const asMaterial=node=>{const m=new NodeMaterial();m.fragmentNode=node;materials.add(m);return m}
 const nodes=new Map(),quads=new Map(),oldSize=new THREE.Vector2(),oldUniform=uniform(oldSize)
 function quadFor(entry,old=false){
  const key=(old?'old-':'')+(entry.kind==='coordinate'?'coordinate':entry.dimension+'-'+entry.output)
  if(!quads.has(key)){
   const position=old?vec3(buildFullFrameFloatCoordinateKernel('Uniform',oldUniform),0):table.node
   const output=entry.kind==='coordinate'?position:compositorWhiteNoiseHash(entry.dimension,position,float(Math.fround(.1)),entry.output==='Color')
   const node=entry.kind==='noise'&&entry.output==='Value'?vec4(vec3(output),1):vec4(output,1)
   const material=asMaterial(node);nodes.set(key,node);quads.set(key,new QuadMesh(material))
  }
  return quads.get(key)
 }
 function extent(width,height,dpr=1){renderer.setPixelRatio(dpr);renderer.setSize(width/dpr,height/dpr);target.setSize(width,height);oldSize.set(width,height);renderer.setRenderTarget(target)}
 async function draw(quad){return new Promise((resolve,reject)=>{renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);quad.render(renderer);lastDrawCalls=renderer.info.render.drawCalls;resolve()}catch(error){reject(error)}}).catch(reject)})}
 function unpack(pixels,width,height){
  if(!(pixels instanceof Float32Array))throw Error('Float32 readback required')
  const stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*((Math.ceil(width*16/256)*256/16)*(height-1)+width)?Math.ceil(width*16/256)*256/16:0
  if(!stride)throw Error('Unknown physical readback stride')
  return {raw:new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),stride}
 }
 async function calibrate(width,height){
  const data=new Float32Array(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x/16384,y/16384,(x+3*y)/65536,1],(y*width+x)*4)
  const input=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true
  const material=asMaterial(textureLoad(input,ivec2(uv().mul(vec2(width,height)))))
  try{
   await draw(new QuadMesh(material));const {raw,stride}=unpack(await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),width,height),wanted=new Uint32Array(data.buffer)
   const matches=flip=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)if(raw[(y*stride+x)*4+c]!==wanted[((flip?height-1-y:y)*width+x)*4+c])return false;return true}
   const a=matches(false),b=matches(true);if(a===b)throw Error('Independent orientation calibration failed/ambiguous');rowFlip=b
  }finally{input.dispose();material.dispose();materials.delete(material)}
 }
 async function compare(entry,expected){
  const {raw,stride}=unpack(await renderer.readRenderTargetPixelsAsync(target,0,0,entry.width,entry.height),entry.width,entry.height)
  let differences=0,worst
  for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++)for(let channel=0;channel<4;channel++){
   const actual=raw[(y*stride+x)*4+channel],wanted=expected[((rowFlip?entry.height-1-y:y)*entry.width+x)*4+channel]
   if(actual!==wanted){differences++;worst??={x,y,channel,actualWord:actual,expectedWord:wanted}}
  }
  return {comparedWords:entry.width*entry.height*4,exactWordDifferences:differences,worst}
 }
 const rejectDraw=async(kind,change,restore,pattern)=>{
  change();let error
  try{await draw(quadFor(proof.rows[0]))}catch(failure){error=String(failure)}finally{restore()}
  if(!error||!pattern.test(error))throw Error('Mutation did not give named refusal '+kind+' '+error)
  negatives.push({kind,error})
 }
 try{
  device?.pushErrorScope('validation')
  for(const [index,entry]of proof.rows.entries()){
   const key=entry.width+':'+entry.height,changed=key!==lastKey
   extent(entry.width,entry.height,index%2?2:1)
   if(changed){await calibrate(entry.width,entry.height);lastKey=key}
   const expected=new Uint32Array(await fetchPinned(entry.pixelUrl,entry.pixelSha256)),before=table.statistics
   await draw(quadFor(entry));const allocation=table.attest(renderer),result=await compare(entry,expected),after=table.statistics
   if(result.exactWordDifferences)throw Error('Exact axis/hash mismatch '+entry.case+' '+JSON.stringify(result))
   if(after.rebuilds-before.rebuilds!==(changed?1:0)||after.uploads-before.uploads!==(changed?1:0))throw Error('Table recomputed/uploaded outside one valid extent change '+JSON.stringify({entry,before,after}))
   if(after.bytes>65536||lastDrawCalls!==1)throw Error('Unexpected table memory or additional pass '+JSON.stringify({bytes:after.bytes,drawCalls:lastDrawCalls}))
   await draw(quadFor(entry));table.attest(renderer);const repeat=await compare(entry,expected)
   if(repeat.exactWordDifferences||table.statistics.rebuilds!==after.rebuilds||table.statistics.uploads!==after.uploads)throw Error('Unchanged-extent draw did not reuse exact table')
   rows.push({case:entry.case,width:entry.width,height:entry.height,pixelRatio:index%2?2:1,allocation,statistics:after,...result,repeatExact:true,drawCalls:lastDrawCalls,liveTableBindings:[...live].filter(t=>t===table.proofTexture).length})
   if(entry.kind==='coordinate'||entry.kind==='noise'&&entry.dimension===2&&entry.output==='Color'&&!entry.linked){
    await draw(quadFor(entry,true));direct.push({case:entry.case,...await compare(entry,expected)})
   }
  }
  const first=proof.rows[0];extent(first.width,first.height);await calibrate(first.width,first.height)
  await draw(quadFor(first));table.attest(renderer);const beforeInvalid=table.statistics
  await rejectDraw('mismatched-target',()=>target.setSize(first.width+1,first.height),()=>target.setSize(first.width,first.height),/Exact axis table: matching full-frame/)
  if(table.statistics.rebuilds!==beforeInvalid.rebuilds||table.statistics.uploads!==beforeInvalid.uploads)throw Error('Refused extent changed the table')
  await draw(quadFor(first));table.attest(renderer)
  await rejectDraw('owned-schema',()=>table.proofTexture.type=THREE.HalfFloatType,()=>table.proofTexture.type=THREE.FloatType,/Exact axis table: owned texture/)
  const originalData=table.proofTexture.image.data
  await rejectDraw('owned-data-identity',()=>table.proofTexture.image.data=new Float32Array(table.proofTexture.image.data),()=>table.proofTexture.image.data=originalData,/Exact axis table: owned texture/)
  // Actual texture version changes are permanent for this immutable owner.
  await rejectDraw('owned-version',()=>{table.proofTexture.needsUpdate=true},()=>{},/Exact axis table: owned texture/)
  table.dispose();table.dispose();materials.forEach(m=>m.dispose());materials.clear();quads.clear();nodes.clear()
  if([...live].some(t=>t!==target.texture))throw Error('Disposed pipeline retained an axis texture')
  for(let cycle=0;cycle<3;cycle++){
   table=new ExactAxisTable();await draw(quadFor(first));const allocation=table.attest(renderer),result=await compare(first,new Uint32Array(await fetchPinned(first.pixelUrl,first.pixelSha256)))
   if(result.exactWordDifferences)throw Error('Recreated table mismatch')
   table.dispose();table.dispose();materials.forEach(m=>m.dispose());materials.clear();quads.clear();nodes.clear()
   if([...live].some(t=>t!==target.texture))throw Error('Reapply retained a table allocation')
   cycles.push({cycle,allocation,...result,remainingPortTextures:0,idempotentDisposals:table.statistics.disposals})
  }
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
  if(errors.length)throw Error('GPU validation/shader errors '+JSON.stringify(errors))
  renderer.setRenderTarget(null);target.dispose();if(live.size||renderer.info.memory.renderTargets)throw Error('Prototype retained GPU resources')
  return {status:'EXPERIMENT_ONLY_EXACT_AXIS_TABLE',portCredit:0,backend,gpu,rows,directKernelResearch:direct,negatives,cycles,errors,remainingTextures:renderer.info.memory.textures,remainingRenderTargets:renderer.info.memory.renderTargets}
 }finally{table.dispose();materials.forEach(m=>m.dispose());renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
