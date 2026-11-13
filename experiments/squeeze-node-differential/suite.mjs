import {assertSqueezeSourceNA} from './protocol.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2)
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback
for(let i=0;i<args.length;i++)assert.ok(['--built','--reuse-native','--blender','--output'].includes(args[i])||i>0&&['--blender','--output'].includes(args[i-1]),'Unknown Squeeze suite argument '+args[i])
const blender=option('--blender',process.env.BLENDLINK_BLENDER),output=resolve(option('--output','artifacts/verification-squeeze'))
assert.ok(blender,'Specify the actual --blender executable');await mkdir(output,{recursive:true})
const built=args.includes('--built'),profile=process.env.BLENDLINK_TEST_PROFILE??'default',env={BLENDLINK_SQUEEZE_REFERENCES:output,BLENDLINK_BLENDER:blender,BLENDLINK_SQUEEZE_BUILT:built?'1':'0'}
const report={status:'running',built,profile,steps:[],productionCases:0}
async function run(name,command,arguments_,extra={}){
 const result=spawnSync(command,arguments_,{cwd:root,env:{...process.env,...env,...extra},encoding:'utf8',maxBuffer:16*1024*1024})
 await writeFile(join(output,'suite-'+profile+'-'+name+'.log'),(result.stdout??'')+(result.stderr??'')+(result.error?'\n'+result.error.stack:''))
 report.steps.push({name,exitCode:result.status,signal:result.signal});assert.equal(result.status,0,name+' failed; inspect retained log')
}
try{
 await run('protocol-policy',process.execPath,['--test','experiments/squeeze-node-differential/protocol.test.mjs'])
 if(!args.includes('--reuse-native')){
  await run('source-policy',blender,['--background','--factory-startup','--python-exit-code','1','--python','packages/blender-addon/tests/squeeze_translation_check.py'])
  if(built)await run('copied-addon',blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/squeeze-node-differential/package_probe.py'],{BLENDLINK_SQUEEZE_ADDON:join(root,'packages/blendlink/dist/addon')})
  await run('native',blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/squeeze-node-differential/reference.py'])
  let na;try{na=JSON.parse(await readFile(join(output,'not-applicable.json')))}catch(error){if(error.code!=='ENOENT')throw error}
  if(na){assertSqueezeSourceNA(na,hash(await readFile(join(root,'experiments/squeeze-node-differential/reference.py'))));report.status='SOURCE_ATTESTATION_NA';report.source=na;console.log('BLENDLINK_SQUEEZE_SUITE_SOURCE_ATTESTATION_NA '+JSON.stringify(na));process.exitCode=0}
  else await run('final-export',process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/squeeze-node-differential/export.test.ts'])
 }
 if(report.status!=='SOURCE_ATTESTATION_NA'){
  await run('raw-browser',process.execPath,['experiments/squeeze-node-differential/run.mjs',...(built?['--built']:[])])
  await run('final-browser',process.execPath,['experiments/squeeze-node-differential/run.mjs',...(built?['--built']:[]),'--final'])
  const references=JSON.parse(await readFile(join(output,'references.json')))
  report.productionCases=references.cases.filter(entry=>entry.id!=='calibration').length;report.nativeVersion=references.version;report.status='passed'
  console.log('BLENDLINK_SQUEEZE_SUITE_PASSED '+JSON.stringify({profile,nativeVersion:report.nativeVersion,productionCases:report.productionCases}))
 }
}catch(error){report.status='failed';report.error=String(error);throw error}finally{await writeFile(join(output,'suite-'+profile+'.json'),JSON.stringify(report,null,2))}
