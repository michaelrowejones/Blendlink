import{spawn}from'node:child_process'
import{mkdir,open,readFile,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
export const stages=['tooling','generation','adapter','preflight','validation']
const hash=b=>createHash('sha256').update(b).digest('hex')
export async function measureStage({stage,method,trial,attempt=1,argv,cwd,output,budgetMs,planSha256}){
 if(!stages.includes(stage)||!['hand-tsl','native-generated','shared'].includes(method)||!Number.isSafeInteger(trial)||trial<1||!Number.isSafeInteger(attempt)||attempt<1||!Array.isArray(argv)||!argv.length||argv.some(s=>typeof s!=='string')||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>600000||!String(planSha256).match(/^[a-f0-9]{64}$/))throw Error('Invalid declared stage')
 const directory=resolve(output);await mkdir(directory);const out=await open(join(directory,'stdout.log'),'wx'),err=await open(join(directory,'stderr.log'),'wx'),startedAt=new Date().toISOString(),begin=process.hrtime.bigint();let bytes=0,timeout=false,child
 try{
  const result=await new Promise(resolveResult=>{
   let error=null;child=spawn(argv[0],argv.slice(1),{cwd,stdio:['ignore',out.fd,err.fd],shell:false,detached:process.platform!=='win32'});child.on('error',e=>{error=String(e)});const timer=setTimeout(()=>{timeout=true;if(child.pid&&process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}else child.kill('SIGKILL')},budgetMs)
   child.on('close',(exitCode,signal)=>{clearTimeout(timer);resolveResult({exitCode,signal,error})})
  })
  const elapsedMs=Number(process.hrtime.bigint()-begin)/1e6;await out.close();await err.close()
  const logs={};for(const name of['stdout.log','stderr.log']){const b=await readFile(join(directory,name));bytes+=b.length;logs[name]={bytes:b.length,sha256:hash(b)}}
  const report={schemaVersion:1,role:'observed-command-stage-not-authoring-time',stage,method,trial,attempt,argv,cwd:resolve(cwd),startedAt,elapsedMs,budgetMs,timedOut:timeout,...result,logBytes:bytes,logs,planSha256,instrumentationSha256:hash(await readFile(new URL('./stages.mjs',import.meta.url))),llmTimeMeasured:false,supportCredit:0}
  await writeFile(join(directory,'stage.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report
 }catch(e){try{child?.kill('SIGKILL')}catch{};await out.close().catch(()=>{});await err.close().catch(()=>{});throw e}
}
export function summarizeStages(records){
 const seen=new Set(),summary={}
 for(const r of records){const key=[r.method,r.trial,r.stage,r.attempt].join('/');if(seen.has(key))throw Error('Duplicate trial/stage/attempt');seen.add(key);if(!Number.isFinite(r.elapsedMs)||r.elapsedMs<0||r.llmTimeMeasured!==false)throw Error('Invalid measured stage');const group=summary[r.method+'/'+r.trial]??={method:r.method,trial:r.trial,observedElapsedSumMs:0,stages:{},allPassed:true};group.observedElapsedSumMs+=r.elapsedMs;(group.stages[r.stage]??=[]).push({attempt:r.attempt,elapsedMs:r.elapsedMs,exitCode:r.exitCode,timedOut:r.timedOut});group.allPassed&&=r.exitCode===0&&!r.error&&!r.timedOut}
 for(const group of Object.values(summary))group.unobservedStages=stages.filter(s=>!(s in group.stages))
 return{role:'command-time-only-sum-not-critical-path-or-llm-time',trials:Object.values(summary)}
}
