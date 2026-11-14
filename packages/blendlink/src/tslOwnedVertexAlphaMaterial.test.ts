import {describe,it,expect,vi}from'vitest'
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial,Scene}from'three'
import {MeshStandardNodeMaterial,MeshPhysicalNodeMaterial}from'three/webgpu'
import {vec4,float}from'three/tsl'
import{createOwnedVertexAlphaMaterial}from'./tslOwnedVertexAlphaMaterial.js'
import{installProgramIntoMaterial,installTslMaterials}from'./tslMaterialRuntime.js'
import{VERTEX_ALPHA_MODEL,VERTEX_ALPHA_PROFILE,VERTEX_ALPHA_OPACITY_MODEL}from'./tslVertexColorAlpha.js'
const semantic='_SCENETOWEB_VCOL_ALPHA_0123456789ABCDEF',name=semantic.toLowerCase()
const alpha={op:'vertex_color_alpha',model:VERTEX_ALPHA_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,layer:'Paint'}
const doc=(output:unknown)=>({schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output})
function fixture(){
 const source=new MeshStandardMaterial({vertexColors:true});source.userData.blendlink_source_material='Artist'
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)).setAttribute(name,new Float32BufferAttribute([.1,.1,.1],1)).setAttribute('color',new Float32BufferAttribute([.5,.25,.75,1,.5,.25,.75,1,.5,.25,.75,1],4))
 const mesh=new Mesh(geometry,source);mesh.userData.blendlink_tsl_runtime={vertexColorAlpha:{Paint:{model:VERTEX_ALPHA_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,semantic,attribute:name,sourceLayer:'Paint',domain:'CORNER',materials:['Artist']}}};const root=new Scene();root.add(mesh);return{source,geometry,mesh,root}
}
async function install(f:ReturnType<typeof fixture>,channels:Record<string,{tslIr:ReturnType<typeof doc>}>,certified=false){
 const marker={schemaVersion:1 as const,model:VERTEX_ALPHA_OPACITY_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,material:'Artist',alphaLayers:['Paint'],completeColor:!!channels['Base Color']}
 if(certified)f.mesh.userData.blendlink_tsl_runtime.vertexColorAlphaOpacityOwners={Artist:marker}
 return installTslMaterials({root:f.root,descriptor:{materialPrograms:{url:'/fixture.json',hash:'0'.repeat(16),bytes:1,materials:1}},loadPrograms:async()=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels,...(certified?{vertexAlphaOpacity:marker}:{})}}})})
}
describe('scoped VertexAlpha material alpha ownership',()=>{
 it('keeps the generic public two-argument installer on its original native material class',()=>{
  const source=new MeshStandardMaterial({vertexColors:true,opacity:.75}),node=float(.1),clone=installProgramIntoMaterial(source,{opacityNode:node})
  expect(installProgramIntoMaterial.length).toBe(2);expect(clone.type).toBe('MeshStandardNodeMaterial');expect(clone.opacityNode).toBe(node);expect(clone.vertexColors).toBe(true);expect(source.opacity).toBe(.75);clone.dispose();source.dispose()
 })
 it.each([false,true])('opts in only for built new Alpha-channel IR; complete RGB flag=%s',async complete=>{
  const f=fixture();Object.assign(f.source,{completeProgramColor:!complete});const channels:{[key:string]:{tslIr:ReturnType<typeof doc>}}={Alpha:{tslIr:doc(alpha)}}
  if(complete)channels['Base Color']={tslIr:doc({op:'const_vec3',value:[.125,.25,.5]})}
  f.geometry.getAttribute('color').setW(0,.1);const result=await install(f,channels,true);expect(result.applied).toBe(1);const material=f.mesh.material as MeshStandardNodeMaterial&{completeProgramColor:boolean};expect(material.type).toBe('SceneToWebOwnedVertexAlphaStandardV1');expect(material.completeProgramColor).toBe(complete);expect(material.vertexColors).toBe(true);result.dispose();expect(f.mesh.material).toBe(f.source);f.geometry.dispose();f.source.dispose()
 })
 it('keeps untagged new Alpha on its previous material behavior',async()=>{const f=fixture(),result=await install(f,{Alpha:{tslIr:doc(alpha)}});expect((f.mesh.material as MeshStandardNodeMaterial).type).toBe('MeshStandardNodeMaterial');result.dispose();f.geometry.dispose();f.source.dispose()})
 it('does not opt in old Alpha programs when VertexAlpha appears only in Roughness',async()=>{
  const f=fixture(),result=await install(f,{Roughness:{tslIr:doc(alpha)},Alpha:{tslIr:doc({op:'const_float',value:.5})}});expect(result.applied).toBe(1);expect((f.mesh.material as MeshStandardNodeMaterial).type).toBe('MeshStandardNodeMaterial');result.dispose();f.geometry.dispose();f.source.dispose()
 })
 it('retains the initial non-unit COLOR0 named refusal before any source swap',async()=>{
  const f=fixture();f.geometry.getAttribute('color').setW(0,.25);const callback=f.mesh.onBeforeRender;await expect(install(f,{Alpha:{tslIr:doc(alpha)}})).rejects.toThrow(/multiply opacity twice/);expect(f.mesh.material).toBe(f.source);expect(f.mesh.onBeforeRender).toBe(callback);f.geometry.dispose();f.source.dispose()
 })
 it.each([false,true])('restores temporary clone graph properties on native setup success and exception; physical=%s',physical=>{
  const proto=physical?MeshPhysicalNodeMaterial.prototype:MeshStandardNodeMaterial.prototype
  for(const throws of[false,true]){
   const material=createOwnedVertexAlphaMaterial(physical,true),originalColor=vec4(.125,.25,.5,.2);material.colorNode=originalColor;material.vertexColors=true;material.opacityNode=float(.1)
   const key=material.customProgramCacheKey();const spy=vi.spyOn(proto,'setupDiffuseColor').mockImplementation(function(){expect(this.vertexColors).toBe(false);expect(this.colorNode).not.toBe(originalColor);if(throws)throw Error('native setup failure')})
   try{const call=()=>material.setupDiffuseColor({geometry:new BufferGeometry()} as Parameters<MeshStandardNodeMaterial['setupDiffuseColor']>[0]);if(throws)expect(call).toThrow('native setup failure');else call();expect(spy).toHaveBeenCalledTimes(1);expect(material.colorNode).toBe(originalColor);expect(material.vertexColors).toBe(true);expect(material.customProgramCacheKey()).toBe(key)}finally{spy.mockRestore();material.dispose()}
  }
 })
 it.each([false,true])('preserves private ownership through ordinary Three clone/copy; physical=%s',physical=>{
  for(const complete of[false,true]){
   const source=createOwnedVertexAlphaMaterial(physical,complete),callback=source.onBeforeCompile,node=vec4(.125,.25,.5,1);source.colorNode=node
   const key=source.customProgramCacheKey(),clone=source.clone() as typeof source&{completeProgramColor:boolean}
   expect(clone).not.toBe(source);expect(clone.completeProgramColor).toBe(complete);expect(clone.type).toBe(source.type);expect(clone.customProgramCacheKey()).toBe(key);expect(clone.colorNode).toBe(node)
   const target=createOwnedVertexAlphaMaterial(physical,!complete) as typeof source&{completeProgramColor:boolean};expect(target.copy(source)).toBe(target);expect(target.completeProgramColor).toBe(complete);expect(target.customProgramCacheKey()).toBe(key)
   expect(source.onBeforeCompile).toBe(callback);expect(source.colorNode).toBe(node);source.dispose();clone.dispose();target.dispose()
  }
  for(const complete of[false,true]){
   const factory=createOwnedVertexAlphaMaterial(physical,complete) as MeshStandardNodeMaterial&{completeProgramColor:boolean}
   const ordinary=physical?new MeshPhysicalNodeMaterial():new MeshStandardNodeMaterial();Object.assign(ordinary,{completeProgramColor:!complete});factory.copy(ordinary)
   expect(factory.completeProgramColor).toBe(complete);expect(factory.customProgramCacheKey()).toMatch(new RegExp(':color='+Number(complete)+'$'));ordinary.dispose();factory.dispose()
  }
  const complete=createOwnedVertexAlphaMaterial(physical,true),fallback=createOwnedVertexAlphaMaterial(physical,false);expect(complete.customProgramCacheKey()).not.toBe(fallback.customProgramCacheKey());complete.dispose();fallback.dispose()
 })
 it('separates ordinary/owned and complete/fallback shader-cache identities',()=>{
  const source=new MeshStandardMaterial(),node=float(.1),ordinary=installProgramIntoMaterial(source,{opacityNode:node}),fallback=createOwnedVertexAlphaMaterial(false,false),complete=createOwnedVertexAlphaMaterial(false,true);fallback.opacityNode=node;complete.opacityNode=node;expect(new Set([ordinary.customProgramCacheKey(),fallback.customProgramCacheKey(),complete.customProgramCacheKey()]).size).toBe(3);ordinary.dispose();fallback.dispose();complete.dispose();source.dispose()
 })
})
