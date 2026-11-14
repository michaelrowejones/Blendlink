/* SPDX-License-Identifier: MIT */
import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {vec4} from 'three/tsl'
import {OwnedCompositorRowTable} from '@rows'
window.rowUploadControl=async()=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgl2'?null:await navigator.gpu.requestAdapter({powerPreference:'high-performance'})
 if(wanted==='webgpu'&&!adapter)throw Error('Actual WebGPU adapter unavailable')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...device?{device}:{}})
 await renderer.init();device?.pushErrorScope('validation')
 const saved=renderer.dispose.bind(renderer),backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
 if(backend!==wanted)throw Error('API fallback')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','description','device'].map(key=>[key,adapter.info[key]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],rows=[],handles=[],owned=new Set();let failure,ending=false
 renderer.debug.onShaderError=(context,p)=>errors.push(context.getProgramInfoLog(p))
 device?.addEventListener('uncapturederror',event=>errors.push(String(event.error)))
 device?.lost.then(info=>{if(!ending)errors.push('Device lost '+info.message)})
 const originalCreate=renderer.backend.createTexture.bind(renderer.backend),originalUpload=renderer.backend.updateTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{
  const result=originalCreate(texture,...args)
  if(owned.has(texture)){
   if(!renderer.backend.has(texture))throw Error('Actual allocated texture record missing')
   const physical=renderer.backend.get(texture),handle=backend==='webgpu'?physical.texture:physical.textureGPU,entry={handle,texture,destroys:0}
   if(!handle)throw Error('Actual allocated handle missing');handles.push(entry)
   if(backend==='webgpu'){const destroy=handle.destroy.bind(handle);handle.destroy=()=>{entry.destroys++;destroy()}}
   if(failure==='create')throw Error('CONTROL allocated then create threw before onUpdate')
  }
  return result
 }
 renderer.backend.updateTexture=(texture,...args)=>{const result=originalUpload(texture,...args);if(owned.has(texture)&&failure==='upload')throw Error('CONTROL upload threw before onUpdate');return result}
 if(gl){const remove=gl.deleteTexture.bind(gl);gl.deleteTexture=handle=>{for(const entry of handles)if(entry.handle===handle)entry.destroys++;remove(handle)}}
 renderer.setPixelRatio(1);renderer.setSize(13,9);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
 const target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;renderer.setRenderTarget(target)
 const draw=quad=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{quad.render(renderer);resolve()}catch(error){reject(error)}}))
 const owner=()=>{
  const table=new OwnedCompositorRowTable(2,(w,h)=>new Float32Array(Math.max(w,h)*2).fill(.25),{label:'Actual row upload control',name:'Owned actual partial upload rows'}),value=table.sample('X',0),textures=new Set()
  value.traverse(node=>{if(node.isTextureNode)textures.add(node.value)});if(textures.size!==1)throw Error('Expected one owned row texture')
  const texture=[...textures][0];owned.add(texture)
  const material=new NodeMaterial();material.fragmentNode=table.guard(vec4(value,value,value,1).toVar());material.blending=THREE.NoBlending
  return{table,texture,material,quad:new QuadMesh(material)}
 }
 try{
  for(const mode of['none','create','upload'])for(const route of['dispose','retry']){
   const resource=owner(),start=handles.length;failure=mode==='none'?undefined:mode
   let error
   try{resource.table.validate(renderer);await draw(resource.quad)}catch(reason){error=String(reason)}
   if((mode==='none')===!!error||error&&!error.includes('CONTROL'))throw Error('Unexpected partial failure control '+error)
   if(route==='retry'){
    failure=undefined;resource.table.validate(renderer);await draw(resource.quad)
    const raw=await renderer.readRenderTargetPixelsAsync(target,0,0,13,9)
    if(!(raw instanceof Float32Array)||raw.length<13*9*4)throw Error('Missing actual retry output')
    // Readback row padding is API-owned; inspect every actual pixel row.
    const stride=raw.length===13*9*4?13:16
    for(let y=0;y<9;y++)for(let x=0;x<13;x++)for(let c=0;c<4;c++)if(raw[(y*stride+x)*4+c]!==[.25,.25,.25,1][c])throw Error('Actual recovered row output changed')
   }
   resource.table.dispose();resource.table.dispose();resource.material.dispose();owned.delete(resource.texture)
   const allocated=handles.slice(start),expected=mode==='none'||route==='dispose'?1:2
   if(allocated.length!==expected||allocated.some(entry=>entry.destroys!==1))throw Error('Actual row handle leaked or double-destroyed '+JSON.stringify({mode,route,expected,destroys:allocated.map(e=>e.destroys)}))
   rows.push({case:mode+'-'+route,allocated:allocated.length,destroys:allocated.map(entry=>entry.destroys),recovered:route==='retry',error:error??null})
  }
  const resource=owner(),start=handles.length;failure='create'
  let error;try{resource.table.validate(renderer);await draw(resource.quad)}catch(reason){error=String(reason)}
  if(!error?.includes('CONTROL'))throw Error('Saved-dispose partial creation did not fail')
  target.dispose();ending=true;saved();resource.table.dispose();resource.table.dispose();resource.material.dispose()
  const allocated=handles.slice(start);if(allocated.length!==1||allocated[0].destroys!==1)throw Error('Original renderer dispose lost partial ownership')
  rows.push({case:'create-saved-dispose',allocated:1,destroys:[1],error})
  if(device){await device.queue.onSubmittedWorkDone();const validation=await device.popErrorScope();if(validation)errors.push(validation.message)}
  if(errors.length)throw Error(errors.join(';'))
  return{backend,gpu,rows,errors,supportCredit:0}
 }finally{ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);target.dispose();renderer.dispose();device?.destroy()}
}

