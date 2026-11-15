/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {assertBaseline,assertSourcePolicy,statuses} from './protocol.mjs'
import {preflightBrowserProofContracts} from '../../scripts/lib/browser-proof-contract.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2])
assert.ok(process.argv[2],'A fresh evidence directory is required')
const run=args=>new Promise((done,reject)=>{
 const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'}),timer=setTimeout(()=>child.kill('SIGTERM'),600000)
 child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Displace matrix command failed '+code+': '+args.join(' ')))})
})
// All fixture schema/producer-order controls run before creating native work.
await preflightBrowserProofContracts(root,['compositor-displace-single'])
await run(['--test','experiments/compositor-displace-single/protocol.test.mjs','experiments/compositor-displace-single/readback-server.test.mjs'])
await mkdir(resolve(out,'..'),{recursive:true})
await run(['experiments/compositor-displace-single/policy.mjs',out+'-source-policy'])
assertSourcePolicy(JSON.parse(await readFile(join(out+'-source-policy','policy.json'))))
await run(['experiments/compositor-displace-single/capture.mjs','sources',out])
const profiles=[]
for(const profile of ['metal','software']){
 await run(['experiments/compositor-displace-single/run.mjs','baseline',out,profile])
 profiles.push(assertBaseline(JSON.parse(await readFile(join(out,'browser-baseline-'+profile,'report.json'))),profile))
}
await writeFile(join(out,'baselines.json'),JSON.stringify({status:statuses.allBaselines,profiles},null,2)+'\n')
await run(['experiments/compositor-displace-single/capture.mjs','references',out])
for(const profile of ['metal','software'])await run(['experiments/compositor-displace-single/run.mjs','compare',out,profile])
await run(['experiments/compositor-displace-single/verify.mjs',out,join(out,'qualified.json')])
