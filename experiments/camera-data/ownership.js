import * as THREE from 'three'
import { WebGPURenderer, MeshStandardNodeMaterial } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { installTslMaterials } from '@blendlink-camera-runtime'
import { fetchMaterialPrograms } from '@blendlink-camera-document'
import { buildTslColorNode } from '@blendlink-camera-recipe'
import { buildOptionsFor } from '@blendlink-camera-program'
const assert=(condition,message)=>{if(!condition)throw new Error(message)}
const replaceArray=(attribute,array)=>{if(attribute.isInterleavedBufferAttribute)attribute.data.array=array;else attribute.array=array}
const version=attribute=>attribute.version??attribute.data?.version
const bytes=array=>Array.from(new Uint8Array(array.buffer,array.byteOffset,array.byteLength))
const snapshot=geometry=>[...Object.entries(geometry.attributes),...(geometry.index?[['index',geometry.index]]:[])].map(([name,attribute])=>({name,array:attribute.array,bytes:bytes(attribute.array)}))
const unchanged=(geometry,records)=>records.every(record=>{const attribute=record.name==='index'?geometry.index:geometry.getAttribute(record.name);return attribute.array===record.array&&equal(bytes(attribute.array),record.bytes)})
const words=array=>Array.from(new Uint32Array(array.buffer,array.byteOffset,array.byteLength/4))
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
window.runProof=async proof=>{
  assert(THREE.REVISION==='184','Ownership contract requires reviewed Three r184')
  const forceWebGL=new URLSearchParams(location.search).get('backend')==='webgl2'
  const create=async()=>{const result=new WebGPURenderer({antialias:false,forceWebGL});await result.init();result.setSize(1024,512);return result}
  const renderer=await create(),earlier=await create(),backend=forceWebGL?'webgl2':'webgpu'
  const adapter=renderer.backend.device?.adapterInfo,gl=renderer.backend.gl,extension=gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu=adapter?{api:'WebGPU',vendor:adapter.vendor,architecture:adapter.architecture,description:adapter.description}
    :{api:'WebGL2',renderer:gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
  const source=proof.scenes.find(row=>row.name.toLowerCase().includes('perspfrontyup'))??proof.scenes[0]
  const manifest=await(await fetch(source.manifestUrl)).json(),programs=await fetchMaterialPrograms(manifest.materialPrograms)
  const rows=[],captures=[]
  const originalDraw=renderer.backend.draw.bind(renderer.backend)
  renderer.backend.draw=(object,...args)=>{captures.push({object:object.object,geometry:object.geometry});return originalDraw(object,...args)}
  const load=async()=>{
    const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url),meshes=[],camera=gltf.cameras[0]
    gltf.scene.traverse(mesh=>{if(mesh.isMesh){mesh.frustumCulled=false;meshes.push(mesh)}})
    gltf.scene.updateMatrixWorld(true);camera.updateMatrixWorld(true)
    const targets=meshes.filter(mesh=>JSON.stringify(programs.materials[mesh.material.userData.blendlink_source_material]?.channels).includes('"op":"camera_data_native"'))
    assert(targets.length>=2,'Actual Final Camera Data primitives are missing')
    return{gltf,camera,meshes,targets,mesh:targets[0]}
  }
  const install=async state=>{
    const result=await installTslMaterials({root:state.gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
    assert(result.applied>0&&!result.skipped.length,'Actual Final installation refused '+JSON.stringify(result.skipped))
    state.targets.forEach(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(material=>{material.fragmentNode=vec4(material.colorNode,1);material.needsUpdate=true}))
    return result
  }
  const render=state=>renderer.render(state.gltf.scene,state.camera)
  const refuse=(state,pattern)=>{let error;try{render(state)}catch(value){error=String(value)}assert(pattern.test(error),'Missing named refusal: '+error);return error}
  const gpuWords=async(driver,attribute)=>Array.from(new Uint32Array(await driver.getArrayBufferAsync(attribute),0,attribute.array.length))
  const clean=state=>{const geometries=new Set(),materials=new Set();state.gltf.scene.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(item=>materials.add(item))}});geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose())}

  // Both renderers already hold the source's OLD bytes. No public CPU cache
  // can infer that history; the private geometry must upload new bytes.
  {
    const state=await load(),sourceGeometries=new Map(state.targets.map(mesh=>[mesh,mesh.geometry]))
    renderer.render(state.gltf.scene,state.camera);earlier.render(state.gltf.scene,state.camera)
    const sourcePosition=state.mesh.geometry.getAttribute('position'),baseline=await gpuWords(renderer,sourcePosition),beforeVersion=version(sourcePosition)
    sourcePosition.setX(0,sourcePosition.getX(0)+.125)
    assert(version(sourcePosition)===beforeVersion,'Test accidentally signaled an upload')
    renderer.render(state.gltf.scene,state.camera);earlier.render(state.gltf.scene,state.camera)
    assert(equal(await gpuWords(renderer,sourcePosition),baseline),'Expected retained old first-renderer GPU bytes')
    assert(equal(await gpuWords(earlier,sourcePosition),baseline),'Expected retained old prior-renderer GPU bytes')
    const originals=new Map([...new Set(sourceGeometries.values())].map(geometry=>[geometry,snapshot(geometry)]))
    let sourceDisposed=0;originals.forEach((records,geometry)=>geometry.addEventListener('dispose',()=>sourceDisposed++))
    const installed=await install(state);captures.length=0;render(state)
    const copy=state.mesh.geometry,position=copy.getAttribute('position')
    assert(copy!==sourceGeometries.get(state.mesh)&&position.array.buffer!==sourcePosition.array.buffer,'No independent private copy')
    const copiedWords=await gpuWords(renderer,position),sourceWords=words(sourcePosition.array),wordOffset=sourcePosition.offset??0
    assert(equal(copiedWords,sourceWords),'Actual new GPU bytes do not match current source CPU bytes')
    assert(captures.some(row=>row.object===state.mesh&&row.geometry===copy),'Backend render object did not bind the managed copy')
    const shared=[...sourceGeometries].some(([a,ga])=>[...sourceGeometries].some(([b,gb])=>a!==b&&ga===gb))
    assert(shared,'Fixture must retain actual shared source geometry')
    assert(new Set(state.targets.map(mesh=>mesh.geometry)).size===state.targets.length,'Shared owners incorrectly share private mutable copies')
    const stable=renderer.info.memory.geometries
    for(let repeat=0;repeat<4;repeat++)render(state)
    assert(renderer.info.memory.geometries===stable,'Warm draws grew geometry resources')
    const old=state.mesh.geometry,edit=old.getAttribute('position');edit.setX(0,edit.getX(0)+.125);edit.needsUpdate=true
    render(state)
    assert(state.mesh.geometry!==old,'Versioned edit did not acquire fresh GPU storage')
    assert(equal(await gpuWords(renderer,state.mesh.geometry.getAttribute('position')),words(edit.array)),'Versioned private GPU bytes are wrong')
    assert(renderer.info.memory.geometries===stable,'Versioned replacement leaked geometry resources')
    const owned=state.mesh.geometry,array=owned.getAttribute('position').array
    replaceArray(owned.getAttribute('position'),new Float32Array(array))
    const replacementError=refuse(state,/needsUpdate/);replaceArray(owned.getAttribute('position'),array);render(state)
    let secondError;try{earlier.render(state.gltf.scene,state.camera)}catch(error){secondError=String(error)}
    assert(/one renderer/.test(secondError),'Second renderer accepted foreign GPU history: '+secondError);render(state)
    installed.dispose();installed.dispose()
    sourceGeometries.forEach((geometry,mesh)=>assert(mesh.geometry===geometry,'Disposal did not restore actual source geometry'))
    const again=await install(state);render(state);again.dispose()
    sourceGeometries.forEach((geometry,mesh)=>assert(mesh.geometry===geometry,'Reapply did not restore source geometry'))
    originals.forEach((records,geometry)=>assert(unchanged(geometry,records),'Installer changed source attribute identity/content'))
    assert(sourceDisposed===0,'Installer disposed artist geometry')
    rows.push({kind:'previous-two-renderer-uploads',sourceGpuStale:true,currentPrivateGpuExact:true,actualBackendCopy:true,sharedOwners:true,
      stableGeometries:stable,uploadedPositionWords:{wordOffset,previousGpu:baseline[wordOffset],sourceCpu:sourceWords[wordOffset],privateGpu:copiedWords[wordOffset]},replacementError,secondError,cleanupReapply:true,sourceArraysUnchanged:true,sourceDisposed})
    clean(state)
  }
  for(const mode of ['same-array','array-replacement','index']){
    const state=await load(),source=state.mesh.geometry,position=source.getAttribute('position'),old=position.getX(0),oldArray=position.array,index=source.index,indexValue=index?.array[1]
    const installed=await install(state)
    if(mode==='same-array')position.setX(0,80)
    if(mode==='array-replacement'){const array=new Float32Array(oldArray);replaceArray(position,array);position.setX(0,80)}
    if(mode==='index')index.array[1]=index.array[0]
    const error=refuse(state,mode==='index'?/degenerate/:/world mesh bounds|absolute position staging/)
    assert(state.mesh.geometry===source,'Failed acquisition changed source pointer')
    replaceArray(position,oldArray);position.setX(0,old);if(index)index.array[1]=indexValue
    render(state);installed.dispose();assert(state.mesh.geometry===source,'Repair/disposal lost source pointer')
    rows.push({kind:'first-draw-'+mode,error,recovered:true});clean(state)
  }
  for(const invalid of [false,true]){
    const state=await load(),original=state.mesh.geometry,replacement=original.clone(),attribute=replacement.getAttribute('position')
    if(invalid)attribute.setX(0,80)
    let pending=true,calls=0;const previous=state.mesh.onBeforeRender
    const callback=function(...args){calls++;previous.apply(this,args);if(pending){this.geometry=replacement;pending=false}}
    state.mesh.onBeforeRender=callback
    const installed=await install(state)
    let error
    if(invalid)error=refuse(state,/world mesh bounds|absolute position staging/)
    else{
      captures.length=0;render(state)
      assert(state.mesh.geometry!==replacement&&captures.some(row=>row.object===state.mesh&&row.geometry===state.mesh.geometry),'Earlier callback copy was not the backend geometry')
      assert(equal(await gpuWords(renderer,state.mesh.geometry.getAttribute('position')),words(attribute.array)),'Callback replacement GPU bytes differ')
    }
    installed.dispose();assert(calls&&state.mesh.onBeforeRender===callback&&state.mesh.geometry===replacement,'Callback swap cleanup did not retain artist intent')
    rows.push({kind:'earlier-callback-swap',invalid,error,sourceRestored:true});clean(state);original.dispose()
  }
  {
    const original=await load(),a=original.targets[0],b=original.targets.find(mesh=>mesh!==a&&mesh.parent===a.parent)
    assert(b&&a.matrix.equals(b.matrix),'Actual shipped primitive transforms do not support a faithful merge')
    const geometry=mergeGeometries([a.geometry,b.geometry],true)
    assert(geometry&&geometry.groups.length===2,'Actual primitive merge failed')
    const mesh=new THREE.Mesh(geometry,[a.material,b.material]);mesh.matrixAutoUpdate=false;mesh.matrix.copy(a.matrix)
    mesh.userData=structuredClone(a.userData);mesh.frustumCulled=false
    const parent=new THREE.Group();parent.matrixAutoUpdate=false;parent.matrix.copy(a.parent.matrixWorld);parent.add(mesh)
    const scene=new THREE.Scene();scene.add(parent);scene.updateMatrixWorld(true)
    const state={gltf:{scene},camera:original.camera,targets:[mesh],meshes:[mesh],mesh}
    const installed=await install(state);captures.length=0;render(state)
    assert(mesh.geometry!==geometry&&captures.filter(row=>row.object===mesh&&row.geometry===mesh.geometry).length===2,'Both actual material slots did not bind the same private copy')
    const copy=mesh.geometry,stable=renderer.info.memory.geometries
    render(state);assert(mesh.geometry===copy&&renderer.info.memory.geometries===stable,'Material slots churned private copies')
    installed.dispose();assert(mesh.geometry===geometry,'Material-slot cleanup lost merged source')
    rows.push({kind:'actual-shipped-primitives-multiple-material-slots',slots:2,actualBackendCopy:true,cleanup:true})
    geometry.dispose();clean(original)
  }
  {
    const state=await load(),mesh=state.mesh,name=mesh.material.userData.blendlink_source_material
    const original=mesh.material,node=new MeshStandardNodeMaterial()
    node.colorNode=buildTslColorNode(programs.materials[name].channels['Base Color'].tslIr,buildOptionsFor(mesh.userData.blendlink_tsl_runtime))
    node.fragmentNode=vec4(node.colorNode,1);mesh.material=node
    const error=refuse(state,/installer-owned position storage.*installTslMaterials/)
    rows.push({kind:'low-level-owned-storage-required',error});node.dispose();mesh.material=original;clean(state)
  }
  renderer.dispose();earlier.dispose();renderer.backend.device?.destroy();earlier.backend.device?.destroy()
  return{backend,gpu,threeRevision:THREE.REVISION,cases:rows.length,rows,maximum:0,failures:[]}
}
