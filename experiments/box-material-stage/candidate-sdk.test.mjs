import assert from 'node:assert/strict'
import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {assertCandidateSdk} from './candidate-sdk.mjs'
const root=resolve(import.meta.dirname,'../..')
test('unpatched public checkout refuses every private entrypoint before inputs/GPU/output',()=>{
 for(const entry of['candidate-sdk.mjs','export-colors.mjs','native-color-references.mjs','installed.mjs','read-installed.mjs']){
  assert.throws(()=>execFileSync(process.execPath,[join(import.meta.dirname,entry),'--check-sdk'],{cwd:root,encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&/Private BOX color research SDK patch is absent or mismatched/.test(error.stderr))
 }
})
test('pinned file list covers exactly the private patch paths',async()=>{
 const candidate=JSON.parse(await readFile(join(import.meta.dirname,'candidate-sdk-files.json'))),patch=await readFile(join(import.meta.dirname,'sdk-candidate.patch'),'utf8')
 assert.equal(candidate.files.length,17);assert.deepEqual([...patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map(m=>m[1]).sort(),candidate.files.map(f=>f.path).sort())
})
test('missing private file is a hard refusal, not a public runtime fallback',async()=>{
 await assert.rejects(assertCandidateSdk({repository:root}),/private.*patch is absent or mismatched/i)
})
