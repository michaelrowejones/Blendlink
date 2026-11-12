import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildTslColorNode, type TslIrDocument } from './tslNodeRecipe.js'
import { installTslMaterials, type MaterialProgramsDocument } from './tslMaterialRuntime.js'
const ir: TslIrDocument = {schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'uv_active'}}
const pointer={url:'https://scene.test/materials.json',bytes:1,hash:'x',materials:1}
const programs=(): MaterialProgramsDocument=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Paint:{channels:{'Base Color':{tslIr:ir}}}}})
const extras=(name:string,channel:number)=>({schemaVersion:1,uvChannels:{[name]:channel},activeRenderUv:{schemaVersion:1,model:'source-active-render-v1',uvMap:name,channel}})
function mesh(material:THREE.MeshStandardMaterial,data:unknown,uv1=true):THREE.Mesh {
  const geometry=new THREE.BoxGeometry()
  if(uv1)geometry.setAttribute('uv1',geometry.getAttribute('uv').clone())
  const object=new THREE.Mesh(geometry,material)
  object.userData.blendlink_tsl_runtime=data
  return object
}
describe('source active-render UV bindings',()=>{
  it('requires a fresh explicit channel, preserves legacy UV and rejects conflicting map names',()=>{
    expect(()=>buildTslColorNode(ir)).toThrow(/active-render UV/)
    for(const activeUvChannel of [0,1,2,3])expect(buildTslColorNode(ir,{activeUvChannel}).isNode).toBe(true)
    for(const activeUvChannel of [-1,4,NaN,1.5])expect(()=>buildTslColorNode(ir,{activeUvChannel})).toThrow(/invalid index/)
    expect(buildTslColorNode({...ir,output:{op:'uv'}}).isNode).toBe(true)
    expect(()=>buildTslColorNode({...ir,output:{op:'uv_active',uvMap:'Other'}},{activeUvChannel:1})).toThrow(/cannot also name/)
  })
  it('separates shared-material variants when their source owners choose different render maps',async()=>{
    const material=new THREE.MeshStandardMaterial();material.userData.blendlink_source_material='Paint'
    const root=new THREE.Group(),first=mesh(material,extras('FirstRender',0)),second=mesh(material,extras('SecondRender',1))
    root.add(first,second)
    const installed=await installTslMaterials({root,descriptor:{materialPrograms:pointer},loadPrograms:async()=>programs()})
    expect(installed.applied).toBe(2);expect(installed.skipped).toEqual([])
    expect(first.material).not.toBe(second.material)
    installed.dispose();expect(first.material).toBe(material);expect(second.material).toBe(material)
  })
  it('retains the carrier when a declared active UV is absent, stale or nonfinite',async()=>{
    const variants=[undefined,{...extras('Render',1),activeRenderUv:{...extras('Render',1).activeRenderUv,model:'future'}},
      {...extras('Render',1),uvChannels:{Render:0}},extras('Render',4),extras('Render',1)]
    for(const data of variants){
      const material=new THREE.MeshStandardMaterial();material.userData.blendlink_source_material='Paint'
      const object=mesh(material,data,false),root=new THREE.Group();root.add(object)
      const installed=await installTslMaterials({root,descriptor:{materialPrograms:pointer},loadPrograms:async()=>programs()})
      expect(installed.applied).toBe(0);expect(object.material).toBe(material)
      expect(installed.skipped.some(item=>/active|TEXCOORD/.test(item.reason))).toBe(true);installed.dispose()
    }
    const material=new THREE.MeshStandardMaterial();material.userData.blendlink_source_material='Paint'
    const object=mesh(material,extras('Render',1));object.geometry.getAttribute('uv1').setX(0,NaN)
    const root=new THREE.Group();root.add(object)
    const installed=await installTslMaterials({root,descriptor:{materialPrograms:pointer},loadPrograms:async()=>programs()})
    expect(installed.applied).toBe(0);expect(installed.skipped.some(item=>/nonfinite/.test(item.reason))).toBe(true);installed.dispose()
  })
})
