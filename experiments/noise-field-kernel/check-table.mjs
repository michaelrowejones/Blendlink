import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {applyFieldTableOverlay} from './overlay.mjs'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve(process.argv[2]),reference=resolve(process.argv[3])
const snapshot=join(evidence,'baseline'),{provenance}=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'field-table-checks'})
const overlay=await applyFieldTableOverlay({root,snapshot,built:true,provenance})
const {lowerNearestNoiseField}=await import(pathToFileURL(join(overlay.snapshot,'fieldNearestTable.js')))
const visit=x=>!x||typeof x!=='object'?[]:[...(x.op==='noise_fractal'||x.op==='noise_normalized'?[x]:[]),...Object.values(x).flatMap(visit)]
const manifest=JSON.parse(readFileSync(join(reference,'index.json'))),cell=manifest.cases.find(x=>x.kind==='noise')
const source=visit(JSON.parse(readFileSync(join(reference,'ir',cell.id+'.json'))))[0]
const baseline=JSON.stringify(source),first=lowerNearestNoiseField(source);assert.ok(first)
assert.equal(JSON.stringify(source),baseline,'Lowering mutated the authored source')
for(const key of Object.keys(source.input))if(key!=='pixels')assert.deepEqual(first.image[key],source.input[key],key+' sampling/alpha semantics changed')
assert.ok(first.stats.minimum<0&&first.stats.maximum>1,'HDR/signed data was clamped')
const changes=[
 x=>x.scale.futureModel='unknown',x=>x.w.futureModel='unknown',x=>x.op='noise',x=>x.dimensions=3,x=>x.output='fac',x=>x.detail=3,x=>x.detail=7,
 x=>x.distortion=1,x=>x.distortion=0,x=>x.futurePrecisionModel='unknown',x=>x.roughnessNode={op:'const_float',value:.5},x=>x.evaluationModel='shader-mf',
 x=>x.input.sourceImageStorage='rgba8',x=>x.input.output='alpha',x=>x.input.sourceImageUploadRounding='toward-zero',
 x=>x.input.interpolation='Linear',x=>x.input.extension='CLIP',x=>x.input.workingSpace='ACEScg',x=>x.input.projection='box',
 x=>x.input.vector={op:'generated'},x=>x.scale.value=61.7,x=>x.input.width=16385,
 x=>x.input.pixels[0]=3,x=>x.input.pixels[0]=2**-24,x=>x.colorOffsets[0][0]=90000,
]
for(const [index,change]of changes.entries()){
 const input=structuredClone(source);input.w={op:'const_float',value:.375};change(input)
 assert.equal(lowerNearestNoiseField(input),undefined,'Unproved domain admitted at'+index)
}
const second=lowerNearestNoiseField(source);assert.deepEqual(first.image.pixels,second.image.pixels)
const report={checks:changes.length+4,sourceStats:first.stats,provenance:overlay.provenance}
writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('FIELD_TABLE_CHECKS_PASSED',report.checks,JSON.stringify(first.stats))
