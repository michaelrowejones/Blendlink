import {describe,expect,it} from 'vitest'
import {DataTexture,FloatType,RGBAFormat} from 'three'
import {texture} from 'three/tsl'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
const pass:SourceCompositorOperation={id:'image',kind:'render-pass',type:'RGBA',source:{path:['Artist'],node:'Render Layers',nodeType:'CompositorNodeRLayers',output:'Image'},properties:{},inputs:{},pass:{scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA',engine:'BLENDER_EEVEE'}}
const operation=(dimension='X'):SourceCompositorOperation=>({id:'relative',kind:'relative-to-pixel',type:'VALUE',source:{path:['Artist'],node:'Relative',nodeType:'CompositorNodeRelativeToPixel',output:'Float Value'},properties:{relative_to_pixel_model:'scalar-render-size-f32-v1',relative_to_pixel_reference_model:'untransformed-render-layer-v1',relative_to_pixel_source_profile:'darwin-arm64-53-f32-v1',relative_to_pixel_native_version:[5,3,0],reference_dimension:dimension,relative_to_pixel_image:{kind:'ref',node:'image',type:'RGBA'},evaluation_device:'CPU',single_value_device:'CPU'},inputs:{Value:{name:'Value',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:.25}}}})
const program=(op:SourceCompositorOperation):SourceCompositorProgram=>({version:1,status:'extracted',ops:[pass,op],passes:[pass.pass!],diagnostics:[],output:{kind:'convert',fromType:'VALUE',type:'RGBA',input:{kind:'ref',node:op.id,type:'VALUE'}}})
const image=new DataTexture(new Float32Array(8*4*4),8,4,RGBAFormat,FloatType)
const build=(op:SourceCompositorOperation)=>buildSourceCompositor(program(op),()=>texture(image))
describe('Relative To Pixel scalar image-size dependency',()=>{
 it('builds every qualified dimension through the production dispatcher',()=>{for(const dimension of ['X','Y','Greater','Smaller']){const result=build(operation(dimension));expect(result.node.isNode).toBe(true);result.dispose();result.dispose()}})
 it('refuses forged profiles, unsupported output widths and computed input domains',()=>{
  for(const mutate of [(op:SourceCompositorOperation)=>{op.properties.relative_to_pixel_model='unknown'},(op:SourceCompositorOperation)=>{op.properties.relative_to_pixel_native_version=[5,2,0]},(op:SourceCompositorOperation)=>{op.properties.reference_dimension='Diagonal'},(op:SourceCompositorOperation)=>{op.type='VECTOR'},(op:SourceCompositorOperation)=>{op.properties.relative_to_pixel_image={kind:'ref',node:'relative',type:'RGBA'}},(op:SourceCompositorOperation)=>{op.inputs.Value!.value={kind:'constant',type:'VALUE',value:.1}},(op:SourceCompositorOperation)=>{op.inputs.Value!.value={kind:'constant',type:'VALUE',value:2**-149}},(op:SourceCompositorOperation)=>{op.inputs.Value!.value={kind:'constant',type:'VALUE',value:-0}}]){const op=operation();mutate(op);expect(()=>build(op)).toThrow(/Relative To Pixel/)}
 })
})
