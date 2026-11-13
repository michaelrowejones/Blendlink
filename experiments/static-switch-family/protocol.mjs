import assert from 'node:assert/strict'
// Version 1 shares the frozen report vocabulary between this family's runner and reader.
export const browserProofContract=Object.freeze({schemaVersion:1,family:'static-selection',nativeStatus:'CAPTURED_STATIC_SELECTION',finalStatus:'PUBLISHED_STATIC_SELECTION',browserStatus:'PASSED_STATIC_SELECTION_BUILT_PROOF'})
export const expectedCases=['calibration',...['switch','index','menu'].flatMap(f=>['float','int','boolean','vector','rgba'].flatMap(m=>[0,1].map(c=>`${f}-${m}-${c}`))),...['switch','index','menu'].flatMap(f=>['field','inactive','group'].flatMap(k=>[0,1].map(c=>`${f}-${k}-${c}`))),...['switch','index'].flatMap(f=>[0,1].map(c=>`${f}-typed-${c}`)),...[0,1].flatMap(c=>[1,2].map(o=>`menu-mask-${c}-${o}`)),...['not','xor','or','imply'].map(o=>'switch-bool-'+o),...['index','menu'].flatMap(f=>['three-items','reordered'].map(k=>`${f}-${k}`)),...['direct','reroute','group'].flatMap(r=>[0,1].map(c=>`menu-source-${r}-${c}`))]
export function assertQualification(q){
 assert.equal(q.status,browserProofContract.nativeStatus);assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.ok(['shader','CPU','GPU'].includes(q.context));assert.equal(q.sourcePreserved,true);assert.equal(q.width,8);assert.equal(q.height,8)
 assert.deepEqual(q.cases.map(x=>x.case).sort(),[...expectedCases].sort());assert.equal(q.cases.filter(x=>x.sourceFile).length,30)
 for(const row of q.cases){assert.equal(row.sourcePreserved,true);assert.equal(row.context,q.context);for(const key of ['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}return q
}
export function assertFinal(f,q,pin){assert.equal(f.status,browserProofContract.finalStatus);assert.equal(f.context,q.context);assert.equal(f.sourcePreserved,true);assert.equal(f.nativeQualificationSha256,pin);assert.deepEqual(f.rows.map(x=>x.case).sort(),q.cases.filter(x=>x.sourceFile).map(x=>x.case).sort());return f}
export function assertBrowserReport(r,q,f,{profile,final}){
 assert.equal(r.status,browserProofContract.browserStatus);assert.equal(r.built,true);assert.equal(r.final,final);assert.equal(r.profile,profile);assert.equal(r.sourceContext,q.context);assert.deepEqual(r.rows.map(x=>x.backend).sort(),['webgl2','webgpu']);assert.equal(r.missingAdapterControl.refused,true);assert.match(r.missingAdapterControl.error,/actual WebGPU adapter/)
 const expected=(final?f.rows:q.cases).map(x=>x.case)
 for(const api of r.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
 assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.errors,[]);assert.deepEqual(api.rows.map(x=>x.case),expected)
 for(const row of api.rows){assert.equal(row.wordMismatches,0);assert.equal(row.remainingTextures,0);assert.equal(row.finalBindings,final);assert.equal(row.ownershipPreserved,true);assert.equal(row.pinRejected,final?true:null)}}return r
}
