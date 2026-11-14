/* SPDX-License-Identifier: MIT */
/** Closed research plan. No renderer, SDK or artist-source mutation. */
import{writeFile}from'node:fs/promises'
import{resolve}from'node:path'
const f=Math.fround,storage=new ArrayBuffer(4),view=new DataView(storage)
const word=n=>{view.setFloat32(0,n,true);return view.getUint32(0,true)},value=n=>{view.setUint32(0,n,true);return view.getFloat32(0,true)}
const adjacent=(n,direction)=>{const bits=word(n);return value(bits+(n>0?direction:-direction))}
const points=[['min-negative',-8],['minimum-negative',-(2**-16)],['zero',0],['minimum-positive',2**-16],['max-positive',8]]
const profiles=['SAW','TRI','SIN'],cases=[]
function add(extent,label,scale,phase){
 for(const axis of['X','Y'])for(const profile of profiles){
  if((scale!==0&&(Math.abs(scale)<2**-16||Math.abs(scale)>8))||(phase!==0&&(Math.abs(phase)<2**-16||Math.abs(phase)>8)))throw Error('Plan outside proposed domain '+label)
  cases.push({case:`${extent[0]}x${extent[1]}-${axis}-${profile}-${label}`,width:extent[0],height:extent[1],axis,profile,parameterWords:[word(scale),word(phase),0]})
 }
}
for(const[s,scale]of points)for(const[p,phase]of points)add([13,9],`bounds-${s}-${p}`,scale,phase)
for(const[s,scale]of points)add([9,13],`scale-bound-${s}`,scale,0)
for(const[p,phase]of points.filter(([,phase])=>phase!==0))add([9,13],`phase-bound-${p}`,0,phase)
const centerBase=f(f(f(f(0*5)+f(.000001))*f(.999999))*20)
for(const[label,target]of[['zero',0],['quarter-positive',Math.PI/2],['sine-one-triangle-half',Math.PI],['three-quarter-positive',Math.PI*1.5],['cycle-positive',Math.PI*2],['sine-one-negative',-Math.PI],['cycle-negative',-Math.PI*2]]){
 const phase=f(target-centerBase)
 for(const[side,p]of[['predecessor',adjacent(phase,-1)],['nearest',phase],['successor',adjacent(phase,1)]])add([13,9],`seam-${label}-${side}`,5,p)
}
for(const extent of[[8192,4],[4,8192]])for(const[label,scale,phase]of[['negative-maximum',-8,-8],['positive-maximum',8,8],['negative-minimum',-(2**-16),-(2**-16)],['positive-minimum',2**-16,2**-16]])add(extent,`thin-${label}`,scale,phase)
if(new Set(cases.map(row=>row.case)).size!==cases.length)throw Error('Duplicate plan case')
const plan={schemaVersion:1,role:'Research only; gates declared before capture',sourceBase:'33053dd7',proposedDomain:{scaleAndPhase:{maximumAbsolute:8,minimumNonzeroAbsolute:2**-16,positiveZero:true},coordinates:'Own implicit Uniform',type:'BANDS',axes:['X','Y'],distortionWord:0},gates:{SAW_TRI:'Every raw RGBA word exact',SIN:{absoluteMax:2**-20,finiteUnit:true,nativeZeroOneExact:true},alphaOneAndGrayExact:true},cases}
await writeFile(resolve(process.argv[2]??'experiments/compositor-wave-axis-research/bound-cases.json'),JSON.stringify(plan,null,2)+'\n');console.log('WAVE_AXIS_BOUND_PLAN '+cases.length)
