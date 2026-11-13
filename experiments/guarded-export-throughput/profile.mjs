// CPU-only startup accounting. Every saved-scene export runs; no renderer/browser work.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,readdir,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher,nodePortPythonFileIdentity} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {resolveConfig} from '../../packages/blendlink/dist/config.js'
import {syncAll,verifyAll,publishedAssetPath} from '../../packages/blendlink/dist/sync.js'
const exec=promisify(execFile),root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.SCENETOWEB_EXPORT_THROUGHPUT_OUTPUT??'artifacts/guarded-export-throughput-baseline'),blender=process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',count=Number(process.env.SCENETOWEB_EXPORT_THROUGHPUT_COUNT??6)
assert.ok(Number.isInteger(count)&&count>=2&&count<=24);await mkdir(output,{recursive:true});await assert.rejects(readFile(join(output,'profile.json')),{code:'ENOENT'})
await captureRuntimeProvenance({root,built:true,label:'CPU export startup benchmark'})
const report={kind:'cpu-only-startup-profile',numericalCredit:0,count,hashes:[],runs:[]},timed=async label=>{const start=performance.now();const identity=await nodePortPythonFileIdentity(label);return{milliseconds:performance.now()-start,identity}}
for(const file of [blender,process.execPath,join(root,'scripts/lib/node-port-python.mjs'),join(root,'scripts/node-port-blender.mjs')])for(let i=0;i<5;i++)report.hashes.push(await timed(file))
let launcher
try{
 launcher=await createNodePortBlenderLauncher({blender,directory:join(output,'launcher')})
 const source=join(output,'owned.blend');await exec(launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python','experiments/guarded-export-throughput/scene.py'],{cwd:root,env:{...process.env,SCENETOWEB_EXPORT_THROUGHPUT_SCENE:source},timeout:120000,maxBuffer:8*1024*1024})
 const sourceSha256=hash(await readFile(source))
 for(const mode of (process.env.SCENETOWEB_EXPORT_THROUGHPUT_MODES??'direct,guarded,transaction').split(',')){
  assert.ok(['direct','guarded','transaction'].includes(mode));const guarded=mode!=='direct';let active=launcher,finalization=null,captureMs=0
  if(mode==='transaction'){const start=performance.now();active=await createNodePortBlenderLauncher({blender,directory:join(output,'transaction-launcher'),identityPolicy:'transaction-metadata-v1'});captureMs=performance.now()-start}
  const directory=join(output,mode+'-'+report.runs.length),config=resolveConfig({blenderPath:guarded?active.executable:blender,outDir:'public/models',genDir:'src/generated',scenes:Array.from({length:count},(_,index)=>({name:'owned'+index,file:source}))},directory)
  const before=new Set(await readdir(join(active.directory,'invocations'))),start=performance.now();await syncAll(config,{force:true});const milliseconds=performance.now()-start
  assert.deepEqual((await verifyAll(config)).filter(x=>x.severity!=='warning'),[]);assert.equal(hash(await readFile(source)),sourceSha256)
  const outputs=[];for(const scene of config.scenes){const m=JSON.parse(await readFile(scene.manifestPath)),p=m.materialPrograms?publishedAssetPath(scene,m.materialPrograms.url,m):null;outputs.push({manifestSha256:hash(await readFile(scene.manifestPath)),glbSha256:hash(await readFile(scene.glbPath)),program:p?JSON.parse(await readFile(p)):null,programSha256:p?hash(await readFile(p)):null})}
  let finalizeMs=0,archiveMs=0;if(mode==='transaction'){const start=performance.now();const pin=await active.finalize();finalization={pin,receipt:JSON.parse(await readFile(pin.path))};finalizeMs=performance.now()-start}
  if(guarded){const start=performance.now(),proof=await archiveNativeLauncher(active,join(directory,'identity-proof'),true);archiveMs=performance.now()-start;if(mode==='transaction'){assert.equal(proof.identityTransaction.sealedInvocations,count+1);assert.equal(proof.finalInvocations,count);finalization.archiveSha256=hash(JSON.stringify(proof));finalization.identityTransaction=proof.identityTransaction}}
  const invocations=[];for(const name of await readdir(join(active.directory,'invocations')))if(!before.has(name))invocations.push(JSON.parse(await readFile(join(active.directory,'invocations',name))))
  report.runs.push({mode,guarded,milliseconds,captureMs,finalizeMs,archiveMs,finalization,outputs,invocations});if(mode==='transaction')await active.dispose();await writeFile(join(output,'partial.json'),JSON.stringify(report,null,2)+'\n')
 }
 for(const run of report.runs.slice(1))for(let index=0;index<count;index++){assert.deepEqual(report.runs[0].outputs[index].program,run.outputs[index].program);assert.equal(report.runs[0].outputs[index].glbSha256,run.outputs[index].glbSha256)}
 report.sourceSha256=sourceSha256;report.native=launcher.identity.native;report.node=launcher.identity.node;report.noGPUWork=true;report.inputs={helperSha256:hash(await readFile(join(root,'scripts/lib/node-port-python.mjs'))),archiveSha256:hash(await readFile(join(root,'scripts/lib/native-proof-archive.mjs'))),fixtureSha256:hash(await readFile(join(import.meta.dirname,'scene.py'))),runnerSha256:hash(await readFile(new URL(import.meta.url)))}
 report.status='CPU_EXPORT_STARTUP_PROFILE_PASSED';await writeFile(join(output,'profile.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,runs:report.runs.map(x=>({mode:x.mode,ms:x.milliseconds,captureMs:x.captureMs,finalizeMs:x.finalizeMs,archiveMs:x.archiveMs,nativeMs:x.invocations.reduce((n,y)=>n+(y.result?.elapsedMs??0),0)}))}))
}finally{await launcher?.dispose()}
