import assert from'node:assert/strict'
import{test}from'node:test'
import{mkdtemp,readFile,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{execFile}from'node:child_process'
import{promisify}from'node:util'
test('closed signed-bound/seam plan is deterministic and keeps declared gates',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wave-plan-'))
 try{
  const file=join(directory,'cases.json');await promisify(execFile)(process.execPath,[new URL('./bound-plan.mjs',import.meta.url).pathname,file])
  const data=await readFile(file),expected=await readFile(new URL('./bound-cases.json',import.meta.url));assert.deepEqual(data,expected)
  const plan=JSON.parse(data);assert.equal(plan.cases.length,378);assert.equal(new Set(plan.cases.map(row=>row.case)).size,378)
  assert.equal(plan.gates.SAW_TRI,'Every raw RGBA word exact');assert.equal(plan.gates.SIN.absoluteMax,2**-20);assert.equal(plan.gates.SIN.nativeZeroOneExact,true)
  for(const profile of['SAW','TRI','SIN'])assert.equal(plan.cases.filter(row=>row.profile===profile).length,126)
  for(const axis of['X','Y'])for(const side of['predecessor','nearest','successor'])assert.ok(plan.cases.some(row=>row.case===`13x9-${axis}-SIN-seam-sine-one-triangle-half-${side}`))
 }finally{await rm(directory,{recursive:true,force:true})}
})
