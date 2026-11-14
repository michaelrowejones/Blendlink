/* SPDX-License-Identifier: MIT */
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),requested=resolve(process.argv[2]??'artifacts/verification-wave-axis-native')
await mkdir(resolve(requested,'..'),{recursive:true});await mkdir(requested);const directory=await realpath(requested)
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'active')})
const run=(command,args,env={})=>new Promise((done,reject)=>{const child=spawn(command,args,{cwd:root,env:{...process.env,...env},stdio:'inherit'}),timer=setTimeout(()=>child.kill('SIGTERM'),120000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Wave axis research command failed '+code))})})
try{
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'experiments/compositor-wave-axis-research/capture.py')],{SCENETOWEB_WAVE_AXIS_OUTPUT:directory})
 await launcher.finalize();const archive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,true)}
 await validateNativeArchive(archive,directory,{expectedScripts:[{path:join(root,'experiments/compositor-wave-axis-research/capture.py'),invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 await writeFile(join(directory,'archive.json'),JSON.stringify(archive,null,2)+'\n')
 await run(process.execPath,[join(root,'experiments/compositor-wave-axis-research/compare.mjs'),directory])
}finally{await launcher.dispose()}
