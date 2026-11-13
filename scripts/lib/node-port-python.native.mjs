/** Opt-in actual Blender import-cache regression; grants zero node numerical credit. */
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {createNodePortBlenderLauncher} from './node-port-python.mjs'
const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),binaries=[]
let output
for(let index=0;index<args.length;index+=2){assert.ok(args[index+1]);if(args[index]==='--blender')binaries.push(resolve(args[index+1]));else{assert.equal(args[index],'--output');assert.equal(output,undefined);output=resolve(args[index+1])}}
assert.ok(binaries.length&&output,'Use --blender PATH (repeatable) --output FRESH_DIRECTORY')
await mkdir(output)
const receipts=[]
for(const[index,blender]of binaries.entries()){
 const directory=join(output,'native-'+index);await mkdir(directory)
 const launcher=await createNodePortBlenderLauncher({blender,directory:join(directory,"launcher files 'quoted'")})
 try{
  const result=await exec('python3',[join(here,'node-port-python.native.py'),launcher.identity.native.path,launcher.executable],{
   env:{...process.env,BLENDLINK_PYTHON_RESEARCH_OUTPUT:directory},maxBuffer:16*1024*1024,timeout:180_000})
  await writeFile(join(directory,'controller.log'),result.stdout+result.stderr)
  const report=JSON.parse(await readFile(join(directory,'cache-research.json'),'utf8'))
  assert.equal(report.status,'NATIVE_PYTHON_CACHE_RESEARCH_PASSED')
  const invocations=await readdir(join(launcher.directory,'invocations'));assert.equal(invocations.length,1)
  const invocation=JSON.parse(await readFile(join(launcher.directory,'invocations',invocations[0]),'utf8'))
  assert.equal(invocation.result.pythonGuardApplied,true);assert.equal(invocation.result.cacheDisposed,true);assert.equal(invocation.result.exitCode,0)
  assert.equal((await readdir(launcher.directory)).some(name=>name.startsWith('python-cache-')),false)
  await cp(launcher.directory,join(directory,'retained-launcher'),{recursive:true})
  receipts.push({directory:'native-'+index,identity:launcher.identity,report,invocation})
 }finally{await launcher.dispose()}
}
const sources={}
for(const name of ['node-port-python.mjs','node-port-python.native.mjs','node-port-python.native.py','node-port-python.probe.py','../node-port-blender.mjs'])sources[name]=createHash('sha256').update(await readFile(join(here,name))).digest('hex')
await writeFile(join(output,'report.json'),JSON.stringify({status:'ACTUAL_NATIVE_CACHE_LAUNCHER_PASSED',productionCases:0,sources,receipts},null,2)+'\n')
console.log('BLENDLINK_NATIVE_PYTHON_LAUNCHER_PASSED '+JSON.stringify(receipts.map(row=>row.report.profiles[0].version)))
