// One full existing family transaction; the manifest runner does not wrap it.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {executeNodePortCommand,nodePortHash} from './lib/node-port-contract.mjs'
import {closedNodePortFamily,assertClosedFamilyReceipt} from './lib/node-port-family-evidence.mjs'

export function closedFamilySuitePlan(id,{root,evidence,blender}){
 const f=closedNodePortFamily(id),mono=id==='mono-switch-view'
 assert.ok(blender&&evidence&&root)
 return {argv:[process.execPath,join(root,f.folder,mono?'suite.mjs':'matrix.mjs'),...(mono?['--built','--mono-view']:[evidence])],
  env:{BLENDLINK_BLENDER:blender,SCENETOWEB_SWITCH_EVIDENCE:mono?evidence:null,SCENETOWEB_SWITCH_VARIANT:mono?'mono-view':'static',
   SCENETOWEB_RUNTIME_TRANSACTION:null,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:null,SCENETOWEB_NATIVE_IDENTITY_POLICY:'per-invocation-sha256-v1'},timeoutMs:1_200_000}
}
export async function runClosedFamily(id,{root,evidence,blender}){
 const command=closedFamilySuitePlan(id,{root,evidence,blender}),path=join(evidence,'suite-matrix.json')
 await assert.rejects(readFile(path),{code:'ENOENT'},'Use a fresh family transaction')
 const result=await executeNodePortCommand({...command,cwd:root,logPath:join(evidence,'family-matrix.log')})
 assert.equal(result.exitCode,0,'Family matrix failed; inspect family-matrix.log');assert.equal(result.timedOut,false);assert.equal(result.error,undefined)
 const receiptPath=join(evidence,id==='mono-switch-view'?'closed-receipt.json':'qualified.json'),bytes=await readFile(receiptPath)
 const proof=assertClosedFamilyReceipt(id,JSON.parse(bytes))
 await writeFile(path,JSON.stringify({status:'passed',family:id,built:true,receiptSha256:nodePortHash(bytes),nativeGraphs:proof.nativeGraphs,savedFinalScenes:proof.savedFinalScenes,browserCaseRuns:proof.browserCaseRuns,reuseNative:false},null,2)+'\n',{flag:'wx'})
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2),id=args.shift(),options={root:resolve(import.meta.dirname,'..')}
  assert.equal(args.length,4,'Specify --evidence and --blender')
  for(let i=0;i<args.length;i+=2){const key={'--evidence':'evidence','--blender':'blender'}[args[i]];assert.ok(key&&!Object.hasOwn(options,key)&&args[i+1]);options[key]=resolve(args[i+1])}
  await runClosedFamily(id,options)
 }catch(error){console.error(error);process.exitCode=1}
}
