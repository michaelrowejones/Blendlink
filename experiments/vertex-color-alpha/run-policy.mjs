import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,open,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'

const root=resolve(import.meta.dirname,'../..'), output=resolve(process.argv[2])
await mkdir(output)
const script=join(root,'packages/blender-addon/tests/vertex_color_alpha_check.py')
const files=['packages/blender-addon/vertex_color_alpha.py','packages/blender-addon/material_compiler.py',
  'packages/blender-addon/tsl_ir.py','packages/blender-addon/tests/vertex_color_alpha_check.py',
  'packages/blendlink/src/tslVertexColorAlpha.ts','packages/blendlink/src/tslMaterialRuntime.ts',
  'packages/blendlink/src/tslNodeRecipe.ts', 'experiments/vertex-color-alpha/run-policy.mjs']
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const before=Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(join(root,file)))])))
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')})
let archived=false
try {
  const log=await open(join(output,'native.log'),'wx')
  try {
    const code=await new Promise((done,reject)=>{
      const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],
        {cwd:root,env:{...process.env,SCENETOWEB_VERTEX_ALPHA_POLICY:output},stdio:['ignore',log.fd,log.fd]})
      const deadline=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},120000)
      child.once('error',reject);child.once('close',code=>{clearTimeout(deadline);done(code)})
    })
    assert.equal(code,0,'native policy failed; retain native.log')
  } finally {await log.close()}
  await launcher.finalize()
  const packet={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,output,true)};archived=true
  await writeFile(join(output,'native-python-proof.json'),JSON.stringify(packet,null,2)+'\n')
  const nativePythonProof=await validateNativeArchive(packet,output,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],
    helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
  for(const [file,pin] of Object.entries(before))assert.equal(sha(await readFile(join(root,file))),pin)
  const policy=JSON.parse(await readFile(join(output,'policy.json')))
  assert.equal(policy.status,'VERTEX_ALPHA_NO_RENDER_POLICY_PASSED');assert.equal(policy.renders,0);assert.equal(policy.portCredit,0)
  await writeFile(join(output,'closed-policy.json'),JSON.stringify({status:'CLOSED_VERTEX_ALPHA_NO_RENDER_POLICY',portCredit:0,
    nativeShaderCredit:0,browserCredit:0,sourceHashes:before,nativePythonProof,policy},null,2)+'\n')
  console.log('Vertex Alpha source/GLB policy closed; no native shader, Final or browser qualification credit.')
} finally {
  try{if(!archived)await archiveNativeLauncher(launcher,output,false)}finally{await launcher.dispose()}
}
