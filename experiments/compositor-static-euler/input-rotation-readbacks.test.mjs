import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {inputRotationReadbackPlan,assertInputRotationReadbackWords,archiveInputRotationReadbacks,closeInputRotationReadbacks} from './input-rotation-readbacks.mjs'
const native={cases:[{case:'sample-0',width:4,height:4,rgbaWords:[0x3f800000,0xbf000000,0,0x3f800000]}]}
const rows=final=>[{case:'sample-0',readbacks:inputRotationReadbackPlan(native.cases[0],final).map(plan=>({...plan,words:Array.from({length:plan.width*plan.height*4},(_,i)=>native.cases[0].rgbaWords[i%4])}))}]
test('all actual signed component words, repeats and install cycles are independently recomputed',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'input-rotation-words-'));t.after(()=>rm(folder,{recursive:true,force:true}));const report={rows:[]}
 for(const backend of ['webgpu','webgl2']){const value=rows(true);await archiveInputRotationReadbacks(folder,backend,value);report.rows.push({backend,rows:value})}
 assert.deepEqual(await closeInputRotationReadbacks(folder,report,native,{final:true}),{words:512,primaryWords:128,frames:8})
 const entry=report.rows[0].rows[0].readbacks[0],path=join(folder,entry.wordFile),bytes=await readFile(path)
 for(const at of [0,31,63]){const bad=Buffer.from(bytes);bad.writeUInt32LE(42,at*4);assert.throws(()=>assertInputRotationReadbackWords(bad,native.cases[0].rgbaWords,4,4))}
 assert.throws(()=>assertInputRotationReadbackWords(bytes.subarray(4),native.cases[0].rgbaWords,4,4))
 for(const mutate of [x=>x.rows[0].rows[0].readbacks.pop(),x=>x.rows[0].rows[0].readbacks[0].wordFile='../foreign.u32',x=>x.rows[0].rows[0].readbacks[0].wordSha256='0'.repeat(64),x=>x.rows[0].rows[0].readbacks[0].phase='repeat']){const bad=structuredClone(report);mutate(bad);await assert.rejects(closeInputRotationReadbacks(folder,bad,native,{final:true}))}
 await assert.rejects(archiveInputRotationReadbacks(folder,'webgpu',rows(true)),/EEXIST/)
 await writeFile(join(folder,'readbacks','extra.u32'),bytes);await assert.rejects(closeInputRotationReadbacks(folder,report,native,{final:true}));await rm(join(folder,'readbacks','extra.u32'))
 await rm(path);await symlink(join(folder,report.rows[0].rows[0].readbacks[1].wordFile),path);await assert.rejects(closeInputRotationReadbacks(folder,report,native,{final:true}))
})
