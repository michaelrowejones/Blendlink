import assert from 'node:assert/strict'
export const sizes=[[13,9,1],[26,18,2],[9,13,1],[18,26,2],[19,11,1],[38,22,2]]
export function assertFloatCoordinateQualification(value){
 assert.equal(value.status,'native-float-coordinate-qualified');assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.cases.length,48)
 const expected=sizes.flatMap(([width,height,pixelRatio])=>['Uniform','Normalized'].flatMap(coordinateOutput=>['rgba','vector3','reroute','group'].map(route=>({case:`blender-5-3-${value.device.toLowerCase()}-${width}x${height}-${coordinateOutput.toLowerCase()}-${route}`,width,height,pixelRatio,route,coordinateOutput}))))
 for(const row of value.cases){const wanted=expected.find(candidate=>candidate.case===row.case);assert.ok(wanted);for(const key of ['width','height','pixelRatio','route','coordinateOutput'])assert.equal(row[key],wanted[key]);for(const key of ['programSha256','pixelSha256','inputSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}
 assert.equal(new Set(value.cases.map(row=>row.case)).size,48);assert.equal(value.cases.filter(row=>row.sourceFile).length,8);return value
}
export function assertFloatCoordinateFinal(value,native,{built,nativeSha256}){
 assert.equal(built,true);assert.equal(value.status,'published-float-coordinate-candidate');assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true)
 assert.deepEqual(value.rows.map(row=>row.case).sort(),native.cases.filter(row=>row.sourceFile).map(row=>row.case).sort());return value
}
