// Research archive closure; this grants no port or numerical qualification.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'

const root=await realpath(resolve(import.meta.dirname,'../..'))
const policy=await realpath(resolve(process.argv[2]))
const scheduling=await realpath(resolve(process.argv[3]))
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const stages=[]
for(const [directory,script] of [[policy,'source-policy.py'],[scheduling,'scheduling.py']]){
 const archive=await validateNativeArchive(await json(join(directory,'native-archive.json')),directory,{
  expectedFinalSources:[],expectedScripts:[{path:join(root,'experiments/box-scene-feasibility',script),invocations:1}],
  helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}
 })
 const files=[]
 async function visit(folder,prefix=''){
  for(const entry of(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   assert.equal(entry.isSymbolicLink(),false)
   const name=prefix+entry.name
   if(name==='closed.json'||name.startsWith('active/'))continue
   if(entry.isDirectory())await visit(join(folder,entry.name),name+'/')
   else{const bytes=await readFile(join(folder,entry.name));files.push({path:name,bytes:bytes.length,sha256:hash(bytes)})}
  }
 }
 await visit(directory)
 stages.push({directory,script,archive,files})
}
const observed=await json(join(policy,'source-policy.json'))
assert.equal(observed.status,'OBSERVED_BOX_SCENE_ADMISSION')
assert.equal(observed.rows.length,4)
assert.equal(observed.nativeRenders,0)
assert.equal(observed.gpuInitializationCalls,0)
for(const row of observed.rows){assert.equal(row.status,'extracted');assert.deepEqual(row.kinds,['box-mask','render-pass','mix']);assert.deepEqual(row.diagnostics,[])}
for(let i=1;i<=4;i++){
 const program=await json(join(policy,'program-'+i+'.json'))
 assert.equal(program.status,'extracted')
 assert.deepEqual(program.ops.map(op=>op.kind),['box-mask','render-pass','mix'])
 assert.equal(program.ops.find(op=>op.kind==='mix').properties.ellipse_scene_mix_model,undefined)
}
const scheduled=await json(join(scheduling,'report.json'))
assert.equal(scheduled.status,'OBSERVED_NATIVE_BOX_FULL_FRAME_SCHEDULING')
assert.deepEqual(scheduled.version,[5,3,0]);assert.equal(scheduled.build,'02f0899d78e3')
assert.equal(scheduled.rows.length,16);assert.equal(scheduled.nativeRenders,16);assert.equal(scheduled.gpuInitializationCalls,0)
assert.deepEqual(scheduled.rows.map(row=>[row.size,row.operation]),[[0,.5],[.5,0],[0,0],[.5,.5]].flatMap(size=>['Add','Subtract','Multiply','Not'].map(operation=>[size,operation])))
for(const row of scheduled.rows)assert.deepEqual(row.nativeDimensionsRGBA,[13,9,0,1])
const fixtures=[]
for(const path of ['source-policy.py','scheduling.py','admission.test.ts','sources.json','close.mjs']){
 const bytes=await readFile(join(import.meta.dirname,path));fixtures.push({path,bytes:bytes.length,sha256:hash(bytes)})
}
const receipt={status:'RETAINED_BOX_SCENE_FEASIBILITY_OBSERVATIONS',sourceRevision:'02f0899d78e374b63e7181d9061e1f7ab03419cc',researchBase:'2840e1ad',nativeRenders:16,sourceGraphs:4,guardedPythonInvocations:2,gpuInitializationCalls:0,supportCredit:0,finalCredit:0,numericalQualification:false,limits:'Archive and observation census validation only; native report pixels are checked by the retained probe, not an independent EXR decoder in this reader.',fixtures,stages}
await writeFile(join(scheduling,'closed.json'),JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify({status:receipt.status,nativeRenders:16,sourceGraphs:4,guardedPythonInvocations:2,supportCredit:0}))
