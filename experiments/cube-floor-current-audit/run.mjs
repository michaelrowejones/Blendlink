/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),source=await realpath(process.argv[3]),sha=bytes=>createHash('sha256').update(bytes).digest('hex');await mkdir(resolve(process.argv[2]));const out=await realpath(resolve(process.argv[2])),script=join(root,'experiments/cube-floor-current-audit/probe.py')
const paths=['experiments/cube-floor-current-audit/probe.py','experiments/cube-floor-current-audit/run.mjs'];for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py')||name.endsWith('.json'))paths.push(folder+'/'+name)
const capture=()=>Promise.all(paths.sort().map(async file=>[file,sha(await readFile(join(root,file)))] )).then(Object.fromEntries),inputs=await capture(),sourceHash=sha(await readFile(source));assert.equal(sourceHash,'a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e');await writeFile(join(out,'source-pins.json'),JSON.stringify(inputs,null,2)+'\n')
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active'),timeoutMs:120000});let complete=false,log=''
try{
 await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','--disable-autoexec','-t','1','--python-exit-code','1','--python',script,'--',join(out,'report.json'),source],{cwd:root,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),120000);const consume=data=>{log+=data.toString();if(log.length>8*1024*1024)child.kill('SIGTERM')};child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Floor source audit failed '+code))})});assert.deepEqual(await capture(),inputs);assert.equal(sha(await readFile(source)),sourceHash);await launcher.finalize();complete=true
}finally{try{await writeFile(join(out,'native.log'),log);await writeFile(join(out,'archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
const report=JSON.parse(await readFile(join(out,'report.json')));assert.equal(report.status,'OBSERVED_ORIGINAL_FLOOR_SOURCE_ONLY');assert.deepEqual(report.guards,{allCanariesRefused:true,gpu:0,render:0,evaluate:0});assert.equal(report.source.sourceOwnershipPreserved,true);assert.equal(report.floor.renderTrianglesExact,8388608)
const archive=await validateNativeArchive(JSON.parse(await readFile(join(out,'archive.json'))),out,{expectedScripts:[{path:script,invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
await writeFile(join(out,'closed.json'),JSON.stringify({status:'CLOSED_ORIGINAL_FLOOR_SOURCE_AUDIT',supportCredit:0,reportSha256:sha(await readFile(join(out,'report.json'))),archiveSha256:sha(await readFile(join(out,'archive.json'))),sourcePins:inputs,archive},null,2)+'\n');console.log('CLOSED_ORIGINAL_FLOOR_SOURCE_AUDIT')
