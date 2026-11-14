import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {texture,vec4} from 'three/tsl'
import {buildSourceCompositor} from '@blackbody-compositor'
import {loadSourcePresentation} from '@blackbody-source-display'
import {ThreeWebgpuPostPipelineService} from '@blackbody-post-pipeline'
import {bindCompiledScene} from '@blackbody-bindings'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const fetchPinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw new Error('Pinned proof fetch failed '+url);const bytes=await response.arrayBuffer();if(await hash(bytes)!==pin)throw new Error('Pinned bytes changed '+url);return bytes}
window.runBlackbodyProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('Blackbody proof requires an actual WebGPU adapter')
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
  let manifest,presentation,glbBytes
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
  if(!negativeDone&&entry.kind==='blackbody'){
   const actual=program.ops.find(op=>op.kind==='blackbody-color');if(!actual)throw new Error('Actual emitted Blackbody node missing')
   const baselineNegativeTextures=renderer.info.memory.textures
   for(const kind of proof.negativeKinds){
    const forged=structuredClone(program),node=forged.ops.find(op=>op.id===actual.id)
    if(kind==='model')node.properties.blackbody_model='unknown'
    else if(kind==='version')node.properties.blackbody_version=[5,2,0]
    else if(kind==='source-profile')node.properties.blackbody_profile='unmeasured'
    else if(kind==='build')node.properties.blackbody_build='other'
    else if(kind==='evaluator')node.properties.single_value_device='GPU'
    else if(kind==='native-backend'){node.properties.evaluation_device='GPU';node.properties.native_gpu_backend='OPENGL'}
    else if(kind==='output')node.source.output='Other'
    else if(kind==='schema')node.type='VECTOR'
    else if(kind==='working-space')node.properties.blackbody_working_space='lin_ap1_scene'
    else if(kind==='config-hash')node.properties.blackbody_ocio_sha256='other'
    else if(kind==='coefficient-source')node.properties.blackbody_table_sha256='other'
    else if(kind==='provenance')node.inputs.Temperature.value={kind:'ref',type:'VALUE',node:'missing'}
    else if(kind==='extra-input')node.inputs.Other={name:'Other',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:0}}
    else node.inputs.Temperature.value={kind:'constant',type:'VALUE',value:kind==='temperature-low'?799:kind==='temperature-high'?12001:6500.1}
    let error;try{const unexpected=buildSourceCompositor(forged,()=>null);unexpected.dispose()}catch(failure){error=String(failure)}
    if(!error?.includes('Blackbody'))throw new Error('Malformed Blackbody did not refuse '+kind+' '+error)
    if(renderer.info.memory.textures!==baselineNegativeTextures)throw new Error('Malformed Blackbody allocated owned textures')
    negatives.push({kind,error,remainingTextures:0})
   }
   negativeDone=true
  }
  const expectedBytes=await fetchPinned(entry.pixelUrl,entry.pixelSha256),expected=new Uint32Array(expectedBytes)
  let sourceTexture;
  if(entry.inputUrl){const bytes=await fetchPinned(entry.inputUrl,entry.inputSha256);sourceTexture=new THREE.DataTexture(new Float32Array(bytes),8,8,THREE.RGBAFormat,THREE.FloatType);sourceTexture.colorSpace=THREE.NoColorSpace;sourceTexture.needsUpdate=true}
  let built,material,quad,pipeline,bindings,scene,camera,gltf,source,pinRejected=false,meshCount=0,sourceMaterialDisposals=0,baselineCache=new Set(),baselineSceneDrawCalls=0
  const ownedSourceMaterials=new Set(),ownedGeometries=new Set(),originals=[],warnings=[]
  const target=new THREE.RenderTarget(8,8,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
  const createPipeline=async()=>{
   const result=await ThreeWebgpuPostPipelineService.create({root:gltf.scene,scene,camera,renderer,bindings,sourcePresentation:source,onWarning:message=>warnings.push(message)})
   result.finalize();result.activate(scene,camera)
   if(!result.resolvedOrder.includes('blender-compositor'))throw new Error('Production pipeline bypassed authored Blackbody')
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
   if(baselineCache.size!==1||[...baselineCache].some(texture=>texture.name!=='DFG_LUT'||texture.image?.width!==16||texture.image?.height!==16))throw new Error('Unexpected no-compositor renderer cache '+JSON.stringify([...baselineCache].map(texture=>liveTextures.get(texture))))
   pipeline=await createPipeline()
  }else{
   built=buildSourceCompositor(program,pass=>sourceTexture?texture(sourceTexture):null);material=new NodeMaterial();material.fragmentNode=built.node;quad=new QuadMesh(material)
  }
  const render=()=>{renderer.setRenderTarget(target);if(pipeline)pipeline.render();else quad.render(renderer)}
  const compare=async(reference=expected,width=8,height=8)=>{
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height)
   if(!(pixels instanceof Float32Array))throw new Error('Actual Float32 readback required')
   const raw=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),pad=Math.ceil(width*16/256)*256/16
   const stride=pixels.length===width*height*4?width:backend==='webgpu'&&pixels.length===4*(pad*(height-1)+width)?pad:0
   if(!stride)throw new Error('Unknown actual readback layout')
   let wordMismatches=0,contractViolations=0,maxUlps=0,maxAbsoluteError=0
   const floats=new Float32Array(reference.buffer,reference.byteOffset,reference.length)
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<4;channel++){
    const index=(y*stride+x)*4+channel,wanted=reference[channel],actual=raw[index],absolute=Math.abs(pixels[index]-floats[channel]),ulps=Math.abs(actual-wanted)
    if(actual!==wanted)wordMismatches++
    maxUlps=Math.max(maxUlps,ulps);maxAbsoluteError=Math.max(maxAbsoluteError,absolute)
    if(!Number.isFinite(pixels[index])||(channel===3||entry.kind==='control'?actual!==wanted:absolute>entry.bounds[channel]||absolute>2**-15))contractViolations++
   }
   if(contractViolations)throw new Error('Actual built Blackbody contract violations '+entry.case+' '+JSON.stringify({contractViolations,maxUlps,maxAbsoluteError}))
   return{comparedWords:width*height*4,wordMismatches,contractViolations,maxUlps,maxAbsoluteError}
  }
  device?.pushErrorScope('validation');render();const metrics=await compare();render();await compare()
  const resizeResults=[]
  if(entry.case==='default-6500')for(const[width,height,dpr]of[[16,12,2],[9,13,1],[8,8,1]]){
   renderer.setPixelRatio(dpr);renderer.setSize(width/dpr,height/dpr);target.setSize(width,height);render();resizeResults.push({width,height,dpr,...await compare(expected,width,height)})
  }
  renderer.setPixelRatio(1);renderer.setSize(8,8);target.setSize(8,8)
  let shaderBytes=0,shaderSha256=null,shaderLoops=null
  if(!proof.final){const shaders=await renderer.debug.getShaderAsync(quad,quad.camera,quad);shaderBytes=shaders.fragmentShader.length;shaderSha256=await hash(new TextEncoder().encode(shaders.fragmentShader));shaderLoops=(shaders.fragmentShader.match(/\bfor\s*\(/g)||[]).length;if(shaderBytes>128000||shaderLoops!==0)throw new Error('Blackbody selected static polynomial exceeded shader cost guard')}
  if(proof.final){
   for(let cycle=0;cycle<3;cycle++){
    if(cycle){pipeline=await createPipeline();render();await compare()}
    pipeline.dispose();pipeline=undefined
    for(const original of originals)if(original.object.material!==original.material||original.object.onBeforeRender!==original.callback)throw new Error('Pipeline disposal changed authored material/callback ownership')
    if(sourceMaterialDisposals||warnings.length)throw new Error('Reapply bypassed a graph or disposed source material '+JSON.stringify(warnings))
    const actualCache=[...liveTextures.keys()].filter(texture=>!target.textures.includes(texture))
    if(actualCache.length!==baselineCache.size||actualCache.some(texture=>!baselineCache.has(texture)))throw new Error('Port resources differ from exact no-compositor cache identity set '+JSON.stringify(actualCache.map(texture=>liveTextures.get(texture))))
   }

  }else{
   built.dispose();built.dispose();material.dispose();const reapplied=buildSourceCompositor(program,pass=>sourceTexture?texture(sourceTexture):null);reapplied.dispose()
  }
  if(proof.final){bindings.dispose();ownedGeometries.forEach(geometry=>geometry.dispose());ownedSourceMaterials.forEach(material=>material.dispose())}
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
  renderer.setRenderTarget(null);target.dispose();sourceTexture?.dispose()
  const remainingTextures=renderer.info.memory.textures;if(remainingTextures!==baselineCache.size||[...liveTextures.keys()].some(texture=>!baselineCache.has(texture)))throw new Error('Blackbody compositor retained non-baseline textures '+remainingTextures+' '+JSON.stringify([...liveTextures.values()]))
  if(renderer.info.memory.renderTargets!==0)throw new Error('Blackbody compositor retained render targets')
  rows.push({case:entry.case,...metrics,shaderBytes,shaderSha256,shaderLoops,resizeResults,resizeFrames:resizeResults.length,remainingTextures,portOwnedTextures:0,remainingRenderTargets:renderer.info.memory.renderTargets,...(proof.final?{pinRejected,meshCount,pipeline:'blender-compositor',sourceMaterialsPreserved:true,lifecycleCycles:3,baselineSceneDrawCalls,baselineCacheRestored:true,baselineCache:[...baselineCache].map(texture=>({name:texture.name,uuid:texture.uuid,width:texture.image.width,height:texture.image.height}))}: {})})
 }
 renderer.dispose();supplied?.destroy();if(errors.length)throw new Error('Shader errors '+JSON.stringify(errors))
 return{backend,gpu,rows,negatives,errors}
}
