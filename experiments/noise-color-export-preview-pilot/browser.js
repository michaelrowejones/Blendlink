import*as THREE from'three'
import{WebGPURenderer,NodeMaterial}from'three/webgpu'
import{uv,vec4}from'three/tsl'
import{startThreeCompiledScenePreparation}from'@runtime'
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('')
window.noiseColorPreview=async proof=>{
 const renderer=new WebGPURenderer({forceWebGL:proof.backend==='webgl2',antialias:false});renderer.setPixelRatio(1);renderer.setSize(64,64);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;document.querySelector('#preview').append(renderer.domElement)
 const errors=[],rows=[],scene=new THREE.Scene(),hostBackground=new THREE.Color(0x204060);scene.background=hostBackground;let prepared,installed,retained=false;const target=new THREE.RenderTarget(64,64,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const cleanup=()=>{installed?.dispose();prepared?.dispose();if(scene.background!==hostBackground||scene.children.length!==0)throw Error('Caller scene not restored');renderer.setRenderTarget(null);target.dispose();renderer.dispose();return{sceneRestored:true}}
 const result={status:'running',backend:proof.backend,rows,errors};window.noiseColorFailure=result
 try{
  await renderer.init();if((renderer.backend.isWebGPUBackend?'webgpu':'webgl2')!==proof.backend)throw Error('Actual API fallback');const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=renderer.backend.device?.adapterInfo;result.gpu={api:gl?'WebGL2':'WebGPU',...(gl?{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}:{vendor:info?.vendor,architecture:info?.architecture,description:info?.description})}
  renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));renderer.backend.device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)))
  const generated=await import(/* @vite-ignore */proof.moduleUrl),descriptor=generated.noiseColorScene
  for(const[file,pin]of Object.entries(proof.assetPins)){const b=await(await fetch(file)).arrayBuffer();if(await hash(b)!==pin)throw Error('Published asset changed '+file)}
  prepared=await startThreeCompiledScenePreparation({renderer,scene,descriptor,assetBaseUrl:proof.assetBaseUrl,viewport:{width:64,height:64},resizeRenderer:true,onWarning:m=>{throw Error('Installed scene warning '+m)}}).promise;installed=prepared.commit()
  if(!installed.tslMaterials||installed.tslMaterials.applied<1||installed.tslMaterials.skipped.length)throw Error('Production material IR not installed')
  const meshes=[];installed.root.traverse(o=>{if(o.isMesh)meshes.push(o)});if(meshes.length!==1||!meshes[0].material.isNodeMaterial||!meshes[0].material.emissiveNode)throw Error('Actual imported Noise Color emissive node absent')
  result.materialInstallation=installed.tslMaterials;result.meshCount=meshes.length
  const originals=meshes.map(m=>({mesh:m,material:m.material})),control=new NodeMaterial();control.fragmentNode=vec4(uv().x,uv().y.oneMinus(),0,1);control.blending=THREE.NoBlending
  const draw=(action,output=target)=>new Promise((done,fail)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(output);action();done(renderer._nodes.nodeFrame.frameId)}catch(error){fail(error)}}).catch(fail))
  const compare=async(kind,size)=>{
   const ref=proof.references.find(r=>r.kind===kind&&r.width===size),expectedBytes=await(await fetch(ref.url)).arrayBuffer();if(await hash(expectedBytes)!==ref.pixelSha256)throw Error('Native reference pin drift');const expected=new Float32Array(expectedBytes)
   target.setSize(size,size);installed.resize(size,size);const drawing=renderer.getDrawingBufferSize(new THREE.Vector2());if(drawing.x!==size||drawing.y!==size)throw Error('Owned renderer extent not resized');const frameId=await draw(()=>kind==='uv'?renderer.render(scene,installed.camera):installed.render())
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,size,size);if(!(pixels instanceof Float32Array)||pixels.length!==expected.length)throw Error('Unexpected installed Float32 readback')
   const actualWords=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length),expectedWords=new Uint32Array(expectedBytes);let flip=proof.backend==='webgpu'?false:false
   if(kind==='uv'){const score=f=>{let error=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)error+=Math.abs(pixels[((f?size-1-y:y)*size+x)*4+1]-expected[(y*size+x)*4+1]);return error};flip=score(true)<score(false);if(result.rowFlip!==undefined&&result.rowFlip!==flip)throw Error('UV orientation changed across extents');result.rowFlip=flip}else flip=result.rowFlip
   let maxAbs=0,violations=0,alphaDifferences=0,wordDifferences=0;const first=[]
   for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++){const src=(y*size+x)*4+c,dst=((flip?size-1-y:y)*size+x)*4+c,diff=Math.abs(pixels[dst]-expected[src]);if(c<3){maxAbs=Math.max(maxAbs,diff);if(!Number.isFinite(pixels[dst])||diff>2**-10){violations++;if(first.length<8)first.push({x,y,c,expected:expected[src],actual:pixels[dst]})}}else if(actualWords[dst]!==expectedWords[src])alphaDifferences++;if(actualWords[dst]!==expectedWords[src])wordDifferences++}
   const row={kind,frameId,drawingBuffer:[drawing.x,drawing.y],width:size,height:size,rowFlip:flip,words:pixels.length,maxAbs,violations,alphaDifferences,wordDifferences,first,actualWords:Array.from(actualWords)};rows.push(row);if(violations||alphaDifferences)throw Error('Installed '+kind+' scene gate failed '+JSON.stringify({...row,actualWords:undefined}))
  }
  for(const size of[64,128]){for(const o of originals)o.mesh.material=control;try{await compare('uv',size)}finally{for(const o of originals)o.mesh.material=o.material}await compare('color',size)}control.dispose()
  installed.resize(128,128);const visibleDrawing=renderer.getDrawingBufferSize(new THREE.Vector2());if(visibleDrawing.x!==128||visibleDrawing.y!==128)throw Error('Visible canvas extent differs from source');await draw(()=>installed.render(),null);if(renderer.backend.device)await renderer.backend.device.queue.onSubmittedWorkDone();result.visibleCanvas={width:128,height:128,dataUrl:renderer.domElement.toDataURL('image/png'),camera:installed.camera.name,backgroundProfile:'caller-owned Color preserved; opaque emissive canvas covers it'};result.visible=true;result.appliedOriginalGraph=true;result.status='INSTALLED_NOISE_COLOR_PREVIEW_PASSED';if(proof.keepVisible){retained=true;window.disposeNoiseColorPreview=cleanup}return result
 }finally{if(!retained)cleanup()}
}
