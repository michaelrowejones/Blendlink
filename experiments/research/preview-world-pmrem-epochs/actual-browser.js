import * as T from 'three'
import {WebGPURenderer,PMREMGenerator} from 'three/webgpu'
import {installLoadedThreeCompiledScene,prepareLoadedThreeCompiledScene} from '@late-runtime'
const descriptor={url:'/owned-loaded.glb',nodes:{},playback:{start:'manual',loop:'repeat',speed:1},look:{toneMapping:'application',exposure:0,background:'application'},authoringPreview:{look:{toneMapping:'none',exposure:0,sourceViewTransform:'Raw',exact:true},shadows:{enabled:false},world:{color:[.1,.2,.3],strength:2,exact:true,source:'background'}}}
const loaded=()=>{const root=new T.Group();return{scene:root,scenes:[root],animations:[],cameras:[],asset:{},parser:{json:{asset:{version:'2.0'}},plugins:{},extensions:{},options:{}},userData:{}}}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
window.runLatePmrem=async()=>{
 const api=new URLSearchParams(location.search).get('api'),rows=[]
 for(const mode of['ready','adopted','cancelled-compile']){
  const adapter=api==='webgpu'?await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}):undefined;if(api==='webgpu'&&!adapter)throw Error('Actual WebGPU adapter required')
  const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:api==='webgl2',antialias:false,...(device?{device}:{})});const savedDispose=renderer.dispose.bind(renderer);await renderer.init();renderer.setSize(32,24)
  const backend=renderer.backend,gl=backend.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','description','device'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
  const scene=new T.Scene(),previous=new T.Color(.03125,.0625,.125);scene.background=previous;const hostEnvironment=new T.Texture();scene.environment=hostEnvironment
  const errors=[];let ending=false;device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)));device?.lost.then(e=>{if(!ending)errors.push('device lost '+e.message)})
  let result,installed,prepared,taskError,targetDisposals=0
  const from=PMREMGenerator.prototype.fromEquirectangular;PMREMGenerator.prototype.fromEquirectangular=function(...args){result=from.apply(this,args);result.addEventListener('dispose',()=>targetDisposals++);return result}
  const originalCompile=renderer.compileAsync,started=deferred(),finish=deferred(),controller=new AbortController()
  try{
   if(mode==='cancelled-compile')renderer.compileAsync=async function(...args){await originalCompile.apply(this,args);started.resolve();await finish.promise}
   const options={renderer,scene,descriptor,useAuthoringPreview:true,prewarm:mode==='cancelled-compile',signal:controller.signal}
   if(mode==='cancelled-compile'){prepared=prepareLoadedThreeCompiledScene(loaded(),options);await started.promise}
   else installed=await installLoadedThreeCompiledScene(loaded(),options)
   if(!result?.isRenderTarget)throw Error('Actual owned PMREM target missing')
   const manager=renderer._textures,record=manager.data.get(result),textures=[...record.textures,record.depthTexture].filter(Boolean),handles=textures.map(texture=>({texture,handle:backend.get(texture)[api==='webgpu'?'texture':'textureGPU'],destroyCalls:0}))
   if(handles.length!==2||handles.some(r=>!r.handle))throw Error('Expected actual color/depth attachments')
   const fbos=api==='webgl2'?Object.values(backend.get(result).framebuffers??{}).map(handle=>({handle,destroyCalls:0})):[]
   if(api==='webgpu')for(const row of handles){const destroy=row.handle.destroy.bind(row.handle);row.handle.destroy=()=>{row.destroyCalls++;destroy()}}
   else{const deleteTexture=gl.deleteTexture.bind(gl),deleteFramebuffer=gl.deleteFramebuffer.bind(gl);gl.deleteTexture=handle=>{const row=handles.find(r=>r.handle===handle);if(row)row.destroyCalls++;deleteTexture(handle)};gl.deleteFramebuffer=handle=>{const row=fbos.find(r=>r.handle===handle);if(row)row.destroyCalls++;deleteFramebuffer(handle)}}
   if(mode==='adopted'){scene.environmentIntensity=.375;installed.dispose();installed=undefined;if(handles.some(r=>r.destroyCalls)||scene.environment!==result.texture)throw Error('Adopted ready target was not retained')}
   const originalEpoch=manager.data;savedDispose();if(manager.data===originalEpoch)throw Error('Saved renderer disposal did not reset manager')
   let externalDeviceAlive=false
   if(device){device.pushErrorScope('validation');const b=device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST});const error=await device.popErrorScope();b.destroy();if(error)throw Error('External device was destroyed '+error.message);externalDeviceAlive=true}
   if(mode==='cancelled-compile'){controller.abort();finish.resolve();try{await prepared}catch(e){taskError=String(e)}if(!taskError||!/cancel|stale|abort/i.test(taskError))throw Error('Pending preparation was not cancelled '+taskError)}
   else if(mode==='adopted'){result.texture.dispose();result.texture.dispose()}
   else{installed.dispose();installed.dispose();installed=undefined}
   if(handles.some(r=>r.destroyCalls!==1)||fbos.some(r=>r.destroyCalls!==1)||targetDisposals!==1)throw Error('Actual original allocations not destroyed once '+JSON.stringify({mode,attachments:handles.map(r=>r.destroyCalls),fbos:fbos.map(r=>r.destroyCalls),targetDisposals}))
   if(mode!=='adopted'&&(scene.background!==previous||scene.environment!==hostEnvironment))throw Error('Late cleanup changed host source identity')
   if(renderer.info.memory.textures!==0||renderer.info.memory.renderTargets!==0||textures.some(t=>backend.has(t)))throw Error('Late cleanup retained owned records or changed reset counters')
   if(errors.length)throw Error(JSON.stringify(errors))
   rows.push({mode,gpu,actualAttachments:handles.length,attachmentDestroyCalls:handles.map(r=>r.destroyCalls),actualFramebuffers:fbos.length,framebufferDestroyCalls:fbos.map(r=>r.destroyCalls),targetDisposals,externalDeviceAlive,contextLost:gl?.isContextLost()??null,managerEpochChanged:true,callerAdoption:mode==='adopted',pendingPreparationCancelled:mode==='cancelled-compile',textures:renderer.info.memory.textures,renderTargets:renderer.info.memory.renderTargets,errors})
  }finally{PMREMGenerator.prototype.fromEquirectangular=from;renderer.compileAsync=originalCompile;finish.resolve();installed?.dispose();ending=true;renderer.dispose();device?.destroy()}
 }
 return{status:'NONQUALIFYING_ACTUAL_LATE_PMREM_DISPOSE_PASS',portCredit:0,api,rows}
}
