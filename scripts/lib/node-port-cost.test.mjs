import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {analyzeNodePortCostBytes,inspectNodePortCost,validateNodePortCostLimits} from './node-port-cost.mjs'
import {runNodePortCost} from '../audit-node-port-cost.mjs'
const scalar=value=>({op:'const_float',value})
const ir=output=>({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})
const squeeze=()=>({op:'squeeze_native',model:'eevee-squeeze-f32-v1',sourceEngine:'EEVEE',sourceProfile:'declared-native-model',value:scalar(1),width:scalar(1),center:scalar(0)})
const limits=maximum=>({schemaVersion:1,model:'node-port-structural-limits-v1',maximum})

test('pins exact input bytes and reports structural facts without runtime/timing claims',()=>{
 const source=Buffer.from(JSON.stringify(ir(squeeze()))),report=analyzeNodePortCostBytes(source,{profile:'declared-webgpu-metal'})
 assert.equal(report.input.sha256,createHash('sha256').update(source).digest('hex'))
 assert.equal(report.metrics.programs,1);assert.equal(report.metrics.expressionOccurrences,4)
 assert.equal(report.metrics.maximumExpressionDepth,2);assert.equal(report.metrics.literalExpressions,3)
 assert.equal(report.profile.observed,false);assert.equal(report.performanceQualified,false);assert.equal(report.productionCases,0)
 for(const name of ['instructions','physicalTextureSamples','renderPasses','gpuMemoryBytes','timings'])assert.equal(report.runtimeCost[name],null)
 assert.equal(report.runtimeCost.semanticValidation,false)
 assert.equal(report.repeatedSubtrees.candidates.find(item=>item.op==='const_float').occurrences,2)
 assert.match(report.repeatedSubtrees.claim,/purity.*not established/)
})
test('accepts actual published channel.tslIr shape, counts per-channel expansion and does not mutate it',()=>{
 const output=squeeze(),input={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{'Base Color':{tslIr:ir(output)},Roughness:{tslIr:ir(output)}}}},images:{Image:{bytes:123}}}
 const before=JSON.stringify(input),report=inspectNodePortCost(input)
 assert.equal(JSON.stringify(input),before);assert.equal(report.metrics.programs,2);assert.equal(report.metrics.expressionOccurrences,8)
 assert.equal(report.metrics.externalImageDeclarations,1);assert.equal(report.metrics.declaredExternalImageBytes,123)
 const duplicate=report.repeatedSubtrees.candidates.find(item=>item.op==='squeeze_native')
 assert.equal(duplicate.occurrences,2);assert.equal(duplicate.scopes.length,2)
 assert.deepEqual(report.input,{source:'object-only',bytes:null,sha256:null})
})
test('does not inspect opaque pixel/LUT elements or claim payload-subtree equality',()=>{
 let accesses=0
 const payload=new Proxy(Array(4).fill(1),{get(target,key){if(key==='length')return target.length;accesses++;throw new Error('Opaque elements were traversed')}})
 const image={op:'tex_image',width:1,height:1,pixels:payload,vector:{op:'const_vec3',value:[0,0,0]}}
 const root={op:'combine',x:image,y:image,z:{op:'ramp_lut',values:payload,input:scalar(.5)}}
 const report=inspectNodePortCost(ir(root))
 assert.equal(accesses,0);assert.equal(report.metrics.embeddedPixelElements,8);assert.equal(report.metrics.opaqueTableElements,4)
 assert.equal(report.metrics.declaredFloat32PayloadBytes,48);assert.equal(report.metrics.imageExpressionOccurrences,2)
 assert.equal(report.repeatedSubtrees.candidates.some(item=>['tex_image','combine','ramp_lut'].includes(item.op)),false)
 assert.ok(report.opaquePayloads.every(item=>item.elementValuesValidated===false))
})
test('keeps negative zero and native source models distinct; unknown lowerings remain visible',()=>{
 const root={op:'new_unreviewed_kernel',a:scalar(-0),b:scalar(0),c:{...squeeze(),sourceProfile:'other-model'},d:squeeze(),e:{op:'__proto__'}}
 const report=inspectNodePortCost(ir(root))
 assert.equal(report.operations.__proto__,1);assert.equal(Object.hasOwn(report.operations,'__proto__'),true)
 assert.ok(report.runtimeCost.loweringNotEstimated.includes('new_unreviewed_kernel'))
 assert.equal(report.repeatedSubtrees.candidates.some(item=>item.op==='squeeze_native'),false)
 const one=report.repeatedSubtrees.candidates.filter(item=>item.op==='const_float')
 assert.deepEqual(one.map(item=>item.occurrences).sort(),[3,4])
})
test('structural limits enforce only named exact metrics, never inferred GPU work',()=>{
 const report=inspectNodePortCost(ir(squeeze()),{limits:limits({expressionOccurrences:3})})
 assert.equal(report.status,'structural-budget-exceeded')
 assert.deepEqual(report.structuralGate.violations,[{metric:'expressionOccurrences',maximum:3,actual:4}])
 assert.equal(inspectNodePortCost(ir(squeeze()),{limits:limits({expressionOccurrences:4})}).structuralGate.status,'within-structural-limits')
 for(const malformed of [limits({instructions:100}),limits({expressionOccurrences:null}),limits({expressionOccurrences:NaN}),limits({expressionOccurrences:-1}),limits({}),{...limits({programs:1}),timings:[] }])assert.throws(()=>validateNodePortCostLimits(malformed))
})
test('rejects malformed shapes and nonfinite/null numeric controls outside opaque data',()=>{
 for(const input of [null,{},ir(null),ir({op:''}),ir(scalar(null)),ir(scalar(Infinity)),ir({op:'const_vec3',value:[0,null,0]}),ir({op:'tex_image',width:1,height:1,pixels:[]}),ir({op:'tex_image',width:null,height:1,pixels:[0,0,0,1]}),ir({op:'tex_image'}),ir({op:'curve_native'}),{schemaVersion:1,model:'blendlink-material-programs-v1',materials:{A:{channels:{Color:{output:scalar(0)}}}}}])assert.throws(()=>inspectNodePortCost(input))
 assert.throws(()=>analyzeNodePortCostBytes(Buffer.from('{"schemaVersion":1,"model":"blendlink-tsl-ir-v1","output":{"op":"const_float","value":1e400}}')),/nonfinite|finite number/)
})
test('bounds cycles, deep nesting, shared-DAG expansion, sparse arrays and accessors',()=>{
 const cycle={op:'future'};cycle.input=cycle;assert.throws(()=>inspectNodePortCost(ir(cycle)),/cycle/)
 let deep=scalar(1);for(let index=0;index<258;index++)deep={op:'future',input:deep}
 assert.throws(()=>inspectNodePortCost(ir(deep)),/nesting/)
 let dag=scalar(1);for(let index=0;index<20;index++)dag={op:'future',a:dag,b:dag}
 assert.throws(()=>inspectNodePortCost(ir(dag)),/work bound/)
 assert.throws(()=>inspectNodePortCost(ir({op:'future',array:Array(1)})),/sparse/)
 const accessor={op:'future',get input(){throw new Error('Getter ran')}}
 assert.throws(()=>inspectNodePortCost(ir(accessor)),/accessor/)
})
test('CLI writes a new receipt, preserves existing output, and retains failures with input hashes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'node-port-cost-'))
 try{
  const input=join(directory,'input.json'),output=join(directory,'report.json'),contract=join(directory,'limits.json')
  await writeFile(input,JSON.stringify(ir(squeeze())));await writeFile(contract,JSON.stringify(limits({expressionOccurrences:3})))
  const report=await runNodePortCost(['--input',input,'--output',output,'--limits',contract])
  assert.equal(report.status,'structural-budget-exceeded');assert.match(report.analyzerSha256,/^[a-f0-9]{64}$/)
  const bytes=await readFile(output);await assert.rejects(runNodePortCost(['--input',input,'--output',output]),/EEXIST/)
  assert.deepEqual(await readFile(output),bytes)
  await writeFile(input,'invalid JSON');const failure=await runNodePortCost(['--input',input,'--output',join(directory,'failure.json')])
  assert.equal(failure.status,'analysis-failed');assert.match(failure.input.sha256,/^[a-f0-9]{64}$/);assert.equal(failure.performanceQualified,false)
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('optional bounded image digests diagnose cross-channel payload repetition without residency claims',()=>{
 const image=()=>({op:'tex_image',width:1,height:1,pixels:[-.5,0,1,1],vector:{op:'const_vec3',value:[0,0,0]}})
 const input={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{channels:{Color:{tslIr:ir(image())},Roughness:{tslIr:ir(image())}}}}}
 const complete=inspectNodePortCost(input,{pixelDigestElements:8}).embeddedImagePayloads
 assert.equal(complete.occurrenceLogicalBytes,32);assert.equal(complete.confirmedUniqueLogicalBytes,16)
 assert.equal(complete.confirmedRepeatedLogicalBytes,16);assert.equal(complete.coverageComplete,true)
 assert.equal(complete.groups[0].occurrences,2);assert.equal(complete.groups[0].scopes.length,2)
 assert.match(complete.claim,/not unique source-file storage.*GPU residency/)
 const partial=inspectNodePortCost(input,{pixelDigestElements:4}).embeddedImagePayloads
 assert.equal(partial.coverageComplete,false);assert.equal(partial.confirmedRepeatedLogicalBytes,0)
 assert.equal(partial.unverified[0].reason,'element-budget')
 assert.throws(()=>inspectNodePortCost(input,{pixelDigestElements:262145}),/bounded work/)
 input.materials.Artist.channels.Color.tslIr.output.pixels[0]=null
 assert.throws(()=>inspectNodePortCost(input,{pixelDigestElements:8}),/finite exact Float32/)
})

test('bounds sidecar wrapper records even when they contain no executable channels',()=>{
 const materials=Object.fromEntries(Array.from({length:4097},(_,index)=>[String(index),{channels:{}}]))
 assert.throws(()=>inspectNodePortCost({schemaVersion:1,model:'blendlink-material-programs-v1',materials}),/record count.*work bound/)
 const images=Object.fromEntries(Array.from({length:4097},(_,index)=>[String(index),{bytes:0}]))
 assert.throws(()=>inspectNodePortCost({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{},images}),/image count.*work bound/)
})
