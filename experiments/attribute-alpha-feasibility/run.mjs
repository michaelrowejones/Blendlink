import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,open,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),out=resolve(process.argv[2]),hash=b=>createHash('sha256').update(b).digest('hex')
await mkdir(out,{recursive:false})
const files=['experiments/attribute-alpha-feasibility/probe.py','experiments/attribute-alpha-feasibility/run.mjs','experiments/attribute-alpha-feasibility/sources.json','experiments/vertex-color-alpha/fixture-geometry.json','packages/blender-addon/vertex_color_alpha.py','packages/blender-addon/material_compiler.py'],pins=Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(join(root,name)))])))
await writeFile(join(out,'inputs.json'),JSON.stringify(pins,null,2)+'\n')
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active')});let complete=false
try{
 const log=await open(join(out,'native.log'),'wx')
 try{await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,'probe.py')],{cwd:root,env:{...process.env,SCENETOWEB_ATTRIBUTE_ALPHA:out},stdio:['ignore',log.fd,log.fd]}),timer=setTimeout(()=>child.kill('SIGTERM'),90000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Native probe failed '+code+'; retained native.log'))})})}finally{await log.close()}
 for(const[name,pin]of Object.entries(pins))assert.equal(hash(await readFile(join(root,name))),pin)
 await launcher.finalize();complete=true
}finally{try{await writeFile(join(out,'native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
console.log('Retained Attribute Alpha research; no Final/browser/support credit')
