/* SPDX-License-Identifier: MIT */
// Experiment-only CPU-MF normalization. Original shader normalization is unchanged.
import {bitcast,countLeadingZeros,float,Fn,select,uint,vec3} from 'three/tsl'
import {compositorHashUint1,compositorHashUint2,hashUint3,hashUint4} from '@experimental-hash'

export const cpuRneUnit=Fn(([value])=>{
 const shift=select(value.lessThan(uint(0x1000000)),uint(0),uint(8).sub(countLeadingZeros(value))).toVar()
 const mantissa=value.shiftRight(shift).toVar(),remainder=value.bitAnd(uint(1).shiftLeft(shift).sub(uint(1))).toVar()
 // shift0 has remainder0; use a legal half shift and carry stays0.
 const nonzeroShift=select(shift.equal(uint(0)),uint(1),shift)
 const half=uint(1).shiftLeft(nonzeroShift.sub(uint(1))).toVar()
 const round=remainder.greaterThan(half).or(remainder.equal(half).and(mantissa.bitAnd(uint(1)).notEqual(uint(0))))
 const exact=mantissa.add(select(round,uint(1),uint(0)))
 // exact <=2^24, including the UINT_MAX carry, so this cast is exact.
 const scale=bitcast(uint(95).add(shift).shiftLeft(uint(23)),'float')
 return float(exact).mul(scale)
}).setLayout({name:'researchCpuU32UnitRneV1',type:'float',inputs:[{name:'value',type:'uint'}]})

/** Existing integer hash bodies are AST-exported unchanged from a pinned snapshot. */
export function experimentalCpuWhiteNoiseHash(dimensions,vector,w,color){
 const x=bitcast(vector.x,'uint'),y=bitcast(vector.y,'uint'),z=bitcast(vector.z,'uint'),t=bitcast(w,'uint')
 const one=uint(0x3f800000),two=uint(0x40000000),u1=a=>cpuRneUnit(compositorHashUint1(a)),u2=(a,b)=>cpuRneUnit(compositorHashUint2(a,b)),u3=(a,b,c)=>cpuRneUnit(hashUint3(a,b,c)),u4=(a,b,c,d)=>cpuRneUnit(hashUint4(a,b,c,d))
 if(dimensions===1)return color?vec3(u1(t),u2(t,one),u2(t,two)):u1(t)
 if(dimensions===2)return color?vec3(u2(x,y),u3(x,y,one),u3(x,y,two)):u2(x,y)
 if(dimensions===3)return color?vec3(u3(x,y,z),u4(x,y,z,one),u4(x,y,z,two)):u3(x,y,z)
 if(dimensions===4)return color?vec3(u4(x,y,z,t),u4(z,x,t,y),u4(t,z,y,x)):u4(x,y,z,t)
 throw Error('Experimental CPU White Noise requires dimensions1..4')
}
