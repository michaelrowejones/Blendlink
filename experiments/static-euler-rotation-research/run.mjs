import assert from'node:assert/strict'
import{spawn}from'node:child_process'
import{mkdir,open,readFile,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]);await mkdir(resolve(output,'..'),{recursive:true});await mkdir(output)
const script=join(root,'experiments/static-euler-rotation-research/witness.py'),launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
const paths=[script,join(root,'experiments/static-euler-rotation-research/run.mjs'),join(root,'experiments/static-euler-rotation-research/sources.json'),join(root,'packages/blendlink/blender/compositor_static_matrix.py'),join(root,'packages/blender-addon/tests/compositor_reference.py')],sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])))
async function archive(complete){if(complete)await launcher.finalize();const record={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,output,complete)};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');archived=true;return record}
try{
 const log=await open(join(output,'native.log'),'wx')
 try{const code=await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_EULER_WITNESS:output},stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},120000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);done(code)})});assert.equal(code,0,'Native Euler witness research failed; retain native.log')}finally{await log.close()}
 const record=await archive(true),nativePythonProof=await validateNativeArchive(record,output,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const report=JSON.parse(await readFile(join(output,'report.json')));assert.equal(report.status,'CAPTURED_EULER_CPU_HASH_WITNESS_RESEARCH');assert.equal(report.credits.support,0)
 for(const[path,pin]of Object.entries(sourceHashes))assert.equal(sha(await readFile(path)),pin)
 await writeFile(join(output,'closed-research.json'),JSON.stringify({status:'CLOSED_EULER_CPU_HASH_WITNESS_RESEARCH',qualificationCredit:0,sourceHashes,nativePythonProof,report},null,2)+'\n');console.log('Closed CPU Euler research: '+report.status)
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
