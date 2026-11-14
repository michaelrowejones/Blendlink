import test from'node:test';import assert from'node:assert/strict'
import{cases,sizes,absoluteGate,expectedFinalCases,browserProofContract}from'./protocol.mjs'
import{readFileSync}from'node:fs'
test('Alpha corpus freezes source fields, default Final and predeclared film gate',()=>{
 assert.equal(cases.length,8);assert.equal(new Set(cases.map(row=>row.case)).size,8);assert.equal(expectedFinalCases().length,8)
 assert.deepEqual(sizes,[64,32,96]);assert.equal(absoluteGate,2**-10);assert.equal(Object.isFrozen(browserProofContract),true)
 assert.ok(cases.some(row=>row.group));assert.ok(cases.some(row=>row.shared&&row.rgb));assert.ok(cases.some(row=>row.domain==='CORNER'))
 for(const row of cases)assert.equal(row.alpha.length,row.domain==='CORNER'?6:4)
})
test('independent authored seams clear all sample centers by at least half a physical pixel',()=>{
 const geometry=JSON.parse(readFileSync(new URL('./fixture-geometry.json',import.meta.url)))
 assert.deepEqual(geometry.calibrationVertices,[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]])
 for(const size of geometry.sizes)for(const line of[geometry.singleOwner,...geometry.sharedOwners]){
  let minimum=Infinity
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const twiceResidual=2*y+1-line.worldSlope*(2*x+1)-(1-line.worldSlope+line.worldIntercept)*size
   minimum=Math.min(minimum,Math.abs(twiceResidual)/2)
  }
  assert.equal(minimum,geometry.predeclaredMinimumVerticalPixelClearance)
 }
})
