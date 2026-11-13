import {BoxGeometry,Group,Mesh,MeshStandardMaterial} from 'three'
import {describe,expect,it,vi} from 'vitest'
import {assertLegacyMaterialCarriers,type MaterialProgramsDocument} from './materialProgramDocument.js'
const squeeze={op:'squeeze_native',model:'eevee-squeeze-f32-v1'}
const programs=(output:unknown=squeeze):MaterialProgramsDocument=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{Roughness:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:output as never}}}}}})
function loaded(marked=true){
 const root=new Group(),material=new MeshStandardMaterial({color:0x336699,roughness:1}),mesh=new Mesh(new BoxGeometry(),material)
 material.userData.blendlink_source_material='Artist';material.name='Actual named carrier'
 if(marked)mesh.userData.blendlink_tsl_runtime={schemaVersion:1,requiresNodeRenderer:{schemaVersion:1,model:'squeeze-native-v1'}}
 root.add(mesh);return root
}
const descriptor={materialPrograms:{url:'/actual.materials.json',bytes:1,hash:'0'.repeat(16)}}
describe('fresh required Squeeze legacy renderer boundary',()=>{
 it('checks a marked matched Roughness program despite portable nonwhite Base Color',async()=>{
  const root=loaded(),loadPrograms=vi.fn(async()=>programs())
  await expect(assertLegacyMaterialCarriers({root,descriptor,loadPrograms})).rejects.toThrow(/Legacy WebGLRenderer.*Squeeze Value/)
  expect(loadPrograms).toHaveBeenCalledOnce()
 })
 it('preserves the ordinary portable and older unmarked program no-fetch path',async()=>{
  const loadPrograms=vi.fn(async()=>programs())
  await assertLegacyMaterialCarriers({root:loaded(false),descriptor,loadPrograms})
  expect(loadPrograms).not.toHaveBeenCalled()
 })
 it('requires an actually matched Squeeze program rather than the exporter marker alone',async()=>{
  for(const payload of [programs({op:'const_float',value:.731}),{...programs(),materials:{Unrelated:programs().materials.Artist}}])
   await expect(assertLegacyMaterialCarriers({root:loaded(),descriptor,loadPrograms:async()=>payload})).resolves.toBeUndefined()
 })
})

describe('generic fresh material renderer boundary',()=>{
 const magic={op:'tex_magic_native',model:'eevee-magic-f32-v1'}
 const marker=(entries:unknown=[magic])=>({schemaVersion:1,model:'live-material-programs-v1',programs:entries})
 function marked(value:unknown=marker()){
  const root=loaded(false)
  ;(root.children[0] as Mesh).userData.blendlink_tsl_runtime={schemaVersion:1,requiresNodeRenderer:value}
  return root
 }
 it('refuses a matched Magic Roughness program with an otherwise portable Base Color',async()=>{
  const loadPrograms=vi.fn(async()=>programs(magic))
  await expect(assertLegacyMaterialCarriers({root:marked(),descriptor,loadPrograms})).rejects.toThrow(/Legacy WebGLRenderer.*Magic Texture/)
  expect(loadPrograms).toHaveBeenCalledOnce()
 })
 it('does not infer required rendering from a marker or another material alone',async()=>{
  for(const payload of [programs({op:'const_float',value:.5}),{...programs(magic),materials:{Other:programs(magic).materials.Artist}}])
   await expect(assertLegacyMaterialCarriers({root:marked(),descriptor,loadPrograms:async()=>payload})).resolves.toBeUndefined()
  const loadPrograms=vi.fn(async()=>programs(magic))
  await assertLegacyMaterialCarriers({root:loaded(false),descriptor,loadPrograms})
  expect(loadPrograms).not.toHaveBeenCalled()
 })
 it('refuses malformed versions and selector models on an actual matched source',async()=>{
  for(const value of [null,{...marker(),schemaVersion:2},{...marker(),model:'unknown'},marker([]),marker([squeeze])])
   await expect(assertLegacyMaterialCarriers({root:marked(value),descriptor,loadPrograms:async()=>programs(magic)})).rejects.toThrow(/node-renderer declaration/)
 })
 it('retains the independently declared native normal and camera legacy gates',async()=>{
  for(const [kind,op,label] of [['normal','normal_map_native','native normal'],['camera','camera_data_native','Camera Data']]){
   const root=loaded(false)
   ;(root.children[0] as Mesh).userData.blendlink_tsl_runtime={schemaVersion:1,geometryContext:[kind]}
   await expect(assertLegacyMaterialCarriers({root,descriptor,loadPrograms:async()=>programs({op})})).rejects.toThrow(label)
  }
 })
})
