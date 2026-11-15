/* SPDX-License-Identifier: MIT */
/** Private BLI CPU double-literal Horner fade compensation. Only the admitted
 * default2D compositor's +0/positive finite lattice fractions [0,1) use this.
 * This is not general Float64 arithmetic or the Cycles SIMD/FMA source model.
 * q=F(F(t*t)*t) stays native Float32; residuals approximate the source's
 * unsuffixed-double (6*t-15)*t+10 until the final Float32 product. Rare
 * one-ULP fade differences remain possible; the whole Noise gate is separate. */
import {Fn,bitcast,uint,select} from 'three/tsl'
import type {TslExpression} from './tslNodeRecipe.js'

const cast=bitcast as unknown as(value:TslExpression,type:string)=>TslExpression
const u=uint as unknown as(value:number)=>TslExpression
const choose=select as unknown as(condition:TslExpression,a:TslExpression,b:TslExpression)=>TslExpression

// A nontrivial float/uint dependency prevents contraction of the error terms.
// Every admitted intermediate is finite; canonical NaN cannot be produced.
const round=(value:TslExpression):TslExpression=>{
 const bits=cast(value,'uint').toVar()
 return cast(choose(bits.equal(u(0x7fc00000)),u(0),bits),'float')
}
const high=(value:TslExpression):TslExpression=>cast(cast(value,'uint').bitAnd(u(0xfffff000)),'float').toVar()
const productError=(a:TslExpression,b:TslExpression,product:TslExpression):TslExpression=>{
 const ah=high(a),bh=high(b),al=round(a.sub(ah)),bl=round(b.sub(bh))
 return round(round(round(round(round(ah.mul(bh)).sub(product)).add(round(ah.mul(bl)))).add(round(al.mul(bh)))).add(round(al.mul(bl))))
}
export const compositorCpuBliPerlinFade=Fn(([fraction]:any[])=>{
 const t=fraction as TslExpression,q=round(round(t.mul(t)).mul(t))
 const m=round(t.mul(6)),a=round(m.sub(15))
 const me=round(round(round(t.mul(4)).sub(m)).add(round(t.mul(2))))
 const ae=round(me.add(round(m.sub(round(a.add(15))))))
 const product=round(t.mul(a)),pe=productError(t,a,product)
 const polynomial=round(product.add(10)),se=round(product.sub(round(polynomial.sub(10))))
 const correction=round(round(pe.add(se)).add(round(t.mul(ae))))
 const value=round(q.mul(polynomial)),low=round(round(q.mul(correction)).add(productError(q,polynomial,value)))
 return round(value.add(low)) as any
}).setLayout({name:'blendlinkCompositorCpuBliFadeV2',type:'float',inputs:[{name:'fraction',type:'float'}]}) as unknown as (fraction:TslExpression)=>TslExpression

/** Shared only by the private CPU compositor's explicit arithmetic stages. */
export {round as roundCompositorNoiseF32}
