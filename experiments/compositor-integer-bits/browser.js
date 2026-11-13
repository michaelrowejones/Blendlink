import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {texture} from 'three/tsl'
import {buildSourceCompositor} from '@integer-bits-compositor'
import {loadSourcePresentation} from '@integer-bits-source-display'
import {ThreeWebgpuPostPipelineService} from '@integer-bits-post-pipeline'
import {bindCompiledScene} from '@integer-bits-bindings'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const fetchPinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw new Error('Pinned proof fetch failed '+url);const bytes=await response.arrayBuffer();if(await hash(bytes)!==pin)throw new Error('Pinned bytes changed '+url);return bytes}
window.runIntegerBitsProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('Integer Bits proof requires an actual WebGPU adapter')
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
 let lastFragment='',integerShaderCompiles=0;const createProgram=renderer.backend.createProgram.bind(renderer.backend);renderer.backend.createProgram=program=>{if(program.stage==='fragment'){lastFragment=program.code;if(program.code.includes('scenetowebIntegerBits')){integerShaderCompiles++;if(/intBitsToFloat|uintBitsToFloat|floatBitsToInt|floatBitsToUint/.test(program.code))throw new Error('Integer Bits shader reintroduced a float bitcast transport')}}return createProgram(program)};const errors=[],rows=[],negatives=[];renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program))
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
  if(!negativeDone&&program.ops.some(op=>['bit-math','hash-value'].includes(op.kind))){
   const actual=program.ops.find(op=>['bit-math','hash-value'].includes(op.kind));if(!actual)throw new Error('Actual emitted texture node missing')
   for(const kind of ['model','version','source-profile','evaluator','operation','input','schema']){
    const forged=structuredClone(program),node=forged.ops.find(op=>op.id===actual.id)
    if(kind==='model')node.properties.integer_bits_model='unknown'
    else if(kind==='version')node.properties.integer_bits_version=[5,2,0]
    else if(kind==='source-profile')node.properties.integer_bits_profile='unmeasured'
    else if(kind==='evaluator')node.properties.single_value_device='GPU'
    else if(kind==='operation')node.properties.operation='UNKNOWN'
    else if(kind==='input')Object.values(node.inputs)[0].socketType='VALUE'
    else node.type='VALUE'
    let error;try{const unexpected=buildSourceCompositor(forged,()=>null);unexpected.dispose()}catch(failure){error=String(failure)}
    if(!error?.includes('Integer Bits'))throw new Error('Malformed texture domain did not refuse '+kind+' '+error)
    if(renderer.info.memory.textures!==0)throw new Error('Malformed texture input allocated owned textures')
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
   if(!result.resolvedOrder.includes('blender-compositor'))throw new Error('Production pipeline bypassed authored Integer Bits')
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
  const compare=async()=>{
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8)
   if(!(pixels instanceof Float32Array))throw new Error('Actual Float32 readback required')
   const raw=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),pad=Math.ceil(8*16/256)*256/16
   const stride=pixels.length===256?8:backend==='webgpu'&&pixels.length===4*(pad*7+8)?pad:0
   if(!stride)throw new Error('Unknown actual readback layout')
   let mismatch=0
   for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let channel=0;channel<4;channel++)if(raw[(y*stride+x)*4+channel]!==expected[(y*8+x)*4+channel])mismatch++
   if(mismatch)throw new Error('Actual built texture compositor mismatches '+entry.case+' '+mismatch+' actual='+JSON.stringify(Array.from(raw.slice(0,4)))+' expected='+JSON.stringify(Array.from(expected.slice(0,4)))+' shader='+lastFragment)
   return mismatch
  }
  device?.pushErrorScope('validation');render();const mismatch=await compare();render();await compare()
  if(proof.final){
   for(let cycle=0;cycle<3;cycle++){
    if(cycle){pipeline=await createPipeline();render();await compare()}
    pipeline.dispose();pipeline=undefined
    for(const original of originals)if(original.object.material!==original.material||original.object.onBeforeRender!==original.callback)throw new Error('Pipeline disposal changed authored material/callback ownership')
    if(sourceMaterialDisposals||warnings.length)throw new Error('Reapply bypassed a graph or disposed source material '+JSON.stringify(warnings))
    const actualCache=[...liveTextures.keys()].filter(texture=>!target.textures.includes(texture))
    if(actualCache.length!==baselineCache.size||actualCache.some(texture=>!baselineCache.has(texture)))throw new Error('Port resources differ from exact no-compositor cache identity set '+JSON.stringify(actualCache.map(texture=>liveTextures.get(texture))))
   }
   bindings.dispose();ownedGeometries.forEach(geometry=>geometry.dispose());ownedSourceMaterials.forEach(material=>material.dispose())
  }else{
   built.dispose();built.dispose();material.dispose();const reapplied=buildSourceCompositor(program,pass=>sourceTexture?texture(sourceTexture):null);reapplied.dispose()
  }
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
  renderer.setRenderTarget(null);target.dispose();sourceTexture?.dispose()
  const remainingTextures=renderer.info.memory.textures;if(remainingTextures!==baselineCache.size||[...liveTextures.keys()].some(texture=>!baselineCache.has(texture)))throw new Error('Texture compositor retained non-baseline textures '+remainingTextures+' '+JSON.stringify([...liveTextures.values()]))
  if(renderer.info.memory.renderTargets!==0)throw new Error('Texture compositor retained render targets')
  rows.push({case:entry.case,wordMismatches:mismatch,remainingTextures,portOwnedTextures:0,remainingRenderTargets:renderer.info.memory.renderTargets,...(proof.final?{pinRejected,meshCount,pipeline:'blender-compositor',sourceMaterialsPreserved:true,lifecycleCycles:3,baselineSceneDrawCalls,baselineCacheRestored:true,baselineCache:[...baselineCache].map(texture=>({name:texture.name,uuid:texture.uuid,width:texture.image.width,height:texture.image.height}))}: {})})
 }
 renderer.dispose();supplied?.destroy();if(errors.length)throw new Error('Shader errors '+JSON.stringify(errors))
 if(integerShaderCompiles===0)throw new Error('Missing actual integer shader compilation control');return{backend,gpu,rows,negatives,errors,integerShaderCompiles,integerFloatBitcasts:0}
}
