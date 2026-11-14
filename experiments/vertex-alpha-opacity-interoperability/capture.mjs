import assert from'node:assert/strict'
import{spawn}from'node:child_process'
import{mkdir,readFile,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertSource,assertFinal,assertProgram}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2])
await mkdir(resolve(directory,'..'),{recursive:true});await mkdir(directory)

const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'native-active')})
const env={...process.env,SCENETOWEB_ALPHA_OWNERSHIP:directory,BLENDLINK_BLENDER:launcher.executable}
const run=(command,args)=>new Promise((done,reject)=>{
 const child=spawn(command,args,{cwd:root,env,stdio:'inherit'}),timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),500).unref()},300000)
 child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Vertex Alpha capture command failed '+code))})
})
const fixtureFiles=['experiments/vertex-alpha-opacity-interoperability/capture.mjs','experiments/vertex-alpha-opacity-interoperability/source.py','experiments/vertex-alpha-opacity-interoperability/export.test.ts',
 'experiments/vertex-alpha-opacity-interoperability/protocol.mjs','experiments/vertex-alpha-opacity-interoperability/cases.json']
const fixtureHashes=Object.fromEntries(await Promise.all(fixtureFiles.map(async file=>[file,hash(await readFile(join(root,file)))])))
let archived=false
try{
 for(const script of['experiments/vertex-alpha-opacity-interoperability/source.py'])
  await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,script)])
 const native=assertSource(JSON.parse(await readFile(join(directory,'qualification.json'))))
 for(const row of native.cases)assertProgram(JSON.parse(await readFile(join(directory,row.rawProgramFile))),row)
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/vertex-alpha-opacity-interoperability/export.test.ts'])
 const final=assertFinal(JSON.parse(await readFile(join(directory,'final-proof.json'))),native)
 for(const[file,pin]of Object.entries(fixtureHashes))assert.equal(hash(await readFile(join(root,file))),pin,'Capture fixture changed '+file)
 final.fixtureHashes=fixtureHashes
 await launcher.finalize();final.nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,true)};archived=true
 await validateNativeArchive(final.nativeArchive,directory,{expectedFinalSources:native.cases.map(row=>join(directory,row.sourceFile)),
  expectedScripts:[{path:join(root,'experiments/vertex-alpha-opacity-interoperability/source.py'),invocations:1}],
  helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 await writeFile(join(directory,'final-proof.json'),JSON.stringify(final,null,2)+'\n')
 console.log('SCENETOWEB_VERTEX_ALPHA_NATIVE_FINAL_CAPTURED '+JSON.stringify({native:native.cases.length,Final:final.rows.length}))
}finally{try{if(!archived)await writeFile(join(directory,'failed-native-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,false)},null,2)+'\n')}finally{await launcher.dispose()}}
