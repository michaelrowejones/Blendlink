// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict'
import{mkdir,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher}from'../../scripts/lib/native-proof-archive.mjs'
import{executeNodePortCommand}from'../../scripts/lib/node-port-contract.mjs'
const[sourceArg,outArg]=process.argv.slice(2);assert.ok(sourceArg&&outArg)
const out=resolve(outArg);await mkdir(out);const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active'),timeoutMs:120000});let complete=false
try{const result=await executeNodePortCommand({argv:[launcher.executable,'--background','--factory-startup','--disable-autoexec','-t','1','--python-exit-code','17','--python',join(import.meta.dirname,'probe.py'),'--',resolve(sourceArg),join(out,'capture')],cwd:resolve(import.meta.dirname,'../..'),timeoutMs:120000,logPath:join(out,'native.log')});assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);await launcher.finalize();complete=true}finally{try{await writeFile(join(out,'native-archive.json'),JSON.stringify({complete,identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
