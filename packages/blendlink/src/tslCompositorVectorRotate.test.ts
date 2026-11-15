import {NodeFrame} from 'three/webgpu'
import {expect,it,vi} from 'vitest'
import {DataTexture,FloatType,RGBAFormat,Scene,PerspectiveCamera} from 'three'
import {pass as renderPass,texture,vec3} from 'three/tsl'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {CompositorVectorRotate,VECTOR_ROTATE_CPU_MODEL,VECTOR_ROTATE_CPU_PROFILE,VECTOR_ROTATE_COORDINATES,compositorRotateNormalizedRows,validateVectorRotateProgram,validateVectorRotatePresentation} from './tslCompositorVectorRotate.js'
const word=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0]!
const source=(nodeType:string,output:string)=>({path:['Compositor'],node:nodeType,nodeType,output})
const common={evaluation_device:'CPU',single_value_device:'CPU'}
function program(field=false):any{
 const rotate={id:'rotate',kind:'vector-rotate-cpu',type:'VECTOR',source:source('ShaderNodeVectorRotate','Vector'),properties:{...common,vector_rotate_model:VECTOR_ROTATE_CPU_MODEL,vector_rotate_profile:VECTOR_ROTATE_CPU_PROFILE,vector_rotate_version:[5,3,0],vector_rotate_build:'02f0899d78e3',vector_rotate_mode:'Z_AXIS',vector_rotate_invert:false,vector_rotate_center_words:[0,0,0],vector_rotate_angle_word:0,vector_rotate_columns:[[1,0,0],[0,1,0],[0,0,1]].map(c=>c.map(word)),vector_rotate_input:field?'normalized':'literal',vector_rotate_vector_words:field?null:[.1,.2,.3].map(word),vector_rotate_coordinates:field?VECTOR_ROTATE_COORDINATES:null,vector_rotate_export_extent:[13,9],vector_rotate_precision:'FULL',vector_rotate_scene:'Scene'},inputs:{Vector:{name:'Vector',socketType:'VECTOR',value:field?{kind:'convert',fromType:'FLOAT_VECTOR2',type:'VECTOR',input:{kind:'ref',node:'coordinates',type:'FLOAT_VECTOR2'}}:{kind:'constant',type:'VECTOR',value:[.1,.2,.3].map(Math.fround)}}}}
 const pass={id:'image',kind:'render-pass',type:'RGBA',source:source('CompositorNodeRLayers','Image'),properties:{...common},inputs:{},pass:{scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA'}}
 const coordinates={id:'coordinates',kind:'image-coordinates',type:'FLOAT_VECTOR2',source:source('CompositorNodeImageCoordinates','Normalized'),properties:{...common,image_coordinates_model:'render-layer-float2-v1',image_coordinates_source_profile:'darwin-arm64-53-float2-v1',image_coordinates_native_version:[5,3,0],image_coordinates_reference_model:'full-frame-render-layer-v1'},inputs:{Image:{name:'Image',socketType:'RGBA',value:{kind:'ref',node:'image',type:'RGBA'}}}}
 return{version:1,status:'extracted',ops:field?[pass,coordinates,rotate]:[rotate],passes:field?[pass.pass]:[],diagnostics:[],output:{kind:'convert',fromType:'VECTOR',type:'RGBA',input:{kind:'ref',node:'rotate',type:'VECTOR'}}}
}
function renderer(){
 let width=13,height=9
 const target:any={width,height,viewport:{x:0,y:0,z:width,w:height},scissorTest:false}
 const value:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(width,height),getRenderTarget:()=>target,getActiveMipmapLevel:()=>0,getActiveCubeFace:()=>0,getRenderObjectFunction:()=>null,getPixelRatio:()=>1,getMRT:()=>null,getClearColor:(c:any)=>c.setRGB(.1,.2,.3),getClearAlpha:()=>.25,getScissorTest:()=>false}
 return{value,target,setSize(w:number,h:number){width=w;height=h;Object.assign(target,{width:w,height:h,viewport:{x:0,y:0,z:w,w:h}})}}
}
it('validates source-isolated plans and refuses payload-minted owned resources',()=>{
 for(const field of[false,true])expect(validateVectorRotateProgram(program(field))).toBeTruthy()
 expect(()=>new CompositorVectorRotate({op:program().ops[0],center:[0,0,0],columns:[[1,0,0],[0,1,0],[0,0,1]]}as any)).toThrow(/closed program validation/)
 expect(validateVectorRotateProgram({...program(),ops:[]})).toBeNull()
})
it('rejects malformed models/raw controls/typed refs before resolving any image',()=>{
 for(const mutate of[(p:any)=>p.ops.at(-1).properties.vector_rotate_mode='EULER_XYZ',(p:any)=>p.ops.at(-1).properties.vector_rotate_invert=1,(p:any)=>p.ops.at(-1).properties.vector_rotate_center_words[0]=0x80000000,(p:any)=>p.ops.at(-1).properties.vector_rotate_angle_word=word(2**-17),(p:any)=>p.ops.at(-1).properties.vector_rotate_columns[0][0]=word(2**-64),(p:any)=>p.ops.at(-1).properties.vector_rotate_fake=true,(p:any)=>p.ops.at(-1).properties.evaluation_device='GPU',(p:any)=>p.ops.at(-1).inputs.Vector.value.fromType='VECTOR',(p:any)=>p.ops[1].source.output='Uniform',(p:any)=>p.ops[0].source.nodeType='CompositorNodeImage',(p:any)=>p.ops[1].inputs.Image.value.node='rotate',(p:any)=>p.ops[1].id=p.ops[0].id,(p:any)=>p.output={kind:'convert',type:'RGBA',fromType:'VALUE',input:{kind:'convert',type:'VALUE',fromType:'VECTOR',input:p.output.input}}]){
  const p=program(true),resolve=vi.fn();mutate(p);expect(()=>buildSourceCompositor(p,resolve)).toThrow(/Vector Rotate/);expect(resolve).not.toHaveBeenCalled()
 }
})
it('closes raw literal vector bounds and fixed-axis zero-angle coefficient shape',()=>{
 for(const n of[-0,2**-17,17,Infinity]){
  const p=program();p.ops[0].inputs.Vector.value.value[0]=n;p.ops[0].properties.vector_rotate_vector_words[0]=word(n)
  expect(()=>validateVectorRotateProgram(p)).toThrow(/Vector Rotate.*literal/)
 }
 const p=program();p.ops[0].properties.vector_rotate_columns[0][1]=word(.25);p.ops[0].properties.vector_rotate_columns[1][0]=word(-.25)
 expect(()=>validateVectorRotateProgram(p)).toThrow(/zero-angle/)
})
it('accepts reordered JSON keys and exact Separate XYZ without native scalar mean fallback',()=>{
 const p=program(),part:any={id:'x',kind:'separate-vector',type:'VALUE',source:source('ShaderNodeSeparateXYZ','X'),properties:{...common},inputs:{Vector:{name:'Vector',socketType:'VECTOR',value:{kind:'ref',type:'VECTOR',node:'rotate'}}}}
 p.ops.push(part);p.output={kind:'convert',type:'RGBA',fromType:'VALUE',input:{kind:'ref',type:'VALUE',node:'x'}}
 expect(()=>validateVectorRotateProgram(JSON.parse(JSON.stringify(p,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort()):v)))).not.toThrow()
 part.inputs.Vector.socketType='RGBA';expect(()=>validateVectorRotateProgram(p)).toThrow(/Vector Rotate.*presentation/)
})
it('predeclares row/display sampler budget and refuses unqualified external effects',()=>{
 const p=program(true),presentation:any={compositor:p,display:{ops:Array.from({length:7},()=>({type:'Lut1DTransform'}))}},fail=(message:string):never=>{throw Error(message)}
 expect(()=>validateVectorRotatePresentation(presentation,0,fail)).not.toThrow();presentation.display.ops.push({type:'Lut3DTransform'})
 expect(()=>validateVectorRotatePresentation(presentation,0,fail)).toThrow(/eight/);presentation.display.ops=[]
 expect(()=>validateVectorRotatePresentation(presentation,1,fail)).toThrow(/effects/);expect(()=>validateVectorRotatePresentation(presentation,0,fail,1)).toThrow(/effects/)
})
it('refuses negative-zero presentation literals outside the final-Center sign proof',()=>{
 const p=program(),component={id:'x',kind:'separate-vector',type:'VALUE',source:source('ShaderNodeSeparateXYZ','X'),properties:{...common},inputs:{Vector:{name:'Vector',socketType:'VECTOR',value:{kind:'ref',node:'rotate',type:'VECTOR'}}}}
 const color:any={id:'rgb',kind:'combine-color',type:'RGBA',source:source('CompositorNodeCombineColor','Image'),properties:{...common,mode:'RGB'},inputs:Object.fromEntries(['Red','Green','Blue','Alpha'].map(name=>[name,{name,socketType:'VALUE',value:name==='Red'?{kind:'ref',node:'x',type:'VALUE'}:{kind:'constant',type:'VALUE',value:name==='Alpha'?1:0}}]))}
 p.ops.push(component,color);p.output={kind:'ref',node:'rgb',type:'RGBA'}
 expect(()=>validateVectorRotateProgram(p)).not.toThrow();color.inputs.Green.value.value=-0
 expect(()=>validateVectorRotateProgram(p)).toThrow(/Vector Rotate.*presentation/)
})
it('retains root lifetime/epoch and private OR-zero checks for literal inputs',()=>{
 const p=program(),built=buildSourceCompositor(p,vi.fn()),r=renderer()
 expect(()=>built.node.update({renderer:r.value})).not.toThrow()
 r.value._textures.data=new WeakMap();expect(()=>built.node.update({renderer:r.value})).toThrow(/allocation epoch/)
 built.dispose();built.dispose();expect(()=>built.node.update({renderer:r.value})).toThrow(/disposed/)
})
it('uses just one owned R32F table and preserves the borrowed Render Layers texture',()=>{
 const pass=renderPass(new Scene(),new PerspectiveCamera()),input:any=pass.getTextureNode(),image=input.value,disposed=vi.spyOn(pass,'dispose'),before={value:input.value,reference:input.referenceNode,uv:input.uvNode,sampler:input.sampler};pass.setSize(13,9)
 const p=program(true),contract=validateVectorRotateProgram(p)!,owner=new CompositorVectorRotate(contract),coords:any=owner.coordinateNode(),loads=new Set<any>()
 coords.traverse((node:any)=>{if(node.isTextureNode)loads.add(node)})
 expect(loads.size).toBe(2);expect(new Set([...loads].map(node=>node.value)).size).toBe(1)
 const tables=[...loads].map(node=>node.value);expect(tables[0].format).not.toBe(RGBAFormat)
 const root:any=owner.guard(vec3(0),new Map([['image',input]])),r=renderer(),schedule=vi.fn(),frame={renderer:r.value,updateBeforeNode:schedule}
 expect(()=>root.update(frame)).not.toThrow();const table=tables[0],version=table.version
 expect(table.image.width).toBe(13);expect(table.image.height).toBe(2);expect(table.image.data.byteLength).toBe(104)
 expect(()=>root.update(frame)).not.toThrow();expect(table.version).toBe(version)
 r.setSize(8193,4);expect(()=>root.update(frame)).toThrow(/physical extents/);expect(table.version).toBe(version)
 r.setSize(13,9);expect(()=>root.update(frame)).not.toThrow()
 image.image.width=12;expect(()=>root.update(frame)).toThrow(/extents/);image.image.width=13
 expect({value:input.value,reference:input.referenceNode,uv:input.uvNode,sampler:input.sampler}).toEqual(before)
 const foreign=renderPass(new Scene(),new PerspectiveCamera());input.passNode=foreign;const calls=schedule.mock.calls.length;expect(()=>root.update(frame)).toThrow(/PassNode.*binding/);expect(schedule.mock.calls.length).toBe(calls);input.passNode=pass;expect(()=>root.update(frame)).not.toThrow()
 owner.dispose();owner.dispose();expect(disposed).not.toHaveBeenCalled();pass.dispose();foreign.dispose()
})
it('refuses a plain same-sized texture as a forged Render Layers producer',()=>{
 const image=new DataTexture(new Float32Array(13*9*4),13,9,RGBAFormat,FloatType)
 expect(()=>buildSourceCompositor(program(true),()=>texture(image))).toThrow(/FRAME.*PassNode/);image.dispose()
})
it('retains fixed extent bounds and exact rectangular row values without mutating prior snapshots',()=>{
 const first=compositorRotateNormalizedRows(13,9),snapshot=first.slice(),next=compositorRotateNormalizedRows(9,13)
 expect([...first]).toEqual([...snapshot]);expect(next).not.toBe(first)
 for(let i=0;i<13;i++)expect(first[i]).toBe(Math.fround((i+.5)/13))
 for(let i=0;i<9;i++)expect(first[13+i]).toBe(Math.fround((i+.5)/9))
 expect(compositorRotateNormalizedRows(8192,4).byteLength).toBe(65536)
 for(const [w,h]of[[1,4],[4,8193],[4.5,4]])expect(()=>compositorRotateNormalizedRows(w!,h!)).toThrow(/physical extents/)
})

