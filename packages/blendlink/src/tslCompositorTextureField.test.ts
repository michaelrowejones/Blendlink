import{describe,it,expect}from'vitest'
import{checkerFieldAdmission,easingFieldAdmission,buildTextureCoordinateField}from'./tslCompositorTextureField.js'
import type{SourceCompositorOperation}from'./sourceDisplay.js'
const operation=():SourceCompositorOperation=>({id:'texture',kind:'gradient-texture',type:'RGBA',source:{path:[],node:'Texture',nodeType:'ShaderNodeTexGradient',output:'Color'},inputs:{},properties:{procedural_texture_coordinate_model:'implicit-uniform-full-frame-v1',procedural_texture_coordinate_output:'Uniform',procedural_texture_field_profile:'darwin-arm64-compositor-texture-field-v1',evaluation_device:'CPU'}})
describe('texture field admission',()=>{
 it('admits artist common default5 extents and refuses independently predicted positive-unity hazards',()=>{
  for(const[w,h]of[[1920,1080],[1080,1920],[1280,720],[3840,2160],[13,9],[9,13]])expect(checkerFieldAdmission(w!,h!,'Uniform',5)).toBe(true)
  for(const[w,h]of[[4,5],[5,4],[15,10],[1920,1081]])expect(checkerFieldAdmission(w!,h!,'Uniform',5)).toBe(false)
  for(const[w,h]of[[4,5],[15,10],[1920,1081]])expect(checkerFieldAdmission(w!,h!,'Normalized',5)).toBe(true)
 })
 it('keeps Easing endpoint controls exact by extent admission, preserving safe portrait fields',()=>{
  expect(easingFieldAdmission(1920,1080,'Uniform')).toBe(true)
  expect(easingFieldAdmission(8192,4,'Uniform')).toBe(false)
  expect(easingFieldAdmission(8192,4,'Normalized')).toBe(false)
  expect(easingFieldAdmission(4,8192,'Uniform')).toBe(true)
  expect(easingFieldAdmission(4,8192,'Normalized')).toBe(true)
 })
 it('checks field profiles and unique bounded operation prefix even without authored Vector inputs',()=>{
  const op=operation(),fail=(m:string):never=>{throw Error(m)},build=(ops:SourceCompositorOperation[])=>buildTextureCoordinateField(op,ops,()=>null as never,fail)
  expect(build([op]).isNode).toBe(true)
  expect(()=>build([])).toThrow(/bounded unique/);expect(()=>build([{...op},op])).toThrow(/bounded unique/)
  expect(()=>build(Array.from({length:2049},()=>op))).toThrow(/bounded unique/)
  op.properties.procedural_texture_coordinate_output='Normalized';expect(()=>build([op])).toThrow(/implicit Vector/)
 })
 it('requires actual qualified float2 provenance and never grants a general field assertion',()=>{
  const op=operation();op.properties.procedural_texture_coordinate_model='linked-render-layer-float2-v1';op.inputs.Vector={name:'Vector',socketType:'VECTOR',value:{kind:'ref',node:'fake',type:'VECTOR'}}
  expect(()=>buildTextureCoordinateField(op,[op],()=>null as never,m=>{throw Error(m)})).toThrow(/explicit fresh float2/)
 })
})
