// SPDX-License-Identifier: MIT
// Reuse the existing saved-scene diagnostic and independent reader, never its acceptance.
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises'
import {resolve,join,relative,dirname,basename} from 'node:path'
import {createHash} from 'node:crypto'
const root=await realpath(resolve(import.meta.dirname,'../..'))
const [references,output,...extra]=process.argv.slice(2)
if(!references||!output||extra.length)throw Error('Usage: early-final-canary.mjs RETAINED_NATIVE_DIRECTORY NEW_OUTPUT_UNDER_ARTIFACTS')
const source=await realpath(resolve(references))
const destination=join(await realpath(dirname(resolve(output))),basename(resolve(output)))
const within=relative(join(root,'artifacts'),destination)
if(!within||within.split('/')[0]==='..')throw Error('Output must be under this checkout artifacts directory (Vite allowlist)')
await mkdir(destination,{recursive:false})
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const report={schemaVersion:1,status:'running',supportCredit:0,freshNativeCredit:0,finalAcceptanceCache:false,source,stages:[],pins:{}}
const save=()=>writeFile(join(destination,'pilot.json'),JSON.stringify(report,null,2)+'\n')
try{
 for(const name of ['qualification.json','final-proof.json'])report.pins[name]=sha(await readFile(join(source,name)))
 const env={...process.env,BLENDLINK_TEST_PROFILE:'metal',BLENDLINK_TEST_CHROMIUM_CHANNEL:'chromium',BLENDLINK_TEST_CHROMIUM_ARGS:'[]'}
 for(const [name,args] of [
  ['capture',['experiments/compositor-vector-rotate/diagnose-final.mjs',source,join(destination,'capture')]],
  ['independent-close',['experiments/compositor-vector-rotate/close-diagnostic.mjs',source,join(destination,'capture'),join(destination,'closed.json')]],
 ]){
  const start=performance.now(),run=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
  await writeFile(join(destination,name+'.log'),(run.stdout??'')+(run.stderr??''))
  report.stages.push({name,elapsedMs:performance.now()-start,exitCode:run.status,signal:run.signal,error:run.error?.message??null})
  await save();if(run.status!==0||run.error)throw Error(name+' failed; inspect retained log')
 }
 report.status='PASSED_RETAINED_FINAL_CURRENT_RUNTIME_CANARY'
 report.closedSha256=sha(await readFile(join(destination,'closed.json')))
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1}
finally{await save();console.log(JSON.stringify(report))}
