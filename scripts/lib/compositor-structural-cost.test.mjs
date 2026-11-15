import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {inspectCompositorCost} from './compositor-structural-cost.mjs'
import {analyzeNodePortCostBytes} from './node-port-cost.mjs'
import {runNodePortCost} from '../audit-node-port-cost.mjs'

const ref=node=>({kind:'ref',node,type:'INT'})
const binding=value=>({name:'A',socketType:'INT',value})
const op=(id,inputs={},kind='utility-constant')=>({id,kind,type:'INT',inputs,properties:{},source:{path:['Root'],node:id,nodeType:'FunctionNodeInputInt',output:'Integer'}})
const graph=()=>({version:1,status:'extracted',passes:[],ops:[op('literal'),op('shared',{A:binding(ref('literal')),B:binding(ref('literal'))},'bit-math'),op('unused')],output:{kind:'convert',type:'RGBA',fromType:'INT',input:ref('shared')}})
const bytes=value=>Buffer.from(JSON.stringify(value))

test('DAG metrics count declared IR operations, repeated edges and unused subgraphs independently',()=>{
 const result=inspectCompositorCost(graph())
 assert.deepEqual(result.metrics,{operations:3,references:3,conversions:1,maximumDependencyDepth:2,maximumFanout:2,reachableOperations:2,unusedOperations:1,imageDeclarations:0,declaredImageDecodedBytes:0,imagePayloadCharacters:0,passDeclarations:0})
 assert.deepEqual(result.sharedReferences,[{id:'literal',uses:2}]);assert.deepEqual(result.unusedOperationIds,['unused'])
 assert.equal(result.performanceQualified,false);assert.equal(result.productionCases,0)
 assert.equal(result.runtimeCost.renderPasses,null);assert.equal(result.runtimeCost.gpuMemoryBytes,null);assert.equal(result.runtimeCost.semanticValidation,false)
})

test('actual source presentation dispatch pins complete input bytes while limiting analysis to compositor',()=>{
 const input=bytes({schemaVersion:1,model:'blendlink-source-presentation-v1',warnings:[],display:{ops:[{type:'Lut3DTransform'}]},compositor:graph()})
 const result=analyzeNodePortCostBytes(input,{profile:'declared-only'})
 assert.equal(result.model,'compositor-dag-structure-v1');assert.equal(result.input.sha256,createHash('sha256').update(input).digest('hex'))
 assert.equal(result.input.bytes,input.length);assert.equal(result.scope.displayAnalyzed,false);assert.equal(result.profile.observed,false)
 assert.deepEqual(result.metrics,inspectCompositorCost(graph()).metrics)
})

test('declared input image bytes are counted without decoding, deduplicating or trusting the payload',()=>{
 const input=graph(),image={model:'native-cpu-static-image-v1',encoding:'zlib-le-rgba32f',width:3,height:5,decodedBytes:240,data:'not-decoded'}
 input.images={one:image,two:structuredClone(image)};input.passes=[{pass:'Image'}]
 const result=inspectCompositorCost(input)
 assert.equal(result.metrics.imageDeclarations,2);assert.equal(result.metrics.declaredImageDecodedBytes,480)
 assert.equal(result.metrics.imagePayloadCharacters,22);assert.equal(result.metrics.passDeclarations,1)
 assert.equal(result.runtimeCost.gpuMemoryBytes,null)
 assert.throws(()=>inspectCompositorCost(input,{pixelDigestElements:1}),/not decoded/)
 for(const patch of [{decodedBytes:239},{width:1.5},{height:0},{encoding:'unknown'}]){
  const candidate=structuredClone(input);Object.assign(candidate.images.one,patch);assert.throws(()=>inspectCompositorCost(candidate))
 }
})

test('structural budgets remain separate from material limits and performance claims',()=>{
 const limits={schemaVersion:1,model:'compositor-structural-limits-v1',maximum:{operations:3,maximumFanout:1,unusedOperations:0}}
 const result=inspectCompositorCost(graph(),{limits})
 assert.equal(result.status,'structural-budget-exceeded');assert.deepEqual(result.structuralGate.violations,[{metric:'maximumFanout',maximum:1,actual:2},{metric:'unusedOperations',maximum:0,actual:1}])
 assert.equal(result.performanceQualified,false)
 for(const change of [v=>v.model='node-port-structural-limits-v1',v=>v.maximum.gpuMemoryBytes=0,v=>v.maximum.operations=-1,v=>v.extra=true]){const v=structuredClone(limits);change(v);assert.throws(()=>inspectCompositorCost(graph(),{limits:v}))}
})

test('malformed, cyclic, duplicated, dangling and out-of-order references fail before costing',()=>{
 const mutations=[v=>v.status='unsupported',v=>v.ops.push(structuredClone(v.ops[0])),v=>v.ops[1].inputs.A.value.node='missing',v=>v.ops[0].inputs.A=binding(ref('shared')),v=>delete v.output,v=>v.output.kind='opaque',v=>v.ops[0].source.nodeType='',v=>v.ops[1].inputs.A.value.type='']
 for(const mutate of mutations){const v=graph();mutate(v);assert.throws(()=>inspectCompositorCost(v))}
 const cycle=graph();cycle.output.input=cycle.output;assert.throws(()=>inspectCompositorCost(cycle),/cycle/)
 const accessor=graph();Object.defineProperty(accessor.ops[0],'kind',{get(){throw new Error('getter executed')},enumerable:true});assert.throws(()=>inspectCompositorCost(accessor),/accessors/)
})

test('bounded work rejects oversized DAGs and deeply nested conversions',()=>{
 const large=graph();large.ops=Array.from({length:2049},(_,i)=>op('n'+i));assert.throws(()=>inspectCompositorCost(large),/bound/)
 const nested=graph();for(let i=0;i<65;i++)nested.output={kind:'convert',type:'RGBA',fromType:'RGBA',input:nested.output}
 assert.throws(()=>inspectCompositorCost(nested),/bounded work/)
})

test('object-only analysis uses bounded dense JSON indices rather than custom array iterators',()=>{
 const input=graph();input.ops[Symbol.iterator]=function*(){for(let i=0;i<2049;i++)yield op('forged'+i)}
 assert.deepEqual(inspectCompositorCost(input).metrics,inspectCompositorCost(graph()).metrics)
 const getter=graph();Object.defineProperty(getter.ops,'1',{get(){throw Error('Array getter executed')},enumerable:true})
 assert.throws(()=>inspectCompositorCost(getter),/accessors/)
 const sparse=graph();delete sparse.ops[1];assert.throws(()=>inspectCompositorCost(sparse),/holes/)
})

test('CLI pins both analyzer modules and preserves an existing output; failures have zero qualification',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'scenetoweb-compositor-cost-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const input=join(directory,'input.json'),output=join(directory,'cost.json');await writeFile(input,bytes(graph()))
 const result=await runNodePortCost(['--input',input,'--output',output]);assert.equal(result.status,'analyzed')
 assert.match(result.analyzerSha256,/^[a-f0-9]{64}$/);assert.match(result.compositorAnalyzerSha256,/^[a-f0-9]{64}$/)
 const saved=await readFile(output);await assert.rejects(runNodePortCost(['--input',input,'--output',output]),{code:'EEXIST'});assert.deepEqual(await readFile(output),saved)
 const bad=graph();bad.output.node='absent';bad.output=ref('absent');await writeFile(input,bytes(bad))
 const failure=await runNodePortCost(['--input',input,'--output',join(directory,'failed.json')]);assert.equal(failure.status,'analysis-failed');assert.equal(failure.performanceQualified,false);assert.equal(failure.productionCases,0)
})
