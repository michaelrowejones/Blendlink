/* SPDX-License-Identifier: MIT */
/** Modern compositor texture contracts; EEVEE shader defaults are not inferred. */
import * as TSL from 'three/tsl'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const {Fn,abs,clamp,float,floor,max,select,vec4}=TSL as unknown as Record<
  'Fn'|'abs'|'clamp'|'float'|'floor'|'max'|'select'|'vec4',(...args:any[])=>TslEffectNode>
const MODEL='native-compositor-texture-v1',PROFILE='darwin-arm64-compositor-texture-v1'
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)
export const textureFiniteWord=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0)
  &&Math.abs(value)<=2**16&&(value===0||Math.abs(value)>=2**-125)&&Math.fround(value)===value

export function resolveTextureLiteral(ref:unknown,operations:readonly SourceCompositorOperation[],current:SourceCompositorOperation,wanted:string):number|number[]|null {
  if(operations.length>2048)return null
  const prefix=new Map<string,SourceCompositorOperation>();let found=false,budget=64
  for(const op of operations){if(op===current){found=!prefix.has(current.id);break}if(typeof op.id!=='string'||prefix.has(op.id))return null;prefix.set(op.id,op)}
  if(!found)return null
  const resolve=(value:unknown,type:string,depth=0):number|number[]|null=>{
    if(--budget<0||depth>8||!record(value)||value.type!==type)return null
    let raw:unknown
    if(value.kind==='constant')raw=value.value
    else if(value.kind==='ref'&&typeof value.node==='string'){
      const source=prefix.get(value.node)
      if(!source)return null
      if(['value','rgb'].includes(source.kind)&&source.type===type&&Object.keys(source.inputs).length===0
        &&({VECTOR:['FunctionNodeInputVector'],VALUE:['ShaderNodeValue','CompositorNodeValue'],RGBA:['CompositorNodeRGB']} as Record<string,string[]>)[type]?.includes(source.source.nodeType)
        &&source.source.output===({VECTOR:'Vector',VALUE:'Value',RGBA:'Color'} as Record<string,string>)[type])raw=source.value
      else if(type==='VECTOR'&&source.kind==='combine-vector'&&source.source.nodeType==='ShaderNodeCombineXYZ'){
        const parts='XYZ'.split('').map(axis=>resolve(source.inputs[axis]?.value,'VALUE',depth+1))
        return parts.every(part=>typeof part==='number')?parts as number[]:null
      }else return null
    }else return null
    if(type==='VALUE')return textureFiniteWord(raw)?raw:null
    const count=type==='VECTOR'?3:type==='RGBA'?4:0
    return Array.isArray(raw)&&raw.length===count&&raw.every(textureFiniteWord)?raw as number[]:null
  }
  return resolve(ref,wanted)
}

const gradientKernels=Object.fromEntries(['LINEAR','QUADRATIC','EASING','DIAGONAL'].map(mode=>[mode,Fn(([p]:TslEffectNode[])=>{
  if(mode==='LINEAR')return clamp(p.x,0,1)
  if(mode==='QUADRATIC'){const r=max(p.x,0).toVar();return clamp(r.mul(r),0,1)}
  if(mode==='DIAGONAL')return clamp(p.x.add(p.y).mul(.5),0,1)
  const r=clamp(p.x,0,1).toVar(),t=r.mul(r).toVar()
  return t.mul(3).sub(t.mul(2).mul(r))
}).setLayout({name:'scenetowebCompositorGradient'+mode+'V1',type:'float',inputs:[{name:'p',type:'vec3'}]})]))
const checkerKernel=Fn(([vector,scale]:TslEffectNode[])=>{
  const p=vector.mul(scale).add(Math.fround(.000001)).mul(Math.fround(.999999)).toVar()
  const parity=(v:TslEffectNode)=>{const n=abs(floor(v)).toVar();return n.sub(floor(n.mul(.5)).mul(2))}
  const xy=select(parity(p.x).equal(parity(p.y)),float(1),float(0))
  return select(xy.equal(parity(p.z)),float(1),float(0))
}).setLayout({name:'scenetowebCompositorCheckerV1',type:'float',inputs:[{name:'vector',type:'vec3'},{name:'scale',type:'float'}]})

export function buildCompositorProceduralTexture(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],input:(name:string)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode {
  const p=op.properties,v=p?.procedural_texture_version,vector=op.inputs?.Vector
  const gradient=op.kind==='gradient-texture',checker=op.kind==='checker-texture'
  if((!gradient&&!checker)||p?.procedural_texture_model!==MODEL||p.procedural_texture_profile!==PROFILE
    ||!Array.isArray(v)||v.length!==3||![5,3,0].every((n,i)=>Object.hasOwn(v,i)&&v[i]===n)
    ||p.texture_mapping_model!=='identity-v1'||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
    ||op.source.nodeType!==(gradient?'ShaderNodeTexGradient':'ShaderNodeTexChecker')||!['Color','Fac'].includes(op.source.output)
    ||op.type!==(op.source.output==='Color'?'RGBA':'VALUE')||vector?.socketType!=='VECTOR'||vector.value?.type!=='VECTOR')
    return fail('Procedural Texture requires its measured Blender 5.3 compositor source, typed schema and identity mapping model')
  const literal=resolveTextureLiteral(vector.value,operations,op,'VECTOR')
  let factor:TslEffectNode
  if(gradient){
    const mode=String(p.gradient_type)
    if(!Object.hasOwn(gradientKernels,mode)||Object.keys(op.inputs).length!==1)
      return fail('Procedural Texture Gradient mode or input schema has no qualified kernel')
    if(!Array.isArray(literal))
      return fail('Procedural Texture Gradient requires bounded literal/Value/group vectors; general fields need a separate signed-zero/subnormal contract')
    if(mode!=='LINEAR'&&(literal as number[]).some(x=>!Number.isInteger(x*16)))
      return fail('Procedural Texture nonlinear/diagonal Gradient requires exact sixteenth-grid literal coordinates')
    if(literal===null&&vector.value.kind==='constant')
      return fail('Procedural Texture literal Vector must contain bounded finite exact Float32 words')
    factor=gradientKernels[mode]!(input('Vector'))
  }else{
    const scale=op.inputs.Scale,number=resolveTextureLiteral(scale?.value,operations,op,'VALUE')
    const names=op.source.output==='Color'?['Vector','Scale','Color1','Color2']:['Vector','Scale']
    if(Object.keys(op.inputs).length!==names.length||!names.every(name=>Object.hasOwn(op.inputs,name))
      ||!Array.isArray(literal)||literal.some(x=>Math.abs(x)>16||!Number.isInteger(x*16))
      ||scale?.socketType!=='VALUE'||typeof number!=='number'||!Number.isInteger(number)||number<0||number>256)
      return fail('Procedural Texture Checker requires sixteenth-grid literal vectors within +/-16 and fixed integer Scale 0..256')
    if(op.source.output==='Color')for(const name of ['Color1','Color2']){
      if(op.inputs[name]?.socketType!=='RGBA'||!Array.isArray(resolveTextureLiteral(op.inputs[name]?.value,operations,op,'RGBA')))
        return fail('Procedural Texture Checker Color inputs require finite bounded exact Float32 literal/group colors')
    }
    factor=checkerKernel(input('Vector'),input('Scale'))
    if(op.source.output==='Color')return select(factor.equal(1),input('Color1'),input('Color2'))
  }
  return op.source.output==='Color'?vec4(factor,factor,factor,1):factor
}
