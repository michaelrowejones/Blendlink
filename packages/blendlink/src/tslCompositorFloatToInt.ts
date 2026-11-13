/* SPDX-License-Identifier: MIT */
/** Literal-only native MF integer rounding, with independently verified input words. */
import * as TSL from 'three/tsl'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const {Fn,If,abs,bitcast,float,int,uint}=TSL as unknown as Record<
  'Fn'|'If'|'abs'|'bitcast'|'float'|'int'|'uint',(...args:TslEffectNode[])=>TslEffectNode>
export const FLOAT_TO_INT_MODEL='native-mf-f32-int24-v1'
const INPUT_MODEL='literal-f32-normal-or-zero-v1',SOURCE_PROFILE='darwin-arm64-mf-v1'
const MODES=['ROUND','FLOOR','CEILING','TRUNCATE'] as const
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
export const literalFloatToIntNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
  &&Math.abs(value)<=2**24&&(value===0||Math.abs(value)>=2**-126)&&Math.fround(value)===value

export function resolveFloatToIntLiteral(value:unknown,operations:readonly SourceCompositorOperation[],current:SourceCompositorOperation):number|null {
  if(!Array.isArray(operations)||operations.length>2048)return null
  const prefix=new Map<string,Record<string,unknown>>();let found=false
  for(const operation of operations){
    if(operation===current){if(typeof current.id!=='string'||prefix.has(current.id))return null;found=true;break}
    if(!record(operation)||typeof operation.id!=='string'||prefix.has(operation.id))return null
    prefix.set(operation.id,operation)
  }
  if(!found)return null
  let remaining=64
  const resolve=(incoming:unknown,depth=0):number|null=>{
    if(--remaining<0||depth>8||!record(incoming)||incoming.type!=='VALUE')return null
    if(incoming.kind==='constant')return literalFloatToIntNumber(incoming.value)?incoming.value:null
    if(incoming.kind==='convert')return incoming.fromType==='VALUE'?resolve(incoming.input,depth+1):null
    if(incoming.kind==='ref'&&typeof incoming.node==='string'){
      const source=prefix.get(incoming.node)
      return source?.kind==='value'&&source.type==='VALUE'&&record(source.inputs)&&Object.keys(source.inputs).length===0
        &&record(source.source)&&['ShaderNodeValue','CompositorNodeValue'].includes(String(source.source.nodeType))
        &&source.source.output==='Value'&&literalFloatToIntNumber(source.value)?source.value:null
    }
    return null
  }
  return resolve(value)
}

const kernels=Object.fromEntries(MODES.map(mode=>[mode,Fn(([value]:TslEffectNode[])=>{
  const result=int(value).toVar()
  if(mode==='ROUND'){
    const fraction=abs(value.sub(float(result))).toVar()
    If(fraction.greaterThanEqual(.5),()=>{
      If(value.lessThan(0),()=>{result.subAssign(int(1))}).Else(()=>{result.addAssign(int(1))})
    })
  }else if(mode==='FLOOR')If(value.lessThan(float(result)),()=>{result.subAssign(int(1))})
  else if(mode==='CEILING')If(value.greaterThan(float(result)),()=>{result.addAssign(int(1))})
  return result
}).setLayout({name:'scenetowebLiteralFloatToInt'+mode+'V1',type:'int',inputs:[{name:'value',type:'float'}]})]))

export function buildCompositorFloatToInt(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],fail:(message:string)=>never):TslEffectNode {
  const p=op.properties,version=p?.float_to_int_native_version,input=op.inputs?.Float
  if(op.kind!=='float-to-int'||op.type!=='INT'||op.source?.nodeType!=='FunctionNodeFloatToInt'||op.source.output!=='Integer'
    ||!record(p)||p.float_to_int_model!==FLOAT_TO_INT_MODEL||p.float_to_int_input_model!==INPUT_MODEL
    ||p.float_to_int_source_profile!==SOURCE_PROFILE||!Array.isArray(version)||version.length!==3
    ||![0,1,2].every(index=>Object.hasOwn(version,index)&&version[index]===[5,3,0][index])
    ||!MODES.includes(p.rounding_mode as typeof MODES[number])||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
    ||!record(op.inputs)||Object.keys(op.inputs).length!==1||!record(input)||input.socketType!=='VALUE'||!record(input.value)||input.value.type!=='VALUE')
    return fail('Float to Integer requires its verified Blender 5.3 native MF literal schema, source profile and rounding mode')
  const literal=resolveFloatToIntLiteral(input.value as unknown as CompositorValue,operations,op)
  if(literal===null)return fail('Float to Integer requires exact Float32 literal/group constants that are normal or zero with magnitude <= 2^24; fields, images, implicit color/vector conversions and asserted intervals remain unqualified')
  const bytes=new ArrayBuffer(4),view=new DataView(bytes);view.setFloat32(0,literal,true)
  // Use the exact validated word; no deferred read of caller data or implicit scalar conversion.
  return kernels[String(p.rounding_mode)]!(bitcast(uint(view.getUint32(0,true)),'float'))
}
