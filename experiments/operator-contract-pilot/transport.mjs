// One replay transport for BOTH families. No numerical candidate code imported.
import assert from'node:assert/strict'
import{readFile,realpath}from'node:fs/promises'
import{createHash}from'node:crypto'
import{resolve,relative,isAbsolute,sep}from'node:path'
import{decode,caseCounts}from'./generated/contracts.ts'
import{existingPolicy}from'./correspondence.mjs'
export const sha256=b=>createHash('sha256').update(b).digest('hex')
const base=new URL('./',import.meta.url),root=new URL('../../',base)
async function ownedFile(directory,name){assert.equal(typeof name,'string');assert.ok(name&&!isAbsolute(name));const canonical=await realpath(directory),path=await realpath(resolve(directory,name)),child=relative(canonical,path);assert.ok(child&&!child.startsWith('..'+sep)&&child!=='..'&&!isAbsolute(child),'Artifact escaped owned fixture directory');return path}
export async function replay({directory=new URL('fixtures/',base),manifestOverride,bytesOverride}={}){
 const fixtureRoot=await realpath(directory),manifestBytes=await readFile(resolve(fixtureRoot,'manifest.json')),manifest=manifestOverride??JSON.parse(manifestBytes),results=[]
 assert.equal(manifest.status,'REPLAY_ONLY_EXISTING_NATIVE_INPUTS');assert.equal(manifest.numericalCredit,0);assert.equal(manifest.supportPromotion,false)
 assert.equal(manifest.rows.length,Object.values(caseCounts).reduce((sum,c)=>sum+c.nativeGraphs,0));assert.equal(new Set(manifest.rows.map(r=>r.family+':'+r.case)).size,manifest.rows.length)
 for(const[family,count]of Object.entries(caseCounts)){
  const planBytes=await readFile(new URL(count.casePlan,root));assert.equal(sha256(planBytes),count.casePlanSha256,'Declared case plan drift');const plan=JSON.parse(planBytes),rows=manifest.rows.filter(r=>r.family===family)
  assert.deepEqual(rows.map(r=>r.case),plan.map(r=>r.case),'Exact ordered family census')
  let comparedWords=0
  for(let i=0;i<rows.length;i++){
   const row=rows[i],files={}
   for(const field of['programFile','pixelFile']){const record=row[field];assert.match(record.sha256,/^[a-f0-9]{64}$/);assert.equal(record.file,family+'/'+row.case+(field==='programFile'?'.program.json':'.rgba32f'));const path=await ownedFile(fixtureRoot,record.file),original=await readFile(path),bytes=bytesOverride?.(record.file,original)??original;assert.equal(sha256(bytes),record.sha256,'Pinned artifact drift: '+record.file);files[field]=bytes}
   const program=decode(family,JSON.parse(files.programFile)),expected=plan[i].expectedWords,bytes=files.pixelFile
   const policy=await existingPolicy(family);policy(program,plan[i])
   assert.equal(expected.length,4);assert.ok(expected.every(w=>Number.isInteger(w)&&w>=0&&w<=0xffffffff));assert.equal(bytes.byteLength,1024)
   for(let n=0;n<256;n++)assert.equal(bytes.readUInt32LE(n*4),expected[n%4],'Independent declared native word: '+row.case+'/'+n)
   results.push({family,case:row.case,program,words:256});comparedWords+=256
  }
  assert.equal(comparedWords,count.nativeGraphs*256)
 }
 assert.equal(results.length,manifest.rows.length)
 return{status:'REPLAYED_EXISTING_INPUTS_NOT_QUALIFICATION',fixtureManifestSha256:sha256(manifestBytes),families:Object.keys(caseCounts),nativePrograms:results.length,nativeWords:results.reduce((sum,r)=>sum+r.words,0),numericalCredit:0,supportPromotion:false,results}
}
