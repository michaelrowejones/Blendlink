import * as THREE from 'three'
import {WebGPURenderer} from 'three/webgpu'
import {vec4} from 'three/tsl'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {installTslMaterials} from '@blendlink-vector-runtime'

const C=new THREE.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1)
const inverseC=C.clone().transpose()
const halfUlp=value=>Math.max(2**(Math.floor(Math.log2(Math.abs(value)||2**-14))-10),2**-24)
const difference=(a,b)=>Math.max(...a.map((value,index)=>Math.abs(value-b[index])))
const nativeElements=rows=>new THREE.Matrix4().set(...rows.flat()).elements

window.runProof=async proof=>{
  const renderer=new WebGPURenderer({antialias:false,forceWebGL:new URLSearchParams(location.search).get('backend')==='webgl2'})
  await renderer.init();renderer.setPixelRatio(1);renderer.setSize(1024,512);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2',device=renderer.backend.device
  const errors=[],failures=[],rows=[],liveMutations=[]
  let flipRows
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
  let maximum=0,matrixMaximum=0,cases=0
  for(const sceneProof of proof.scenes){
    const manifest=await(await fetch(sceneProof.manifestUrl)).json()
    const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url)
    const camera=gltf.cameras[0]
    if(gltf.cameras.length!==1||!gltf.scene.getObjectById(camera.id))throw new Error('The active camera must be the actual published glTF camera node')
    const owners=[];gltf.scene.traverse(object=>{if(object.userData.blendlink_tsl_object)owners.push(object)})
    if(owners.length!==2||owners.some(owner=>owner.children.length!==28))throw new Error('Expected two shared-mesh owners with28 real primitive meshes')
    const installed=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
    if(installed.applied!==56||installed.skipped.length)throw new Error('Vector material installation failed '+JSON.stringify(installed))
    const materials=new Set()
    for(const owner of owners)for(const mesh of owner.children){
      if(!mesh.isMesh||!mesh.material.colorNode)throw new Error('Actual Final primitive has no installed Base Color node')
      if(!materials.has(mesh.material)){mesh.material.fragmentNode=vec4(mesh.material.colorNode,1);mesh.material.needsUpdate=true;materials.add(mesh.material)}
    }
    const mixer=new THREE.AnimationMixer(gltf.scene)
    for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()}
    const times=gltf.animations.flatMap(clip=>clip.tracks.map(track=>track.times[0]))
    if(!times.length)throw new Error('Actual Final owner/camera animation tracks are absent')
    const firstTime=Math.min(...times)
    const localCenters=new Map()
    for(const owner of owners)for(const mesh of owner.children){
      const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.index
      const used=new Set(indices?Array.from(indices.array):Array.from({length:position.count},(_,index)=>index))
      const center=new THREE.Vector3()
      for(const index of used)center.add(new THREE.Vector3().fromBufferAttribute(position,index))
      localCenters.set(mesh,center.divideScalar(used.size))
    }
    const target=new THREE.RenderTarget(1024,512,{type:THREE.FloatType,depthBuffer:true});target.texture.colorSpace=THREE.NoColorSpace
    for(const frame of [1,3]){
      mixer.setTime(firstTime+(frame-1)/24);gltf.scene.updateMatrixWorld(true);camera.updateMatrixWorld(true)
      const cameraNative=(sceneProof.basis==='gltf-y-up'?inverseC.clone().multiply(camera.matrixWorld):camera.matrixWorld.clone())
      const actualCamera=new THREE.Matrix4().extractRotation(cameraNative).setPosition(new THREE.Vector3().setFromMatrixPosition(cameraNative))
      device?.pushErrorScope('validation')
      for(const owner of owners){
        for(const other of owners)other.visible=other===owner
        const ownerName=owner.userData.blendlink_tsl_object.objectName
        const reference=proof.references.rows.find(row=>row.engine===sceneProof.engine&&row.frame===frame&&row.owner===ownerName)
        if(!reference)throw new Error('No native row for actual owner '+ownerName)
        const actualObject=sceneProof.basis==='gltf-y-up'?inverseC.clone().multiply(owner.matrixWorld).multiply(C):owner.matrixWorld
        const sourceCamera=new THREE.Matrix4().fromArray(nativeElements(reference.cameraMatrix))
        const normalizedSourceCamera=new THREE.Matrix4().extractRotation(sourceCamera).setPosition(new THREE.Vector3().setFromMatrixPosition(sourceCamera))
        const objectError=difference(actualObject.elements,nativeElements(reference.objectMatrix))
        const cameraError=difference(actualCamera.elements,normalizedSourceCamera.elements)
        matrixMaximum=Math.max(matrixMaximum,objectError,cameraError)
        if(objectError>2e-5||cameraError>2e-5)throw new Error('Actual GLTF world matrices differ from native Blender '+JSON.stringify({scene:sceneProof.name,ownerName,frame,objectError,cameraError}))
        renderer.setRenderTarget(target);renderer.setClearColor(new THREE.Color(1,0,1),0);renderer.render(gltf.scene,camera)
        const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,1024,512)
        const pixelFor=mesh=>{
          const center=mesh.localToWorld(localCenters.get(mesh).clone()).project(camera)
          return[Math.floor((center.x+1)*.5*1024),Math.floor((center.y+1)*.5*512)]
        }
        if(flipRows===undefined){
          const control=owner.children.find(mesh=>mesh.material.userData.blendlink_source_material===proof.references.cases.at(-1).name)
          const[x,y]=pixelFor(control),expected=reference.values.at(-1)
          const sample=row=>Array.from(pixels.slice((row*1024+x)*4,(row*1024+x)*4+3))
          const direct=difference(sample(y),expected),flipped=difference(sample(511-y),expected)
          if(Math.min(direct,flipped)>2e-6)throw new Error('Independent constant RGB row-orientation control failed '+JSON.stringify({direct,flipped,x,y,directSample:sample(y),flippedSample:sample(511-y),expected,localCenter:localCenters.get(control).toArray(),positionCount:control.geometry.getAttribute('position').count,indexCount:control.geometry.index?.count,drawRange:control.geometry.drawRange,objectError,cameraError,cameraWorld:camera.matrixWorld.elements,cameraInverse:camera.matrixWorldInverse.elements}))
          flipRows=flipped<direct
        }
        for(const mesh of owner.children){
          const source=mesh.material.userData.blendlink_source_material
          const index=proof.references.cases.findIndex(test=>test.name===source)
          if(index<0)throw new Error('Unknown installed source material '+source)
          const[x,rawY]=pixelFor(mesh),y=flipRows?511-rawY:rawY
          if(x<0||x>=1024||y<0||y>=512){
            failures.push({scene:sceneProof.name,frame,owner:ownerName,source,error:'Published camera cannot see actual material center',x,y,objectError,cameraError,
              actualCamera:actualCamera.elements,expectedCamera:normalizedSourceCamera.elements,actualObject:actualObject.elements,expectedObject:nativeElements(reference.objectMatrix)})
            continue
          }
          const actual=Array.from(pixels.slice((y*1024+x)*4,(y*1024+x)*4+3)),expected=reference.values[index]
          const error=difference(actual,expected),allowances=expected.map(value=>2e-6+(sceneProof.engine==='CYCLES'?0:halfUlp(value)))
          const passed=actual.every((value,channel)=>Number.isFinite(value)&&Math.abs(value-expected[channel])<=allowances[channel])
          const row={scene:sceneProof.name,frame,owner:ownerName,source,actual,expected,error,allowances,objectError,cameraError,passed}
          rows.push(row);cases++;maximum=Math.max(maximum,error)
          if(!passed)failures.push(row)
        }
      }
      const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
    }
    if(sceneProof.engine==='CYCLES'){
      for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.reset();action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play()}
      mixer.setTime(firstTime);gltf.scene.updateMatrixWorld(true);camera.updateMatrixWorld(true)
      const field='Vector POINT OBJECT WORLD',index=proof.references.cases.findIndex(item=>item.name===field)
      const selected=owners.map(owner=>owner.children.find(mesh=>mesh.material.userData.blendlink_source_material===field))
      if(selected.some(mesh=>!mesh)||selected[0].material===selected[1].material)throw new Error('Distinct actual GLB owners must have isolated object-context materials')
      owners[0].position.x+=.75;gltf.scene.updateMatrixWorld(true)
      device?.pushErrorScope('validation')
      for(const owner of owners){
        for(const other of owners)other.visible=other===owner
        const name=owner.userData.blendlink_tsl_object.objectName
        const reference=proof.references.rows.find(row=>row.engine===sceneProof.engine&&row.frame===1&&row.owner===name)
        const nativeWorld=sceneProof.basis==='gltf-y-up'?inverseC.clone().multiply(owner.matrixWorld).multiply(C):owner.matrixWorld.clone()
        const expected=owner===owners[0]?new THREE.Vector3(.31,-.43,.57).applyMatrix4(nativeWorld).multiplyScalar(.002).addScalar(.5).toArray():reference.values[index]
        const mesh=selected[owners.indexOf(owner)]
        renderer.setRenderTarget(target);renderer.render(gltf.scene,camera)
        const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,1024,512)
        const point=mesh.localToWorld(localCenters.get(mesh).clone()).project(camera)
        const x=Math.floor((point.x+1)*.5*1024),rawY=Math.floor((point.y+1)*.5*512),y=flipRows?511-rawY:rawY
        const actual=Array.from(pixels.slice((y*1024+x)*4,(y*1024+x)*4+3)),error=difference(actual,expected)
        const changed=difference(actual,reference.values[index])
        if(error>2e-6||!actual.every(Number.isFinite)||(owner===owners[0]&&changed<1e-4))throw new Error('Live single-owner mutation failed '+JSON.stringify({scene:sceneProof.name,name,actual,expected,error,changed,x,y}))
        liveMutations.push({scene:sceneProof.name,owner:name,mutated:owner===owners[0],actual,expected,error,changed})
      }
      const validation=await device?.popErrorScope();if(validation)errors.push(validation.message)
    }
    for(const owner of owners)owner.visible=true
    if(errors.length)throw new Error(errors.join('\n'))
    installed.dispose();target.dispose();mixer.stopAllAction()
  }
  renderer.dispose()
  return{backend,maximum,matrixMaximum,cases,liveMutations,failures,rows}
}
