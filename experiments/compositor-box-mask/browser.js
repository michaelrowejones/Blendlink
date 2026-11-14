import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {buildSourceCompositor} from '@pixel-compositor'
import {loadSourcePresentation} from '@pixel-source-display'
import {ThreeWebgpuPostPipelineService} from '@pixel-post-pipeline'
import {bindCompiledScene} from '@pixel-bindings'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {texture,textureLoad,ivec2,uv,vec2,vec4} from 'three/tsl'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const fetchPinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw new Error('Pinned proof fetch failed '+url);const bytes=await response.arrayBuffer();if(await hash(bytes)!==pin)throw new Error('Pinned bytes changed '+url);return bytes}
window.runBoxMaskProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('Box Mask proof requires an actual WebGPU adapter')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(supplied?{device:supplied}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
 if(backend!==wanted){renderer.dispose();supplied?.destroy();throw new Error('Actual renderer fallback is not requested API qualification')}
 const device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}
  :{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.setPixelRatio(1);renderer.setSize(8,8);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const liveTextures=new Map(),manager=renderer._textures,updateTexture=manager.updateTexture.bind(manager),destroyTexture=manager._destroyTexture.bind(manager)
 manager.updateTexture=(texture,options)=>{if(!liveTextures.has(texture))liveTextures.set(texture,{name:texture.name,uuid:texture.uuid,width:texture.image?.width,height:texture.image?.height,depth:texture.isDepthTexture,renderTarget:texture.isRenderTargetTexture,stack:new Error().stack});return updateTexture(texture,options)}
 manager._destroyTexture=texture=>{liveTextures.delete(texture);return destroyTexture(texture)}
 const errors=[],rows=[],negatives=[];renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program))
 let negativeDone=false
 for(const entry of proof.cases){
  let manifest,presentation,glbBytes,ownedInput
  let program=JSON.parse(new TextDecoder().decode(await fetchPinned(entry.programUrl,entry.programSha256)))
  if(proof.final){
   manifest=JSON.parse(new TextDecoder().decode(await fetchPinned(entry.manifestUrl,entry.manifestSha256)))
   glbBytes=await fetchPinned(entry.glbUrl,entry.glbSha256)
   const body=await fetchPinned(entry.presentationUrl,entry.presentationSha256)
   if(body.byteLength!==manifest.sourcePresentation.bytes||(await hash(body)).slice(0,16)!==manifest.sourcePresentation.hash)throw new Error('Actual presentation descriptor pin mismatch')
   presentation=JSON.parse(new TextDecoder().decode(body))
   for(const key of ['ops','passes','output'])if(canonical(presentation.compositor[key])!==canonical(program[key]))throw new Error('Published compositor differs from native program '+key)
   program=presentation.compositor
  }
  if(!negativeDone){
   const actual=program.ops.find(op=>op.kind==='box-mask');if(!actual)throw new Error('Actual Box Mask node missing')
   for(const kind of ['model','version','source-profile','evaluator','precision','storage','scalar-words','literal-bound','extra-input','schema','duplicate-id','spatial']){
    const forged=structuredClone(program),node=forged.ops.find(op=>op.id===actual.id),p=node.properties
    if(kind==='model')p.box_mask_model='unknown'
    else if(kind==='version')p.box_mask_native_version=[5,2,0]
    else if(kind==='source-profile')p.box_mask_source_profile='unmeasured'
    else if(kind==='evaluator')p.evaluation_device='GPU'
    else if(kind==='precision')p.box_mask_precision='GPU_HALF'
    else if(kind==='storage')p.box_mask_scalar_storage='unknown'
    else if(kind==='scalar-words')p.box_mask_scalar_words[2]=0x80000000
    else if(kind==='literal-bound')p.box_mask_size[0]=2**-17
    else if(kind==='extra-input')node.inputs.Mask={name:'Mask',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:0}}
    else if(kind==='schema')node.type='RGBA'
    else if(kind==='duplicate-id')forged.ops.push(structuredClone(node))
    else if(kind==='spatial')forged.ops.push({...structuredClone(node),id:'flip-unsupported',kind:'flip'})
    let error;try{const unexpected=buildSourceCompositor(forged,()=>{throw new Error('Unexpected Box Mask image reference')});unexpected.dispose()}catch(failure){error=String(failure)}
    if(!error?.includes('Box Mask'))throw new Error('Malformed Box Mask did not named-refuse '+kind+' '+error)
    negatives.push({kind,error})
   }
   negativeDone=true
  }
  const expectedBytes=await fetchPinned(entry.pixelUrl,entry.pixelSha256);let expected=new Uint32Array(expectedBytes),coordinates=entry.controlUrl?new Float32Array(await fetchPinned(entry.controlUrl,entry.controlSha256)):null
  let width=entry.width,height=entry.height;renderer.setPixelRatio(entry.pixelRatio);renderer.setSize(width/entry.pixelRatio,height/entry.pixelRatio)
  const animationFrames=[],resizeResults=[];let renderPhase="initial",rowFlip=false,resizeFrames=0,extentRefused=false,extentRecovered=false,built,material,quad,pipeline,bindings,scene,camera,gltf,source,pinRejected=false,meshCount=0,sourceMaterialDisposals=0,baselineCache=new Set(),baselineSceneDrawCalls=0
  const ownedSourceMaterials=new Set(),ownedGeometries=new Set(),originals=[],warnings=[]
  const target=new THREE.RenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
  const createPipeline=async()=>{
   const result=await ThreeWebgpuPostPipelineService.create({root:gltf.scene,scene,camera,renderer,bindings,sourcePresentation:source,onWarning:message=>warnings.push(message)})
   result.finalize();result.activate(scene,camera)
   if(!result.resolvedOrder.includes('blender-compositor'))throw new Error('Production pipeline bypassed authored Box Mask')
   return result
  }
  if(proof.final){
   source=await loadSourcePresentation(manifest.sourcePresentation)
   try{await loadSourcePresentation({...manifest.sourcePresentation,hash:'0'.repeat(16)})}catch(error){pinRejected=/hash differs/.test(String(error))}
   if(!pinRejected)throw new Error('Bad actual presentation pin was accepted')
   gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glbBytes,new URL('.',new URL(manifest.url,location.href)).href)
   gltf.scene.traverse(object=>{if(object.isMesh){meshCount++;originals.push({object,material:object.material,callback:object.onBeforeRender});ownedGeometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>ownedSourceMaterials.add(material))}})
   if(!meshCount||!gltf.cameras.length)throw new Error('Actual saved scene/camera binding missing')
   for(const material of ownedSourceMaterials)material.addEventListener('dispose',()=>sourceMaterialDisposals++)
   scene=new THREE.Scene();scene.add(gltf.scene);scene.updateMatrixWorld(true);camera=gltf.cameras[0]
   bindings=bindCompiledScene(gltf.scene,{url:manifest.url,nodes:Object.fromEntries(manifest.nodes.map(node=>[node.name,node.name])),nodeIds:Object.fromEntries(manifest.nodes.filter(node=>node.id).map(node=>[node.name,node.id])),objectsById:Object.fromEntries(manifest.nodes.filter(node=>node.id).map(node=>[node.id,node.name]))})
   renderer.setRenderTarget(target);renderer.render(scene,camera)
   baselineSceneDrawCalls=renderer.info.render.drawCalls
   if(!(baselineSceneDrawCalls>0))throw new Error('No actual source-scene draw in the resource control')
   baselineCache=new Set([...liveTextures.keys()].filter(texture=>!target.textures.includes(texture)))
   if(baselineCache.size>1||[...baselineCache].some(texture=>texture.name!=='DFG_LUT'||texture.image?.width!==16||texture.image?.height!==16))throw new Error('Unexpected no-compositor renderer cache '+JSON.stringify([...baselineCache].map(texture=>liveTextures.get(texture))))
   pipeline=await createPipeline()
  }else{
   const inputBytes=await fetchPinned(entry.inputUrl,entry.inputSha256)
   const input=new THREE.DataTexture(new Float32Array(inputBytes),width,height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true;ownedInput=input
   // Independent image-load control chooses readback orientation before any Box Mask evaluation.
   const calibration=new NodeMaterial();calibration.fragmentNode=textureLoad(input,ivec2(uv().mul(vec2(width,height))));const control=new QuadMesh(calibration)
   renderer.setRenderTarget(target);control.render(renderer)
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),actual=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),wanted=new Uint32Array(inputBytes)
   const pad=Math.ceil(width*16/256)*256/16,stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*(pad*(height-1)+width)?pad:0
   if(!stride)throw new Error('Unknown calibration stride')
   const matches=flip=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)if(actual[(y*stride+x)*4+c]!==wanted[((flip?height-1-y:y)*width+x)*4+c])return false;return true}
   const forward=matches(false),reverse=matches(true);if(forward===reverse)throw new Error('Independent orientation control failed/ambiguous');rowFlip=reverse;calibration.dispose()
   built=buildSourceCompositor(program,()=>{throw new Error('Box Mask has no image dependency')});material=new NodeMaterial();material.fragmentNode=built.node;quad=new QuadMesh(material)
  }
  if(proof.final){
   const inputBytes=await fetchPinned(entry.inputUrl,entry.inputSha256),input=new THREE.DataTexture(new Float32Array(inputBytes),width,height,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true
   const calibration=new NodeMaterial();calibration.fragmentNode=textureLoad(input,ivec2(uv().mul(vec2(width,height))));const control=new QuadMesh(calibration)
   renderer.setRenderTarget(target);control.render(renderer)
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),actual=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),wanted=new Uint32Array(inputBytes),pad=Math.ceil(width*16/256)*256/16
   const stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*(pad*(height-1)+width)?pad:0
   if(!stride)throw new Error('Unknown Final control stride')
   const matches=flip=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++)if(actual[(y*stride+x)*4+c]!==wanted[((flip?height-1-y:y)*width+x)*4+c])return false;return true}
   const forward=matches(false),reverse=matches(true);if(forward===reverse)throw new Error('Independent Final orientation failed');rowFlip=reverse;calibration.dispose();input.dispose()
  }
  const render=()=>new Promise((resolve,reject)=>{
   renderer.setAnimationLoop(()=>{
    renderer.setAnimationLoop(null)
    try{
     const frame=renderer._nodes.nodeFrame.frameId
     if(animationFrames.length&&frame<=animationFrames.at(-1))throw new Error('Renderer animation frame did not advance')
     animationFrames.push(frame);renderer.setRenderTarget(target);if(pipeline)pipeline.render();else quad.render(renderer);resolve()
    }catch(error){reject(new Error(renderPhase+': '+error))}
   }).catch(reject)
  })
  const compare=async()=>{
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height)
   if(!(pixels instanceof Float32Array))throw new Error('Actual Float32 readback required')
   const raw=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),pad=Math.ceil(width*16/256)*256/16
   const stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*(pad*(height-1)+width)?pad:0
   if(!stride)throw new Error('Unknown actual readback layout')
   const expectedValues=new Float32Array(expected.buffer,expected.byteOffset,expected.length)
   const ordered=word=>(word>>>31)?0x80000000-(word&0x7fffffff):0x80000000+word
   let exactWordMismatches=0,contractViolations=0,maxUlps=0,maxAbsoluteError=0,exactControlWords=0,worst
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<4;channel++){
    const at=(y*stride+x)*4+channel,wanted=((rowFlip?height-1-y:y)*width+x)*4+channel,actualWord=raw[at],expectedWord=expected[wanted]
    const actualValue=pixels[at],expectedValue=expectedValues[wanted],ulp=Math.abs(ordered(actualWord)-ordered(expectedWord)),absolute=Math.abs(actualValue-expectedValue)
    if(actualWord!==expectedWord)exactWordMismatches++
    const exact=true;exactControlWords++
    const accepted=actualWord===expectedWord
    maxUlps=Math.max(maxUlps,ulp);maxAbsoluteError=Math.max(maxAbsoluteError,absolute)
    if(!Number.isFinite(actualValue)||exact&&actualWord!==expectedWord||!exact&&!accepted){
     contractViolations++;worst??={x,y,channel,actual:actualValue,expected:expectedValue,ulp,absolute,exact}
    }
   }
   if(contractViolations)throw new Error('Actual built box-mask contract violation '+entry.case+' '+contractViolations+' '+JSON.stringify(worst))
   return{exactWordMismatches,contractViolations,maxUlps,maxAbsoluteError,exactControlWords,comparedWords:width*height*4}

  }
  device?.pushErrorScope('validation');await render();const mismatch=await compare();await render();await compare()
  if(entry.resizeFamily&&entry.width===13&&entry.height===9&&entry.route==='direct'){
   // Both raw and actual Final paths must retain validation even for constant
   // or all-zero graphs that the shader optimizer can otherwise erase.
   renderer.setSize((width+1)/entry.pixelRatio,height/entry.pixelRatio)
   let refusal;try{await render()}catch(error){refusal=String(error)}
   if(!refusal?.includes('matching full-frame physical'))throw new Error('Live Box Mask extent did not named-refuse '+refusal)
   extentRefused=true
   renderer.setSize(width/entry.pixelRatio,height/entry.pixelRatio);await render();await compare();extentRecovered=true
   const sequence=[...proof.resizeCases.filter(row=>row.resizeFamily===entry.resizeFamily&&row.case!==entry.case),entry]
   for(const resized of sequence){
    renderPhase='resize '+resized.width+'x'+resized.height;width=resized.width;height=resized.height;expected=new Uint32Array(await fetchPinned(resized.pixelUrl,resized.pixelSha256))
    renderer.setPixelRatio(resized.pixelRatio);renderer.setSize(width/resized.pixelRatio,height/resized.pixelRatio);target.setSize(width,height)
    await render();const measured=await compare();resizeResults.push({width,height,pixelRatio:resized.pixelRatio,...measured});resizeFrames++
   }
   width=entry.width;height=entry.height;expected=new Uint32Array(expectedBytes);renderer.setPixelRatio(entry.pixelRatio);renderer.setSize(width/entry.pixelRatio,height/entry.pixelRatio);target.setSize(width,height);await render();await compare()
  }
  if(proof.final){
   for(let cycle=0;cycle<3;cycle++){
    if(cycle){pipeline=await createPipeline();await render();await compare()}
    pipeline.dispose();pipeline=undefined
    for(const original of originals)if(original.object.material!==original.material||original.object.onBeforeRender!==original.callback)throw new Error('Pipeline disposal changed authored material/callback ownership')
    if(sourceMaterialDisposals||warnings.length)throw new Error('Reapply bypassed a graph or disposed source material '+JSON.stringify(warnings))
    const actualCache=[...liveTextures.keys()].filter(texture=>!target.textures.includes(texture))
    if(actualCache.length!==baselineCache.size||actualCache.some(texture=>!baselineCache.has(texture)))throw new Error('Port resources differ from exact no-compositor cache identity set '+JSON.stringify(actualCache.map(texture=>liveTextures.get(texture))))
   }
   bindings.dispose();ownedGeometries.forEach(geometry=>geometry.dispose());ownedSourceMaterials.forEach(material=>material.dispose())
  }else{
   built.dispose();built.dispose();material.dispose();const reapplied=buildSourceCompositor(program,()=>{throw new Error('Box Mask has no image dependency')});reapplied.dispose()
  }
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
  renderer.setRenderTarget(null);target.dispose();ownedInput?.dispose()
  const remainingTextures=renderer.info.memory.textures;if(remainingTextures!==baselineCache.size||[...liveTextures.keys()].some(texture=>!baselineCache.has(texture)))throw new Error('Box Mask compositor retained non-baseline textures '+remainingTextures+' '+JSON.stringify([...liveTextures.values()]))
  if(renderer.info.memory.renderTargets!==0)throw new Error('Box Mask compositor retained render targets')
  rows.push({case:entry.case,width,height,pixelRatio:entry.pixelRatio,route:entry.route,rowFlip,resizeFrames,resizeResults,extentRefused,extentRecovered,animationFrames,...mismatch,remainingTextures,portOwnedTextures:0,remainingRenderTargets:renderer.info.memory.renderTargets,...(proof.final?{pinRejected,meshCount,pipeline:'blender-compositor',sourceMaterialsPreserved:true,lifecycleCycles:3,baselineSceneDrawCalls,baselineCacheRestored:true,baselineCache:[...baselineCache].map(texture=>({name:texture.name,uuid:texture.uuid,width:texture.image.width,height:texture.image.height}))}: {})})
 }
 renderer.dispose();supplied?.destroy();if(errors.length)throw new Error('Shader errors '+JSON.stringify(errors))
 return{backend,gpu,rows,negatives,errors}
}
