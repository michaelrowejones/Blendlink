/* SPDX-License-Identifier: MIT */
// Synthetic schema canaries only. Not native or numerical evidence.
import {cases,nativeFrames,statuses,expectedFinalProvenance} from './protocol.mjs'
export const displaceSourceInputsFixture=()=>({'packages/blendlink/blender/compositor_displace.py':'a'.repeat(64),'packages/blender-addon/manifest.json':'b'.repeat(64)})
export function displaceSourcesFixture(){return{status:statuses.source,version:[5,3,0],build:'02f0899d78e3',nativeRenders:0,gpuInitializations:0,rows:cases.map(row=>({...structuredClone(row),sourceFile:row.case+'.blend',sourceSha256:'a'.repeat(64),programFile:row.case+'.program.json',programSha256:'a'.repeat(64)}))}}
export function displaceFinalFixture(sources=displaceSourcesFixture(),inputs=displaceSourceInputsFixture()){return{status:statuses.final,sourcePreserved:true,provenance:expectedFinalProvenance(inputs),rows:sources.rows.map((row,index)=>({...row,...Object.fromEntries(['manifest','glb','presentation','module'].flatMap(role=>[[role+'Path','/owned/'+row.case+'.'+role],[role+'Sha256','a'.repeat(64)]])),moduleExport:'displace'+index}))}}
export function displaceNativeFixture(){
 const pin='a'.repeat(64),rows=nativeFrames().map(frame=>({...frame,...Object.fromEntries(['baseline','copy','linear','display'].flatMap(role=>[[role+'File',role==='baseline'?'frames/'+frame.id+'.rgba32f':'native/'+frame.id+'.'+role+'.rgba32f'],[role+'Sha256',pin]])),words:frame.width*frame.height*4,copyDifferences:0,sourceExtractionStatus:cases.find(c=>c.case===frame.case).source==='render-layer'?'unsupported':'extracted'}))
 return{status:statuses.native,version:[5,3,0],build:'02f0899d78e3',rows,nativeRenders:320,sourcePreserved:true,rawDisplayAudit:{model:'cpu-reciprocal-f32-identity-ocio-audit-v1',ocioProcessorIsNoOp:true,primarySourcesSha256:pin,configPath:'/owned/config.ocio',configSha256:pin},gpuInitializations:0,sourceImageProducerCredit:0}
}
