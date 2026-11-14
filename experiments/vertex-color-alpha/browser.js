import * as THREE from'three'
import{WebGPURenderer,NodeMaterial}from'three/webgpu'
import{vec4,screenCoordinate}from'three/tsl'
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js'
import{MeshoptDecoder}from'three/addons/libs/meshopt_decoder.module.js'
import{installTslMaterials}from'@alpha-materials'
import{vertexAlphaBinding}from'@alpha-field'

const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Alpha proof asset unavailable');const bytes=await response.arrayBuffer();if(await sha(bytes)!==pin)throw Error('Alpha proof asset pin mismatch');return bytes}
const json=async(url,pin)=>JSON.parse(new TextDecoder().decode(await pinned(url,pin)))

window.runVertexAlphaProof=async proof=>{
 const wanted=new URLSearchParams(location.search).get('backend'),webgl=wanted==='webgl2'
 const adapter=webgl?undefined:await navigator.gpu?.requestAdapter({powerPreference:'high-performance'})
 if(!webgl&&!adapter)throw Error('Vertex Alpha proof requires an actual WebGPU adapter')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:false,...(device?{device}:{})})
 const errors=[],uncaptured=[],contextEvents=[],live=new Set(),cases=[]
 let phase='initialization',disposing=false
 device?.addEventListener('uncapturederror',event=>uncaptured.push({phase,error:String(event.error)}))
 device?.lost.then(event=>{if(!disposing)uncaptured.push({phase,error:'device lost: '+event.message})})
 await renderer.init()
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('Renderer fallback does not count as requested API coverage')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=adapter?.info??renderer.backend.device?.adapterInfo
 const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}
  :{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 for(const event of['webglcontextlost','webglcontextrestored'])renderer.domElement.addEventListener(event,()=>contextEvents.push({event,phase}))
 renderer.debug.onShaderError=(gl,program)=>errors.push(gl.getProgramInfoLog(program))
 const createTexture=renderer.backend.createTexture.bind(renderer.backend),destroyTexture=renderer.backend.destroyTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const result=createTexture(texture,...args);live.add(texture);return result}
 renderer.backend.destroyTexture=(texture,...args)=>{const result=destroyTexture(texture,...args);live.delete(texture);return result}
 renderer.setPixelRatio(1);renderer.setSize(64,64);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const target=new THREE.RenderTarget(64,64,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 let flip=false,materialIdContext
 const read=async()=>{
  const value=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height)
  if(!(value instanceof Float32Array))throw Error('Alpha proof requires actual Float32 render target readback')
  return value
 }
 const outsideTarget=()=>new Set([...live].filter(texture=>!target.textures.includes(texture)))
 const assertBaseline=baseline=>{const current=outsideTarget();if(current.size!==baseline.size||[...current].some(texture=>!baseline.has(texture)))throw Error('Alpha install/dispose changed actual renderer-owned texture identity')}
 const compare=async(entry,frame)=>{
  const expected=new Float32Array(await pinned(frame.pixelUrl,frame.pixelSha256)),actual=await read(),width=frame.width,height=frame.height
  if(actual.length!==expected.length)throw Error('Alpha readback size differs from native pixels')
  let maxAbs=0,violations=0,alphaOneDiff=0,rgbWordDiff=0,seamMax=0,edgeMax=0,seamPixels=0,edgePixels=0
  const failurePixels=[]
  const aw=new Uint32Array(actual.buffer,actual.byteOffset,actual.length),ew=new Uint32Array(expected.buffer)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const source=(y*width+x)*4,destination=((flip?height-1-y:y)*width+x)*4
   const wx=-1+(x+.5)*2/width,wy=-1+(y+.5)*2/height,localX=entry.shared?(wx<0?2*(wx+1):2*(wx-1)):wx
   const seam=Math.abs(wy-2*localX)<=4/width||(entry.shared&&Math.abs(wx)<=4/width)
   const edge=x<2||y<2||x>=width-2||y>=height-2
   let pixelMax=0
   for(let lane=0;lane<3;lane++){
    const value=actual[destination+lane],diff=Math.abs(value-expected[source+lane])
    if(!Number.isFinite(value))throw Error('Nonfinite Vertex Alpha output')
    maxAbs=Math.max(maxAbs,diff);pixelMax=Math.max(pixelMax,diff);if(diff>2**-10)violations++
    if(aw[destination+lane]!==ew[source+lane])rgbWordDiff++
   }
   if(pixelMax>2**-10&&failurePixels.length<8)failurePixels.push({x,y,world:[wx,wy],localX,
    distanceFromAuthoredDiagonal:wy-2*localX,expected:[...expected.slice(source,source+4)],actual:[...actual.slice(destination,destination+4)],
    expectedWords:[...ew.slice(source,source+4)],actualWords:[...aw.slice(destination,destination+4)]})
   if(aw[destination+3]!==0x3f800000)alphaOneDiff++
   if(seam){seamPixels++;seamMax=Math.max(seamMax,pixelMax)}
   if(edge){edgePixels++;edgeMax=Math.max(edgeMax,pixelMax)}
  }
  if(violations||alphaOneDiff){
   const detail={case:entry.case,width,height,maxAbs,violations,alphaOneDiff,failurePixels}
   // Host-only diagnostic hook. It runs AFTER retaining the failed node
   // readback, never changes a gate, and always rethrows the numerical failure.
   if(proof.diagnostic&&typeof proof.materialIdModuleUrl==='string'&&materialIdContext){
    try{
     const {captureAlphaMaterialIDs}=await import(/* @vite-ignore */proof.materialIdModuleUrl)
     const ids=await captureAlphaMaterialIDs(renderer,target,materialIdContext.scene,materialIdContext.camera)
     const words=new Uint32Array(ids.pixels.buffer,ids.pixels.byteOffset,ids.pixels.length)
     detail.materialIdControl={source:'independent-flat-owner-material-ids',width:ids.width,height:ids.height,qualificationCredit:0,
      pixels:failurePixels.map(pixel=>{const offset=((flip?height-1-pixel.y:pixel.y)*width+pixel.x)*4
       return{x:pixel.x,y:pixel.y,rgba:[...ids.pixels.slice(offset,offset+4)],words:[...words.slice(offset,offset+4)]}})}
    }catch(error){detail.materialIdError=String(error)}
   }
   throw Error('Vertex Alpha predeclared native half-film gate failed '+JSON.stringify(detail))
  }
  return{maxAbs,violations,alphaOneDiff,rgbWordDiff,seamPixels,seamMax,edgePixels,edgeMax,words:actual.length}
 }
 try{
  // Independent exact fragment centers establish readback orientation before
  // loading any node test. Three r184 ScreenNode COORDINATE is top-left on
  // both APIs, so 1-y/64 expresses the native bottom-row convention. Native
  // geometry/camera jitter calibration is separate and unchanged.
  phase='independent-fragment-coordinate-ramp'
  const material=new NodeMaterial();material.fragmentNode=vec4(screenCoordinate.x.div(64),screenCoordinate.y.div(64).oneMinus(),.5,1)
  const geometry=new THREE.PlaneGeometry(4,4),mesh=new THREE.Mesh(geometry,material),scene=new THREE.Scene();scene.add(mesh)
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);camera.position.z=2
  renderer.setRenderTarget(target);renderer.render(scene,camera)
  const actual=await read(),matches=flipped=>{
   for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const at=((flipped?63-y:y)*64+x)*4,expected=[(x+.5)/64,(y+.5)/64,.5,1]
    for(let lane=0;lane<4;lane++)if(actual[at+lane]!==expected[lane])return false
   }return true
  }
  const direct=matches(false),inverted=matches(true)
  if(Number(direct)+Number(inverted)!==1){
   const error=flipped=>{let maximum=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const at=((flipped?63-y:y)*64+x)*4,expected=[(x+.5)/64,(y+.5)/64,.5,1]
    for(let lane=0;lane<4;lane++)maximum=Math.max(maximum,Math.abs(actual[at+lane]-expected[lane]))
   }return maximum}
   throw Error('Independent fragment-coordinate ramp did not establish exact readback orientation '+JSON.stringify({maxDirect:error(false),maxFlipped:error(true),first:[...actual.slice(0,12)],middle:[...actual.slice(4*(32*64+32),4*(32*64+32)+4)]}))
  }
  flip=inverted;geometry.dispose();material.dispose()
  for(const entry of proof.cases){
   phase=entry.case
   const glb=await pinned(entry.glbUrl,entry.glbSha256),programBytes=await pinned(entry.materialUrl,entry.materialSha256)
   const programs=JSON.parse(new TextDecoder().decode(programBytes)),pointer={url:entry.materialUrl,hash:entry.materialSha256.slice(0,16),bytes:programBytes.byteLength}
   const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb,new URL('.',new URL(entry.glbUrl,location.href)).href)
   const scene=new THREE.Scene();scene.add(gltf.scene);scene.updateMatrixWorld(true)
   if(gltf.cameras.length!==1)throw Error('Actual saved camera missing');const camera=gltf.cameras[0]
   materialIdContext={scene,camera}
   const originals=[],materials=new Set(),geometries=new Set()
   gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;originals.push({mesh,material:mesh.material,callback:mesh.onBeforeRender});geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material)})
   if(originals.length!==entry.owners*entry.materials)throw Error('Actual saved primitive/owner census differs')
   let sourceDisposals=0;for(const material of materials)material.addEventListener('dispose',()=>sourceDisposals++)
   renderer.setRenderTarget(target);renderer.render(scene,camera)
   const baseline=outsideTarget()
   if([...baseline].some(texture=>texture.name!=='DFG_LUT'||texture.image?.width!==16||texture.image?.height!==16)||baseline.size>1)throw Error('Unexpected renderer baseline for texture-free Alpha field')
   let badPinRejected=false
   try{const value=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:{...pointer,hash:'0'.repeat(16)}}});value.dispose()}catch(error){badPinRejected=/hash/i.test(String(error))}
   if(!badPinRejected)throw Error('Bad actual material publication pin was accepted')
   let scalarWasFloat32=true
   for(const{mesh}of originals){
    const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material,source=material.userData.blendlink_source_material
    const extras=mesh.userData.blendlink_tsl_runtime
    const binding=vertexAlphaBinding(mesh,programs.materials[source].channels,extras,source);binding.validate()
    for(const descriptor of Object.values(extras.vertexColorAlpha)){
     const attribute=mesh.geometry.getAttribute(descriptor.attribute),array=attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array
     if(!(array instanceof Float32Array)||attribute.itemSize!==1||attribute.normalized)scalarWasFloat32=false
    }
   }
   const primary=entry.frames.find(frame=>frame.width===64);let primaryMetrics,resizeFrames=0,fullMaterialSmoke=false
   for(let cycle=0;cycle<3;cycle++){
    let installation
    try{
     installation=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:pointer}})
     if(installation.applied!==entry.owners*entry.materials||installation.skipped.length)throw Error('Actual Alpha programs not completely installed '+JSON.stringify(installation.skipped))
     renderer.setRenderTarget(target);renderer.render(scene,camera)
     await compare(entry,primary);fullMaterialSmoke=true
     for(const{mesh}of originals){
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
      for(const material of materials){if(!material.emissiveNode)throw Error('Actual Final Emission channel absent');material.fragmentNode=vec4(material.emissiveNode,1);material.needsUpdate=true}
     }
     renderer.render(scene,camera);const measured=await compare(entry,primary);if(cycle===0)primaryMetrics=measured
     if(cycle===0)for(const size of[32,96,64]){
      const dpr=size===32?2:1;renderer.setPixelRatio(dpr);renderer.setSize(size/dpr,size/dpr);target.setSize(size,size);renderer.setRenderTarget(target)
      renderer.render(scene,camera);await compare(entry,entry.frames.find(frame=>frame.width===size));resizeFrames++
     }
    }finally{installation?.dispose()}
    if(originals.some(row=>row.mesh.material!==row.material||row.mesh.onBeforeRender!==row.callback)||sourceDisposals)throw Error('Source material/callback ownership not restored')
    assertBaseline(baseline)
   }
   for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose()
   cases.push({case:entry.case,primaryWords:64*64*4,...primaryMetrics,cycles:3,resizeFrames,sourceOwnershipRestored:true,resourceBaselineRestored:true,badPinRejected,scalarWasFloat32,fullMaterialSmoke})
  }
  const remaining=outsideTarget();if([...remaining].some(texture=>texture.name!=='DFG_LUT')||remaining.size>1)throw Error('Alpha proof retained a port-owned texture')
  if(errors.length||uncaptured.length||contextEvents.length)throw Error('Actual renderer validation failed '+JSON.stringify({errors,uncaptured,contextEvents}))
  return{backend,gpu,orientation:{source:'independent-fragment-coordinate-ramp',flip,exactPixels:4096},cases,errors,uncaptured,contextEvents,portOwnedTextures:0}
 }finally{phase='dispose';renderer.setRenderTarget(null);target.dispose();disposing=true;renderer.dispose()}
}
