import assert from 'node:assert/strict'
export const browserProofContract=Object.freeze({schemaVersion:1,family:'pixel-int2',nativeStatus:'native-pixel-int2-qualified',finalStatus:'published-pixel-candidate',browserStatus:'PASSED_PIXEL_BUILT_PROOF'})
export const savedFinalCaseCount=16
export const pixelCastRoutes=['scalar','integer','boolean'].flatMap(kind=>['','-reroute','-group'].map(suffix=>kind+suffix))
export const pixelFinalRoutes=['rgba','group','scalar','integer','boolean','scalar-group','integer-group','boolean-group']
export function expectedPixelCases(device){return [[13,9,1],[26,18,2],[19,11,1],[38,22,2],[9,13,1],[18,26,2]].flatMap(([width,height,pixelRatio])=>['rgba','vector3','reroute','group',...pixelCastRoutes].map(route=>({case:`blender-5-3-${device.toLowerCase()}-${width}x${height}-${route}`,width,height,pixelRatio,route})))}
export function assertPixelQualification(value){
 assert.equal(value.status,browserProofContract.nativeStatus);assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.cases.length,78)
 const expected=expectedPixelCases(value.device)
 for(const row of value.cases){const wanted=expected.find(candidate=>candidate.case===row.case);assert.ok(wanted);for(const key of ['width','height','pixelRatio','route'])assert.equal(row[key],wanted[key]);for(const key of ['programSha256','pixelSha256','inputSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}
 assert.equal(new Set(value.cases.map(row=>row.case)).size,78);assert.deepEqual(value.cases.filter(row=>row.sourceFile).map(row=>row.case).sort(),expected.filter(row=>[13,26].includes(row.width)&&pixelFinalRoutes.includes(row.route)).map(row=>row.case).sort());return value
}
export function assertPixelFinal(value,native,{built,nativeSha256}){
 assert.equal(built,true);assert.equal(value.status,browserProofContract.finalStatus);assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true)
 assert.deepEqual(value.rows.map(row=>row.case).sort(),native.cases.filter(row=>row.sourceFile).map(row=>row.case).sort());return value
}
