/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]);assert.ok(process.argv[2]);await mkdir(directory)
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'active')})
const files=['compositor_vector_rotate_unit_axis_check.py','compositor_vector_rotate_check.py'],records=[];let complete=false
try{
 for(const name of files){let output='';const script=join(root,'packages/blender-addon/tests',name),report=join(directory,name+'.json');await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script,'--',report],{cwd:root,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),120000);const consume=chunk=>output+=chunk;child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',async code=>{clearTimeout(timer);await writeFile(join(directory,name+'.log'),output);code===0?done():reject(Error('Unit-axis policy failed '+name+' '+code))})});const value=JSON.parse(await readFile(report));assert.equal(value.gpuInitializations,0);assert.equal(value.nativeRenders,0);assert.equal(value.supportCredit,0);const{validateVectorRotateProgram}=await import(join(root,'packages/blendlink/dist/tslCompositorVectorRotate.js'));for(const row of value.programs)validateVectorRotateProgram(row.program);records.push({name,report:report.slice(directory.length+1),sha256:hash(await readFile(report)),positives:value.positives.length,refusals:value.refusals.length})}
 await launcher.finalize();complete=true
}finally{try{await writeFile(join(directory,'archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
const archive=await validateNativeArchive(JSON.parse(await readFile(join(directory,'archive.json'))),directory,{expectedScripts:files.map(name=>({path:join(root,'packages/blender-addon/tests',name),invocations:1})),expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
await writeFile(join(directory,'closed.json'),JSON.stringify({status:'CLOSED_SOURCE_ONLY_VECTOR_ROTATE_UNIT_AXIS',supportCredit:0,records,archive},null,2)+'\n');console.log('CLOSED_SOURCE_ONLY_VECTOR_ROTATE_UNIT_AXIS',records)
