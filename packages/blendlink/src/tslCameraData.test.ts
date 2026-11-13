import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, PerspectiveCamera, OrthographicCamera } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { assertLegacyMaterialCarriers } from './materialProgramDocument.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { buildTslColorNode } from './tslNodeRecipe.js'
import { hasNativeCameraData, validateCameraDataBinding } from './tslCameraData.js'
const expression = (output='view-vector') => ({op:'camera_data_native',output,model:'eevee-primary-camera-v1',
  sourceVersion:[5,3,0],sourceEngine:'EEVEE',camera:{op:'geometry_context',output:'camera',model:'primary-triangles-v1',sourceEngine:'EEVEE',normalStorage:'SNORM10'}})
const ir = () => ({schemaVersion:1,model:'blendlink-tsl-ir-v1' as const,output:expression()})
const viewport={width:1024,height:512}
const position = new Float32Array([0,0,0,1,0,0,0,1,0])
function triangle(){return new Mesh(new BufferGeometry().setAttribute('position',new Float32BufferAttribute(position,3)),new MeshStandardMaterial())}
describe('native EEVEE Camera Data',()=>{
  it('uses a fresh explicit model, raw units, exact known source versions and an actual camera child',()=>{
    for (const output of ['view-vector']) expect(()=>buildTslColorNode({...ir(),output:expression(output)},{objectSpace:{basis:'blender-z-up'}})).not.toThrow()
    expect(hasNativeCameraData({nested:[ir()]})).toBe(true)
    for(const patch of [{output:'distance'},{output:'z-depth'},{sourceEngine:'CYCLES'},{sourceVersion:[5,3,1]},{output:'incoming'},{model:'unknown'},{camera:{op:'const_vec3',value:[0,0,1]}}])
      expect(()=>buildTslColorNode({...ir(),output:{...expression(),...patch}},{objectSpace:{basis:'blender-z-up'}})).toThrow(/Camera Data/)
  })
  it('checks actual positions and live camera/owner conditioning without relying on UV or normal attributes',()=>{
    const mesh=triangle(),camera=new PerspectiveCamera();camera.position.z=20;camera.scale.set(1.3,.7,2.1)
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).not.toThrow()
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,{...viewport,y:1})).toThrow(/render origin/)
    camera.fov=160;camera.updateProjectionMatrix()
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/angular footprint/)
    camera.fov=50;camera.updateProjectionMatrix()
    const ortho=new OrthographicCamera(-100,100,50,-50,.1,1000);ortho.position.z=2
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',ortho,viewport)).toThrow(/angular footprint/)
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,{width:1,height:1})).toThrow(/angular footprint/)
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera)).toThrow(/active renderer viewport/)
    camera.position.set(.25,.25,.5)
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/at least 1/)
    camera.position.z=20;mesh.position.x=64
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/world mesh bounds/)
    mesh.position.x=0;camera.position.z=65
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/camera translation/)
    camera.position.z=20;camera.scale.x=-1
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/reflected\/sheared/)
    camera.scale.x=1;mesh.position.x=-1e7;mesh.geometry.setAttribute('position',new Float32BufferAttribute([1e7,0,0,1e7+1,0,0,1e7,1,0],3))
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/absolute position staging/)
    mesh.position.x=0;mesh.geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,80,0,0,0,1,0],3))
    expect(()=>validateCameraDataBinding(mesh,'blender-z-up',camera,viewport)).toThrow(/world mesh bounds/)
  })
})
it('checks actual decoded GLB geometry even with a portable carrier, then preserves ownership on refusal/disposal',async()=>{
  const document=new Document(),buffer=document.createBuffer()
  const accessor=document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(position)
  const material=document.createMaterial('Camera.BLENDLINK_TSL').setBaseColorFactor([.25,.25,.25,1]).setExtras({blendlink_source_material:'Camera'})
  const mesh=document.createMesh().setExtras({blendlink_tsl_runtime:{schemaVersion:1,objectSpace:'blender-z-up',geometryContext:['camera']}})
    .addPrimitive(document.createPrimitive().setMaterial(material).setAttribute('POSITION',accessor))
  document.getRoot().setDefaultScene(document.createScene().addChild(document.createNode().setMesh(mesh)))
  const bytes=await new NodeIO().writeBinary(document),json=(await new NodeIO().binaryToJSON(bytes)).json
  const programs={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Camera:{channels:{'Base Color':{tslIr:ir()}}}}}
  const sidecar=new TextEncoder().encode(JSON.stringify(programs)),descriptor={materialPrograms:{url:'/camera.materials.json',materials:1,bytes:sidecar.length,hash:createHash('sha256').update(sidecar).digest('hex').slice(0,16)}}
  await expect(validatedBaseColorProgramMaterials(json,descriptor,sidecar)).rejects.toThrow(/actual decoded primitive geometry/)
  const data=new Map([['0:0',{position,normal:null,indices:null}]])
  await expect(validatedBaseColorProgramMaterials(json,descriptor,sidecar,undefined,data)).resolves.toEqual(new Set())
  const outside=structuredClone(json);outside.nodes![0].translation=[65,0,0]
  await expect(validatedBaseColorProgramMaterials(outside,descriptor,sidecar,undefined,data)).rejects.toThrow(/world mesh bounds/)
  const loaded=await new GLTFLoader().parseAsync(bytes.slice().buffer,''),bound=loaded.scene.children[0] as Mesh
  await expect(assertLegacyMaterialCarriers({root:loaded.scene,descriptor,loadPrograms:async()=>programs as never})).rejects.toThrow(/Legacy WebGLRenderer.*Camera Data/)
  const original=bound.material,user=vi.fn();bound.onBeforeRender=user
  const installed=await installTslMaterials({root:loaded.scene,descriptor,loadPrograms:async()=>programs as never})
  expect(installed.applied).toBe(1);expect(installed.skipped).toEqual([])
  installed.dispose();installed.dispose();expect(bound.material).toBe(original);expect(bound.onBeforeRender).toBe(user)
  bound.position.x=65
  const refused=await installTslMaterials({root:loaded.scene,descriptor,loadPrograms:async()=>programs as never})
  expect(refused.applied).toBe(0);expect(refused.skipped[0].reason).toMatch(/world mesh bounds/)
  refused.dispose();expect(bound.material).toBe(original);expect(bound.onBeforeRender).toBe(user)
})
