import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {pass,textureLoad,ivec2,uv,vec2,vec4,floor,screenCoordinate} from 'three/tsl'
import {buildSourceCompositor} from '@rotate-compositor'
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Missing pinned pilot input');const bytes=await response.arrayBuffer();if(await hash(bytes)!==pin)throw Error('Pilot pin changed '+url);return bytes}
window.runVectorRotatePilot=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgpu'?await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}):null
 if(wanted==='webgpu'&&!adapter)throw Error('Vector Rotate pilot requires an actual WebGPU adapter')
 const supplied=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({antialias:false,forceWebGL:wanted==='webgl2',...(supplied?{device:supplied}:{})});await renderer.init();renderer.info.autoReset=false
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Actual API fallback')
 const device=renderer.backend.device,gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(key=>[key,adapter.info[key]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const errors=[],rows=[],orientation=[],negatives=[],uploads=[],created=[],live=new Set();let ending=false
 renderer.debug.onShaderError=(context,program)=>errors.push(context.getProgramInfoLog(program));device?.addEventListener('uncapturederror',event=>errors.push(String(event.error)));device?.lost.then(event=>{if(!ending)errors.push('Device lost: '+event.message)})
 const isRow=texture=>texture.isDataTexture&&texture.name==='SceneToWeb private Vector Rotate Normalized rows'
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend),upload=renderer.backend.updateTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const result=create(texture,...args);live.add(texture);if(isRow(texture))created.push(texture);return result}
 renderer.backend.destroyTexture=(texture,...args)=>{const result=destroy(texture,...args);live.delete(texture);return result}
 renderer.backend.updateTexture=(texture,...args)=>{const result=upload(texture,...args);if(isRow(texture))uploads.push(texture);return result}
 renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setClearColor(0x102030,.375)
 const originalDispose=renderer.dispose.bind(renderer),target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const snapshot={backend,gpu,rows,orientation,negatives,active:null};window.vectorRotatePilotFailure=snapshot
 const size=entry=>{renderer.setPixelRatio(entry.pixelRatio??1);renderer.setSize(entry.width/(entry.pixelRatio??1),entry.height/(entry.pixelRatio??1));target.setSize(entry.width,entry.height);renderer.setRenderTarget(target)}
 const draw=action=>new Promise((done,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);action();done()}catch(error){reject(error)}}).catch(reject))
 const read=async(width,height)=>{
  const values=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height),padded=Math.ceil(width*16/256)*16,stride=values.length===width*height*4?width:backend==='webgpu'&&[4*(padded*(height-1)+width),4*padded*height].includes(values.length)?padded:0
  if(!(values instanceof Float32Array)||!stride)throw Error('Actual Float32 readback shape changed')
  const raw=new Uint32Array(values.buffer,values.byteOffset,values.length),words=new Uint32Array(width*height*4)
  for(let y=0;y<height;y++)words.set(raw.subarray(y*stride*4,(y*stride+width)*4),y*width*4)
  return words
 }
 const orient=(words,width,height,flip)=>{const result=new Uint32Array(words.length);for(let y=0;y<height;y++)result.set(words.subarray(y*width*4,(y+1)*width*4),(flip?height-1-y:y)*width*4);return result}
 const compare=(actual,expected,label)=>{let differences=0,first;for(let index=0;index<actual.length;index++)if(actual[index]!==expected[index]){differences++;first??={index,actual:actual[index],expected:expected[index]}}snapshot.active={label,words:Array.from(actual),wordDifferences:differences,first};if(actual.length!==expected.length||differences)throw Error('Vector Rotate exact-word gate '+label+' '+differences+' '+JSON.stringify(first));return{words:actual.length,wordDifferences:0}}
 const flips=new Map()
 try{
  device?.pushErrorScope('validation')
  // Calibrate CPU-buffer/readback order using an unrelated explicit texel load.
  // Then check native integer Pixel against screenCoordinate independently of
  // the rotation kernel. No flip is inferred from a rotation output.
  for(const control of proof.pixelControls){
   size(control);const bytes=await pinned(control.url,control.sha256),expected=new Uint32Array(bytes),image=new THREE.DataTexture(new Float32Array(bytes),control.width,control.height,THREE.RGBAFormat,THREE.FloatType);image.needsUpdate=true
   const material=new NodeMaterial();material.blending=THREE.NoBlending;material.fragmentNode=textureLoad(image,ivec2(uv().mul(vec2(control.width,control.height))));const quad=new QuadMesh(material)
   try{
    await draw(()=>quad.render(renderer));const actual=await read(control.width,control.height)
    const matches=flip=>{const aligned=orient(actual,control.width,control.height,flip);return aligned.every((value,index)=>value===expected[index])},normal=matches(false),reverse=matches(true)
    if(normal===reverse)throw Error('Independent input orientation calibration failed')
    const flip=reverse;flips.set(control.width+'x'+control.height,flip)
    material.fragmentNode=vec4(floor(screenCoordinate),0,1);material.needsUpdate=true;await draw(()=>quad.render(renderer))
    const screen=orient(await read(control.width,control.height),control.width,control.height,flip),metrics=compare(screen,expected,'independent-pixel-'+control.width+'x'+control.height)
    orientation.push({width:control.width,height:control.height,readbackFlipY:flip,nativeDomainFlipY:control.nativeDomainFlipY,...metrics,rawWords:Array.from(screen)})
   }finally{material.dispose();image.dispose()}
  }
  for(const entry of proof.cases){
   snapshot.active={label:entry.case,stage:'setup'}
   size(entry);const program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.program.sha256))),expected=new Uint32Array(await pinned(entry.pixelUrl,entry.pixels.sha256)),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),source=pass(scene,camera),sourceTexture=source.getTextureNode(),sourceBefore={value:sourceTexture.value,reference:sourceTexture.referenceNode,uv:sourceTexture.uvNode,sampler:sourceTexture.sampler},sourceDispose=source.dispose.bind(source)
   let entries=0,wrongAlpha=false,sourceDisposed=0;scene.onBeforeRender=()=>{entries++;if(renderer.getClearAlpha()!==.375)wrongAlpha=true};source.dispose=()=>{sourceDisposed++;return sourceDispose()}
   const built=buildSourceCompositor(program,()=>sourceTexture),material=new NodeMaterial();material.fragmentNode=built.node;material.blending=THREE.NoBlending;const quad=new QuadMesh(material),beforeUploads=uploads.length,beforeCreates=created.length,samples=[]
   try{
    for(let frame=0;frame<2;frame++){
     const uploadBefore=uploads.length;await draw(()=>quad.render(renderer));const actual=orient(await read(entry.width,entry.height),entry.width,entry.height,flips.get(entry.width+'x'+entry.height));const metrics=compare(actual,expected,entry.case+'-'+frame)
     samples.push({frame,...metrics,rawWords:Array.from(actual),rowUploads:uploads.length-uploadBefore})
     if(frame&&uploads.length!==uploadBefore)throw Error('Warm Vector Rotate frame uploaded row data')
    }
    const field=entry.kind==='normalized',rowTextures=[...live].filter(isRow)
    if(rowTextures.length!==(field?1:0)||created.length-beforeCreates!==(field?1:0)||uploads.length-beforeUploads!==(field?1:0))throw Error('Private row allocation/upload census mismatch')
    if(field&&(!entries||wrongAlpha))throw Error('Original producer did not enter with caller clear state')
    if(sourceTexture.value!==sourceBefore.value||sourceTexture.referenceNode!==sourceBefore.reference||sourceTexture.uvNode!==sourceBefore.uv||sourceTexture.sampler!==sourceBefore.sampler)throw Error('Borrowed source texture changed')
    if(field&&negatives.length===0){
     const foreign=pass(new THREE.Scene(),new THREE.PerspectiveCamera());sourceTexture.passNode=foreign;const entered=entries;let error
     try{await draw(()=>quad.render(renderer))}catch(failure){error=String(failure)}finally{sourceTexture.passNode=source}
     if(!/Vector Rotate.*PassNode/.test(error)||entries!==entered)throw Error('Replacement producer was not refused before scheduling');negatives.push({kind:'replaced-producer',error});foreign.dispose()
     const version=rowTextures[0].version;size({width:3,height:9});try{error=null;await draw(()=>quad.render(renderer))}catch(failure){error=String(failure)}finally{size(entry)}
     if(!/physical extents/.test(error)||rowTextures[0].version!==version)throw Error('Invalid extent altered current table');negatives.push({kind:'invalid-extent',error});await draw(()=>quad.render(renderer));compare(orient(await read(entry.width,entry.height),entry.width,entry.height,flips.get(entry.width+'x'+entry.height)),expected,entry.case+'-recovery')
    }
    rows.push({case:entry.case,width:entry.width,height:entry.height,pixelRatio:entry.pixelRatio,kind:entry.kind,samples,producerEntries:entries,callerClearPreserved:!wrongAlpha,rowBindings:rowTextures.length,maximumRowBytes:rowTextures.reduce((sum,texture)=>sum+texture.image.data.byteLength,0),warmUploads:0})
   }finally{built.dispose();built.dispose();material.dispose();if(sourceDisposed)throw Error('Port disposed a borrowed producer');source.dispose()}
   if([...live].some(isRow))throw Error('Disposed Vector Rotate retained a row allocation')
  }
  // A saved original renderer disposal must revoke the actual root while an
  // external WebGPU device survives; retire the one owned handle exactly once.
  const entry=proof.cases.find(row=>row.kind==='normalized'),program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.program.sha256)));size(entry)
  const source=pass(new THREE.Scene(),new THREE.PerspectiveCamera()),built=buildSourceCompositor(program,()=>source),material=new NodeMaterial();material.fragmentNode=built.node;material.blending=THREE.NoBlending;await draw(()=>new QuadMesh(material).render(renderer));if(device)await device.queue.onSubmittedWorkDone();else gl.finish()
  const table=[...live].filter(isRow);if(table.length!==1)throw Error('Saved dispose needs one original row allocation');const data=renderer.backend.get(table[0]),handle=backend==='webgpu'?data.texture:data.textureGPU;let physicalDestroys=0
  if(backend==='webgpu'){const destroy=handle.destroy.bind(handle);handle.destroy=()=>{physicalDestroys++;destroy()}}else{const remove=gl.deleteTexture.bind(gl);gl.deleteTexture=value=>{if(value===handle)physicalDestroys++;remove(value)}}
  source.dispose();material.dispose();renderer.setRenderTarget(null);target.dispose();originalDispose();let staleError
  try{built.node.update({renderer})}catch(error){staleError=String(error)}
  if(!/Vector Rotate.*epoch|Vector Rotate.*actual available/.test(staleError))throw Error('Saved dispose failed to revoke root: '+staleError)
  built.dispose();built.dispose();if(physicalDestroys!==1)throw Error('Original owned row handle cleanup count '+physicalDestroys)
  const validation=await device?.popErrorScope();if(validation)errors.push(validation.message);if(errors.length)throw Error(JSON.stringify(errors))
  return{status:'PASSED_RESEARCH_ONLY_VECTOR_ROTATE_BROWSER_PILOT',supportCredit:0,FinalCredit:0,backend,gpu,orientation,rows,negatives,savedDispose:{error:staleError,physicalDestroys,perHandleDestroys:[physicalDestroys],distinctHandles:1,externalDevice:!!supplied},errors}
 }catch(error){snapshot.error=String(error);throw error}finally{ending=true;renderer.setAnimationLoop(null);renderer.setRenderTarget(null);target.dispose();renderer.dispose();supplied?.destroy()}
}
