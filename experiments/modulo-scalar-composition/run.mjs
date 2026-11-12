import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs'
import{createHash}from'node:crypto'
import {resolve,join} from 'node:path'
const root=resolve(import.meta.dirname,'../..')
const evidence=resolve(process.env.BLENDLINK_MODULO_COMPOSITION_EVIDENCE||join(root,'artifacts/modulo-scalar-composition'))
mkdirSync(evidence,{recursive:true})
if(!process.argv.includes('--reuse-reference')) {
 const blender=process.env.BLENDLINK_BLENDER;assert.ok(blender,'BLENDLINK_BLENDER must select the native oracle')
 const frozen=join(evidence,'native-'+Date.now());mkdirSync(frozen,{recursive:true})
 for(const directory of ['packages/blendlink/blender','packages/blender-addon'])for(const file of readdirSync(join(root,directory)))if(file.endsWith('.py')||file.endsWith('.json'))copyFileSync(join(root,directory,file),join(frozen,file))
 const fixture=join(frozen,'composition-reference.py'),shared=join(frozen,'noise-reference.py')
 copyFileSync(join(import.meta.dirname,'reference.py'),fixture);copyFileSync(join(root,'experiments/noise-fractal-differential/reference.py'),shared)
 const log=execFileSync(blender,['--background','--factory-startup','--python-exit-code','1','--python',fixture],
  {cwd:root,env:{...process.env,BLENDLINK_MODULO_COMPOSITION_REFERENCE:join(evidence,'reference'),BLENDLINK_MODULO_COMPOSITION_ROOT:root,BLENDLINK_NOISE_NATIVE_MODULES:frozen,BLENDLINK_MODULO_COMPOSITION_SHARED_REFERENCE:shared},encoding:'utf8',maxBuffer:64*1024*1024})
 assert.match(log,/BLENDLINK_MODULO_SCALAR_COMPOSITION_NATIVE_PASSED/);writeFileSync(join(evidence,'reference.log'),log)
}
const fixture=JSON.parse(readFileSync(join(evidence,'reference/index.json'),'utf8'));assert.equal(fixture.requestedCases,fixture.cases.length+fixture.refusals.length)
assert.equal(fixture.fixtureSha256,createHash('sha256').update(readFileSync(join(import.meta.dirname,'reference.py'))).digest('hex'),'Regenerate after fixture edits')
execFileSync(process.execPath,[join(root,'experiments/noise-fractal-differential/run.mjs'),'--reuse-reference',...(process.argv.includes('--built')?['--built']:[])],
 {cwd:root,env:{...process.env,BLENDLINK_NOISE_EVIDENCE:evidence},stdio:'inherit'})
