import assert from 'node:assert/strict'
const MODES=['LINEAR','QUADRATIC','EASING','DIAGONAL']
export function expectedTextureCases(){
 const cases=[]
 for(const mode of MODES)for(const output of ['Fac','Color'])for(let i=0;i<14;i++)cases.push('gradient-'+mode.toLowerCase()+'-'+output.toLowerCase()+'-'+i)
 for(const mode of ['LINEAR'])for(const output of ['Fac','Color'])for(let i=0;i<3;i++)cases.push('gradient-'+mode.toLowerCase()+'-'+output.toLowerCase()+'-edge-'+i)
 for(const scale of [0,1,5,16,256])for(const output of ['Fac','Color'])for(let i=0;i<14;i++)cases.push('checker-'+scale+'-'+output.toLowerCase()+'-'+i)
 return [...cases,'gradient-group','checker-group','gradient-linked-vector','checker-linked-colors'].sort()
}
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function assertTextureQualification(value){
 assert.equal(value.status,'CAPTURED_TEXTURE_FAMILY_NATIVE');assert.deepEqual(value.version,[5,3,0]);assert.equal(value.build,'02f0899d78e3');assert.ok(['CPU','GPU'].includes(value.device));assert.equal(value.width,8);assert.equal(value.height,8)
 assert.deepEqual(value.cases.map(x=>x.case).sort(),expectedTextureCases());assert.equal(new Set(value.cases.map(x=>x.case)).size,value.cases.length)
 assert.equal(value.cases.filter(x=>x.sourceFile).length,14);assert.equal(value.cases.filter(x=>x.field).length,0)
 for(const row of value.cases){for(const key of ['programSha256','pixelSha256'])sha(row[key]);if(row.sourceFile){assert.equal(row.field,false);sha(row.sourceSha256)}if(row.field)sha(row.inputSha256)}
 return value
}
export function assertTextureFinal(value,native){
 assert.equal(value.status,'published-texture-family');assert.equal(value.exporter,'built');assert.equal(value.sourcePreserved,true)
 assert.deepEqual(value.rows.map(x=>x.case).sort(),native.cases.filter(x=>x.sourceFile).map(x=>x.case).sort())
 assert.equal(value.rows.length,14);for(const row of value.rows)for(const key of ['sourceSha256','manifestSha256','glbSha256','presentationSha256'])sha(row[key]);return value
}
