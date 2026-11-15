import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
import test from'node:test'
const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url)))
const expected=row=>row.kind==='control'?[.125,.25,.5,1]:row.route==='aspect'?[2,2,2,1]:row.route==='summary'?row.size.concat(0,1):['Dimensions','Resolution'].includes(row.output)?row.size.map(n=>Math.max(1,n)).concat(0,1):row.output==='Scale'?[1,1,0,1]:[0,0,0,1]
const words=values=>{const b=new ArrayBuffer(16),v=new DataView(b);values.forEach((n,i)=>v.setFloat32(i*4,n,true));return values.map((_,i)=>v.getUint32(i*4,true))}
test('predeclared finite metadata census separates calibration and actual source graphs',()=>{
 assert.equal(cases.length,21);assert.equal(new Set(cases.map(row=>row.case)).size,21)
 assert.equal(cases.filter(row=>row.kind==='control').length,1);assert.equal(cases.filter(row=>row.saveFinal).length,8)
 assert.equal((21+8)*4,116);assert.equal(((21+8)*4-8)*256,27648)
 assert.equal((21*4*2+8*4*3)*256,67584)
})
test('expected words come independently from authored size/output semantics, not kernel output',()=>{
 for(const row of cases){assert.deepEqual(row.expectedRgba,expected(row));assert.deepEqual(row.expectedWords,words(expected(row)))}
 assert.ok(cases.some(row=>row.producer==='blank'&&row.size.some(n=>n<=0)))
 for(const p of['blank','png'])for(const output of['Dimensions','Resolution','Location','Rotation','Scale'])assert.ok(cases.some(row=>row.producer===p&&row.output===output))
 assert.ok(cases.some(row=>row.size?.[0]===8192));assert.ok(cases.some(row=>row.producer==='png'&&row.size[0]===4096))
})
