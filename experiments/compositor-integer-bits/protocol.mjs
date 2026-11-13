import assert from 'node:assert/strict'
export function expectedIntegerBitsCases(){
 const out=Array.from({length:12},(_,i)=>'calibration-'+i)
 for(const mode of ['and','or','xor','not','shift','rotate'])for(let i=0;i<(mode==='not'?12:mode==='shift'||mode==='rotate'?45:44);i++)out.push('bit-'+mode+'-'+i)
 for(let i=0;i<48;i++)out.push('hash-int-'+i)
 return [...out,'bit-int-compare','hash-int-compare','hash-bit-chain'].sort()
}
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function assertIntegerBitsQualification(value){
 assert.equal(value.status,'CAPTURED_INTEGER_BITS_NATIVE');assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.width,8);assert.equal(value.height,8)
 assert.deepEqual(value.cases.map(x=>x.case).sort(),expectedIntegerBitsCases());assert.equal(new Set(value.cases.map(x=>x.case)).size,value.cases.length)
 assert.equal(value.cases.filter(x=>x.sourceFile).length,12);assert.equal(value.cases.filter(x=>x.control).length,12)
 for(const row of value.cases){for(const key of ['programSha256','pixelSha256'])sha(row[key]);assert.ok(Number.isInteger(row.expectedInt)&&row.expectedInt>=-2147483648&&row.expectedInt<=2147483647);if(row.sourceFile)sha(row.sourceSha256)}
 return value
}
export function assertIntegerBitsFinal(value,native){
 assert.equal(value.status,'published-integer-bits-family');assert.equal(value.exporter,'built');assert.equal(value.sourcePreserved,true)
 assert.deepEqual(value.rows.map(x=>x.case).sort(),native.cases.filter(x=>x.sourceFile).map(x=>x.case).sort())
 assert.equal(value.rows.length,12);for(const row of value.rows)for(const key of ['sourceSha256','manifestSha256','glbSha256','presentationSha256'])sha(row[key]);return value
}
