import * as THREE from 'three'
import {WebGPURenderer} from 'three/webgpu'
import {vec4} from 'three/tsl'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {installTslMaterials} from '@required-runtime'
import {assertLegacyMaterialCarriers} from '@required-document'
window.runRequiredRenderer=async descriptor=>{
 const backend=new URLSearchParams(location.search).get('backend')
 const loaded=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(descriptor.url)
 const meshes=[];loaded.scene.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh)})
 if(meshes.length!==1)throw new Error('Expected the actual single authored owner')
 const mesh=meshes[0],original=mesh.material,callback=mesh.onBeforeRender
 const stock={roughness:original.roughness,roughnessMap:!!original.roughnessMap,color:original.color.toArray(),map:!!original.map,runtime:mesh.userData.blendlink_tsl_runtime}
 let loads=0,legacyError
 const programs=await(await fetch(descriptor.materialPrograms.url)).json()
 try{await assertLegacyMaterialCarriers({root:loaded.scene,descriptor,loadPrograms:async()=>{loads++;return programs}})}catch(error){legacyError=String(error)}
 const installed=await installTslMaterials({root:loaded.scene,descriptor})
 if(installed.applied!==1||installed.skipped.length||!mesh.material.roughnessNode)throw new Error('Actual Magic Roughness failed to install')
 const node=mesh.material.roughnessNode
 mesh.material.fragmentNode=vec4(node,node,node,1);mesh.material.needsUpdate=true
 const adapter=backend==='webgpu'?await navigator.gpu.requestAdapter():null
 if(backend==='webgpu'&&!adapter)throw new Error('Actual WebGPU adapter unavailable')
 const device=await adapter?.requestDevice()
 const renderer=new WebGPURenderer({antialias:false,forceWebGL:backend==='webgl2',...(device?{device}:{})});await renderer.init()
 if(backend==='webgpu'&&!renderer.backend.isWebGPUBackend)throw new Error('WebGPU silently fell back')
 renderer.setPixelRatio(1);renderer.setSize(32,32);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info')
 const gpu=adapter?{api:'WebGPU',vendor:adapter.info.vendor,architecture:adapter.info.architecture}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const target=new THREE.RenderTarget(32,32,{type:THREE.FloatType,depthBuffer:true});target.texture.colorSpace=THREE.NoColorSpace
 renderer.setRenderTarget(target);renderer.render(loaded.scene,loaded.cameras[0]);const data=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32),stride=data.length/(32*4)
 const center=Array.from(data.slice((16*stride+16)*4,(16*stride+16)*4+4)),range=[Math.min(...data.filter((_,i)=>i%4===0)),Math.max(...data.filter((_,i)=>i%4===0))]
 renderer.setRenderTarget(null);installed.dispose();target.dispose();const textures=renderer.info.memory.textures;renderer.dispose();device?.destroy()
 if(mesh.material!==original||mesh.onBeforeRender!==callback||textures!==0)throw new Error('Carrier probe changed caller ownership or leaked textures')
 return{backend,gpu,stock,legacyLoads:loads,legacyError:legacyError??null,installedCenter:center,installedRange:range,ownedTexturesRemaining:textures}
}
window.runRequiredRendererMulti=async descriptor=>{
 const loaded=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(descriptor.url)
 const programs=await(await fetch(descriptor.materialPrograms.url)).json(),meshes=[]
 loaded.scene.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh)})
 if(meshes.length!==2)throw new Error('Expected two actual primitive material bindings')
 const rows=[]
 for(const mesh of meshes){
  const marker=mesh.userData.blendlink_tsl_runtime?.requiresNodeRenderer
  if(marker?.model!=='live-material-programs-v1'||marker.programs.length!==2)throw new Error('Merged requirements did not reach the actual loaded primitive')
  const root=new THREE.Group();root.add(mesh.clone())
  let loads=0,error
  try{await assertLegacyMaterialCarriers({root,descriptor,loadPrograms:async()=>{loads++;return programs}})}catch(failure){error=String(failure)}
  const family=mesh.material.userData.blendlink_source_material.startsWith('Magic')?'Magic Texture':'Squeeze Value'
  if(loads!==1||!error?.includes(family))throw new Error('Actual material borrowed the other material requirement')
  rows.push({source:mesh.material.userData.blendlink_source_material,marker,loads,error})
 }
 const originals=meshes.map(mesh=>({material:mesh.material,callback:mesh.onBeforeRender}))
 const installed=await installTslMaterials({root:loaded.scene,descriptor})
 if(installed.applied!==2||installed.skipped.length)throw new Error('Merged actual Final programs did not install')
 installed.dispose()
 if(meshes.some((mesh,index)=>mesh.material!==originals[index].material||mesh.onBeforeRender!==originals[index].callback))throw new Error('Merged material disposal changed caller ownership')
 return{actualPrimitiveBindings:meshes.length,rows,installedMaterials:2,sourceRestored:true}
}
