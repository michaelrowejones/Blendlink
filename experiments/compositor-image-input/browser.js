import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, ivec2, uv, vec2 } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { loadSourcePresentation } from '@image-source-display'
import { ThreeWebgpuPostPipelineService } from '@image-post-pipeline'
import { bindCompiledScene } from '@image-bindings'
import { imagePerformanceProof, imagePipelinePerformanceProof, imageViewportPerformanceProof } from './performance.js'

window.runProof = async ({ manifest, reference, performanceProgramUrl, readbackRows, replacement }) => {
  window.imageStage='native-reference-fetch'
  // Binary native oracles avoid JSON/Playwright transport of millions of
  // floats. Fetch, hash and calibration finish before UI timing starts.
  for(const key of ['expected','calibration'])if(reference[key+'File']){
    const bytes=await (await fetch('/image-reference/'+reference[key+'File'])).arrayBuffer()
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')
    if(digest!==reference[key+'Sha256']||bytes.byteLength!==reference.width*reference.height*16)throw new Error('Native binary reference pin differs')
    reference[key]=new Float32Array(bytes)
  }
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  const adapter = webgl ? null : await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!webgl && !adapter) throw new Error('WebGPU adapter unavailable')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: webgl, ...(device ? { device } : {}) })
  window.imageGpuLifetime={gpu:navigator.gpu,adapter,device,renderer}
  window.imageStage='renderer-init'
  await renderer.init()
  const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { ...Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(key => [key,adapter.info[key]])) }
    : { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  renderer.setPixelRatio(1); renderer.setSize(reference.width, reference.height)
  if(reference.fullViewport){
    document.body.style.cssText='margin:0;overflow:hidden'
    renderer.domElement.style.display='block';document.body.appendChild(renderer.domElement)
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const errors = [], warnings = []
  renderer.debug.onShaderError = (context, program, vertex, fragment) => errors.push([context.getProgramInfoLog(program),context.getShaderInfoLog(vertex),context.getShaderInfoLog(fragment)].join(';'))
  device?.pushErrorScope('validation')
  const asset = manifest.sourcePresentation
  window.imageStage='presentation-load'
  const presentation = await loadSourcePresentation(asset)
  let replacementPresentation,replacementExpected
  if(replacement){
    if(!replacement.sourceUnchanged||replacement.asset.hash===asset.hash)throw new Error('Replacement must come from a distinct preserved actual Final publication')
    replacementPresentation=await loadSourcePresentation(replacement.asset)
    const bytes=await (await fetch('/image-reference/'+replacement.expectedFile)).arrayBuffer()
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')
    if(digest!==replacement.expectedSha256||bytes.byteLength!==reference.width*reference.height*16)throw new Error('Replacement native reference differs')
    replacementExpected=new Float32Array(bytes)
  }
  let badPinRejected = false
  try { await loadSourcePresentation({ ...asset, hash: '0000000000000000' }) }
  catch (error) { badPinRejected = /hash differs/.test(String(error)) }
  if (!badPinRejected) throw new Error('Presentation pin did not reject different bytes')
  const bytes = await (await fetch(manifest.url)).arrayBuffer()
  window.imageStage='glb-load'
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join('')
  if (digest.slice(0,16) !== manifest.hash) throw new Error('Final GLB pin differs')
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, new URL('.',new URL(manifest.url,location.href)).href)
  let meshCount = 0; gltf.scene.traverse(object => { if (object.isMesh) meshCount++ })
  if (!meshCount || !gltf.cameras.length) throw new Error('Actual Final GLB lost its authored scene/camera')
  const scene = new THREE.Scene();scene.add(gltf.scene);scene.updateMatrixWorld(true)
  const camera = gltf.cameras[0]
  const bindings = bindCompiledScene(gltf.scene, { url: manifest.url,
    nodes: Object.fromEntries(manifest.nodes.map(node => [node.name,node.name])),
    nodeIds: Object.fromEntries(manifest.nodes.filter(node => node.id).map(node => [node.name,node.id])),
    objectsById: Object.fromEntries(manifest.nodes.filter(node => node.id).map(node => [node.id,node.name])) })
  const target = new THREE.RenderTarget(reference.width,reference.height,{type:THREE.FloatType,depthBuffer:false})
  const control = new THREE.DataTexture(new Float32Array(reference.calibration),reference.width,reference.height,THREE.RGBAFormat,THREE.FloatType);control.needsUpdate=true
  const material = new NodeMaterial(),quad = new QuadMesh(material)
  const readPixels=async()=>{
    if(!readbackRows)return await renderer.readRenderTargetPixelsAsync(target,0,0,reference.width,reference.height)
    const stride=webgl?reference.width:Math.ceil(reference.width/16)*16,result=new Float32Array(stride*reference.height*4)
    for(let y=0;y<reference.height;y+=readbackRows){
      const rows=Math.min(readbackRows,reference.height-y)
      const part=await renderer.readRenderTargetPixelsAsync(target,0,y,reference.width,rows)
      result.set(part,y*stride*4)
    }
    return result
  }
  const errorFor = (actual, expected, flip) => {
    const stride = webgl ? reference.width : Math.ceil(reference.width/16)*16
    let maximum = 0
    for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++)for(let c=0;c<4;c++){
      const value=actual[(y*stride+x)*4+c],wanted=expected[((flip?reference.height-y-1:y)*reference.width+x)*4+c]
      if(!Number.isFinite(value))throw new Error('Nonfinite Final compositor output')
      maximum=Math.max(maximum,Math.abs(value-wanted))
    }
    return maximum
  }
  let pipeline
  try {
    renderer.setRenderTarget(target)
    material.fragmentNode=textureLoad(control,ivec2(uv().mul(vec2(reference.width,reference.height))))
    quad.render(renderer)
    window.imageStage='calibration-readback'
    const untouched=await readPixels()
    const forward=errorFor(untouched,reference.calibration,false),reverse=errorFor(untouched,reference.calibration,true),flip=reverse<forward
    if(Math.min(forward,reverse)>1e-6)throw new Error('Independent output orientation calibration failed')
    let installationTimings
    const expectedByPipeline=new WeakMap();let useReplacement=false
    const create=async signal=>{
      const changed=useReplacement
      const candidate=await ThreeWebgpuPostPipelineService.create({root:gltf.scene,scene,camera,renderer,bindings,sourcePresentation:changed?replacementPresentation:presentation,signal,onWarning:message=>warnings.push(message)})
      expectedByPipeline.set(candidate,changed?replacementExpected:reference.expected);return candidate
    }
    const render=async candidate=>{
      candidate.activate(scene,camera)
      renderer.setRenderTarget(target);candidate.render()
      const pixels=await readPixels()
      return errorFor(pixels,expectedByPipeline.get(candidate),flip)
    }
    if(reference.fullViewport){
      window.imageStage='full-viewport-proof'
      const submit=candidate=>{candidate.activate(scene,camera);renderer.setRenderTarget(null);candidate.render()}
      const proof=await imageViewportPerformanceProof(create,submit,render,renderer,replacement?()=>{useReplacement=true}:undefined)
      pipeline=proof.pipeline;installationTimings=proof.timings
    }else if(reference.imageWidth>=1000){
      const proof=await imagePipelinePerformanceProof(create,render,renderer)
      pipeline=proof.pipeline;installationTimings=proof.timings
    }else{
      pipeline=await create();pipeline.finalize();pipeline.activate(scene,camera)
    }
    if(!pipeline.resolvedOrder.includes('blender-compositor'))throw new Error('Production post pipeline bypassed the Image graph')
    renderer.setRenderTarget(target);pipeline.render()
    window.imageStage='final-readback'
    const actual=await readPixels()
    const maximum=errorFor(actual,expectedByPipeline.get(pipeline),flip)
    const timings=performanceProgramUrl?await imagePerformanceProof(performanceProgramUrl,renderer,quad,material,target,errorFor,flip):undefined
    const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
    if(errors.length||warnings.length)throw new Error(JSON.stringify({errors,warnings}))
    return {backend:webgl?'webgl2':'webgpu',gpu,maximum,meshCount,badPinRejected,glbSha256:digest,
      imageDefinitions:Object.keys(presentation.compositor.images).length,pipeline:pipeline.resolvedOrder,timings,installationTimings,
      decoderFeatures:{nativeStream:typeof DecompressionStream==='function',nativeBase64:typeof Uint8Array.fromBase64==='function'},readbackRows:readbackRows??reference.height,
      ...(replacement?{replacementHash:replacement.asset.hash,replacementApplied:useReplacement}: {})}
  } finally {
    pipeline?.dispose();bindings.dispose();target.dispose();control.dispose();material.dispose()
    const geometries=new Set(),materials=new Set()
    gltf.scene.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(value=>materials.add(value))}})
    geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose())
    renderer.dispose();device?.destroy();window.imageGpuLifetime=null
  }
}
