import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
export const variant=process.env.SCENETOWEB_SWITCH_VARIANT??'static'
assert.ok(['static','mono-view'].includes(variant),'Unknown static selection proof variant')
export const contexts=variant==='mono-view'?['CPU']:['shader','CPU','GPU']
export const expectedSavedFinalCount=variant==='mono-view'?8:30
// Version 1 shares the frozen report vocabulary between this family's runner and reader.
export const browserProofContract=Object.freeze({schemaVersion:1,family:'static-selection',nativeStatus:'CAPTURED_STATIC_SELECTION',finalStatus:'PUBLISHED_STATIC_SELECTION',browserStatus:'PASSED_STATIC_SELECTION_BUILT_PROOF'})
const legacyExpectedCases=['calibration',...['switch','index','menu'].flatMap(f=>['float','int','boolean','vector','rgba'].flatMap(m=>[0,1].map(c=>`${f}-${m}-${c}`))),...['switch','index','menu'].flatMap(f=>['field','inactive','group'].flatMap(k=>[0,1].map(c=>`${f}-${k}-${c}`))),...['switch','index'].flatMap(f=>[0,1].map(c=>`${f}-typed-${c}`)),...[0,1].flatMap(c=>[1,2].map(o=>`menu-mask-${c}-${o}`)),...['not','xor','or','imply'].map(o=>'switch-bool-'+o),...['index','menu'].flatMap(f=>['three-items','reordered'].map(k=>`${f}-${k}`)),...['direct','reroute','group'].flatMap(r=>[0,1].map(c=>`menu-source-${r}-${c}`))]
export const viewCases=JSON.parse(readFileSync(new URL('./view-cases.json',import.meta.url)))
export const expectedCases=variant==='mono-view'?viewCases.map(row=>row.case):legacyExpectedCases
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.ok(contexts.includes(q.context));assert.equal(q.sourcePreserved,true);assert.equal(q.width,8);assert.equal(q.height,8)
 if(variant==='mono-view')assert.deepEqual(q.nativeBackend,{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false})
 assert.deepEqual(q.cases.map(x=>x.case).sort(),[...expectedCases].sort());assert.equal(q.cases.filter(x=>x.sourceFile).length,expectedSavedFinalCount)
 for(const row of q.cases){if(variant==='mono-view'){const spec=viewCases.find(x=>x.case===row.case);for(const[k,v]of Object.entries(spec))assert.deepEqual(row[k],v)}assert.equal(row.sourcePreserved,true);assert.equal(row.context,q.context);for(const key of ['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}return q
}
export function assertFinal(f,q,pin){assert.equal(f.status,browserProofContract.finalStatus);assert.equal(f.context,q.context);assert.equal(f.sourcePreserved,true);assert.equal(f.nativeQualificationSha256,pin);assert.deepEqual(f.rows.map(x=>x.case).sort(),q.cases.filter(x=>x.sourceFile).map(x=>x.case).sort());return f}
export function assertBrowserReport(r,q,f,{profile,final}){
 assert.equal(r.status,browserProofContract.browserStatus);assert.equal(r.built,true);assert.equal(r.final,final);assert.equal(r.profile,profile);assert.equal(r.sourceContext,q.context);assert.deepEqual(r.rows.map(x=>x.backend).sort(),['webgl2','webgpu']);assert.equal(r.missingAdapterControl.refused,true);assert.match(r.missingAdapterControl.error,/actual WebGPU adapter/)
 const expected=(final?f.rows:q.cases).map(x=>x.case)
 for(const api of r.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
 assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.errors,[]);assert.deepEqual(api.rows.map(x=>x.case),expected)
 for(const row of api.rows){if(variant==='mono-view'){assert.equal(row.comparedWords,256);assert.equal(row.lifecycleCycles,final?2:1)}assert.equal(row.wordMismatches,0);assert.equal(row.remainingTextures,0);assert.equal(row.finalBindings,final);assert.equal(row.ownershipPreserved,true);assert.equal(row.pinRejected,final?true:null)}}return r
}

export function assertMonoProgram(program,entry){
 if(variant!=='mono-view')return
 assert.equal(program.status,'extracted')
 if(entry.kind==='control')return
 assert.equal(program.compileTimeViews?.length,1)
 const view=program.compileTimeViews[0]
 assert.equal(view.model,'native-mono-switch-view-cpu-53-v1');assert.deepEqual(view.nativeVersion,[5,3,0]);assert.equal(view.nativeBuild,'02f0899d78e3');assert.equal(view.sourceContext,'current-mono-CPU');assert.equal(view.selectionKind,'actual-native-input0');assert.equal(view.preservesSelectedDomain,true)
 assert.equal(view.selectedInput,entry.kind==='view-disabled'?'right':entry.kind==='view-renamed'?'Artist right':'left');assert.equal(view.inputIdentifiers[0],view.selectedInput)
 assert.ok(program.ops.every(op=>!['CompositorNodeSwitchView','CompositorNodeSceneTime'].includes(op.source.nodeType)))
 if(entry.kind==='view-image'){assert.deepEqual(program.ops.map(op=>op.kind),['image-input']);assert.equal(program.output.kind,'ref')}
 if(entry.kind==='view-domain')assert.deepEqual(program.ops.map(op=>op.kind).sort(),['image-info','render-pass'])
}
