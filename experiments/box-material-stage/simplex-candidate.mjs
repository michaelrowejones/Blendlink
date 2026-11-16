// SPDX-License-Identifier: MIT
// Independent inset-simplex / edge-transition construction. The derivation is
// recorded with the CPU model; this does not transcribe a Blender kernel.
import{Fn,If,abs,clamp,float,min,texture,vec2,vec3}from'three/tsl'
export const boxWeights=Fn(([normal,blend])=>{
 const magnitude=abs(normal),q=magnitude.div(magnitude.x.add(magnitude.y).add(magnitude.z)).toVar()
 const inset=float(1).sub(blend).div(float(3).sub(blend))
 const smallest=min(q.x,min(q.y,q.z)),weights=vec3(0).toVar()
 const edge=(first,second)=>clamp(float(.5).add(first.div(first.add(second)).sub(.5).div(blend)),0,1)
 If(smallest.greaterThanEqual(inset),()=>{weights.assign(q.sub(inset).div(float(1).sub(inset.mul(3))))})
 .ElseIf(q.x.equal(smallest),()=>{const w=edge(q.y,q.z).toVar();weights.assign(vec3(0,w,float(1).sub(w)))})
 .ElseIf(q.y.equal(smallest),()=>{const w=edge(q.x,q.z).toVar();weights.assign(vec3(w,0,float(1).sub(w)))})
 .Else(()=>{const w=edge(q.x,q.y).toVar();weights.assign(vec3(w,float(1).sub(w),0))})
 return weights
})
export function boxSample(map,p,n,blend){
 const weights=boxWeights(n,blend).toVar()
 const chartCoordinates=[vec2(n.x.lessThan(0).select(float(1).sub(p.y),p.y),p.z),vec2(n.y.greaterThan(0).select(float(1).sub(p.x),p.x),p.z),vec2(n.z.greaterThan(0).select(float(1).sub(p.y),p.y),p.x)]
 const samples=chartCoordinates.map(uv=>texture(map,uv))
 return samples[0].mul(weights.x).add(samples[1].mul(weights.y)).add(samples[2].mul(weights.z))
}
