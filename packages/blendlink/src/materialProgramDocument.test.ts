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
