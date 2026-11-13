import test from 'node:test'
import assert from 'node:assert/strict'
import {assertTextureQualification,assertTextureFinal,expectedTextureCases} from './protocol.mjs'
const hash='a'.repeat(64)
const packet=()=>({status:'CAPTURED_TEXTURE_FAMILY_NATIVE',version:[5,3,0],build:'02f0899d78e3',device:'CPU',width:8,height:8,cases:expectedTextureCases().map((name,index)=>({case:name,programSha256:hash,pixelSha256:hash,field:name.includes('-field-'),...(name.includes('-field-')?{inputSha256:hash}:{}),...(name.endsWith('-6')&&!name.startsWith('checker-0-')&&!name.startsWith('checker-1-')&&!name.startsWith('checker-16-')&&!name.startsWith('checker-256-')||name.endsWith('-group')||name==='gradient-linked-vector'||name==='checker-linked-colors'?{sourceFile:name+'.blend',sourceSha256:hash}:{})}))})
test('closed texture receipt rejects omissions, duplicates, wrong versions/devices and missing field pins',()=>{
 const correct=packet();assert.equal(correct.cases.length,262);assertTextureQualification(correct)
 for(const mutate of [p=>p.cases.pop(),p=>p.cases[0]=p.cases[1],p=>p.version=[5,2,0],p=>p.device='UNKNOWN',p=>p.cases[0].field=true]){const changed=structuredClone(correct);mutate(changed);assert.throws(()=>assertTextureQualification(changed))}
})
test('Final requires the exact saved-scene subset and the production exporter',()=>{
 const native=packet(),final={status:'published-texture-family',exporter:'built',sourcePreserved:true,rows:native.cases.filter(x=>x.sourceFile).map(x=>({...x,manifestSha256:hash,glbSha256:hash,presentationSha256:hash}))};assertTextureFinal(final,native)
 for(const mutate of [p=>p.exporter='source',p=>p.rows.pop(),p=>p.rows[0]=p.rows[1],p=>p.sourcePreserved=false]){const changed=structuredClone(final);mutate(changed);assert.throws(()=>assertTextureFinal(changed,native))}
})
