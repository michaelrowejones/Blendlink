import{describe,expect,it}from'vitest'
import{DataTexture,RGBAFormat,FloatType}from'three'
import{texture,vec4}from'three/tsl'
import{buildSourceCompositor}from'./tslSourceCompositor.js'
import{buildCompositorImageInfo,buildImageInfoConversion,imageInfoConversionSource}from'./tslCompositorImageInfo.js'
import type{SourceCompositorOperation,SourceCompositorProgram}from'./sourceDisplay.js'
const types:Record<string,string>={Dimensions:'INT_VECTOR2',Resolution:'INT_VECTOR2',Location:'FLOAT_VECTOR2',Rotation:'VALUE',Scale:'FLOAT_VECTOR2'}
const source=():SourceCompositorOperation=>({id:'source',kind:'render-pass',type:'RGBA',source:{path:['Scene'],node:'Render Layers',nodeType:'CompositorNodeRLayers',output:'Image'},properties:{},inputs:{},pass:{scene:'Scene',layer:'ViewLayer',pass:'Image',socketType:'RGBA'}as never})
const info=(output='Dimensions'):SourceCompositorOperation=>({id:'info',kind:'image-info',type:types[output]!,source:{path:['Scene'],node:'Image Info',nodeType:'CompositorNodeImageInfo',output},properties:{image_info_model:'render-layer-identity-image-info-v1',image_info_source_profile:'darwin-arm64-53-image-info-v1',image_info_native_version:[5,3,0],image_info_reference_model:'full-frame-render-layer-identity-v1',image_info_scene:'Scene',evaluation_device:'CPU',single_value_device:'CPU'},inputs:{Image:{name:'Image',socketType:'RGBA',value:{kind:'ref',node:'source',type:'RGBA'}}}})
const fail=(m:string):never=>{throw Error(m)}
describe('Image Info direct identity metadata',()=>{
 it('builds all five outputs and explicit native-width conversions through production dispatch',()=>{
  const image=new DataTexture(new Float32Array(13*9*4),13,9,RGBAFormat,FloatType)
  for(const output of Object.keys(types)){
   const node=info(output),program:SourceCompositorProgram={version:1,status:'extracted',ops:[source(),node],passes:[],diagnostics:[],output:{kind:'convert',type:'RGBA',fromType:node.type,input:{kind:'ref',type:node.type,node:node.id}}}
   const built=buildSourceCompositor(program,()=>texture(image));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
  }image.dispose()
 })
 it('rejects nontexture resolved images with a named refusal before GPU compilation',()=>{
  const op=info();expect(()=>buildCompositorImageInfo(op,[source(),op],vec4(0),fail)).toThrow(/Image Info.*texture-backed/)
  expect(()=>buildCompositorImageInfo(op,[source(),op],null as never,fail)).toThrow(/Image Info.*texture-backed/)
 })
 it('closes model, width, native stage, scene and topological schema',()=>{
  for(const patch of[{image_info_model:'unknown'},{image_info_native_version:[5,2,0]},{image_info_source_profile:'unknown'},{single_value_device:'GPU'},{image_info_scene:'Other'}]){const op=info();Object.assign(op.properties,patch);expect(()=>buildCompositorImageInfo(op,[source(),op],{}as never,fail)).toThrow(/Image Info/)}
  const op=info();op.type='VECTOR';expect(()=>buildCompositorImageInfo(op,[source(),op],{}as never,fail)).toThrow(/Image Info/)
  const valid=info();expect(()=>buildCompositorImageInfo(valid,[source(),source(),valid],{}as never,fail)).toThrow(/Image Info/)
 })
 it('owns explicit metadata conversion provenance instead of spoofing Pixel or float coordinates',()=>{
  const op=info(),edge:any={kind:'convert',fromType:'INT_VECTOR2',type:'RGBA',input:{kind:'ref',type:'INT_VECTOR2',node:'info'}}
  expect(imageInfoConversionSource(edge,[source(),op])).toBe(true)
  expect(buildImageInfoConversion(edge,[source(),op],()=>vec4(1)as never,fail).isNode).toBe(true)
  for(const type of['VALUE','INT','BOOLEAN'])expect(()=>buildImageInfoConversion({...edge,type},[source(),op],()=>null as never,fail)).toThrow(/Image Info/)
  const fake={...op,kind:'image-coordinates'};expect(imageInfoConversionSource(edge,[fake])).toBe(false);expect(()=>buildImageInfoConversion(edge,[fake],()=>null as never,fail)).toThrow(/Image Info/)
 })
})
