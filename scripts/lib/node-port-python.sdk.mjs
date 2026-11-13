/** Fresh routing proof: actual SDK sync invokes the proof launcher for Final. No pixel qualification. */
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {createNodePortBlenderLauncher} from './node-port-python.mjs'
const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),args=process.argv.slice(2)
assert.equal(args[0],'--blender');assert.equal(args[2],'--output');assert.equal(args.length,4)
const directory=resolve(args[3]);await mkdir(directory)
const launcher=await createNodePortBlenderLauncher({blender:resolve(args[1]),directory:join(directory,"SDK launcher 'quoted'")})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function caches(directory){
 const entries=[]
 const walk=async folder=>{for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.pyc'))entries.push({path,sha256:hash(await readFile(path))})}}
 await walk(directory);return entries.sort((a,b)=>a.path.localeCompare(b.path))
}
try{
 const source=join(directory,'actual-source.blend')
 const expression='import bpy; bpy.ops.wm.read_factory_settings(use_empty=False); bpy.ops.wm.save_as_mainfile(filepath='+JSON.stringify(source)+')'
 const created=await exec(launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python-expr',expression],{maxBuffer:16*1024*1024,timeout:60_000})
 await writeFile(join(directory,'source-save.log'),created.stdout+created.stderr)
 const before=hash(await readFile(source)),cacheBefore=await caches(join(root,'packages/blendlink/dist/blender'))
 const {resolveConfig}=await import('../../packages/blendlink/dist/config.js')
 const {syncAll,verifyAll}=await import('../../packages/blendlink/dist/sync.js')
 const config=resolveConfig({blenderPath:launcher.executable,outDir:'public/models',genDir:'src/generated',scenes:[{name:'pythonCache',file:source}]},directory)
 await syncAll(config,{force:true})
 const issues=await verifyAll(config);assert.deepEqual(issues.filter(issue=>issue.severity!=='warning'),[])
 const scene=config.scenes[0],glb=await readFile(scene.glbPath),manifest=await readFile(scene.manifestPath)
 assert.equal(glb.subarray(0,4).toString(),'glTF');assert.equal(hash(await readFile(source)),before)
 assert.deepEqual(await caches(join(root,'packages/blendlink/dist/blender')),cacheBefore)
 const invocations=await Promise.all((await readdir(join(launcher.directory,'invocations'))).map(async file=>JSON.parse(await readFile(join(launcher.directory,'invocations',file),'utf8'))))
 const final=invocations.filter(row=>row.result?.args.includes('--python')&&row.result.args.some(arg=>arg.endsWith('export_scene.py')))
 assert.ok(final.length,'Actual SDK export did not traverse the proof launcher')
 for(const row of final){
  const argv=row.result.args;assert.ok(argv.indexOf('--python-expr')<argv.indexOf('--python')&&argv.indexOf('--python')<argv.indexOf('--'))
  assert.equal(row.result.pythonGuardApplied,true);assert.equal(row.result.cacheDisposed,true);assert.equal(row.result.exitCode,0)
 }
 assert.equal((await readdir(launcher.directory)).some(name=>name.startsWith('python-cache-')),false)
 await cp(launcher.directory,join(directory,'retained-launcher'),{recursive:true})
 await writeFile(join(directory,'report.json'),JSON.stringify({status:'ACTUAL_SDK_FINAL_PYTHON_ROUTING_PASSED',productionCases:0,
  numericalQualification:false,identity:launcher.identity,sourceSha256:before,glbSha256:hash(glb),manifestSha256:hash(manifest),
  projectCacheUnchanged:true,finalInvocations:final,invocations},null,2)+'\n')
 console.log('BLENDLINK_NATIVE_PYTHON_SDK_FINAL_PASSED '+JSON.stringify({finalInvocations:final.length,productionCases:0}))
}finally{await launcher.dispose()}
