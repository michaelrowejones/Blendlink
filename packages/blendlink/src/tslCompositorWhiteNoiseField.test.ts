import {expect,it,vi} from 'vitest'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {COMPOSITOR_WHITE_NOISE_FIELD_MODEL as model,COMPOSITOR_WHITE_NOISE_FIELD_PROFILE as profile,COMPOSITOR_WHITE_NOISE_AXES as coordinates,buildCompositorWhiteNoise} from './tslCompositorWhiteNoise.js'
import {validateWhiteNoisePresentation} from './tslCompositorWhiteNoiseField.js'
const fail=(m:string):never=>{throw Error(m)}
const field=(dimensions=2,color=true):any=>({id:'field',kind:'white-noise-texture',type:color?'RGBA':'VALUE',source:{node:'Artist Default White Noise',nodeType:'ShaderNodeTexWhiteNoise',path:[],output:color?'Color':'Value'},properties:{white_noise_model:model,white_noise_profile:profile,white_noise_coordinate_model:coordinates,white_noise_version:[5,3,0],white_noise_build:'02f0899d78e3',white_noise_evaluator:'CPU-MF',evaluation_device:'CPU',single_value_device:'CPU',noise_dimensions:dimensions,white_noise_reference_model:'full-frame-context-zero-offset-v1',white_noise_export_extent:[13,9],white_noise_precision:'CPU_FLOAT32',white_noise_requested_precision:'FULL',white_noise_normalization:'u32-rne-integer-mantissa-v1'},inputs:dimensions===4?{W:{name:'W',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:Math.fround(.1)}}}:{}})
const program=(op=field()):any=>({version:1,status:'extracted',ops:[op],passes:[],diagnostics:[],output:{kind:'ref',type:op.type,node:op.id}})
const build=(p:any)=>buildSourceCompositor(p,()=>null)
it('builds default fields2D..4D Value/Color and retains one table across multiple nodes',()=>{
 for(const d of[2,3,4])for(const color of[true,false]){const built=build(program(field(d,color)));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()}
 const a=field(2,false),b=field(4,false);b.id='second'
 const combine:any={id:'combine',kind:'combine-vector',type:'VECTOR',source:{path:[],node:'Combine',nodeType:'ShaderNodeCombineXYZ',output:'Vector'},properties:{evaluation_device:'CPU',single_value_device:'CPU'},inputs:Object.fromEntries(['X','Y','Z'].map((name,i)=>[name,{name,socketType:'VALUE',value:{kind:'ref',type:'VALUE',node:i===1?b.id:a.id}}]))}
 const p=program(a);p.ops.push(b,combine);p.output={kind:'convert',fromType:'VECTOR',type:'RGBA',input:{kind:'ref',type:'VECTOR',node:'combine'}}
 const built=build(p),textures=new Set<any>(),seen=new Set<any>(),queue=[built.node];while(queue.length){const n=queue.pop();if(seen.has(n))continue;seen.add(n);if(n.isTextureNode)textures.add(n.value);for(const child of n.getChildren())queue.push(child);expect(seen.size).toBeLessThan(10000)}
 expect(textures.size).toBe(1);const texture=[...textures][0],disposed=vi.fn();texture.addEventListener('dispose',disposed);built.dispose();built.dispose();expect(disposed).toHaveBeenCalledTimes(1)
})
it('names malformed/unknown field models, dimensions and input schemas before allocation/resolution',()=>{
 const patches=[{white_noise_profile:'unknown'},{white_noise_coordinate_model:'normalized'},{white_noise_model:'unknown'},{noise_dimensions:1},{white_noise_reference_model:'image-domain'},{white_noise_export_extent:[3,9]},{white_noise_export_extent:[13.5,9]},{white_noise_precision:'HALF'},{white_noise_requested_precision:'HALF'},{white_noise_normalization:'native-wide-cast'},{white_noise_version:[5,2,0]},{evaluation_device:'GPU'}]
 for(const patch of patches){const op=field();Object.assign(op.properties,patch);expect(()=>build(program(op))).toThrow(/White Noise/)}
 for(const key of['source','properties','inputs'])for(const value of[null,undefined,[],{}]){const op=field(4);op[key]=value;expect(()=>build(program(op))).toThrow(/White Noise/)}
 const vector=field();vector.inputs.Vector={socketType:'VECTOR',value:{kind:'constant',type:'VECTOR',value:[0,0,0]}};expect(()=>build(program(vector))).toThrow(/White Noise/)
 for(const value of[-0,2**-149,.1,Infinity,NaN]){const op=field(4);op.inputs.W.value.value=value;expect(()=>build(program(op))).toThrow(/White Noise/)}
 const wrong=field();wrong.kind='rgb';expect(()=>build(program(wrong))).toThrow(/White Noise/)
})
it('closes image/pass/spatial/sampler producers and unaccounted external effects',()=>{
 for(const kind of['image-info','image-input','render-pass','translate','flip','blur','curves','gradient-texture','unregistered-sampler']){
  const p=program();p.ops.push({id:'foreign',kind,type:'RGBA',source:{path:[],node:'Foreign',nodeType:'Other',output:'Image'},properties:{},inputs:{}})
  const resolve=vi.fn();expect(()=>buildSourceCompositor(p,resolve)).toThrow(/White Noise.*pointwise/);expect(resolve).not.toHaveBeenCalled()
 }
 const presentation:any={compositor:program(),display:{ops:Array.from({length:7},()=>({type:'Lut3DTransform'}))}}
 expect(()=>validateWhiteNoisePresentation(presentation,0,fail)).not.toThrow();presentation.display.ops.push({type:'Lut1DTransform'});expect(()=>validateWhiteNoisePresentation(presentation,0,fail)).toThrow(/eight/)
 presentation.display.ops.pop();expect(()=>validateWhiteNoisePresentation(presentation,1,fail)).toThrow(/post-LDR/);expect(()=>validateWhiteNoisePresentation(presentation,0,fail,1)).toThrow(/pre-HDR/)
 presentation.compositor.ops.push({id:'ellipse',kind:'ellipse-mask',properties:{ellipse_mask_size:[1,1],ellipse_mask_mask:0,ellipse_mask_value:1,ellipse_mask_operation:'ADD'}})
 expect(()=>validateWhiteNoisePresentation(presentation,0,fail)).toThrow(/eight/);presentation.display.ops.pop();expect(()=>validateWhiteNoisePresentation(presentation,0,fail)).not.toThrow()
})

it('requires a genuine owned axis binding for the low-level field builder',()=>{
 for(const foreign of[undefined,{node:{}},{node:{isNode:true}},{model:'exact-uniform-r32f-axes-v1'}])expect(()=>buildCompositorWhiteNoise(field(),fail,foreign as any)).toThrow(/owned shared Uniform-axis/)
})

it('retains the full-frame field guard when a terminal consumer is constant',()=>{
 const p=program();p.output={kind:'constant',type:'RGBA',value:[0,0,0,1]};const built=build(p)
 const renderer={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(3,3),getRenderTarget:()=>null}
 expect(()=>built.node.update({renderer})).toThrow(/physical extents/);built.dispose();expect(()=>built.node.update({renderer})).toThrow(/disposed/)
})
