import assert from 'node:assert/strict'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]),probe=join(import.meta.dirname,'probe.py');await mkdir(out,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:out,timeoutMs:60000}),sha=b=>createHash('sha256').update(b).digest('hex')
try{
 const r=spawnSync(launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python',probe,'--',join(out,'report.json')],{cwd:root,encoding:'utf8'});await writeFile(join(out,'native.log'),r.stdout+r.stderr)
 const record={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,r.status===0)};await writeFile(join(out,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');assert.equal(r.status,0,r.stdout+r.stderr)
 const validated=await validateNativeArchive(record,out,{expectedFinalSources:[],expectedScripts:[{path:probe,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const report=JSON.parse(await readFile(join(out,'report.json')));assert.equal(report.twins.length,12);assert.equal(report.rawCalibration.length,12);assert.equal(report.ownershipRestored,true)
 for(const row of report.twins){assert.equal(row.exactTwinWords,true);assert.equal(row.exactTwinHashes,true)}
 const receipt={status:'RESEARCH_INPUT_ROTATION_TWINS_CLOSED',supportCredit:0,renderCredit:0,gpuCredit:0,probeSha256:sha(await readFile(probe)),reportSha256:sha(await readFile(join(out,'report.json'))),nativePythonProof:validated,twins:12,componentComparisons:48,preStoreHashComparisons:48,rawCalibrationWords:36};await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt))
}finally{await launcher.dispose()}
