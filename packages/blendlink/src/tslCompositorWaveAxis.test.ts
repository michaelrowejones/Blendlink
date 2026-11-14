import {it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {COMPOSITOR_WAVE_AXIS_MODEL as model,COMPOSITOR_WAVE_AXIS_PROFILE as profile,validateCompositorWaveAxis,waveAxisRows,waveParameter,CompositorWaveAxisTable,buildCompositorWaveAxis,waveAxisKey} from './tslCompositorWaveAxis.js'
import {validateWaveAxisPresentation} from './tslCompositorWaveField.js'
const fail=(message:string):never=>{throw Error(message)}
const word=(n:number)=>new Uint32Array(new Float32Array([n]).buffer)[0]!
const make=(axis='X',waveProfile='SAW',scale=5,phase=0,color=true):any=>({id:'wave',kind:'wave-texture',type:color?'RGBA':'VALUE',source:{path:[],node:'Artist Wave',nodeType:'ShaderNodeTexWave',output:color?'Color':'Fac'},properties:{wave_axis_model:model,wave_axis_profile:profile,wave_axis_version:[5,3,0],wave_axis_build:'02f0899d78e3',wave_axis_evaluator:'CPU-MF',evaluation_device:'CPU',single_value_device:'CPU',wave_axis_coordinate_model:'implicit-uniform-f32-v1',wave_axis_reference_model:'full-frame-context-zero-offset-v1',wave_axis_precision:'CPU_FLOAT32',wave_axis_requested_precision:'FULL',wave_axis_export_extent:[13,9],wave_axis_mapping_model:'identity-v1',wave_axis_detail_model:'unlinked-unused-v1',wave_axis_direction:axis,wave_axis_wave_profile:waveProfile,wave_axis_parameter_words:[scale,phase,0].map(word)},inputs:Object.fromEntries([['Scale',scale],['Phase Offset',phase],['Distortion',0]].map(([name,value])=>[name,{name,socketType:'VALUE',value:{kind:'constant',type:'VALUE',value}}]))})
const program=(ops:any[]):any=>({version:1,status:'extracted',ops,passes:[],diagnostics:[],output:{kind:'ref',type:ops.at(-1).type,node:ops.at(-1).id}})
const textureSet=(node:any)=>{const result=new Set<any>();node.traverse((child:any)=>{if(child.isTextureNode)result.add(child.value)});return result}
it('matches 252 independent native CPU factor-row hashes including signed bounds and adjacent seams',()=>{
 const golden=JSON.parse(readFileSync(new URL('../../../experiments/compositor-wave-axis/native-row-goldens.json',import.meta.url),'utf8'))
 expect(golden.rows).toHaveLength(252)
 for(const row of golden.rows){
  const values=new Float32Array(new Uint32Array(row.parameterWords).buffer),data=waveAxisRows(row.width,row.height,{axis:row.axis,profile:row.profile,scale:values[0]!,phase:values[1]!}),active=row.axis==='X'?row.width:row.height
  expect(createHash('sha256').update(new Uint8Array(data.buffer,0,active*4)).digest('hex'),row.case).toBe(row.nativeFactorRowSha256)
  expect(data.length).toBe(Math.max(row.width,row.height));expect(data.byteLength).toBeLessThanOrEqual(32768)
 }
})
it('rejects unqualified modes, fields, word claims and stale source schemas before resource creation',()=>{
 for(const mutate of[(op:any)=>op.properties.wave_axis_wave_profile='SIN',(op:any)=>op.properties.wave_axis_direction='DIAGONAL',(op:any)=>op.source.nodeType='ShaderNodeTexNoise',(op:any)=>op.type='VECTOR',(op:any)=>op.properties.evaluation_device='GPU',(op:any)=>op.inputs.Vector={socketType:'VECTOR',value:{kind:'constant',type:'VECTOR',value:[0,0,0]}},(op:any)=>op.inputs.Scale.value={kind:'ref',type:'VALUE',node:'missing'},(op:any)=>op.properties.wave_axis_parameter_words[0]++,(op:any)=>op.properties.wave_fake=true,(op:any)=>op.properties.wave_axis_detail_model='linked-fields',(op:any)=>op.inputs.Scale.value.input={kind:'ref',node:'hidden'},(op:any)=>op.source.fake=true,(op:any)=>op.inputs.Distortion.value.value=1]){
  const op=make();mutate(op);expect(()=>validateCompositorWaveAxis(op,fail)).toThrow();expect(()=>buildSourceCompositor(program([op]),()=>null)).toThrow()
 }
 for(const value of[-0,2**-17,8.000001,NaN,Infinity,.1])expect(waveParameter(value)).toBe(false)
 for(const value of[0,2**-16,-(2**-16),8,-8,Math.fround(.1)])expect(waveParameter(value)).toBe(true)
})
it('shares one physical table between Color and Factor and identical source settings',()=>{
 const color=make(),factor=make('X','SAW',5,0,false);factor.id='factor'
 const built=buildSourceCompositor(program([color,factor]),()=>null)
 const dispose=vi.spyOn(CompositorWaveAxisTable.prototype,'dispose')
 try{expect(textureSet(built.node).size).toBe(1);built.dispose();built.dispose();expect(dispose).toHaveBeenCalledTimes(1)}finally{dispose.mockRestore()}
})
it('closes sampler budgets on distinct keys including display LUTs and effects',()=>{
 const ops=Array.from({length:8},(_,i)=>({...make('X','SAW',i,0),id:'wave'+i})),presentation:any={compositor:program(ops),display:{ops:[]}}
 expect(()=>validateWaveAxisPresentation(presentation,0,fail)).not.toThrow();presentation.display.ops.push({type:'Lut3DTransform'});expect(()=>validateWaveAxisPresentation(presentation,0,fail)).toThrow(/eight/)
 presentation.display.ops=[];expect(()=>validateWaveAxisPresentation(presentation,1,fail)).toThrow(/post-LDR/);expect(()=>validateWaveAxisPresentation(presentation,0,fail,1)).toThrow(/pre-HDR/)
 presentation.compositor.ops.push({...make('Y','SAW'),id:'ninth'});expect(()=>validateWaveAxisPresentation(presentation,0,fail)).toThrow(/eight/)
 const fake={...make(),kind:'math'};expect(()=>buildSourceCompositor(program([fake]),()=>null)).toThrow(/actual Wave/)
 const duplicate=make();duplicate.id='wave';expect(()=>buildSourceCompositor(program([make(),duplicate]),()=>null)).toThrow(/unique/)
 const pass=program([make()]);pass.passes=[{}];expect(()=>buildSourceCompositor(pass,()=>null)).toThrow(/scene-pass/)
 const spatial={id:'flip',kind:'flip',type:'RGBA',source:{path:[],node:'Flip',nodeType:'CompositorNodeFlip',output:'Image'},properties:{},inputs:{}}
 expect(()=>buildSourceCompositor(program([make(),spatial]),()=>null)).toThrow(/closed full-frame/)
})

it('does not trust a supplied table map to certify a foreign or differently keyed binding',()=>{
 const op=make(),key=waveAxisKey(validateCompositorWaveAxis(op,fail)),resources:any[]=[]
 expect(()=>buildCompositorWaveAxis(op,new Map([[key,{node:{}} as any]]),resources,fail)).toThrow(/matching owned/)
 const wrong=new CompositorWaveAxisTable({axis:'Y',profile:'SAW',scale:5,phase:0})
 try{expect(()=>buildCompositorWaveAxis(op,new Map([[key,wrong]]),resources,fail)).toThrow(/matching owned/)}finally{wrong.dispose()}
 expect(resources).toHaveLength(0)
})

it('retains every Wave extent guard when the terminal output is constant',()=>{
 const p=program([make()]);p.output={kind:'constant',type:'RGBA',value:[0,0,0,1]}
 const built=buildSourceCompositor(p,()=>null),renderer={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(3,3),getRenderTarget:()=>null}
 expect(()=>built.node.update({renderer})).toThrow(/physical extents/)
 built.dispose();expect(()=>built.node.update({renderer})).toThrow(/disposed/)
})
