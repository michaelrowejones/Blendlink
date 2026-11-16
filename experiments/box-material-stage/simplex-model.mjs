// SPDX-License-Identifier: MIT
// Independent geometric construction: shrink the positive unit simplex until
// each vertex represents one projection chart. Outside its inset triangle,
// project onto the remaining edge and use a centered transition of width b.
// No native implementation, coefficients fitted to answers, or captured pixels.
const f=Math.fround,add=(a,b)=>f(a+b),sub=(a,b)=>f(a-b),mul=(a,b)=>f(a*b),div=(a,b)=>f(a/b)
export function simplexWeights(normal,blend){
 if(normal.length!==3||!normal.every(Number.isFinite)||!Number.isFinite(blend)||blend<=0||blend>1)throw Error('Finite nonzero normal and blend (0,1] required')
 const a=normal.map(x=>f(Math.abs(x))),total=add(add(a[0],a[1]),a[2]);if(!total)throw Error('Zero normal')
 const q=a.map(x=>div(x,total)),inset=div(sub(1,blend),sub(3,blend))
 const smallest=q.indexOf(Math.min(...q));
 if(q[smallest]>=inset){const extent=sub(1,mul(3,inset));return q.map(x=>div(sub(x,inset),extent))}
 const pair=[0,1,2].filter(i=>i!==smallest),ratio=div(q[pair[0]],add(q[pair[0]],q[pair[1]])),w=Math.max(0,Math.min(1,add(.5,div(sub(ratio,.5),blend))));const result=[0,0,0];result[pair[0]]=w;result[pair[1]]=sub(1,w);return result
}
