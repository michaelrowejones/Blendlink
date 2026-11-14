/* SPDX-License-Identifier: MIT */
/** Separate CPU Wave profile. No shader/EEVEE normalization or libm reuse. */
import {vec4} from 'three/tsl'
import {OwnedCompositorRowTable,validateCompositorRowExtent} from './tslCompositorRowTable.js'
import type {SourceCompositorOperation,SourceCompositorProgram} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
export const COMPOSITOR_WAVE_AXIS_MODEL='native-compositor-wave-axis-cpu-53-v1'
export const COMPOSITOR_WAVE_AXIS_PROFILE='darwin-arm64-53-wave-saw-tri-cpu-v1'
export type WaveAxisSettings=Readonly<{axis:'X'|'Y';profile:'SAW'|'TRI';scale:number;phase:number}>
const fail=(message:string):never=>{throw Error('Wave axis: '+message)}
export const waveParameter=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0)&&Math.fround(value)===value&&Math.abs(value)<=8&&(value===0||Math.abs(value)>=2**-16)
const bitsBuffer=new ArrayBuffer(4),bitsView=new DataView(bitsBuffer)
const word=(value:number):number=>{bitsView.setFloat32(0,value,true);return bitsView.getUint32(0,true)}
function waveAxisFactor(coordinate:number,scale:number,phase:number,profile:'SAW'|'TRI'):number{
 const f=Math.fround,p=f(f(f(coordinate*scale)+f(.000001))*f(.999999)),n=f(f(p*20)+phase),cycles=f(n/(Math.PI*2))
 return profile==='SAW'?f(cycles-Math.floor(cycles)):f(Math.abs(f(cycles-Math.floor(f(cycles+f(.5)))))*2)
}
export function waveAxisRows(width:number,height:number,settings:WaveAxisSettings):Float32Array{
 validateCompositorRowExtent(width,height,fail)
 if(!['X','Y'].includes(settings.axis)||!['SAW','TRI'].includes(settings.profile)||!waveParameter(settings.scale)||!waveParameter(settings.phase))fail('unqualified internal axis settings')
 const maximum=Math.max(width,height),dimension=settings.axis==='X'?width:height,data=new Float32Array(maximum)
 for(let i=0;i<dimension;i++)data[i]=waveAxisFactor(Math.fround((2*i+1-dimension)/maximum),settings.scale,settings.phase,settings.profile)
 return data
}
const propertyNames=['wave_axis_model','wave_axis_profile','wave_axis_version','wave_axis_build','wave_axis_evaluator','wave_axis_coordinate_model','wave_axis_reference_model','wave_axis_precision','wave_axis_requested_precision','wave_axis_export_extent','wave_axis_mapping_model','wave_axis_detail_model','wave_axis_direction','wave_axis_wave_profile','wave_axis_parameter_words']
export function validateCompositorWaveAxis(op:SourceCompositorOperation,refuse:(message:string)=>never):WaveAxisSettings{
 const closed=(value:object,keys:string[]):boolean=>Object.keys(value).sort().join('|')===keys.sort().join('|')
 const p=op?.properties,inputs=op?.inputs,source=op?.source,color=source?.output==='Color'
 if(!op||op.kind!=='wave-texture'||source?.nodeType!=='ShaderNodeTexWave'||!['Color','Fac'].includes(source.output)||op.type!==(color?'RGBA':'VALUE')||!Array.isArray(source.path)||!source.path.every(x=>typeof x==='string')||typeof source.node!=='string'||!p||typeof p!=='object'||Array.isArray(p)||!inputs||typeof inputs!=='object'||Array.isArray(inputs))return refuse('Wave axis requires its native source and input schema')
 if(!closed(source,['path','node','nodeType','output']))return refuse('Wave axis requires a closed native source record')
 if(Object.keys(p).some(key=>key.startsWith('wave_')&&!propertyNames.includes(key))||p.wave_axis_model!==COMPOSITOR_WAVE_AXIS_MODEL||p.wave_axis_profile!==COMPOSITOR_WAVE_AXIS_PROFILE||JSON.stringify(p.wave_axis_version)!=='[5,3,0]'||p.wave_axis_build!=='02f0899d78e3'||p.wave_axis_evaluator!=='CPU-MF'||p.evaluation_device!=='CPU'||p.single_value_device!=='CPU'||p.wave_axis_coordinate_model!=='implicit-uniform-f32-v1'||p.wave_axis_reference_model!=='full-frame-context-zero-offset-v1'||p.wave_axis_precision!=='CPU_FLOAT32'||!['AUTO','FULL'].includes(String(p.wave_axis_requested_precision))||p.wave_axis_mapping_model!=='identity-v1'||p.wave_axis_detail_model!=='unlinked-unused-v1'||!['X','Y'].includes(String(p.wave_axis_direction))||!['SAW','TRI'].includes(String(p.wave_axis_wave_profile)))return refuse('Wave axis requires its pinned CPU SAW/TRI Uniform-field profile; SIN and other modes remain unqualified')
 if(!Array.isArray(p.wave_axis_export_extent)||p.wave_axis_export_extent.length!==2||!p.wave_axis_export_extent.every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=4&&n<=8192))return refuse('Wave axis requires its full-frame physical export extent')
 const names=['Scale','Phase Offset','Distortion'];if(Object.keys(inputs).length!==names.length||!names.every(name=>Object.hasOwn(inputs,name)))return refuse('Wave axis requires only its three literal scalar controls')
 const values=names.map(name=>{const input=inputs[name],v=input?.value;if(!input||!closed(input,['name','socketType','value'])||input.name!==name||input.socketType!=='VALUE'||!v||!closed(v,['kind','type','value'])||v.kind!=='constant'||v.type!=='VALUE'||!waveParameter(v.value))return refuse('Wave axis controls require raw Float32 literals: positive zero or magnitude in [2^-16,8]');return v.value})
 if(values[2]!==0||!Array.isArray(p.wave_axis_parameter_words)||JSON.stringify(p.wave_axis_parameter_words)!==JSON.stringify(values.map(word)))return refuse('Wave axis requires raw positive-zero Distortion and matching exact parameter words')
 return Object.freeze({axis:p.wave_axis_direction as 'X'|'Y',profile:p.wave_axis_wave_profile as 'SAW'|'TRI',scale:values[0]!,phase:values[1]!})
}
export function waveAxisKey(settings:WaveAxisSettings):string{return [settings.axis,settings.profile,word(settings.scale),word(settings.phase)].join(':')}
export function waveAxisTableKeys(ops:SourceCompositorProgram['ops']):Set<string>{
 const keys=new Set<string>();for(const op of ops)if(op.kind==='wave-texture')keys.add(waveAxisKey(validateCompositorWaveAxis(op,fail)));return keys
}
const tableOwners=new WeakMap<object,string>()
export class CompositorWaveAxisTable{
 #table:OwnedCompositorRowTable;#node:TslEffectNode;#dead=false
 constructor(settings:WaveAxisSettings){
  const snapshot=Object.freeze({...settings});waveAxisRows(4,4,snapshot)
  this.#table=new OwnedCompositorRowTable(1,(w,h)=>waveAxisRows(w,h,snapshot),{label:'Wave axis',name:'SceneToWeb compositor Wave factor row'})
  this.#node=this.#table.guard(this.#table.sample(snapshot.axis,0).toVar())
  tableOwners.set(this,waveAxisKey(snapshot))
 }
 get node():TslEffectNode{if(this.#dead)fail('pipeline resources were disposed');return this.#node}
 validate(renderer:any):void{this.#table.validate(renderer)}
 dispose():void{if(this.#dead)return;this.#dead=true;this.#table.dispose()}
}
export function buildCompositorWaveAxis(op:SourceCompositorOperation,tables:Map<string,CompositorWaveAxisTable>,resources:{dispose():void}[],refuse:(message:string)=>never):TslEffectNode{
 const settings=validateCompositorWaveAxis(op,refuse),key=waveAxisKey(settings)
 let table=tables.get(key);if(!table){if(tables.size>=8)return refuse('Wave axis exceeds its eight distinct row-table budget');table=new CompositorWaveAxisTable(settings);tables.set(key,table);resources.push(table)}
 if(tableOwners.get(table)!==key)return refuse('Wave axis requires its matching owned factor-row binding')
 return op.type==='RGBA'?vec4(table.node,table.node,table.node,1):table.node
}
