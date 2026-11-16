import assert from 'node:assert/strict'
import test from 'node:test'
import { closeUniform } from './compare.mjs'
import { closeOrcoField } from './orco-field-compare.mjs'
const e=process.env,uniform=[e.UNIFORM_BASELINE,e.UNIFORM_CANDIDATE,e.UNIFORM_REPEAT,e.UNIFORM_CONTROLS]
test('independent uniform close preserves exact-image/Float32 failures and lower program count', {skip:uniform.every(Boolean)?false:'Requires immutable original-app A/B artifacts'},async()=>{
 const r=await closeUniform(...uniform)
 assert.equal(r.status,'EXACT_UNIFORM_CANDIDATE_FAILED');assert.equal(r.supportCredit,0)
 assert.deepEqual(r.image,{bytes:2764800,differences:572,maxAbs:25});assert.equal(r.literalSelfRepeat.differences,0)
 assert.equal(r.baseline.uniqueFragmentSources,53);assert.equal(r.candidate.uniqueFragmentSources,11)
 assert.equal(r.controls.filter(x=>x.mode==='uniform'&&x.differences>0).length,2)
 assert.ok(r.controls.filter(x=>x.mode==='wrong-bbox').every(x=>x.differences>0))
})
test('independent actual native field close retains the one failed word, exact masks and negative associations', {skip:e.ORCO_FIELD_NATIVE&&e.ORCO_FIELD_BROWSER?false:'Requires immutable actual EEVEE/browser field artifacts'},async()=>{
 const r=await closeOrcoField(e.ORCO_FIELD_NATIVE,e.ORCO_FIELD_BROWSER)
 assert.equal(r.passed,false);assert.equal(r.supportCredit,0)
 assert.equal(r.totals.find(x=>x.kind==='mask').violations,0)
 assert.equal(r.totals.find(x=>x.kind==='position').violations,0)
 assert.equal(r.totals.find(x=>x.kind==='generated').violations,1)
 assert.deepEqual(r.rows.filter(x=>x.kind==='generated'&&x.violations>0).map(x=>[x.api,x.case,x.basis]),[['webgl2','Cube','gltf-y-up']])
 assert.ok(r.rows.filter(x=>x.kind==='wrong-bbox').every(x=>x.violations>0))
})
