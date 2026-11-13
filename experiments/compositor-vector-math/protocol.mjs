import assert from 'node:assert/strict'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'compositor-vector-math',nativeStatus:'native-vector-math-qualified',finalStatus:'published-vector-math-candidate',browserStatus:'PASSED_VECTOR_MATH_BUILT_PROOF'})
export const modes=['ADD','SUBTRACT','MULTIPLY','MULTIPLY_ADD','DIVIDE','SCALE','CROSS_PRODUCT','DOT_PRODUCT','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
export const simpleModes=['ADD','SUBTRACT','MULTIPLY','SCALE','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
export const routes=['direct','reroute','combine','group']
export const expectedCases=()=>[...modes.flatMap(mode=>Array.from({length:8},(_,i)=>mode.toLowerCase()+'-'+i)),...routes.map(route=>'add-'+route),...simpleModes.flatMap(mode=>Array.from({length:6},(_,i)=>mode.toLowerCase()+'-wide-'+i))].sort()
export const expectedFinalCases=()=>[...modes.map(mode=>mode.toLowerCase()+'-0'),...routes.map(route=>'add-'+route),...simpleModes.map(mode=>mode.toLowerCase()+'-wide-0')].sort()
export const browserRefusals=['model','version','source-profile','evaluator','native-backend','mode','schema','non-f32-word','provenance','input-schema','normal-magnitude','compound-grid','unsafe-signed-zero']
export const expectedRefusals=['unqualified-mode','compound-off-grid','out-of-range','below-normal-contract','image-field','computed-vector','negative-zero','unsafe-product-zero','non-dyadic-divisor','unsafe-ceil-zero','animated-input']
export function assertVectorMathQualification(value){
 assert.equal(value.status,browserProofContract.nativeStatus);assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.width,8);assert.equal(value.height,8)
 assert.deepEqual(value.cases.map(row=>row.case).sort(),expectedCases());assert.equal(new Set(value.cases.map(row=>row.case)).size,expectedCases().length)
 assert.deepEqual(value.cases.filter(row=>row.sourceFile).map(row=>row.case).sort(),expectedFinalCases())
 for(const row of value.cases){assert.equal(row.mode,row.case.startsWith('add-')?'ADD':modes.find(mode=>row.case.startsWith(mode.toLowerCase()+'-')));assert.equal(row.route,routes.find(route=>row.case==='add-'+route)??'default');for(const key of ['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/);if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');assert.match(row.sourceSha256,/^[a-f0-9]{64}$/)}}
 assert.deepEqual(value.refusals.map(row=>row.kind).sort(),expectedRefusals.slice().sort());for(const row of value.refusals){assert.ok(row.diagnostics.length>0);assert.ok(row.diagnostics.some(item=>item.code===(row.kind==='animated-input'?'animated-tree':'unsupported-vector-math')))}
 return value
}
export function assertVectorMathFinal(value,native,{built,nativeSha256}){
 assert.equal(built,true);assert.equal(value.status,browserProofContract.finalStatus);assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true);assert.deepEqual(value.rows.map(row=>row.case).sort(),native.cases.filter(row=>row.sourceFile).map(row=>row.case).sort());return value
}
