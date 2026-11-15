import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {performance} from 'node:perf_hooks'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
import {executeNodePortCommand,nodePortHash} from '../../scripts/lib/node-port-contract.mjs'
const args=process.argv.slice(2),schema=args.includes('--schema-only'),filtered=args.filter(x=>x!=='--schema-only');assert.equal(filtered.length,1,'Pass fresh output directory [--schema-only]');const folder=resolve(filtered[0]);await mkdir(folder)
const root=resolve(import.meta.dirname,'../..'),launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(folder,'active'),timeoutMs:120000});let complete=false;const start=performance.now()
try{
 const result=await executeNodePortCommand({argv:[launcher.executable,'--background','--factory-startup','-t','1','--python-exit-code','17','--python',join(import.meta.dirname,'capture.py'),'--',folder,...(schema?['--schema-only']:[])],cwd:root,timeoutMs:120000,logPath:join(folder,'native.log')});assert.equal(result.exitCode,0,'Native capture failed; inspect retained native.log');assert.equal(result.timedOut,false)
 await launcher.finalize();complete=true
 const reportPath=join(folder,schema?'schema.json':'report.json');await writeFile(join(folder,'capture-receipt.json'),JSON.stringify({status:'completed',milliseconds:performance.now()-start,native:launcher.identity.native,reportSha256:nodePortHash(await readFile(reportPath)),scriptSha256:nodePortHash(await readFile(join(import.meta.dirname,'capture.py'))),contractSha256:nodePortHash(await readFile(join(import.meta.dirname,'contract.json'))),supportCredit:0},null,2)+'\n')
}finally{try{await writeFile(join(folder,'native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,folder,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
