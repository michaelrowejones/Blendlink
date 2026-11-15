// SPDX-License-Identifier: MIT
// Mutates snapshot copies only; no Blender sources, shaders or coverage are changed.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {planUpdate} from './plan.mjs'
const [input,out,...extra]=process.argv.slice(2);assert.ok(out&&!extra.length)
const bytes=await readFile(input),baseline=JSON.parse(bytes),sha=b=>createHash('sha256').update(b).digest('hex')
const cases=[]
for(const [name,predicate,expected]of [
 ['gradient-body',p=>p.endsWith('/gpu_shader_material_tex_gradient.bsl.hh'),['gradient']],
 ['white-noise-hash-helper',p=>p.endsWith('/gpu_shader_common_hash.bsl.hh'),['white_noise']],
 ['gradient-constants',p=>p.endsWith('/gpu_shader_math_constants.bsl.hh'),['gradient']],
 ['compiler',p=>p.endsWith('/shader_tool/processor.cc'),['checker','gradient','white_noise']],
 ['compatibility',p=>p.endsWith('/gpu_shader_compat_glsl.glsl'),['checker','gradient','white_noise']],
 ['generator',p=>p==='tool:generator',['checker','gradient','white_noise']],
 ]){
 const next=structuredClone(baseline),changedPaths=new Set()
 for(const bucket of [next.global,...Object.values(next.families)])for(const path of Object.keys(bucket))if(predicate(path)){bucket[path]=sha('synthetic changed bytes '+path);changedPaths.add(path)}
 assert.ok(changedPaths.size);const start=performance.now(),plan=planUpdate(baseline,next),elapsedMs=performance.now()-start
 assert.deepEqual(plan.families.filter(f=>f.freshNumericalVerificationRequired).map(f=>f.name),expected)
 cases.push({name,changedPaths:[...changedPaths],elapsedMs,plan})
}
const report={schemaVersion:1,kind:'counterfactual-update-selection-on-real-compiler-dependencies',baselineSha256:sha(bytes),supportPromotion:false,sourceFilesModified:false,nativeOrBrowserJobs:0,cases}
await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({cases:cases.length,sourceFilesModified:false,supportPromotion:false}))
