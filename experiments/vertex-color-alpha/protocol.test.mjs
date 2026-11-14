import test from'node:test';import assert from'node:assert/strict'
import{cases,sizes,absoluteGate,expectedFinalCases,browserProofContract,sourceFamily}from'./protocol.mjs'
import{readFileSync}from'node:fs'
test('Alpha corpus freezes source fields, default Final and predeclared film gate',()=>{
 const count=sourceFamily==='attribute'?9:8;assert.equal(cases.length,count);assert.equal(new Set(cases.map(row=>row.case)).size,count);assert.equal(expectedFinalCases().length,count);if(sourceFamily==='attribute')for(const row of cases){assert.equal(row.sourceNode,'ShaderNodeAttribute');assert.ok(row.layer);assert.notEqual(row.layer,'temperature')}
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

test('selected named-Attribute source leaves cannot become empty, other layers, or baked constants',async()=>{
 const {assertAlphaSourcePrograms}=await import('./protocol.mjs')
 if(sourceFamily!=='attribute')return
 const spec=cases[0],good={materials:{Artist:{channels:{Emission:{tslIr:{output:{op:'vertex_color_alpha',model:'eevee53-float-color-alpha-scalar-v1',sourceProfile:'blender53-eevee-metal-float-color-alpha-v1',layer:spec.layer}}}}}}}
 assertAlphaSourcePrograms(good,spec)
 for(const value of['','temperature','Missing']){const bad=structuredClone(good);bad.materials.Artist.channels.Emission.tslIr.output.layer=value;assert.throws(()=>assertAlphaSourcePrograms(bad,spec))}
 const bad=structuredClone(good);bad.materials.Artist.channels.Emission.tslIr.output={op:'const_float',value:1};assert.throws(()=>assertAlphaSourcePrograms(bad,spec))
 assert.throws(()=>assertAlphaSourcePrograms(good,{...spec,sourceNode:'ShaderNodeVertexColor'}))
})
