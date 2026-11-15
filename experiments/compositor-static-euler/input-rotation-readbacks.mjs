// Fixture-only exact raw capture transport; no numerical repair or SDK behavior.
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export const inputRotationReadbackPlan=(row,final)=>[
 {phase:'primary',width:row.width,height:row.height},{phase:'repeat',width:row.width,height:row.height},
 ...(['zero-0','producer-group-0'].includes(row.case)?[[8,6],[3,5],[4,4]].map(([width,height],i)=>({phase:'resize-'+i,width,height})):[]),
 ...(final?[{phase:'reapply-1',width:row.width,height:row.height},{phase:'reapply-2',width:row.width,height:row.height}]:[])
]
export function assertInputRotationReadbackWords(bytes,words,width,height){
 assert.equal(bytes.byteLength,width*height*16,'Every readback Float32 word is required')
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 for(let i=0;i<width*height*4;i++)assert.equal(data.getUint32(i*4,true),words[i%4],'Actual GPU word differs at '+i)
 return width*height*4
}
export async function archiveInputRotationReadbacks(directory,backend,rows){
 assert.ok(['webgpu','webgl2'].includes(backend));await mkdir(join(directory,'readbacks'),{recursive:true})
 for(const row of rows){assert.match(row.case,/^[a-z0-9-]+$/)
  for(const capture of row.readbacks){assert.match(capture.phase,/^(primary|repeat|resize-[0-2]|reapply-[12])$/);assert.ok(Number.isSafeInteger(capture.width)&&capture.width>0&&Number.isSafeInteger(capture.height)&&capture.height>0);assert.equal(capture.words.length,capture.width*capture.height*4)
   const bytes=Buffer.alloc(capture.words.length*4);for(const[i,word]of capture.words.entries()){assert.ok(Number.isInteger(word)&&word>=0&&word<=0xffffffff);bytes.writeUInt32LE(word,i*4)}
   capture.wordFile=`readbacks/${backend}-${row.case}-${capture.phase}.u32`;capture.wordSha256=hash(bytes);await writeFile(join(directory,capture.wordFile),bytes,{flag:'wx'});delete capture.words
  }
 }
}
export async function closeInputRotationReadbacks(directory,report,native,{final}){
 const expected=[];let words=0,primaryWords=0,frames=0
 for(const api of report.rows)for(const row of api.rows){const entry=native.cases.find(x=>x.case===row.case);assert.ok(entry)
  assert.deepEqual(row.readbacks.map(({phase,width,height})=>({phase,width,height})),inputRotationReadbackPlan(entry,final))
  for(const capture of row.readbacks){const name=`readbacks/${api.backend}-${row.case}-${capture.phase}.u32`;assert.equal(capture.wordFile,name);assert.match(capture.wordSha256,/^[a-f0-9]{64}$/);const bytes=await readFile(join(directory,name));assert.equal(hash(bytes),capture.wordSha256);const count=assertInputRotationReadbackWords(bytes,entry.rgbaWords,capture.width,capture.height);words+=count;if(capture.phase==='primary')primaryWords+=count;frames++;expected.push(name)}
 }
 const folder=join(directory,'readbacks');assert.equal(await realpath(folder),join(await realpath(directory),'readbacks'),'Readback directory cannot be a symlink alias')
 const actual=await readdir(folder,{withFileTypes:true});for(const entry of actual)assert.ok(entry.isFile()&&!entry.isSymbolicLink());assert.deepEqual(actual.map(x=>'readbacks/'+x.name).sort(),expected.sort())
 return {words,primaryWords,frames}
}
