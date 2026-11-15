/* SPDX-License-Identifier: MIT */
import test from 'node:test'
import assert from 'node:assert/strict'
import {cases,assertCasePlan,assertProgram,assertGroupTrace,assertQualification,assertFinal,assertPolicy,assertBrowserRows,policyPositive,policyRefusals} from './protocol.mjs'
import {compareNoise,numericDifference,word,assertRedFac} from './numeric-contract.mjs'
import {noiseProgramFixture,noiseNativeFixture,noiseFinalFixture,noiseBrowserFixture,noiseGroupTraceFixture} from './schema-fixtures.mjs'
const pin='a'.repeat(64)
const mutate=(value,change)=>{const copy=structuredClone(value);change(copy);return copy}
test('declared default field census retains ordinary, thin, lattice, group, repeated source and budget-bound cases',()=>{
 assertCasePlan(cases)
 for(const change of [x=>x.pop(),x=>x[1]={...x[0]},x=>x[0].perlinCalls=9,x=>x[0].resizeCases.pop(),x=>x[22].route='direct'])assert.throws(()=>assertCasePlan(mutate(cases,change)))
})
test('actual native and Final schemas refuse lost, extra, duplicated, unpinned and cross-family evidence',()=>{
 const q=noiseNativeFixture(),f=noiseFinalFixture(q);assertQualification(q);assertFinal(f,q,{built:true,nativeSha256:pin})
 for(const change of [x=>x.cases.pop(),x=>x.cases.push(x.cases[0]),x=>x.coordinateControls.pop(),x=>x.endpointControls.pop(),x=>x.fieldDomainControls[0].dimensions=[0,0],x=>x.nativeRenders--,x=>x.status='other',x=>x.build='other',x=>x.cases[0].pixelSha256='bad'])assert.throws(()=>assertQualification(mutate(q,change)))
 for(const change of [x=>x.rows.pop(),x=>x.provenance.pop(),x=>x.sourcePreserved=false,x=>x.nativeQualificationSha256='b'.repeat(64),x=>x.rows[0].moduleSha256='bad'])assert.throws(()=>assertFinal(mutate(f,change),q,{built:true,nativeSha256:pin}))
})
test('source schema preserves only the pinned compensated BLI model and exact original scalar controls',()=>{
 for(const row of cases)assertProgram(noiseProgramFixture(row),row)
 const p=noiseProgramFixture(),row=cases[0],ordered=JSON.parse(JSON.stringify(p,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,value[key]])):value));assertProgram(ordered,row)
 for(const change of [x=>x.ops[0].properties.noise_kernel='staged-f32-perlin2d-default-fbm-v1',x=>x.ops[0].properties.noise_kernel='compensated-bli-fade-f32-outer-noise2d-v2',x=>x.ops[0].properties.noise_build='other',x=>x.ops[0].properties.noise_dimensions=3,x=>x.ops[0].inputs.Scale.value.value=6,x=>x.ops[0].inputs.Distortion.value.value=-0,x=>x.ops[0].inputs.Scale.name='other',x=>x.ops[0].inputs.Scale.value.extra=1,x=>x.ops[0].inputs.Extra=x.ops[0].inputs.Scale,x=>delete x.ops[0].inputs.Detail,x=>x.passes.push({})])assert.throws(()=>assertProgram(mutate(p,change),row))
})
test('source policy closes real control identities and measured no-render/no-GPU guard canaries',()=>{
 const p={status:'NOISE_DEFAULT_FIELD_SOURCE_POLICY_PASSED',positive:[...policyPositive],refusals:[...policyRefusals],renders:0,gpuInitializationCalls:0,portCredit:0,guardControls:{gpuInitializationRefused:true,renderRefused:true}};assertPolicy(p)
 for(const change of [x=>x.positive.pop(),x=>x.refusals.reverse(),x=>x.renders=1,x=>x.gpuInitializationCalls=1,x=>x.guardControls.renderRefused=false])assert.throws(()=>assertPolicy(mutate(p,change)))
})
test('numeric tolerance requires both bounds; synthetic arms are separate from production value-range admission',()=>{
 const ulpOnly=numericDifference(word(.5)+9,word(.5));assert.ok(ulpOnly.absoluteError<=2**-20);assert.equal(ulpOnly.outsideTolerance,true)
 const absOnly=numericDifference(word(8)+2,word(8));assert.ok(absOnly.ulps<=8);assert.ok(absOnly.absoluteError>2**-20);assert.equal(absOnly.outsideTolerance,true)
 assert.equal(numericDifference(word(.5)+8,word(.5)).outsideTolerance,false)
})
test('exact alpha, lattice, scalar broadcast and independent orientation survive bounded approximate RGB',()=>{
 const entry={width:4,height:4,output:'Fac'},native=new Uint32Array(64),coordinates=new Uint32Array(64)
 for(let i=0;i<64;i+=4){native.set([word(.5),word(.5),word(.5),word(1)],i);coordinates.set([word(.125),word(.25),0,word(1)],i)}
 assert.equal(compareNoise(native,native,coordinates,entry).contractViolations,0)
 const alpha=native.slice();alpha[3]=word(.5);assert.ok(compareNoise(alpha,native,coordinates,entry).alphaDifferences>0)
 const differing=native.slice();differing[0]++;assert.ok(compareNoise(differing,native,coordinates,entry).facBroadcastDifferences>0)
 const lattice=coordinates.slice();lattice[0]=lattice[1]=0;const result=compareNoise(differing,native,lattice,entry);assert.ok(result.latticeDifferences>0&&result.contractViolations>0)
 const gradient=native.slice();for(let i=0;i<64;i+=4)gradient.fill(word(.2+i/1024),i,i+3)
 const flipped=new Uint32Array(64);for(let y=0;y<4;y++)flipped.set(gradient.subarray(y*16,y*16+16),(3-y)*16)
 assert.ok(compareNoise(flipped,gradient,coordinates,entry).contractViolations>0);assert.equal(compareNoise(flipped,gradient,coordinates,entry,true).contractViolations,0)
 assertRedFac(gradient,gradient);assert.throws(()=>assertRedFac(gradient,flipped))
})
test('group and variant fixtures bind real ancestry, every contributing edge, and exact pair-mean topology',()=>{
 const group=cases.find(row=>row.route==='group-reroute'),gp=noiseProgramFixture(group)
 for(const change of [x=>x.ops[0].source.path=['Compositor'],x=>x.ops[0].properties.noise_fixed_sources=x.ops[0].properties.noise_fixed_sources.filter(m=>m.nodeType!=='CompositorNodeGroup'),x=>x.ops[0].properties.noise_fixed_sources.at(-1).node='WrongGroup'])assert.throws(()=>assertProgram(mutate(gp,change),group))
 for(const route of ['shared-fac-color','two-color','six-fac']){
  const row=cases.find(r=>r.route===route),p=noiseProgramFixture(row)
  for(const change of [x=>x.ops.at(-1).inputs={},x=>x.ops.at(-1).inputs.Red.value={kind:'constant',type:'VALUE',value:.5},x=>x.ops.at(-1).inputs.Alpha.value.value=.5])assert.throws(()=>assertProgram(mutate(p,change),row))
 }
 const six=cases.find(r=>r.route==='six-fac'),sp=noiseProgramFixture(six)
 assert.throws(()=>assertProgram(mutate(sp,x=>x.ops.find(op=>op.kind==='math'&&op.properties.operation==='MULTIPLY').inputs.Value_001.value.value=.25),six))
 assert.throws(()=>assertQualification(mutate(noiseNativeFixture(),x=>x.pythonGpuInitializationCalls=1)))
 const direct=noiseProgramFixture();assert.throws(()=>assertProgram(mutate(direct,x=>x.output.fromType='RGBA'),cases[0]))
})
test('independent exact red/Fac closure includes responsive observations even within the numeric tolerance',async()=>{
 const {assertRedFacObservations}=await import('./numeric-contract.mjs'),fac=new Uint32Array([word(.5),word(.5),word(.5),word(1)]),color=fac.slice()
 const observations=[{cohort:'13x9->509x503:resize',output:'Fac',words:fac},{cohort:'13x9->509x503:resize',output:'Color',words:color}]
 assert.equal(assertRedFacObservations(observations).differences,0)
 const changed=fac.slice();changed[0]++;changed[1]++;changed[2]++
 assert.equal(numericDifference(changed[0],color[0]).outsideTolerance,false)
 assert.throws(()=>assertRedFacObservations([{...observations[0],words:changed},observations[1]]))
 assert.throws(()=>assertRedFacObservations(observations.slice(0,1)))
})
test('all four browser tuples close exact case, responsive, error and real ownership censuses before raw-word verification',()=>{
 const q=noiseNativeFixture(),f=noiseFinalFixture(q)
 for(const profile of ['metal','software'])for(const final of [false,true]){
  const options={profile,final},r=noiseBrowserFixture({...options,q,f})
  assertBrowserRows(r,q,f,options)
  const changes=[
   x=>x.status='failed',x=>x.built=false,x=>x.sourceDevice='GPU',x=>x.rows.reverse(),x=>x.rows[0].rows.pop(),
   x=>x.missingAdapterControl.refused=false,x=>x.rows[0].errors.push('validation error'),x=>x.rows[0].uncaptured.push('device lost'),x=>x.rows[0].pageErrors.push('uncaught error'),
   x=>x.rows[0].coordinateControls.pop(),x=>x.rows[0].coordinateControls[0].exactWordMismatches=1,
   x=>x.rows[0].savedDispose.physicalDestroys=2,x=>x.rows[0].savedDispose.bindingControls[0].borrowedUploads=1,
   x=>x.rows[0].rows[0].contractViolations=1,x=>x.rows[0].rows[0].maxUlps=9,x=>x.rows[0].rows[0].maxAbsoluteError=2**-19,
   x=>x.rows[0].rows[0].actualSha256='bad',x=>x.rows[0].rows[0].alphaDifferences=1,
   x=>x.rows[0].rows[0].resizeResults.pop(),x=>x.rows[0].rows[0].resizeResults[0].repeatUploads=1,
   x=>x.rows[0].rows[0].animationFrames=[1,1],x=>x.rows[0].rows[0].maximumAxisBytes=65540,
   x=>x.rows[0].rows[0].additionalPortPasses=1,x=>x.rows[0].rows[0].remainingRenderTargets=1,
   x=>x.rows[0].gpu={api:'WebGPU',description:profile==='metal'?'SwiftShader':'Apple Metal'}
  ]
  if(final)changes.push(x=>x.rows[0].rows[0].installationCycles.pop(),x=>x.rows[0].rows[0].installationCycles[0].preparation.axisAllocations=-1,x=>x.rows[0].rows[0].rendererCallbacksRestored=false,x=>x.rows[0].rows[0].hostAfterCalls=0,x=>x.rows[0].rows[0].cancelledPreparationRejected=false,x=>x.rows[0].rows[0].remainingTextures=1)
  for(const change of changes)assert.throws(()=>assertBrowserRows(mutate(r,change),q,f,options))
 }
})

test('native transparent group proof binds every physical reroute edge to the extracted source ancestry',()=>{
 const row=cases.find(r=>r.route==='group-reroute'),program=noiseProgramFixture(row),trace=noiseGroupTraceFixture()
 assertGroupTrace(trace,program)
 for(const change of [x=>x.links.pop(),x=>x.links[0].from.socket='Fac',x=>x.links[0].to.node='Other',x=>x.links[1].from.node='Other',x=>x.links[2].from.tree='Other',x=>x.noise='Other',x=>x.groupTree=x.rootTree,x=>x.links[2].to.nodeType='CompositorNodeViewer'])assert.throws(()=>assertGroupTrace(mutate(trace,change),program))
 const q=noiseNativeFixture()
 assert.throws(()=>assertQualification(mutate(q,x=>x.cases[0].sourceOwnershipPreserved=false)))
 assert.throws(()=>assertQualification(mutate(q,x=>delete x.cases.find(r=>r.route==='group-reroute').groupTrace)))
})
