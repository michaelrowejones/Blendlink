import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {vec4,textureLoad,uv,ivec2,vec2} from 'three/tsl'
import {buildTslColorNode} from '@selection-recipe'
import {installTslMaterials} from '@selection-materials'
import {buildSourceCompositor} from '@selection-compositor'
import {loadSourcePresentation} from '@selection-source'
import {ThreeWebgpuPostPipelineService} from '@selection-pipeline'
import {bindCompiledScene} from '@selection-bindings'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')
const bytes=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw new Error('Proof asset fetch failed');const result=await response.arrayBuffer();if(await hash(result)!==pin)throw new Error('Proof asset pin mismatch');return result}
const json=async(url,pin)=>JSON.parse(new TextDecoder().decode(await bytes(url,pin)))
window.staticSelectionProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('Static selection requires an actual WebGPU adapter')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(device?{device}:{})});await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw new Error('Actual renderer fallback is not requested API coverage')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??renderer.backend.device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.setPixelRatio(1);renderer.setSize(8,8);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const rows=[],errors=[];renderer.debug.onShaderError=(gl,program)=>errors.push(gl.getProgramInfoLog(program));let flip
 for(const entry of proof.cases){
  const expected=new Uint32Array(await bytes(entry.pixelUrl,entry.pixelSha256)),target=new THREE.RenderTarget(8,8,{type:THREE.FloatType,depthBuffer:!!proof.final});target.texture.colorSpace=THREE.NoColorSpace
  let sourceTexture,quad,material,built,pipeline,installation,gltf,scene,camera,bindings,source,originals=[],geometries=new Set(),materials=new Set(),pinRejected=false
  const make=async()=>{
   if(!proof.final){
    const document=await json(entry.programUrl,entry.programSha256)
    if(proof.context==='shader'){material=new NodeMaterial();material.fragmentNode=vec4(buildTslColorNode(document,{activeUvChannel:0}),1)}
    else{
     const data=new Float32Array(8*8*4);for(let index=0;index<data.length;index+=4)data.set([.125,.25,.5,1],index)
     sourceTexture=new THREE.DataTexture(data,8,8,THREE.RGBAFormat,THREE.FloatType);sourceTexture.needsUpdate=true;sourceTexture.colorSpace=THREE.NoColorSpace
     const input=textureLoad(sourceTexture,ivec2(uv().mul(vec2(8,8))))
     built=buildSourceCompositor(document,()=>input);material=new NodeMaterial();material.fragmentNode=built.node
    }
    quad=new QuadMesh(material);return
   }
   const manifest=await json(entry.manifestUrl,entry.manifestSha256),glb=await bytes(entry.glbUrl,entry.glbSha256)
   gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb,new URL('.',new URL(manifest.url,location.href)).href)
   gltf.scene.traverse(object=>{if(object.isMesh){originals.push({object,material:object.material,callback:object.onBeforeRender});geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m))}})
   if(originals.length!==1||gltf.cameras.length!==1)throw new Error('Actual exported mesh/camera missing')
   scene=new THREE.Scene();scene.add(gltf.scene);scene.updateMatrixWorld(true);camera=gltf.cameras[0]
   if(proof.context==='shader'){
    try{await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:{...manifest.materialPrograms,hash:'0'.repeat(16)}}})}catch(error){pinRejected=/hash/i.test(String(error))}
    installation=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
    if(installation.applied!==1||installation.skipped.length)throw new Error('Actual saved shader program not installed')
    material=originals[0].object.material;if(!material.colorNode)throw new Error('Actual material channel absent')
    material.fragmentNode=vec4(material.colorNode,1);material.needsUpdate=true
   }else{
    try{await loadSourcePresentation({...manifest.sourcePresentation,hash:'0'.repeat(16)})}catch(error){pinRejected=/hash/i.test(String(error))}
    source=await loadSourcePresentation(manifest.sourcePresentation)
    bindings=bindCompiledScene(gltf.scene,{url:manifest.url,nodes:Object.fromEntries(manifest.nodes.map(x=>[x.name,x.name]))})
    pipeline=await ThreeWebgpuPostPipelineService.create({root:gltf.scene,scene,camera,renderer,bindings,sourcePresentation:source,onWarning:message=>errors.push(message)})
    pipeline.finalize();pipeline.activate(scene,camera);if(!pipeline.resolvedOrder.includes('blender-compositor'))throw new Error('Actual compositor pipeline bypassed')
   }
   if(!pinRejected)throw new Error('Bad publication pin did not refuse')
  }
  await make()
  const render=()=>{renderer.setRenderTarget(target);if(pipeline)pipeline.render();else if(proof.final)renderer.render(scene,camera);else quad.render(renderer)}
  const read=async()=>{
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8);if(!(pixels instanceof Float32Array))throw new Error('Actual Float32 readback required')
   const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),stride=pixels.length===256?8:backend==='webgpu'&&pixels.length===480?16:0
   if(!stride)throw new Error('Unknown actual GPU readback layout')
   const measure=flipped=>{let count=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++)if(words[((flipped?7-y:y)*stride+x)*4+c]!==expected[(y*8+x)*4+c])count++;return count}
   if(entry.case==='calibration'){flip=measure(true)<measure(false);if(measure(flip))throw new Error('Independent source/calibration mismatch '+measure(flip))}
   if(flip===undefined)throw new Error('Independent calibration is required')
   const mismatches=measure(flip);if(mismatches)throw new Error(entry.case+' '+proof.context+' has '+mismatches+' word mismatches')
   return mismatches
  }
  renderer.backend.device?.pushErrorScope('validation');render();const mismatches=await read();render();await read()
  const dispose=()=>{pipeline?.dispose();installation?.dispose();built?.dispose();if(!proof.final)material.dispose();sourceTexture?.dispose()}
  dispose()
  if(proof.final){
   for(const x of originals)if(x.object.material!==x.material||x.object.onBeforeRender!==x.callback)throw new Error('Dispose did not restore caller ownership')
   if(proof.context==='shader'){
    const manifest=await json(entry.manifestUrl,entry.manifestSha256);installation=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}});material=originals[0].object.material;material.fragmentNode=vec4(material.colorNode,1);material.needsUpdate=true
   }else{pipeline=await ThreeWebgpuPostPipelineService.create({root:gltf.scene,scene,camera,renderer,bindings,sourcePresentation:source});pipeline.finalize();pipeline.activate(scene,camera)}
   render();await read();pipeline?.dispose();installation?.dispose();bindings?.dispose();for(const x of originals)if(x.object.material!==x.material||x.object.onBeforeRender!==x.callback)throw new Error('Reapply did not restore caller ownership')
   geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose())
  }
  const error=await renderer.backend.device?.popErrorScope();if(error)errors.push(error.message)
  renderer.setRenderTarget(null);target.dispose();if(renderer.info.memory.textures!==0)throw new Error('Owned textures leaked '+renderer.info.memory.textures)
  rows.push({case:entry.case,wordMismatches:mismatches,remainingTextures:0,finalBindings:!!proof.final,pinRejected:proof.final?pinRejected:null,ownershipPreserved:true})
 }
 renderer.dispose();device?.destroy();if(errors.length)throw new Error(JSON.stringify(errors))
 return{backend,gpu,rows,errors}
}
