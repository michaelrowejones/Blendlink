import { describe, expect, it } from 'vitest'
import { Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three'
import { nativeVectorTransformMatrix, validateVectorTransformBinding, type VectorTransformRequirement } from './tslVectorTransform.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { createHash } from 'node:crypto'
import type { SceneManifest } from './typegen.js'
import type { MaterialProgramsDocument } from './materialProgramDocument.js'

const C = new Matrix4().set(1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1)
const expression = { op:'vector_transform',kind:'POINT',from:'WORLD',to:'OBJECT',sourceEngine:'CYCLES',cameraModel:'scale-normalized-positive-z-forward',normalDomain:'not-normalized',input:{op:'const_vec3',value:[.25,.5,.75]} }
const doc = {schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output:expression}
const requirement: VectorTransformRequirement = {from:'WORLD',to:'OBJECT',kind:'POINT'}
const marker = (name: string) => ({schemaVersion:1,objectName:name})

function nodeWithMatrix(matrix: Matrix4) {
  const object = new Group(); object.matrixAutoUpdate = false; object.matrix.copy(matrix)
  return object
}

describe('native Vector Transform object/camera bridge', () => {
  it.each(['blender-z-up','gltf-y-up'] as const)('resolves the declared native object basis for %s', basis => {
    const native = new Matrix4().makeTranslation(2,3,4).multiply(new Matrix4().makeRotationZ(Math.PI/2)).multiply(new Matrix4().makeScale(2,3,4))
    const object = nodeWithMatrix(basis==='gltf-y-up' ? C.clone().multiply(native).multiply(C.clone().transpose()) : native)
    object.userData.blendlink_tsl_object = marker('Authored owner')
    const child = new Mesh(); child.position.set(99,99,99); object.add(child)
    const camera = new PerspectiveCamera()
    const point = new Vector3(.25,.5,.75).applyMatrix4(nativeVectorTransformMatrix({object:child,camera},'OBJECT','WORLD','POINT',basis))
    point.toArray().forEach((value,index)=>expect(value).toBeCloseTo([.5,3.5,7][index]!,12))
    const inverse = nativeVectorTransformMatrix({object:child,camera},'WORLD','OBJECT','POINT',basis)
    point.applyMatrix4(inverse).toArray().forEach((value,index)=>expect(value).toBeCloseTo([.25,.5,.75][index]!,12))
  })
  it('uses inverse-transpose normals and a scale-normalized reflected positive-forward camera', () => {
    const object = nodeWithMatrix(new Matrix4().makeRotationZ(Math.PI/2).multiply(new Matrix4().makeScale(2,3,4)))
    const camera = new PerspectiveCamera(); camera.position.set(10,20,30); camera.scale.set(-2,3,4)
    const normal = new Vector3(.25,.5,.75).applyMatrix4(nativeVectorTransformMatrix({object,camera},'OBJECT','WORLD','NORMAL','blender-z-up'))
    normal.toArray().forEach((value,index)=>expect(value).toBeCloseTo([-1/6,1/8,3/16][index]!,12))
    const point = new Vector3(.25,.5,.75).applyMatrix4(nativeVectorTransformMatrix({object,camera},'CAMERA','WORLD','POINT','blender-z-up'))
    expect(point.toArray()).toEqual([9.75,20.5,29.25])
    camera.scale.set(-.25,20,8)
    expect(new Vector3(.25,.5,.75).applyMatrix4(nativeVectorTransformMatrix({object,camera},'CAMERA','WORLD','POINT','blender-z-up')).toArray()).toEqual(point.toArray())
  })
  it('checks only required object inverses, refuses GPU instances and leaves camera validation until a real draw', () => {
    const object = new Mesh(); object.scale.x = 0
    expect(()=>validateVectorTransformBinding([requirement],object,'gltf-y-up')).toThrow('invertible')
    expect(()=>validateVectorTransformBinding([{...requirement,from:'OBJECT',to:'WORLD'}],object,'gltf-y-up')).not.toThrow()
    expect(()=>validateVectorTransformBinding([{...requirement,from:'WORLD',to:'CAMERA'}],null,'gltf-y-up')).not.toThrow()
    expect(()=>validateVectorTransformBinding([requirement],new InstancedMesh(new PlaneGeometry(),new MeshStandardMaterial(),2),'gltf-y-up')).toThrow('per-instance')
    expect(()=>validateVectorTransformBinding([requirement],new Mesh(),undefined)).toThrow('coordinate basis')
    const camera = new PerspectiveCamera(); camera.scale.set(0,1,1)
    expect(()=>nativeVectorTransformMatrix({object,camera},'WORLD','CAMERA','POINT','gltf-y-up')).toThrow('invertible')
  })
  it('preserves legacy EEVEE direction normals and modern inverse-transpose normals as distinct native models', () => {
    const object = nodeWithMatrix(new Matrix4().makeTranslation(5,8,13).multiply(new Matrix4().makeScale(2,3,4)))
    const camera = new PerspectiveCamera()
    const source = new Vector3(.25,.5,.75)
    expect(source.clone().applyMatrix4(nativeVectorTransformMatrix({object,camera},'OBJECT','WORLD','NORMAL','blender-z-up','EEVEE','direction')).toArray()).toEqual([.5,1.5,3])
    expect(source.clone().applyMatrix4(nativeVectorTransformMatrix({object,camera},'OBJECT','WORLD','NORMAL','blender-z-up','EEVEE','object-inverse-transpose')).toArray()).toEqual([.125,1/6,.1875])
    object.scale.x = 0; object.matrix.makeScale(0,1,1)
    expect(()=>validateVectorTransformBinding([{kind:'NORMAL',from:'OBJECT',to:'WORLD',normal:source.toArray(),normalModel:'direction'}],object,'blender-z-up')).not.toThrow()
    expect(()=>validateVectorTransformBinding([{kind:'NORMAL',from:'WORLD',to:'OBJECT',normal:source.toArray(),normalModel:'direction'}],object,'blender-z-up')).toThrow('invertible')
  })
  it('validates actual installed object matrices before replacing a live-only carrier and isolates shared owners', async () => {
    const root = new Group(), material = new MeshStandardMaterial(), geometry = new PlaneGeometry()
    material.userData.blendlink_source_material = 'Artist'
    const meshes = [0,1].map(index=>{
      const owner = new Group(); owner.userData.blendlink_tsl_object=marker('Owner '+index); owner.position.x=index*3; root.add(owner)
      const mesh = new Mesh(geometry,material); mesh.userData.blendlink_tsl_runtime={schemaVersion:1,objectSpace:'gltf-y-up'}; owner.add(mesh)
      return mesh
    })
    const programs: MaterialProgramsDocument = {schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{'Base Color':{tslIr:doc}}}}}
    const installed = await installTslMaterials({root,descriptor:{materialPrograms:{url:'/material.json',bytes:0,hash:'unused'}},loadPrograms:async()=>programs})
    expect(installed.applied).toBe(2); expect(installed.skipped).toEqual([]); expect(meshes[0]!.material).not.toBe(meshes[1]!.material)
    installed.dispose()
    meshes[1]!.parent!.scale.x=0
    const refused = await installTslMaterials({root,descriptor:{materialPrograms:{url:'/material.json',bytes:0,hash:'unused'}},loadPrograms:async()=>programs})
    expect(refused.applied).toBe(1);expect(refused.skipped.some(item=>/Vector Transform.*invertible/.test(item.reason))).toBe(true)
    expect(meshes[1]!.material).toBe(material);refused.dispose()
  })
  it('proves every actual default-scene matrix chain before granting a Final Base Color exemption', async () => {
    const sidecar={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{'Base Color':{tslIr:doc}}}}}
    const bytes=new TextEncoder().encode(JSON.stringify(sidecar))
    const manifest={materialPrograms:{url:'/material.json',bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex').slice(0,16)}} as Pick<SceneManifest,'materialPrograms'>
    const raw:any={scene:0,scenes:[{nodes:[0]}],nodes:[{translation:[1,2,3],children:[1,2]},{mesh:0,scale:[2,3,4]},{mesh:0,scale:[1,2,3]}],
      materials:[{extras:{blendlink_source_material:'Artist'}}],meshes:[{extras:{blendlink_tsl_runtime:{schemaVersion:1,objectSpace:'gltf-y-up'}},primitives:[{material:0,attributes:{POSITION:0}}]}]}
    expect((await validatedBaseColorProgramMaterials(raw,manifest,bytes)).has(0)).toBe(true)
    raw.nodes[2].scale[0]=0
    expect((await validatedBaseColorProgramMaterials(raw,manifest,bytes)).size).toBe(0)
    raw.nodes[2].scale[0]=1;raw.nodes[2].extensions={EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:3}}}
    expect((await validatedBaseColorProgramMaterials(raw,manifest,bytes)).size).toBe(0)
    delete raw.nodes[2].extensions;raw.nodes[0].children.push(1)
    expect((await validatedBaseColorProgramMaterials(raw,manifest,bytes)).size).toBe(0)
  })
})
