import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {planUpdate,generationProfile} from './plan.mjs'
const sha=s=>createHash('sha256').update(s).digest('hex')
const before={schemaVersion:1,kind:'compiler-generation-inputs-only',global:{compiler:sha('compiler'),compat:sha('compat')},families:{gradient:{gradient:sha('gradient'),constants:sha('constants')},checker:{checker:sha('checker')},white:{white:sha('white'),hash:sha('hash')}}}
const changed=fn=>{const b=structuredClone(before);fn(b);return planUpdate(before,b)}
test('identical generation keys remain unchanged without accepting cached numerical results',()=>{
 const p=planUpdate(before,structuredClone(before));assert.equal(p.numericalAcceptanceReusable,false);assert.equal(p.supportPromotion,false);assert.ok(p.families.every(f=>f.status==='generation-inputs-unchanged'))
})
test('family-local body and transitive helper changes select only the owning families',()=>{
 for(const key of ['gradient','constants']){const p=changed(s=>s.families.gradient[key]=sha('changed'));assert.deepEqual(p.families.filter(f=>f.freshNumericalVerificationRequired).map(f=>f.name),['gradient'])}
 const p=changed(s=>{s.families.checker.hash=sha('hash');s.families.white.hash=sha('changed')});assert.deepEqual(p.families.filter(f=>f.freshNumericalVerificationRequired).map(f=>f.name),['checker','white'])
})
test('compiler, compatibility and generator identities invalidate every family',()=>{
 for(const key of ['compiler','compat','tool:generator']){const p=changed(s=>s.global[key]=sha('changed'));assert.ok(p.families.every(f=>f.freshNumericalVerificationRequired))}
})
test('new and removed families require review without deleting historical evidence',()=>{
 const p=changed(s=>{delete s.families.white;s.families.noise={noise:sha('noise')}});assert.equal(p.families.find(f=>f.name==='white').status,'removed-needs-review');assert.equal(p.families.find(f=>f.name==='noise').status,'new-needs-review')
})
test('invalid and missing dependency hashes refuse instead of silently reusing generation',()=>{
 assert.throws(()=>changed(s=>s.families.gradient.constants='bad'));assert.throws(()=>changed(s=>s.global={}))
 const p=changed(s=>delete s.families.gradient.constants);assert.equal(p.families.find(f=>f.name==='gradient').status,'regenerate-and-reverify')
})
test('backend compiler flags are keyed while timing and output-folder changes are excluded',()=>{
 const g={blenderCommit:'pinned',nagaVersion:'pinned',clangVersion:'pinned',compatibilityMacros:['define'],commands:[{command:['clang','-E','/tmp/a/test.frag'],returncode:0,seconds:1}]}
 const baseline=generationProfile(g,'/tmp/a'),moved=structuredClone(g);moved.commands[0].command[2]='/tmp/b/test.frag';moved.commands[0].seconds=2
 assert.equal(generationProfile(moved,'/tmp/b'),baseline)
 moved.commands[0].command.push('-DGPU_METAL');assert.notEqual(generationProfile(moved,'/tmp/b'),baseline)
 moved.commands[0].returncode=1;assert.throws(()=>generationProfile(moved,'/tmp/b'))
})