it('schedules the original FRAME producer before outer geometry, never during late render updates',()=>{
 const producer=renderPass(new Scene(),new PerspectiveCamera());producer.setSize(13,9)
 const owner=new CompositorVectorRotate(validateVectorRotateProgram(program(true))!),root:any=owner.guard(vec3(0),new Map([['image',producer.getTextureNode()]])),r=renderer(),events:string[]=[]
 producer.updateBefore=vi.fn(()=>{events.push('producer')})
 const frame=new NodeFrame();frame.renderer=r.value;frame.frameId=1;frame.renderId=1
 expect(root.getUpdateBeforeType()).toBe('render');frame.updateBeforeNode(root);events.push('outer-geometry');root.update(frame)
 expect(events).toEqual(['producer','outer-geometry']);expect(producer.updateBefore).toHaveBeenCalledTimes(1)
 frame.renderId=2;frame.updateBeforeNode(root);events.push('outer-geometry-2');root.update(frame)
 expect(events).toEqual(['producer','outer-geometry','outer-geometry-2']);expect(producer.updateBefore).toHaveBeenCalledTimes(1)
 frame.frameId=2;frame.renderId=3;frame.updateBeforeNode(root);expect(producer.updateBefore).toHaveBeenCalledTimes(2)
 r.setSize(3,9);frame.frameId=3;frame.renderId=4;expect(()=>frame.updateBeforeNode(root)).toThrow(/physical extents/);expect(producer.updateBefore).toHaveBeenCalledTimes(2)
 owner.dispose();producer.dispose()
})
