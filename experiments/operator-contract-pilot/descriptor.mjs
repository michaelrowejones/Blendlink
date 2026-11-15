// Reviewed structural vocabulary only. No candidate equations or expected pixels.
const c=constant=>({constant}),e=(...values)=>({enum:values}),r=name=>({ref:name})
const str={type:'string',minLength:1},number={type:'number'},i32={type:'integer',minimum:-2147483648,maximum:2147483647,rejectNegativeZero:true}
const arr=(items,minItems=0,maxItems=2048)=>({type:'array',items,minItems,maxItems})
const tuple=(items)=>({type:'array',tuple:items,minItems:items.length,maxItems:items.length})
const object=(fields,optional=[])=>({type:'object',fields,optional,extra:false})
const common={evaluation_device:c('CPU'),native_gpu_backend:str,single_value_device:c('CPU')}
const source=(nodeType,output)=>object({path:arr(str,1,17),node:str,nodeType:c(nodeType),output:typeof output==='string'?c(output):output})
const binding=(name,socketType,value=r('value'))=>object({name:c(name),socketType:c(socketType),value})
const props=fields=>object({...common,...fields})
const op=(kind,type,nodeType,output,properties,inputs,value)=>object({id:str,kind:c(kind),type:typeof type==='string'?c(type):type,source:source(nodeType,output),properties:props(properties),inputs:object(inputs),...(value?{value}:{})})
const schemas={
 value:{union:[object({kind:c('constant'),type:e('VALUE','INT','BOOLEAN','RGBA','VECTOR','INT_VECTOR2','FLOAT_VECTOR2','INT_VECTOR3'),value:{type:'json'}}),object({kind:c('ref'),node:str,type:e('VALUE','INT','BOOLEAN','RGBA','VECTOR','INT_VECTOR2','FLOAT_VECTOR2','INT_VECTOR3')}),object({kind:c('convert'),fromType:e('VALUE','INT','BOOLEAN','RGBA','VECTOR','INT_VECTOR2','FLOAT_VECTOR2','INT_VECTOR3'),type:e('VALUE','INT','BOOLEAN','RGBA','VECTOR','INT_VECTOR2','FLOAT_VECTOR2','INT_VECTOR3'),input:r('value')})]},
 rgb:op('rgb','RGBA','CompositorNodeRGB','Color',{}, {},tuple([number,number,number,number])),
 int3:op('integer-vector','INT_VECTOR3','FunctionNodeInputIntVector','Vector',{integer_vector_model:c('native-int3-constant-53-v1'),integer_vector_profile:c('darwin-arm64-53-int3-cpu-v1'),integer_vector_version:c([5,3,0]),integer_vector_build:c('02f0899d78e3'),integer_vector_dimensions:c(3),integer_vector_precision:c('CPU_INT32'),integer_vector_presentation:c('component-rne-f32-alpha-one-v1')},{},tuple([i32,i32,i32])),
 blank:op('blank-image','RGBA','CompositorNodeBlankImage','Image',{blank_image_model:c('native-compositor-blank-image-cpu-53-v1'),blank_image_profile:c('darwin-arm64-53-blank-image-cpu-v1'),blank_image_version:c([5,3,0]),blank_image_build:c('02f0899d78e3'),blank_image_color_words:arr({type:'integer',minimum:0,maximum:4294967295},4,4),blank_image_size:tuple([i32,i32]),blank_image_effective_size:tuple([{type:'integer',minimum:1,maximum:8192},{type:'integer',minimum:1,maximum:8192}]),blank_image_max_pixels:c(4194304),blank_image_sampling_model:c('modern-cpu-v1'),blank_image_source_precision:c('FULL')},{Color:binding('Color','RGBA'),Size:binding('Size','INT_VECTOR')}),
 image:op('image-input','RGBA','CompositorNodeImage','Image',{image_id:{type:'string',pattern:'^[a-f0-9]{64}$'},image_window_model:c('modern-cpu-v1')},{}),
 info:op('image-info',e('INT_VECTOR2','FLOAT_VECTOR2','VALUE'),'CompositorNodeImageInfo',e('Dimensions','Resolution','Location','Rotation','Scale'),{image_info_model:c('finite-identity-image-info-v1'),image_info_source_profile:c('darwin-arm64-53-finite-image-info-v1'),image_info_native_version:c([5,3,0]),image_info_reference_model:c('finite-image-identity-v1'),image_info_scene:str,image_info_finite_size:tuple([{type:'integer',minimum:1,maximum:8192},{type:'integer',minimum:1,maximum:8192}])},{Image:binding('Image','RGBA')}),
 separate:op('separate-vector','VALUE','ShaderNodeSeparateXYZ',e('X','Y','Z'),{},{Vector:binding('Vector','VECTOR')}),
 divide:op('math','VALUE','ShaderNodeMath','Value',{operation:c('DIVIDE'),use_clamp:c(false)},{Value:binding('Value','VALUE'),Value_001:binding('Value','VALUE')}),
 combine:op('combine-color','RGBA','CompositorNodeCombineColor','Image',{mode:c('RGB'),ycc_mode:c('ITUBT709'),color_conversion_device:c('CPU'),legacy_hsv_clamp:c(false),legacy_hsl_clamp:c(false)},{Red:binding('Red','VALUE'),Green:binding('Green','VALUE'),Blue:binding('Blue','VALUE'),Alpha:binding('Alpha','VALUE')}),
}
const base={version:c(1),blenderVersion:c('5.3.0'),engine:c('CYCLES'),frame:{type:'integer'},status:c('extracted'),passes:c([]),diagnostics:c([]),alphaConvention:c('premultiplied'),colorSpace:c('scene-linear'),displayTransform:c('separate, after authored compositor'),tree:str,output:r('value')}
const imageRecord=object({model:c('native-cpu-static-image-v1'),encoding:c('zlib-le-rgba32f'),width:{type:'integer',minimum:1,maximum:8192},height:{type:'integer',minimum:1,maximum:8192},decodedBytes:{type:'integer',minimum:16,maximum:67108864},data:{type:'string'},source:object({name:str,kind:str,colorSpace:str,alphaMode:str,storage:str})})
export const descriptor={schemaVersion:1,scope:'structural-prototype-only',limits:{maxDepth:64,maxValues:100000},schemas,families:{
 'integer-vector3':{casePlan:'experiments/static-switch-family/int-vector3-cases.json',program:object({...base,ops:arr({union:[r('int3'),r('rgb')]},1,1)})},
 'finite-image-info':{casePlan:'experiments/compositor-finite-image-info/cases.json',program:object({...base,ops:arr({union:['blank','image','info','separate','divide','combine','rgb'].map(r)},1,64),images:{type:'map',values:imageRecord,maxKeys:1}},['images'])},
},transport:{pixelsPerCase:64,channels:4,profiles:2,apis:2,rawReadPhases:['primary','repeat'],finalReadPhases:['primary','repeat','reinstalled']}}
