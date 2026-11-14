import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,copyFile,readFile,readdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
import {writeCaptureManifest} from './archive.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),source=resolve(process.argv[3]),active=process.argv.includes('--active-coat')
await mkdir(directory)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(source));assert.equal(before,'a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e')
const copy=join(directory,'owned-cube.blend');await copyFile(source,copy)
const sourcePins={}
const sourcePaths=[]
for(const folder of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py'))sourcePaths.push(folder+'/'+name)
for(const name of ['probe.py','numeric-contract.json','run.mjs','inspect.py','transport_check.py','archive.mjs'])sourcePaths.push('experiments/cycles-normal-bake/'+name)
sourcePaths.push('scripts/lib/native-proof-archive.mjs','scripts/lib/node-port-contract.mjs')
for(const name of sourcePaths){const bytes=await readFile(join(root,name));sourcePins[name]=hash(bytes);const target=join(directory,'source-archive',name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,bytes)}
await writeFile(join(directory,'source-pins.json'),JSON.stringify(sourcePins,null,2)+'\n')
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'native')});let passed=false
try{
 const result=spawnSync(launcher.executable,['--background','--factory-startup','--disable-autoexec',copy,'--python-exit-code','1','--python',join(import.meta.dirname,'probe.py'),'--','--root',root,'--output',directory,...(active?['--active-coat']:[])],{cwd:root,env:process.env,encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024});await writeFile(join(directory,'native.log'),String(result.stdout)+String(result.stderr)+String(result.error??''));assert.equal(result.status,0,'Actual owned normal probe failed; inspect retained native.log');assert.equal(hash(await readFile(source)),before);assert.equal(hash(await readFile(copy)),before);for(const[name,pin]of Object.entries(sourcePins))assert.equal(hash(await readFile(join(root,name))),pin,'Proof source changed during actual bake: '+name);await launcher.finalize();passed=true
}finally{try{const archive=await archiveNativeLauncher(launcher,directory,passed);await writeFile(join(directory,'native-python-proof.json'),JSON.stringify({identity:launcher.identity,archive},null,2)+'\n')}finally{await launcher.dispose();if(passed){await writeCaptureManifest(directory,true);console.log('NORMAL_CAPTURE_MANIFEST '+hash(await readFile(join(directory,'capture-manifest.json'))))}}}
