import type { TslIrExpression } from './tslNodeRecipe.js'
import { evaluateStaticNoiseInput } from './staticNoise4d.js'

export const MF_COORDINATE_MODEL = 'native-mf-f32-coordinates-v1'
type Coordinate = number | readonly number[]
const ordinary = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value)
  && (value===0 || Math.abs(value)>=2**-126) && Math.abs(value)<=2**31

/** Separate node stages only: this does not fold arbitrary shader Math. */
export function evaluateMfNoiseCoordinate(expression:unknown):Coordinate|undefined {
  let count=0
  const visiting=new Set<object>()
  const visit=(value:unknown,depth:number):Coordinate|undefined=>{
    if (!value || typeof value!=='object' || Array.isArray(value) || depth>32 || ++count>256 || visiting.has(value)) return undefined
    const node=value as TslIrExpression
    visiting.add(value)
    try {
      if(node.op==='const_float') return ordinary(node.value) && Math.fround(node.value)===node.value ? node.value : undefined
      if(node.op==='const_vec3') return Array.isArray(node.value) && node.value.length===3 && node.value.every(v=>ordinary(v) && Math.fround(v)===v) ? node.value : undefined
      const child=(key:string):Coordinate|undefined=>visit(node[key],depth+1)
      if(node.op==='combine') {
        const parts=['x','y','z'].map(child)
        return parts.every(ordinary)?parts:undefined
      }
      if(node.op==='separate') {
        const input=child('input'),axis=['x','y','z'].indexOf(String(node.channel))
        return Array.isArray(input) && axis>=0?input[axis]:undefined
      }
      let a:Coordinate|undefined,b:Coordinate|undefined,operation:unknown
      if(node.op==='vector_scale') {
        a=child('input');const scale=child('scale');operation='MULTIPLY'
        if(!Array.isArray(a) || !ordinary(scale))return undefined
        b=[scale,scale,scale]
      } else if(node.op==='math' || node.op==='vector_math') {
        a=child('a');b=child('b');operation=node.operation
        if(!['ADD','SUBTRACT','MULTIPLY'].includes(String(operation)))return undefined
        if(node.op==='math'?!ordinary(a)||!ordinary(b):!Array.isArray(a)||!Array.isArray(b))return undefined
      } else return undefined
      const binary=(left:number,right:number):number|undefined=>{
        const wide=operation==='ADD'?left+right:operation==='SUBTRACT'?left-right:left*right
        return ordinary(wide) && ordinary(Math.fround(wide))?Math.fround(wide):undefined
      }
      if(Array.isArray(a) && Array.isArray(b)) {
        const parts=a.map((v,axis)=>binary(v,b[axis]!))
        return parts.every(ordinary)?parts:undefined
      }
      return ordinary(a)&&ordinary(b)?binary(a,b):undefined
    } finally { visiting.delete(value) }
  }
  const value=visit(expression,0),parts=Array.isArray(value)?value:[value]
  return parts.every(v=>ordinary(v) && Math.abs(v)<=1e6)?value:undefined
}

/** Recompute the retained source, rather than trusting a precision annotation.
 * Only changed input/W literals are allowed; ordinary exact inputs keep v1. */
export function hasValidMfCoordinateSource(expression:TslIrExpression):boolean {
  const evidence=expression.mfCoordinateSource
  if(!evidence || typeof evidence!=='object' || Array.isArray(evidence))return false
  const sources=evidence as Record<string,TslIrExpression>,keys=Object.keys(sources)
  if(keys.length===0 || keys.some(key=>key!=='input' && (key!=='w'||expression.dimensions!==4)))return false
  const words=(value:number)=>new Uint32Array(new Float32Array([value]).buffer)[0]
  return keys.every(key=>{
    const source=sources[key]!,value=evaluateMfNoiseCoordinate(source)
    if(value===undefined || evaluateStaticNoiseInput(source,{exactArithmetic:true})!==undefined)return false
    const scalar=expression.dimensions===1 || key==='w',literal=expression[key] as TslIrExpression|undefined
    if(!literal || literal.op!==(scalar?'const_float':'const_vec3'))return false
    if(scalar)return typeof value==='number' && ordinary(literal.value) && Math.fround(literal.value)===literal.value && words(value)===words(literal.value)
    return Array.isArray(value) && Array.isArray(literal.value) && literal.value.length===3 && literal.value.every((v,axis)=>ordinary(v) && Math.fround(v)===v && words(v)===words(value[axis]!))
  })
}
