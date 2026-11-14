import assert from 'node:assert/strict'
import {readFile,readdir,realpath,stat,writeFile} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {createHash} from 'node:crypto'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
import {nodePortFileIdentity} from '../../scripts/lib/node-port-contract.mjs'

export const manifestName='capture-manifest.json'
export async function inventory(directory,prefix=''){
 const files=[]
 for(const entry of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  assert.equal(entry.isSymbolicLink(),false,'Capture archive cannot contain symlinks')
  const name=prefix+entry.name,path=join(directory,entry.name)
  if(entry.isDirectory())files.push(...await inventory(path,name+'/'))
  else{assert.equal(entry.isFile(),true);if(name!==manifestName){const bytes=await readFile(path);files.push({path:name,bytes:bytes.length,sha256:hash(bytes)})}}
 }
 return files
}
export async function writeCaptureManifest(directory,complete){
 directory=await realpath(directory)
 const files=await inventory(directory),find=path=>{const value=files.find(row=>row.path===path);assert.ok(value,'Missing producer artifact '+path);return value}
 const manifest={schemaVersion:1,kind:'scenetoweb-owned-normal-capture-v1',directory,complete,liveNodeCredit:0,files,
  report:find('report.json'),glb:find('material.glb'),programs:find('material.glb.materials.json'),sourcePins:find('source-pins.json'),nativeProof:find('native-python-proof.json')}
 await writeFile(join(directory,manifestName),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
 return manifest
}
export async function assertCaptureManifest(directory,expectedSha256){
 directory=await realpath(directory);const bytes=await readFile(join(directory,manifestName)),sha256=hash(bytes)
 if(expectedSha256)assert.equal(sha256,expectedSha256,'Capture manifest changed')
 const value=JSON.parse(bytes);assert.equal(value.schemaVersion,1);assert.equal(value.kind,'scenetoweb-owned-normal-capture-v1');assert.equal(value.directory,directory);assert.equal(value.complete,true);assert.equal(value.liveNodeCredit,0)
 assert.deepEqual(await inventory(directory),value.files,'Native producer artifact inventory/hash changed')
 for(const [key,path]of Object.entries({report:'report.json',glb:'material.glb',programs:'material.glb.materials.json',sourcePins:'source-pins.json',nativeProof:'native-python-proof.json'})){assert.equal(value[key]?.path,path);assert.deepEqual(value[key],value.files.find(row=>row.path===path),'Producer artifact pin is outside its census')}
 return {manifest:value,sha256}
}
export async function assertNativeCapture(root,directory){
 directory=await realpath(directory);const capture=await assertCaptureManifest(directory),read=async path=>JSON.parse(await readFile(join(directory,path)))
 const pins=await read('source-pins.json'),expected=[]
 for(const folder of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py'))expected.push(folder+'/'+name)
 for(const name of ['probe.py','numeric-contract.json','run.mjs','inspect.py','transport_check.py','archive.mjs'])expected.push('experiments/cycles-normal-bake/'+name)
 expected.push('scripts/lib/native-proof-archive.mjs','scripts/lib/node-port-contract.mjs')
 assert.deepEqual(Object.keys(pins).sort(),expected.sort(),'Native source census changed')
 for(const [path,pin]of Object.entries(pins)){assert.equal(hash(await readFile(join(root,path))),pin,'Native source changed: '+path);assert.equal(hash(await readFile(join(directory,'source-archive',path))),pin,'Native source archive changed')}
 const packet=await read('native-python-proof.json'),{identity,archive}=packet,owned=join(directory,'native-python-proof')
 assert.equal(archive.complete,true);assert.equal(archive.numericalCredit,false);assert.equal(await realpath(archive.directory),await realpath(owned));assert.deepEqual(await inventory(owned),archive.files)
 const config=JSON.parse(await readFile(join(owned,'launcher.json')))
 assert.equal(config.transaction,undefined,'This producer uses the default fresh standalone launcher');assert.equal(identity.transaction,undefined);assert.equal(config.kind,identity.kind);assert.deepEqual(config.native,identity.native);assert.deepEqual(config.node,identity.node)
 for(const key of ['native','node'])assert.deepEqual(await nodePortFileIdentity(identity[key].path),identity[key])
 for(const key of ['launcher','configuration','helper','bridge']){const path=relative(config.owned,identity[key].path);assert.ok(path!=='..'&&!path.startsWith('../'));assert.equal(hash(await readFile(join(owned,path))),identity[key].sha256)}
 for(const key of ['helper','bridge'])assert.deepEqual(config[key],identity[key])
 for(const [key,path]of [['helper','scripts/lib/node-port-python.mjs'],['bridge','scripts/node-port-blender.mjs']])assert.equal(hash(await readFile(join(root,path))),identity[key].sha256)
 const calls=[];for(const file of archive.files.filter(row=>row.path.startsWith('invocations/')))calls.push(JSON.parse(await readFile(join(owned,file.path))))
 assert.deepEqual(calls,archive.invocations);assert.equal(calls.length,1);assert.equal(archive.pythonInvocations,1);assert.equal(archive.finalInvocations,0)
 const call=calls[0],result=call.result;assert.equal(call.productionCases,0);assert.equal(call.kind,identity.kind);assert.equal(call.configSha256,identity.configuration.sha256);assert.deepEqual(call.native,identity.native);assert.deepEqual(call.node,identity.node);assert.equal(call.error,undefined)
 for(const [key,value]of Object.entries({exitCode:0,error:null,signal:null,timedOut:false,aborted:false,cacheDisposed:true,pythonGuardApplied:true}))assert.equal(result[key],value)
 const guard=result.args.indexOf('--python-expr'),script=result.args.indexOf('--python');assert.ok(guard>=0&&script>guard);assert.equal(result.args[guard+1],'import sys; sys.pycache_prefix='+JSON.stringify(result.cacheDirectory)+'; sys.dont_write_bytecode=True');await assert.rejects(stat(result.cacheDirectory),{code:'ENOENT'})
 const delimiter=result.args.indexOf('--');assert.ok(delimiter>script);const flag=name=>result.args[result.args.indexOf(name)+1]
 assert.equal(await realpath(flag('--root')),await realpath(root));assert.equal(await realpath(flag('--output')),directory);assert.equal(await realpath(flag('--disable-autoexec')),join(directory,'owned-cube.blend'))
 assert.equal(await realpath(result.args[script+1]),await realpath(join(root,'experiments/cycles-normal-bake/probe.py')));assert.ok(result.args.includes('--factory-startup')&&result.args.includes('--disable-autoexec'))
 const report=await read('report.json');assert.equal(report.status,'PASSED_OWNED_CUBE_NORMAL_BAKE_CARRIER');assert.deepEqual(report.version,[5,3,0]);assert.equal(report.build,'02f0899d78e3');assert.equal(report.engine,'CYCLES');assert.equal(report.sourcePreserved,true);assert.equal(report.stateRestored,true)
 assert.equal(report.sourceHash,'a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e');assert.equal(hash(await readFile(join(directory,'owned-cube.blend'))),report.sourceHash)
 const active=result.args.includes('--active-coat');assert.deepEqual(report.normalChannels,active?['Normal','Coat Normal']:['Normal']);assert.equal(report.rows.length,report.normalChannels.length);assert.equal(report.normalBakes,active?3:2)
 assert.deepEqual(report.numericContract,JSON.parse(await readFile(join(root,'experiments/cycles-normal-bake/numeric-contract.json'))))
 assert.equal(await realpath(report.materialPrograms.path),join(directory,'material.glb.materials.json'));assert.equal(report.materialPrograms.hash,capture.manifest.programs.sha256.slice(0,16));assert.equal(report.materialPrograms.bytes,capture.manifest.programs.bytes)
 assert.deepEqual(report.rows.map(row=>row.channel.includes('Coat Normal')?'Coat Normal':'Normal'),report.normalChannels)
 for(const row of report.rows){assert.equal(row.deviceClass,'gpu');assert.equal(row.backend,'metal');assert.match(row.sha256,/^[a-f0-9]{64}$/)}
 return {capture,report,prefix:result.cacheDirectory,identity}
}
