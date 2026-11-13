import assert from 'node:assert/strict'
export function assertRelativeQualification(value){
 assert.equal(value.status,'native-relative-scalar-qualified');assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.cases.length,32);assert.equal(new Set(value.cases.map(row=>row.case)).size,32)
 for(const row of value.cases){assert.equal(row.width,13);assert.equal(row.height,9);for(const key of ['programSha256','pixelSha256'])assert.match(row[key],/^[a-f0-9]{64}$/)}
 const expected=['x','y','greater','smaller'].flatMap(mode=>['0','0p1','0p25','-0p5','1','1p1754943508222875e-38','65536','-65536'].map(suffix=>'blender-5-3-'+value.device.toLowerCase()+'-'+mode+'-'+suffix))
 assert.deepEqual(value.cases.map(row=>row.case).sort(),expected.sort());assert.equal(value.cases.filter(row=>row.sourceFile).length,4);return value
}
export function assertRelativeFinal(value,native,{built,nativeSha256}){
 assert.equal(built,true);assert.equal(value.status,'published-relative-candidate');assert.equal(value.exporter,'built');assert.equal(value.nativeQualificationSha256,nativeSha256);assert.equal(value.sourcePreserved,true)
 assert.deepEqual(value.rows.map(row=>row.case).sort(),native.cases.filter(row=>row.sourceFile).map(row=>row.case).sort());return value
}
