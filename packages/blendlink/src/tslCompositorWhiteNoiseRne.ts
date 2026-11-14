/* SPDX-License-Identifier: MIT */
/** CPU Float32 uint normalization. Old EEVEE/shader normalization is unchanged.
 * Integer ties-to-even construction independently checked over all2^32 inputs;
 * avoids backend-permitted wide uint-to-float rounding differences. */
import * as TSL from 'three/tsl'
const {bitcast,countLeadingZeros,float,Fn,select,uint,vec3}=TSL as unknown as Record<string,(...args:any[])=>TslEffectNode>
import {compositorHashUint2,compositorHashUint3,compositorHashUint4} from './tslNodeRecipe.js'
import type {TslEffectNode} from './tslPostEffects.js'
export const compositorCpuUintRne=Fn(([value]:TslEffectNode[])=>{
 const shift=select(value.lessThan(uint(0x1000000)),uint(0),uint(8).sub(countLeadingZeros(value))).toVar()
 const mantissa=value.shiftRight(shift).toVar(),remainder=value.bitAnd(uint(1).shiftLeft(shift).sub(uint(1))).toVar()
 const nonzeroShift=select(shift.equal(uint(0)),uint(1),shift)
 const half=uint(1).shiftLeft(nonzeroShift.sub(uint(1))).toVar()
 const round=remainder.greaterThan(half).or(remainder.equal(half).and(mantissa.bitAnd(uint(1)).notEqual(uint(0))))
 const exact=mantissa.add(select(round,uint(1),uint(0)))
 return float(exact).mul(bitcast(uint(95).add(shift).shiftLeft(uint(23)),'float'))
}).setLayout({name:'scenetowebCpuU32UnitRneV1',type:'float',inputs:[{name:'value',type:'uint'}]})

export function compositorCpuFieldWhiteNoise(dimensions:number,vector:TslEffectNode,w:TslEffectNode,color:boolean):TslEffectNode{
 const x=bitcast(vector.x,'uint'),y=bitcast(vector.y,'uint'),z=bitcast(vector.z,'uint'),t=bitcast(w,'uint')
 const one=uint(0x3f800000),two=uint(0x40000000)
 const u2=(a:TslEffectNode,b:TslEffectNode)=>compositorCpuUintRne(compositorHashUint2(a,b))
 const u3=(a:TslEffectNode,b:TslEffectNode,c:TslEffectNode)=>compositorCpuUintRne(compositorHashUint3(a,b,c))
 const u4=(a:TslEffectNode,b:TslEffectNode,c:TslEffectNode,d:TslEffectNode)=>compositorCpuUintRne(compositorHashUint4(a,b,c,d))
 if(dimensions===2)return color?vec3(u2(x,y),u3(x,y,one),u3(x,y,two)):u2(x,y)
 if(dimensions===3)return color?vec3(u3(x,y,z),u4(x,y,z,one),u4(x,y,z,two)):u3(x,y,z)
 if(dimensions===4)return color?vec3(u4(x,y,z,t),u4(z,x,t,y),u4(t,z,y,x)):u4(x,y,z,t)
 throw Error('White Noise field requires dimensions2..4')
}
