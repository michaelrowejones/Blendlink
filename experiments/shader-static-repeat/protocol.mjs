import assert from'node:assert/strict'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'static-repeat',nativeStatus:'CAPTURED_STATIC_REPEAT',finalStatus:'PUBLISHED_STATIC_REPEAT',browserStatus:'PASSED_STATIC_REPEAT_BUILT_PROOF'})
export const counts=[0,1,2,7,32,64]
export const browserRefusals=['model','version','source-profile','iteration-bound','state-bound','cross-state','unrounded-seed','scalar-field','vector-field','texture-body','cancelled']
export const policyRefusals=['iterations','float-count','body','animation','cycle','scalar-field','vector-field','group-vector-field']
export function expectedCases(){const rows=[{case:'calibration',kind:'control',iterations:0,component:0,state:0,saved:true}]
 for(const kind of['scalar-step','counter','vector-step'])for(const n of counts)for(const component of(kind.startsWith('vector')?[0,1,2]:[0]))rows.push({case:kind+'-'+n+'-'+component,kind,iterations:n,component,state:0,saved:[7,64].includes(n)&&component===0})
 for(const n of[2,64])for(const[state,type]of['FLOAT','VECTOR','FLOAT','VECTOR'].entries())for(const component of(type==='VECTOR'?[0,1,2]:[0]))rows.push({case:'multi-'+n+'-'+state+'-'+component,kind:'multi',iterations:n,state,component,saved:n===64&&(state===0&&component===0||state===3&&component===1)})
 for(const kind of['scalar-step'])rows.push({case:'group-'+kind,kind,iterations:7,state:0,component:0,group:true,saved:true})
 rows.push({case:'inactive-zero',kind:'scalar-step',iterations:0,state:0,component:0,inactive:true,saved:true});return rows}
export const expectedFinalCases=()=>expectedCases().filter(row=>row.saved)
export function assertQualification(q){assert.equal(q.status,browserProofContract.nativeStatus);assert.equal(q.context,'shader');assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.sourcePreserved,true);assert.equal(q.width,8);assert.equal(q.height,8);const expected=expectedCases();assert.deepEqual(q.cases.map(r=>r.case),expected.map(r=>r.case));assert.equal(new Set(q.cases.map(r=>r.case)).size,expected.length)
 for(const[row,i]of q.cases.map((r,i)=>[r,i])){for(const key of['kind','iterations','state','component'])assert.equal(row[key],expected[i][key]);for(const key of['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/);assert.equal(!!row.sourceFile,expected[i].saved);if(row.sourceFile)assert.match(row.sourceSha256,/^[a-f0-9]{64}$/)}return q}
export function assertFinal(f,q,sha){assert.equal(f.status,browserProofContract.finalStatus);assert.equal(f.context,'shader');assert.equal(f.sourcePreserved,true);assert.equal(f.nativeQualificationSha256,sha);assert.deepEqual(f.rows.map(r=>r.case),expectedFinalCases().map(r=>r.case));return f}
