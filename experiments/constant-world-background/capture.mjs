import assert from'node:assert/strict'
import{spawn}from'node:child_process'
import{mkdir,readFile,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertQualification,assertFinal}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2])
await mkdir(resolve(directory,'..'),{recursive:true});await mkdir(directory)

const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'native-active')})
const env={...process.env,SCENETOWEB_WORLD_BACKGROUND_REFERENCES:directory,BLENDLINK_BLENDER:launcher.executable}
const run=(command,args,overrides={})=>new Promise((done,reject)=>{
 const child=spawn(command,args,{cwd:root,env:{...env,...overrides},stdio:'inherit'}),timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),500).unref()},300000)
 child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('World capture command failed '+code))})
})
const fixtureFiles=['experiments/constant-world-background/capture.mjs','experiments/constant-world-background/reference.py','experiments/constant-world-background/export.test.ts',
 'experiments/constant-world-background/protocol.mjs','experiments/constant-world-background/cases.json','experiments/constant-world-background/sources.json','packages/blender-addon/tests/world_background_check.py']
const fixtureHashes=Object.fromEntries(await Promise.all(fixtureFiles.map(async file=>[file,hash(await readFile(join(root,file)))])))
let archived=false
try{
 const setupDirectory=join(directory,'setup-only');await mkdir(setupDirectory)
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'experiments/constant-world-background/reference.py')],{SCENETOWEB_WORLD_SETUP_ONLY:'1',SCENETOWEB_WORLD_BACKGROUND_REFERENCES:setupDirectory})
 const setup=JSON.parse(await readFile(join(setupDirectory,'setup-policy.json')));assert.equal(setup.status,'CONSTANT_WORLD_SETUP_PASSED');assert.equal([...setup.cases,...setup.controls].length,7);assert.ok([...setup.cases,...setup.controls].every(row=>row.frames.length===0))
 for(const script of['packages/blender-addon/tests/world_background_check.py','experiments/constant-world-background/reference.py'])
  await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,script)])
 const native=assertQualification(JSON.parse(await readFile(join(directory,'qualification.json'))))
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/constant-world-background/export.test.ts'])
 const final=assertFinal(JSON.parse(await readFile(join(directory,'final-proof.json'))),native)
 for(const[file,pin]of Object.entries(fixtureHashes))assert.equal(hash(await readFile(join(root,file))),pin,'Capture fixture changed '+file)
 final.fixtureHashes=fixtureHashes
 await launcher.finalize();final.nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,true)};archived=true
 await validateNativeArchive(final.nativeArchive,directory,{expectedFinalSources:[...native.cases,...native.controls].map(row=>join(directory,row.sourceFile)),
  expectedScripts:[{path:join(root,'packages/blender-addon/tests/world_background_check.py'),invocations:1},{path:join(root,'experiments/constant-world-background/reference.py'),invocations:2}],
  helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 await writeFile(join(directory,'final-proof.json'),JSON.stringify(final,null,2)+'\n')
 console.log('SCENETOWEB_CONSTANT_WORLD_NATIVE_FINAL_CAPTURED '+JSON.stringify({native:native.cases.length,Final:final.rows.length}))
}finally{try{if(!archived)await writeFile(join(directory,'failed-native-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,false)},null,2)+'\n')}finally{await launcher.dispose()}}
