// Synthetic protocol/schema checks only: no native process, browser or numerical credit.
// One mode: node scripts/proof-protocol-variants.test.mjs --family static-switch --variant integer-vector3
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const self=fileURLToPath(import.meta.url)
const families={
 'vector-rotate':{directory:'compositor-vector-rotate',environment:'SCENETOWEB_VECTOR_ROTATE_VARIANT',default:'fixed-axis',variants:{'fixed-axis':[25,10],'unit-axis':[35,10]}},
 'static-switch':{directory:'static-switch-family',environment:'SCENETOWEB_SWITCH_VARIANT',default:'static',variants:{static:[71,30],'mono-view':[8,8],'integer-vector3':[16,8],'finite-image-info':[21,8]}},
 'static-euler':{directory:'compositor-static-euler',environment:'SCENETOWEB_STATIC_EULER_VARIANT',default:'euler',variants:{euler:[62,12],'input-rotation':[48,8]}},
}
const marker='PROOF_PROTOCOL_VARIANT '
function options(argv){
 const result={}
 for(let i=0;i<argv.length;i+=2){
  assert.ok(['--family','--variant'].includes(argv[i]),'Unknown protocol flag: '+argv[i])
  assert.ok(argv[i+1]&&!argv[i+1].startsWith('--')&&!Object.hasOwn(result,argv[i]),'Missing or duplicate protocol flag: '+argv[i])
  result[argv[i]]=argv[i+1]
 }
 assert.ok(Object.hasOwn(families,result['--family']),'Unknown protocol family')
 const family=families[result['--family']]
 const variant=result['--variant']??family.default
 assert.ok(Object.hasOwn(family.variants,variant),'Unknown protocol variant: '+variant)
 return{familyName:result['--family'],...family,variant}
}
function isolatedEnvironment(env){
 return Object.fromEntries(Object.entries(env).filter(([key])=>!['NODE_OPTIONS','NODE_TEST_CONTEXT'].includes(key)&&!/^SCENETOWEB_.*_VARIANT$/.test(key)))
}
function runTest(config,env,spawn=spawnSync){
 const file=fileURLToPath(new URL('../experiments/'+config.directory+'/protocol.test.mjs',import.meta.url))
 const result=spawn(process.execPath,['--test','--test-reporter=tap',file],{env:{...isolatedEnvironment(env),[config.environment]:config.variant},encoding:'utf8',timeout:20_000,maxBuffer:2*1024*1024})
 if(result.error)throw result.error
 assert.equal(result.signal,null,'Protocol subprocess terminated: '+result.signal)
 assert.ok(Number.isInteger(result.status),'Protocol subprocess did not return an exit status')
 return result
}
async function main(argv){
 const config=options(argv),env={...isolatedEnvironment(process.env),[config.environment]:config.variant}
 // The launcher itself is a fresh process: import-time variant caches cannot leak
 // from a preceding suite or a caller's ambient variant selection.
 for(const key of Object.keys(process.env))if(/^SCENETOWEB_.*_VARIANT$/.test(key))delete process.env[key]
 process.env[config.environment]=config.variant
 const p=await import(new URL('../experiments/'+config.directory+'/protocol.mjs',import.meta.url))
 assert.equal(p.variant,config.variant)
 const actual=[config.familyName==='static-switch'?p.expectedCases.length:p.cases.length,config.familyName==='static-switch'?p.expectedSavedFinalCount:p.expectedFinalCases().length]
 assert.deepEqual(actual,config.variants[config.variant],'Actual protocol census differs from declared variant')
 const result=runTest(config,env)
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'')
 process.stdout.write(marker+JSON.stringify({family:config.familyName,variant:p.variant,cases:actual[0],finals:actual[1],pid:process.pid,status:result.status,numericalCredit:0})+'\n')
 process.exitCode=result.status
}
if(process.argv.length>2){
 await main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1})
}else{
 const call=(args,extra={})=>spawnSync(process.execPath,[self,...args],{env:{...isolatedEnvironment(process.env),...extra},encoding:'utf8',timeout:25_000,maxBuffer:2*1024*1024})
 const parse=result=>{assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);const lines=result.stdout.split('\n').filter(line=>line.startsWith(marker));assert.equal(lines.length,1);return JSON.parse(lines[0].slice(marker.length))}
 test('every explicit protocol variant runs its real schema tests in a fresh isolated Node process',()=>{
  const pids=[]
  for(const[family,config]of Object.entries(families))for(const[variant,census]of Object.entries(config.variants)){
   const result=parse(call(['--family',family,'--variant',variant],{SCENETOWEB_VECTOR_ROTATE_VARIANT:'wrong-ambient-mode',SCENETOWEB_SWITCH_VARIANT:'wrong-ambient-mode',SCENETOWEB_STATIC_EULER_VARIANT:'wrong-ambient-mode'}))
   assert.deepEqual([result.family,result.variant,result.cases,result.finals,result.numericalCredit],[family,variant,...census,0]);assert.notEqual(result.pid,process.pid);pids.push(result.pid)
  }
  assert.equal(new Set(pids).size,Object.values(families).reduce((n,f)=>n+Object.keys(f.variants).length,0))
 })
 test('default protocols retain their family defaults despite caller variant contamination',()=>{
  for(const[family,config]of Object.entries(families)){
   const result=parse(call(['--family',family],{SCENETOWEB_VECTOR_ROTATE_VARIANT:'unit-axis',SCENETOWEB_SWITCH_VARIANT:'finite-image-info',SCENETOWEB_STATIC_EULER_VARIANT:'input-rotation'}))
   assert.equal(result.variant,config.default);assert.deepEqual([result.cases,result.finals],config.variants[config.default])
  }
 })
 test('unknown, missing and duplicate explicit flags fail before any protocol tests run',()=>{
  for(const args of[['--unknown','static'],['--family'],['--family','unknown'],['--family','static-switch','--variant','unknown'],['--family','static-switch','--family','static-euler']]){
   const result=call(args);assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/Unknown|Missing or duplicate/);assert.doesNotMatch(result.stdout,/PROOF_PROTOCOL_VARIANT|TAP version/)
  }
 })
 test('test invocation strips ambient runner/variant flags and propagates child failures',()=>{
  const config=options(['--family','static-switch','--variant','mono-view'])
  const result=runTest(config,{PATH:'owned-test-path',NODE_OPTIONS:'--require unwanted',NODE_TEST_CONTEXT:'child-v8',SCENETOWEB_SWITCH_VARIANT:'static',SCENETOWEB_STATIC_EULER_VARIANT:'input-rotation'},(executable,args,settings)=>{
   assert.equal(executable,process.execPath);assert.deepEqual(args.slice(0,2),['--test','--test-reporter=tap']);assert.match(args[2],/static-switch-family\/protocol\.test\.mjs$/)
   assert.deepEqual(settings.env,{PATH:'owned-test-path',SCENETOWEB_SWITCH_VARIANT:'mono-view'})
   return{status:23,signal:null,stdout:'failed protocol',stderr:''}
  })
  assert.equal(result.status,23)
  assert.throws(()=>runTest(config,{},()=>({status:null,signal:'SIGTERM'})),/terminated/)
  assert.throws(()=>runTest(config,{},()=>({error:new Error('spawn failed')})),/spawn failed/)
 })
}
