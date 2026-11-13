/** Maintainer-only structural analysis; never reports GPU performance qualification. */
import assert from 'node:assert/strict'
import {readFile,mkdir,open,stat} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {analyzeNodePortCostBytes,NODE_PORT_COST_BOUNDS} from './lib/node-port-cost.mjs'
export async function runNodePortCost(args){
 const options={}
 for(let index=0;index<args.length;index+=2){const key=args[index];assert.ok(['--input','--output','--limits','--profile','--pixel-digest-elements'].includes(key)&&args[index+1]&&!Object.hasOwn(options,key),'Use unique --input/--output [--limits/--profile] values');options[key]=args[index+1]}
 assert.ok(options['--input']&&options['--output'],'Use --input JSON --output NEW_JSON [--limits JSON] [--profile DECLARED_LABEL] [--pixel-digest-elements N]')
 const output=resolve(options['--output']);await mkdir(dirname(output),{recursive:true})
 const handle=await open(output,'wx');let report,inputRecord=null,limitsInput=null
 try{
  const input=resolve(options['--input']),info=await stat(input)
  assert.ok(info.isFile()&&info.size<=NODE_PORT_COST_BOUNDS.inputBytes,'Input exceeds bounded static analysis size or is not a file')
  const payload=await readFile(input);inputRecord={source:'json-bytes',path:input,bytes:payload.length,sha256:createHash('sha256').update(payload).digest('hex')}
  let limits=null
  if(options['--limits']){
   const path=resolve(options['--limits']),info=await stat(path);assert.ok(info.isFile()&&info.size<=65536,'Limits file exceeds bounded contract size')
   const bytes=await readFile(path);limitsInput={path,sha256:createHash('sha256').update(bytes).digest('hex')};limits=JSON.parse(bytes.toString('utf8'))
  }
  report=analyzeNodePortCostBytes(payload,{limits,profile:options['--profile']??null,pixelDigestElements:options['--pixel-digest-elements']===undefined?0:Number(options['--pixel-digest-elements'])})
  report.input.path=input;report.limitsInput=limitsInput
  report.cliSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
  report.analyzerSha256=createHash('sha256').update(await readFile(new URL('./lib/node-port-cost.mjs',import.meta.url))).digest('hex')
 }catch(error){report={schemaVersion:1,kind:'blendlink-node-port-static-cost-v1',status:'analysis-failed',productionCases:0,performanceQualified:false,input:inputRecord,limitsInput,error:{name:error.name,message:error.message}}}
 finally{try{await handle.writeFile(JSON.stringify(report,null,2)+'\n')}finally{await handle.close()}}
 return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const report=await runNodePortCost(process.argv.slice(2));console.log('BLENDLINK_NODE_PORT_STATIC_ANALYSIS '+JSON.stringify({status:report.status,output:resolve(process.argv[process.argv.indexOf('--output')+1]),performanceQualified:false}));process.exitCode=report.status==='analyzed'?0:1}
 catch(error){console.error(error.message);process.exitCode=1}
}
