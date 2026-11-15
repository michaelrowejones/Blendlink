/* SPDX-License-Identifier: MIT */
export const statuses=Object.freeze({source:'CAPTURED_DISPLACE_ADMITTED_SOURCES',final:'EXPORTED_DISPLACE_SAVED_FINAL',baseline:'CAPTURED_DISPLACE_ACTUAL_FINAL_INPUTS',allBaselines:'CAPTURED_ALL_DISPLACE_ACTUAL_INPUTS',native:'CAPTURED_DISPLACE_CPU_SAME_PIXEL_REFERENCES',browser:'PASSED_DISPLACE_ACTUAL_FINAL',qualified:'QUALIFIED_DISPLACE_SINGLE_CPU_FINAL',failed:'FAILED_DISPLACE_DIAGNOSTIC_ZERO_CREDIT'})
export const proofModel='native-displace-single-domain-cpu-53-v1'
export const stages=Object.freeze(['sources','references'])
export const displayContract=Object.freeze({model:'cpu-reciprocal-f32-identity-ocio-audit-v1',rgbAbsoluteLimit:3e-5,alphaExact:true})
export function exactMetric(actual,expected){
 if(actual.length!==expected.length)throw Error('Displace word count mismatch')
 let wordDifferences=0;const examples=[]
 for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i]){wordDifferences++;if(examples.length<8)examples.push({index:i,actual:actual[i],native:expected[i]})}
 return{words:actual.length,wordDifferences,examples}
}
export function displayMetric(actual,expected){
 if(actual.length!==expected.length)throw Error('Displace display word count mismatch')
 const a=new Float32Array(actual.buffer,actual.byteOffset,actual.length),b=new Float32Array(expected.buffer,expected.byteOffset,expected.length)
 let wordDifferences=0,alphaWordDifferences=0,nonfiniteClassDifferences=0,maxClampedAbsoluteError=0
 const category=u=>(u&0x7fffffff)>0x7f800000?'nan':(u&0x7fffffff)===0x7f800000?(u>>>31?'negative-infinity':'positive-infinity'):'finite'
 for(let i=0;i<actual.length;i++){
  if(actual[i]!==expected[i])wordDifferences++
  if(i%4===3){if(actual[i]!==expected[i])alphaWordDifferences++;continue}
  if(category(actual[i])!==category(expected[i]))nonfiniteClassDifferences++
  if(Number.isFinite(a[i])&&Number.isFinite(b[i]))maxClampedAbsoluteError=Math.max(maxClampedAbsoluteError,Math.abs(Math.max(0,Math.min(1,a[i]))-Math.max(0,Math.min(1,b[i]))))
 }
 return{words:actual.length,wordDifferences,alphaWordDifferences,nonfiniteClassDifferences,maxClampedAbsoluteError,projectionContract:'existing-ocio-png-clamp01-3e-5',projectionAccepted:alphaWordDifferences===0&&nonfiniteClassDifferences===0&&maxClampedAbsoluteError<=displayContract.rgbAbsoluteLimit}
}

/** Preserve failing raw words without granting any comparison/support credit. */
export function failurePacket(error,context,frame){
 const failureFrame=frame?{...frame,buffers:frame.buffers.map(({role,words})=>({role,words:Array.from(words)}))}:null
 // Completed frames can contain millions of JS-number words. They have not
 // reached the host archive yet. Keep their measured metrics/digests, without
 // a huge CDP failure payload that can obscure the actual current-frame error.
 const rows=context.rows?.map(({buffers,...row})=>buffers?{...row,unarchivedReadbacks:buffers.map(({role,words})=>{
  const [kind,cycle]=role.split('-'),metric=role==='direct'?row.direct:row.cycles[Number(cycle)][kind]
  return{role,wordCount:words.length,sha256:metric.sha256}
 })}:row)
 return{...context,...(rows?{rows}:{}),status:statuses.failed,error:String(error),stack:typeof error?.stack==='string'?error.stack:null,failureFrame,supportCredit:0}
}