// Independent fresh renderer per destructive edge control. No source kernel,
// row plan, or numerical input is changed; mutations target cleanup records.
window.rowCleanupEdgeControl=async()=>{
 const wanted=new URLSearchParams(location.search).get('backend'),rows=[]
 for(const mode of['observer-before-native-reset','observer-after-native-reset','borrowed-destructor-field','mutated-default-flag',...(wanted==='webgl2'?['late-partial-replaced-context']:[])]){
  const adapter=wanted==='webgl2'?null:await navigator.gpu.requestAdapter({powerPreference:'high-performance'}),device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...device?{device}:{}})
  await renderer.init();device?.pushErrorScope('validation')
  const savedDispose=renderer.dispose.bind(renderer),backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
  if(backend!==wanted)throw Error('Edge control API fallback')
  const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','description','device'].map(key=>[key,adapter.info[key]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
  const errors=[];let ending=false,borrowedRenderer,foreign,foreignOwner,borrowedDestroys=0,ownedDestroys=0,replacementContextDeletes=0,partialError
  device?.addEventListener('uncapturederror',event=>errors.push(String(event.error)));device?.lost.then(info=>{if(!ending)errors.push('Device lost '+info.message)})
  renderer.debug.onShaderError=(context,p)=>errors.push(context.getProgramInfoLog(p))
  renderer.setPixelRatio(1);renderer.setSize(13,9);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  const target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace;renderer.setRenderTarget(target)
  const table=new OwnedCompositorRowTable(2,(w,h)=>new Float32Array(Math.max(w,h)*2).fill(.25),{label:'Actual cleanup edge rows',name:'Owned actual cleanup edge rows'}),sample=table.sample('X',0),all=new Set()
  sample.traverse(node=>{if(node.isTextureNode)all.add(node.value)});if(all.size!==1)throw Error('Expected one actual edge row texture');const texture=[...all][0]
  const material=new NodeMaterial();material.fragmentNode=table.guard(vec4(sample,sample,sample,1).toVar());material.blending=THREE.NoBlending
  const quad=new QuadMesh(material),originalCreate=renderer.backend.createTexture.bind(renderer.backend);let ownedHandle
  const nativeGlDelete=gl?.deleteTexture.bind(gl)
  if(gl)gl.deleteTexture=handle=>{if(handle===ownedHandle)ownedDestroys++;nativeGlDelete(handle)}
  renderer.backend.createTexture=(candidate,...args)=>{
   const result=originalCreate(candidate,...args)
   if(candidate===texture){if(!renderer.backend.has(texture))throw Error('Missing edge physical record');const physical=renderer.backend.get(texture);ownedHandle=backend==='webgpu'?physical.texture:physical.textureGPU
    if(!ownedHandle)throw Error('Missing edge physical handle')
    if(device){const remove=ownedHandle.destroy.bind(ownedHandle);ownedHandle.destroy=()=>{ownedDestroys++;remove()}}
    if(mode==='late-partial-replaced-context')throw Error('CONTROL partial row allocation before onUpdate')
   }
   return result
  }
  const reset=()=>{renderer._textures.dispose();renderer.info.dispose()}
  if(mode==='observer-before-native-reset')texture.addEventListener('dispose',reset)
  try{
   table.validate(renderer)
   await new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{quad.render(renderer);resolve()}catch(error){reject(error)}})).catch(error=>{if(mode!=='late-partial-replaced-context'||!String(error).includes('CONTROL'))throw error;partialError=String(error)})
   if(!ownedHandle)throw Error('No actual edge allocation observed')
   if(mode==='observer-after-native-reset')texture.addEventListener('dispose',reset)
   if(mode==='borrowed-destructor-field'){
    const physical=renderer.backend.get(texture)
    if(device){foreign=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});const remove=foreign.destroy.bind(foreign);foreign.destroy=()=>{borrowedDestroys++;remove()};physical.msaaTexture=foreign}
    else{foreign=gl.createFramebuffer();foreignOwner={};renderer.backend.get(foreignOwner).framebuffers={borrowed:foreign};physical.renderTarget=foreignOwner;const remove=gl.deleteFramebuffer.bind(gl);gl.deleteFramebuffer=handle=>{if(handle===foreign)borrowedDestroys++;remove(handle)}}
   }
   if(mode==='mutated-default-flag')renderer._textures.data.get(texture).isDefaultTexture=true
   // Retire the test target while its native manager still owns its record.
   // Subsequent manager reset controls concern only the one owned table.
   renderer.setRenderTarget(null);target.dispose()
   if(mode==='late-partial-replaced-context'){
    if(!partialError)throw Error('Expected actual pre-onUpdate failure')
    ending=true;savedDispose()
    borrowedRenderer=new WebGPURenderer({forceWebGL:true,antialias:false});await borrowedRenderer.init()
    const replacement=borrowedRenderer.backend.gl,remove=replacement.deleteTexture.bind(replacement)
    replacement.deleteTexture=handle=>{replacementContextDeletes++;remove(handle)}
    renderer.backend.gl=replacement
   }
   table.dispose();table.dispose();material.dispose()
   if(ownedDestroys!==1||borrowedDestroys!==0||replacementContextDeletes!==0)throw Error('Edge cleanup violated exact ownership '+JSON.stringify({mode,ownedDestroys,borrowedDestroys,replacementContextDeletes}))
   if(mode==='borrowed-destructor-field'){
    const physical=renderer.backend.has(texture)?renderer.backend.get(texture):undefined
    if(device&&physical?.msaaTexture!==foreign||gl&&renderer.backend.get(foreignOwner).framebuffers.borrowed!==foreign)throw Error('Borrowed destructor field was removed')
   }
   if(device){await device.queue.onSubmittedWorkDone();const validation=await device.popErrorScope();if(validation)errors.push(validation.message)}
   if(errors.length)throw Error(errors.join(';'))
   rows.push({case:mode,backend,gpu,ownedDestroys,borrowedDestroys,replacementContextDeletes,partialError:partialError??null,errors})
  }finally{
   ending=true;renderer.setAnimationLoop(null);if(gl)renderer.backend.gl=gl
   try{table.dispose();material.dispose();target.dispose()}finally{if(foreign){if(device)foreign.destroy();else{gl.deleteFramebuffer(foreign);if(renderer.backend.has(foreignOwner))renderer.backend.delete(foreignOwner)}}renderer.dispose();borrowedRenderer?.dispose();device?.destroy()}
  }
 }
 return{backend:wanted,rows,supportCredit:0}
}
