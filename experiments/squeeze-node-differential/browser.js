import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {vec4} from 'three/tsl'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {buildTslColorNode} from '@squeeze-recipe'
import {validSqueezeExpression} from '@squeeze-bounds'
import {installTslMaterials} from '@squeeze-runtime'
import {assertLegacyMaterialCarriers} from '@squeeze-document'
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('')
const fetchBytes=async(url,hash)=>{const bytes=await(await fetch(url)).arrayBuffer();if(hash&&await digest(bytes)!==hash)throw new Error('Published bytes changed '+url);return bytes}
const fetchJson=async(url,hash)=>JSON.parse(new TextDecoder().decode(await fetchBytes(url,hash)))
window.runProof=async proof=>{
 const webgl=new URLSearchParams(location.search).get('backend')==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw new Error('Squeeze proof requires an actual WebGPU adapter; WebGL2 fallback is not WebGPU coverage')
 const suppliedDevice=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(suppliedDevice?{device:suppliedDevice}:{})});await renderer.init()
 if(!webgl&&!renderer.backend.isWebGPUBackend){renderer.dispose();throw new Error('Squeeze proof refused an actual WebGL2 renderer fallback for requested WebGPU')}
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2',device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.setSize(32,32);renderer.setPixelRatio(1);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
 const failures=[],rows=[],errors=[],negativeChecks=[];renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
 let flip,maximum=0
 for(const entry of proof.cases){
  let boundCheckMilliseconds
  if(entry.id==='image-all'){
   const ir=(await fetchJson(entry.irUrl,entry.irSha256)).output,times=[]
   for(let i=0;i<30;i++){const start=performance.now();if(!validSqueezeExpression(ir,proof.version))throw new Error('Actual full-cap bound proof refused');times.push(performance.now()-start)}
   boundCheckMilliseconds={minimum:Math.min(...times),maximum:Math.max(...times),median:[...times].sort((a,b)=>a-b)[15],iterations:30,imagePixels:1024,pixelValuesPerValidation:12288}
  }
  const target=new THREE.RenderTarget(32,32,{type:THREE.FloatType,depthBuffer:!!proof.final});target.texture.colorSpace=THREE.NoColorSpace
  const native=[]
  for(const file of entry.native){const data=new Float32Array(await fetchBytes(file.url,file.sha256)),decoded=[];for(let i=0;i<data.length;i+=4)decoded.push(data[i]+data[i+1]/256+data[i+2]/65536);native.push(decoded)}
  let render,dispose,install,scene,material,originalMaterial,originalCallback,mesh,resources={textures:[]},gltf
  if(proof.final){
   const manifest=await fetchJson(entry.manifestUrl,entry.manifestSha256),bytes=await fetchBytes(manifest.url,entry.glbSha256)
   if(manifest.hash!==entry.glbSha256.slice(0,16)||manifest.stats.bytes!==bytes.byteLength)throw new Error('GLB publication pin changed')
   const programs=await fetchJson(manifest.materialPrograms.url,entry.programSha256)
   gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes,new URL('.',new URL(manifest.url,location.href)).href)
   const meshes=[];gltf.scene.traverse(object=>{if(object.isMesh)meshes.push(object)})
   if(meshes.length!==1||gltf.cameras.length!==1)throw new Error('Actual Final mesh/camera binding changed')
   mesh=meshes[0];originalMaterial=mesh.material;originalCallback=mesh.onBeforeRender
   let pinError
   try{await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:{...manifest.materialPrograms,hash:'0'.repeat(16)}}})}catch(error){pinError=String(error)}
   if(!pinError?.toLowerCase().includes('hash')||mesh.material!==originalMaterial||mesh.onBeforeRender!==originalCallback)throw new Error('Bad publication pin did not preserve loaded source')
   negativeChecks.push({id:entry.id,kind:'actual-published-program-pin',error:pinError})
   if(entry.id==='image-all'){
    const actual=programs.materials[entry.material].channels['Base Color'].tslIr
    for(const kind of ['overflow-product','changed-image-pixels']){
     const forged=structuredClone(actual),node=forged.output,allocated={textures:[]}
     if(node.op!=='squeeze_native')throw new Error('Actual Final Squeeze opcode missing')
     if(kind==='overflow-product'){node.value={op:'const_float',value:16};node.width={op:'const_float',value:16};node.center={op:'const_float',value:0}}
     else node.value.input.pixels[0]=32
     let error;try{buildTslColorNode(forged,{resources:allocated})}catch(failure){error=String(failure)}
     if(!error?.includes('Squeeze Value')||allocated.textures.length||mesh.material!==originalMaterial)throw new Error('Independent runtime bound refusal failed')
     negativeChecks.push({id:entry.id,kind,error,allocatedTextures:allocated.textures.length})
    }
   }
   if(entry.id!=='calibration'){
    let legacyError;try{await assertLegacyMaterialCarriers({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms},loadPrograms:async()=>programs})}catch(error){legacyError=String(error)}
    if(!legacyError?.includes('Squeeze Value'))throw new Error('Actual Final legacy carrier silently loses Squeeze '+entry.id)
    negativeChecks.push({id:entry.id,kind:'actual-legacy-squeeze-refusal',error:legacyError})
   }
   install=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
   if(install.applied!==1||install.skipped.length)throw new Error('Actual Final program did not install '+JSON.stringify(install.skipped))
   material=mesh.material;const selected=entry.channel==='Roughness'?material.roughnessNode:material.colorNode;if(!selected||material.userData.blendlink_source_material!==entry.material)throw new Error('Wrong Final material/channel binding')
   material.fragmentNode=entry.channel==='Roughness'?vec4(selected,selected,selected,1):vec4(selected,1);material.needsUpdate=true
   scene=new THREE.Scene();scene.add(gltf.scene);scene.updateMatrixWorld(true);gltf.cameras[0].updateMatrixWorld(true)
   render=()=>renderer.render(scene,gltf.cameras[0])
   dispose=()=>{install.dispose();if(mesh.material!==originalMaterial||mesh.onBeforeRender!==originalCallback)throw new Error('Dispose did not restore source material/callback')}
  }else{
   const document=await fetchJson(entry.irUrl,entry.irSha256)
   material=new NodeMaterial();material.fragmentNode=vec4(buildTslColorNode(document,{resources,activeUvChannel:0}),1)
   const quad=new QuadMesh(material);render=()=>quad.render(renderer);dispose=()=>{material.dispose();for(const map of resources.textures)map.dispose()}
  }
  renderer.setRenderTarget(target);renderer.setClearColor(new THREE.Color(1,0,1),1);device?.pushErrorScope('validation');render()
  const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32),stride=pixels.length/(32*4)
  const measure=flipped=>{let max=0,raw=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)for(let channel=0;channel<3;channel++){
   const value=pixels[((flipped?31-y:y)*stride+x)*4+channel],expected=native[native.length===1?0:channel][y*32+x]
   if(!Number.isFinite(value))throw new Error('Nonfinite Squeeze pixel '+entry.id)
   raw=Math.max(raw,Math.abs(value-expected));max=Math.max(max,Math.max(expected-value,value-Math.min(1,expected+proof.interval),0))
  }return{max,raw}}
  if(entry.id==='calibration'){flip=measure(true).raw<measure(false).raw;if(measure(flip).raw!==0)throw new Error('Independent image/UV calibration failed')}
  if(flip===undefined)throw new Error('Missing independent calibration')
  const metrics=measure(flip);maximum=Math.max(maximum,metrics.max)
  if(metrics.max>proof.kernelBudget)failures.push({id:entry.id,...metrics})
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
  // Repeat unchanged draw must remain stable; actual Final reinstall must own
  // a new material and leave the loaded source pointers untouched on disposal.
  render();const again=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32)
  if(again.length!==pixels.length||again.some((value,index)=>value!==pixels[index]))throw new Error('Repeated draw changed Squeeze output')
  renderer.setRenderTarget(null);dispose()
  if(proof.final){
   const manifest=await fetchJson(entry.manifestUrl,entry.manifestSha256),reinstalled=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
   if(reinstalled.applied!==1||reinstalled.skipped.length)throw new Error('Reapply refused')
   const selected=entry.channel==='Roughness'?mesh.material.roughnessNode:mesh.material.colorNode
   mesh.material.fragmentNode=entry.channel==='Roughness'?vec4(selected,selected,selected,1):vec4(selected,1);mesh.material.needsUpdate=true
   renderer.setRenderTarget(target);render();const reapplied=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32)
   if(reapplied.length!==pixels.length||reapplied.some((value,index)=>value!==pixels[index]))throw new Error('Actual Final reapply changed Squeeze output')
   renderer.setRenderTarget(null);reinstalled.dispose();if(mesh.material!==originalMaterial||mesh.onBeforeRender!==originalCallback)throw new Error('Reapply ownership changed source')
   mesh.geometry.dispose();originalMaterial.dispose()
  }
  target.dispose();const remainingTextures=renderer.info.memory.textures
  if(remainingTextures!==0)throw new Error('Owned Squeeze textures leaked after dispose: '+remainingTextures)
  rows.push({id:entry.id,...metrics,flipRows:flip,remainingTextures,boundCheckMilliseconds,resources:proof.final?'actual-Final-owned':resources.textures.length})
 }
 renderer.dispose();suppliedDevice?.destroy();if(errors.length)throw new Error(errors.join('\n'))
 return{backend,gpu,maximum,rows,negativeChecks,failures,errors}
}
