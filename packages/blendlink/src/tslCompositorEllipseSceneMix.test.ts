import{readFileSync}from'node:fs'
import{buildCompositorEllipseMask}from'./tslCompositorEllipseMask.js'
import{describe,it,expect,vi}from'vitest'
import{Scene,Group,PerspectiveCamera}from'three'
import{ThreeWebgpuPostPipelineService}from'./threeWebgpuPostPipeline.js'
import*as sceneFrame from'./tslCompositorSceneFrame.js'
import{ellipseSceneMixContract,ELLIPSE_SCENE_MIX_MODEL,ELLIPSE_SCENE_FRAME_MODEL}from'./tslCompositorEllipseSceneMix.js'
import{validateEllipsePresentation,validateStaticMaskDomains}from'./tslCompositorMaskDomains.js'
import{buildSourceCompositor}from'./tslSourceCompositor.js'
import type{SourceCompositorProgram,SourcePresentation}from'./sourceDisplay.js'
const word=(n:number)=>new Uint32Array(new Float32Array([n]).buffer)[0]!
const ref=(node:string,type:string)=>({kind:'ref' as const,type,node})
const input=(value:any)=>({name:'owned',socketType:value.type,value})
export function sceneMixProgram():SourceCompositorProgram{
 const source={path:['Owned'],node:'Owned',nodeType:'',output:''},pass={scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA',aov:null},background=[.125,.25,.5,.75]
 return{version:1,status:'extracted',passes:[pass],diagnostics:[],output:ref('mix','RGBA'),ops:[
  {id:'scene',kind:'render-pass',type:'RGBA',source:{...source,nodeType:'CompositorNodeRLayers',output:'Image'},pass,properties:{evaluation_device:'CPU',single_value_device:'CPU'},inputs:{}},
  {id:'mask',kind:'ellipse-mask',type:'VALUE',source:{...source,nodeType:'CompositorNodeEllipseMask',output:'Mask'},properties:{ellipse_mask_operation:'ADD',ellipse_mask_mask:0,ellipse_mask_value:1,ellipse_mask_identity:false},inputs:{}},
  {id:'mix',kind:'mix',type:'RGBA',source:{...source,nodeType:'ShaderNodeMix',output:'Result_Color'},properties:{data_type:'RGBA',blend_type:'MIX',clamp_factor:true,clamp_result:false,evaluation_device:'CPU',color_conversion_device:'CPU',ellipse_scene_mix_model:ELLIPSE_SCENE_MIX_MODEL,ellipse_scene_mix_frame_model:ELLIPSE_SCENE_FRAME_MODEL,ellipse_scene_mix_owner:['Scene','ViewLayer'],ellipse_scene_mix_direction:'A',ellipse_scene_mix_background_words:background.map(word)},inputs:{Factor_Float:input(ref('mask','VALUE')),A_Color:input(ref('scene','RGBA')),B_Color:input({kind:'constant',type:'RGBA',value:background})}},
 ]}
}
const fail=(message:string):never=>{throw Error(message)}
describe('closed scene/Ellipse/binary native Mix ABI',()=>{
 it('admits only the three terminal ops and both source sides with exact native Alpha conversion',()=>{
  for(const alpha of[false,true])for(const side of['A','B']){const p=sceneMixProgram(),source=p.ops[0]!,mix=p.ops[2]!;if(alpha){source.type='VALUE';source.source.output='Alpha';Object.assign(source.pass!,{pass:'Alpha',name:'Alpha',type:'VALUE'});mix.inputs.A_Color!.value={kind:'convert',fromType:'VALUE',type:'RGBA',input:ref('scene','VALUE')}}if(side==='B'){[mix.inputs.A_Color,mix.inputs.B_Color]=[mix.inputs.B_Color!,mix.inputs.A_Color!];mix.properties.ellipse_scene_mix_direction='B'}expect(ellipseSceneMixContract(p)?.side).toBe(side);expect(()=>validateStaticMaskDomains(p,'CompositorNodeEllipseMask',fail)).not.toThrow()}
 })
 it('rejects schema/source/owner/model/branch edits rather than creating a broad sampler exemption',()=>{
  const changes:Array<(p:SourceCompositorProgram)=>void>=[p=>p.ops.push({...p.ops[0]!,id:'extra'}),p=>p.output=ref('scene','RGBA'),p=>p.ops[0]!.source.nodeType='CompositorNodeImage',p=>p.ops[0]!.pass!.viewLayer='Other',p=>p.ops[0]!.pass!.aov={name:'custom'},p=>p.ops[1]!.properties.ellipse_mask_mask=.5,p=>p.ops[1]!.properties.ellipse_mask_identity=true,p=>p.ops[2]!.properties.blend_type='ADD',p=>p.ops[2]!.properties.clamp_result=true,p=>p.ops[2]!.properties.ellipse_scene_mix_model='unknown',p=>p.ops[2]!.properties.ellipse_scene_mix_frame_model='rgba32-finite-flag',p=>p.ops[2]!.properties.ellipse_scene_mix_direction='B',p=>p.ops[2]!.properties.ellipse_scene_mix_background_words=[0,0,0,0],p=>p.ops[2]!.inputs.Factor_Float!.value={kind:'constant',type:'VALUE',value:1},p=>p.ops[2]!.inputs.B_Color!.value=ref('scene','RGBA')]
  for(const change of changes){const p=sceneMixProgram();change(p);expect(ellipseSceneMixContract(p)).toBeNull();expect(()=>validateStaticMaskDomains(p,'CompositorNodeEllipseMask',fail)).toThrow(/pointwise|budget/)}
 })
 it('admits positive zero/min-normal backgrounds and rejects negative-zero/subnormal/nonfinite/HDR literals',()=>{
  for(const n of[0,2**-126,1,-0,2**-149,-1,1.0000001192092896,Infinity,NaN]){const p=sceneMixProgram(),m=p.ops[2]!;m.inputs.B_Color!.value.value=[n,n,n,n];m.properties.ellipse_scene_mix_background_words=[n,n,n,n].map(word);expect(ellipseSceneMixContract(p)!==null).toBe([0,2**-126,1].some(v=>Object.is(v,n)))}
 })
 it('counts one frame plus one row before six display lookup slots and refuses seventh/extra effects',()=>{
  const p=sceneMixProgram(),presentation={schemaVersion:1,model:'blendlink-source-presentation-v1',compositor:p,warnings:[],display:{ops:Array.from({length:6},()=>({type:'Lut1DTransform'}))}} as unknown as SourcePresentation
  expect(()=>validateEllipsePresentation(presentation,0,fail,0)).not.toThrow();(presentation.display!.ops as any[]).push({type:'Lut3DTransform'});expect(()=>validateEllipsePresentation(presentation,0,fail,0)).toThrow(/eight/);(presentation.display!.ops as any[]).pop();expect(()=>validateEllipsePresentation(presentation,1,fail,0)).toThrow(/post-LDR/);expect(()=>validateEllipsePresentation(presentation,0,fail,1)).toThrow(/pre-HDR/)
 })
 it('rejects cancellation after the async decoder boundary before returning a pipeline',async()=>{
  const controller=new AbortController(),scene=new Scene(),root=new Group();scene.add(root)
  const prepare=vi.spyOn(sceneFrame,'prepareEllipseSceneDecoder').mockImplementation(async()=>{queueMicrotask(()=>controller.abort(Error('canceled after decoder')));return{report:{model:'half-decoder-canonical-nan-v1',words:262144,milliseconds:1,nominalTransientBytes:4194304,readbackFlipped:false}}})
  try{await expect(ThreeWebgpuPostPipelineService.create({signal:controller.signal,sourcePresentation:{schemaVersion:1,model:'blendlink-source-presentation-v1',compositor:sceneMixProgram(),warnings:[]},scene,root,camera:new PerspectiveCamera(),renderer:{} as any,bindings:{byId:{},byName:{}}})).rejects.toThrow('canceled after decoder');expect(prepare).toHaveBeenCalledTimes(1)}finally{prepare.mockRestore()}
 })
 it('retains the complete native graph at the inner Ellipse builder without an array-only bypass',()=>{
  const p=JSON.parse(readFileSync(new URL('../../../experiments/compositor-ellipse-scene-mix/inner-program.fixture.json',import.meta.url),'utf8')),mask=p.ops.find((op:any)=>op.kind==='ellipse-mask'),resources:{dispose():void}[]=[]
  const node=buildCompositorEllipseMask(mask,p.ops,resources,fail,p);expect(node.isNode).toBe(true);expect(resources).toHaveLength(1);resources.forEach(r=>r.dispose())
  expect(()=>buildCompositorEllipseMask(mask,p.ops,[],fail)).toThrow(/pointwise/)
  expect(()=>buildCompositorEllipseMask(mask,p.ops,[],fail,{...p,ops:[...p.ops]})).toThrow(/operation-list identity/)
 })
 it('requires an actual opaque frame binding before invoking a resolver or allocating row resources',()=>{const resolver=vi.fn(()=>null);expect(()=>buildSourceCompositor(sceneMixProgram(),resolver)).toThrow(/renderer-owned/);expect(()=>buildSourceCompositor(sceneMixProgram(),resolver,{sceneFrame:{model:'renderer-owned-half-frame-v1'}})).toThrow(/renderer-owned/);expect(resolver).not.toHaveBeenCalled()})
})
