import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { canonical, summarizeSamples, compareTimingTrials, compareRuntimeBenchmarks } from './node-performance-comparison.mjs'

const policy = { relativeTolerance: .1, absoluteToleranceMs: .2, minimumSamples: 30, minimumTrials: 3 }
const series = values => values.map((value, repeat) => ({ repeat, samples: Array(30).fill(value) }))
const report = (value = 1) => ({ schemaVersion: 1, kind: 'blendlink-runtime-benchmark-v1', status: 'measured', correctnessQualification: false,
  comparisonIdentity: { profile: 'test-software', platform: 'test-os', architecture: 'test-arch', cpuModel: 'test-cpu', hostOpaqueId:'test-host', browserVersion: 'test-browser',
    threeVersion: '0.184.0', threeSourceDigest: 'test-three', harnessDigest: 'test-harness', artifactsDigest: 'test-artifacts', config: { width: 256, height: 256, dpr: 1 } },
  rows: [0,1,2].map(repeat => ({ caseId: 'test-only-fixture', variant: 'program', backend: 'webgl2', repeat, status:'measured', sourceRestored:true,
    drawCoverage:{validationFrames:1,drawnProgramMeshes:1,drawnProgramMaterials:1},
    gpu: { api:'WebGL2',renderer: 'test-software-renderer' }, materials: { applied: 1, skipped: [] }, errors: [],
    phases: { rendererInitMs:1,loadMs:1,installMs:1,compileMs:1,firstFrameMs:1 },
    steady: { cpuSubmission: { samples: Array(30).fill(value) }, rafInterval: { samples: Array(30).fill(16.7) },
      gpuTimestamp: { available: false, reason: 'Test device has no timestamp extension', distribution: null } },
    resources: { afterDispose: { memory: { textures: 2, programs: 1 } }, afterReapplyDispose: { memory: { textures: 2, programs: 1 } } } })) })

test('sample summaries use raw nearest-rank data, preserve input order and reject invalid timings', () => {
  const data = [4,1,3,2], copy = [...data]
  assert.deepEqual(summarizeSamples(data), { count:4,p50Ms:2,p95Ms:4,minMs:1,maxMs:4 }); assert.deepEqual(data,copy)
  for (const input of [[],[NaN],[Infinity],[-1],['1'],null]) assert.throws(()=>summarizeSamples(input))
  assert.throws(()=>summarizeSamples(Array(30)),/dense/)
  assert.equal(canonical({ z:-1,a:[0,true,null] }), '{"a":[0,true,null],"z":-1}')
  assert.throws(()=>canonical({ bad: undefined }))
})

test('explicit practical tolerances require both absolute and relative threshold exceedance', () => {
  assert.equal(compareTimingTrials(series([1,1,1]),series([1.3,1.3,1.3]),policy).status,'threshold-exceeded')
  assert.equal(compareTimingTrials(series([1,1,1]),series([1.15,1.15,1.15]),policy).status,'within-threshold')
  assert.equal(compareTimingTrials(series([10,10,10]),series([10.5,10.5,10.5]),policy).status,'within-threshold')
  assert.equal(compareTimingTrials(series([0,0,0]),series([1,1,1]),policy).trials[0].relative,null)
})

test('small, mismatched and unstable trial sets are inconclusive instead of passing', () => {
  assert.equal(compareTimingTrials(series([1,1]),series([1,1]),policy).status,'inconclusive')
  const short=series([1,1,1]);short[0].samples.pop()
  assert.equal(compareTimingTrials(short,series([1,1,1]),policy).reason,'Too few samples')
  const mismatch=series([1,1,1]);mismatch[0].repeat=3
  assert.equal(compareTimingTrials(series([1,1,1]),mismatch,policy).reason,'Trial sets differ')
  assert.equal(compareTimingTrials(series([1,1,1]),series([1.3,1,1.3]),policy).status,'inconclusive')
  const duplicate=series([1,1,1]);duplicate[1].repeat=0
  assert.throws(()=>compareTimingTrials(duplicate,series([1,1,1]),policy),/unique/)
})

test('comparison requires explicit bounded policy and sufficient repetitions', () => {
  for (const input of [null,{}, {...policy, relativeTolerance:NaN}, {...policy, relativeTolerance:2}, {...policy, minimumSamples:1}, {...policy,minimumTrials:1}, {...policy,extra:1}])
    assert.throws(()=>compareTimingTrials(series([1,1,1]),series([1,1,1]),input))
})

test('matching observed reports compare raw values without numerical or physical-device qualification', () => {
  const a=report(),b=report(1.3)
  for(const row of b.rows) row.steady.cpuSubmission.p95Ms=.001
  const result=compareRuntimeBenchmarks(a,b,policy)
  assert.equal(result.status,'threshold-exceeded');assert.equal(result.correctnessQualification,false);assert.equal(result.performanceQualification,false)
  assert.equal(result.metrics.find(m=>m.metric==='cpuSubmission').status,'threshold-exceeded')
  assert.equal(result.metrics.find(m=>m.metric==='gpuTimestamp').status,'unmeasured')
  assert.equal(compareRuntimeBenchmarks(report(),report(),policy).status,'within-threshold')
})

test('different artifact, host, browser, GPU, config or material coverage refuses comparison', () => {
  for (const key of ['profile','platform','architecture','cpuModel','hostOpaqueId','browserVersion','threeVersion','threeSourceDigest','harnessDigest','artifactsDigest']) {
    const b=report();b.comparisonIdentity[key]+='changed'
    assert.equal(compareRuntimeBenchmarks(report(),b,policy).status,'not-comparable',key)
  }
  for(const edit of [b=>b.comparisonIdentity.config.dpr=2,b=>b.rows[0].gpu.renderer='other',b=>b.rows[0].materials.applied=2,b=>b.rows[0].materials.skipped.push({ reason:'refused' }),b=>b.rows.pop()]) {
    const b=report();edit(b);assert.equal(compareRuntimeBenchmarks(report(),b,policy).status,'not-comparable')
  }
})

test('failed, zero-case, duplicate, unobserved and error-bearing reports cannot become performance evidence', () => {
  for(const edit of [b=>b.status='failed',b=>b.rows=[],b=>b.rows.push(b.rows[0]),b=>b.rows[0].status='failed',b=>b.rows[0].sourceRestored=false,b=>b.rows[0].materials.applied=0,b=>b.rows[0].drawCoverage.drawnProgramMeshes=0,b=>delete b.rows[0].drawCoverage,b=>b.rows[0].errors.push('shader failure'),b=>b.rows[0].gpu={},b=>b.comparisonIdentity.cpuModel=null,b=>b.correctnessQualification=true,b=>b.rows[0].steady.cpuSubmission.samples=[NaN]]) {
    const b=report();edit(b);assert.throws(()=>compareRuntimeBenchmarks(report(),b,policy))
  }
})

test('available GPU timings require actual samples and remain separate from submission and RAF', () => {
  const a=report(),b=report()
  for(const row of a.rows) row.steady.gpuTimestamp={ available:true, distribution:{samples:Array(30).fill(2)} }
  for(const row of b.rows) row.steady.gpuTimestamp={ available:true, distribution:{samples:Array(30).fill(3)} }
  const result=compareRuntimeBenchmarks(a,b,policy)
  assert.equal(result.metrics.find(m=>m.metric==='gpuTimestamp').status,'threshold-exceeded')
  assert.equal(result.metrics.find(m=>m.metric==='cpuSubmission').status,'within-threshold')
  delete b.rows[0].steady.gpuTimestamp.distribution
  assert.throws(()=>compareRuntimeBenchmarks(a,b,policy))
})

test('reapply resource growth is visible, while fixed renderer overhead is not a leak claim', () => {
  const b=report();b.rows[0].resources.afterReapplyDispose.memory.textures=3
  const result=compareRuntimeBenchmarks(report(),b,policy)
  assert.equal(result.status,'threshold-exceeded');assert.equal(result.resourceGrowth.length,1)
  assert.deepEqual(result.resourceGrowth[0],{caseId:'test-only-fixture',variant:'program',backend:'webgl2',repeat:0,metric:'textures',before:2,after:3})
})

test('compile/load/install/first-frame phases use independent observed durations, not invented frame samples', () => {
  const b=report();for(const row of b.rows) row.phases.compileMs=3
  const result=compareRuntimeBenchmarks(report(),b,policy)
  const phase=result.metrics.find(m=>m.metric==='compileMs')
  assert.equal(phase.status,'threshold-exceeded');assert.equal(phase.trials.length,3);assert.equal(phase.trials[0].candidateMs,3)
  assert.equal('p95Ms' in phase.trials[0],false)
  delete b.rows[0].phases.compileMs
  assert.equal(compareRuntimeBenchmarks(report(),b,policy).metrics.find(m=>m.metric==='compileMs').status,'unmeasured')
  b.rows[0].gpu={ api:'webgpu',vendor:null,architecture:'unknown' }
  assert.throws(()=>compareRuntimeBenchmarks(report(),b,policy),/API/)
  b.rows[0].gpu={ api:'WebGL2',vendor:null,architecture:'unknown' }
  assert.throws(()=>compareRuntimeBenchmarks(report(),b,policy),/unknown values/)
  b.rows[0].gpu={ api:'WebGL2',renderer:'real control' };b.rows[0].backend='webgpu'
  assert.throws(()=>compareRuntimeBenchmarks(report(),b,policy),/API/)
})

test('CLI retains hashed comparison evidence, meaningful exit status and existing output ownership', async () => {
  const directory=await mkdtemp(join(tmpdir(),'blendlink-perf-comparison-'))
  const cli=new URL('../compare-node-performance.mjs',import.meta.url)
  const run=promisify(execFile)
  try {
    const baseline=join(directory,'baseline.json'),candidate=join(directory,'candidate.json'),policyPath=join(directory,'policy.json'),output=join(directory,'result.json')
    await Promise.all([writeFile(baseline,JSON.stringify(report())),writeFile(candidate,JSON.stringify(report())),writeFile(policyPath,JSON.stringify(policy))])
    const args=[cli.pathname,'--baseline',baseline,'--candidate',candidate,'--policy',policyPath,'--output',output]
    await run(process.execPath,args)
    const bytes=await readFile(output,'utf8'),result=JSON.parse(bytes)
    assert.equal(result.status,'within-threshold');assert.match(result.inputPins.candidate.sha256,/^[a-f0-9]{64}$/)
    await assert.rejects(run(process.execPath,args),error=>error.code===1)
    assert.equal(await readFile(output,'utf8'),bytes)
    const unknown=report();unknown.comparisonIdentity.profile='other'
    await writeFile(candidate,JSON.stringify(unknown));args[args.length-1]=join(directory,'mismatch.json')
    await assert.rejects(run(process.execPath,args),error=>error.code===2)
    assert.equal(JSON.parse(await readFile(args.at(-1),'utf8')).status,'not-comparable')
    const bad=report();bad.rows[0].errors.push('uncaptured GPU error')
    await writeFile(candidate,JSON.stringify(bad));args[args.length-1]=join(directory,'invalid.json')
    await assert.rejects(run(process.execPath,args),error=>error.code===1)
    assert.equal(JSON.parse(await readFile(args.at(-1),'utf8')).status,'invalid-evidence')
    await writeFile(candidate,'{malformed');args[args.length-1]=join(directory,'malformed.json')
    await assert.rejects(run(process.execPath,args),error=>error.code===1)
    const malformed=JSON.parse(await readFile(args.at(-1),'utf8'))
    assert.equal(malformed.status,'invalid-evidence');assert.match(malformed.inputPins.candidate.sha256,/^[a-f0-9]{64}$/)
    args[args.length-1]=join(directory,'missing.json');args[2]=join(directory,'missing-baseline.json')
    await assert.rejects(run(process.execPath,args),error=>error.code===1)
    assert.equal(JSON.parse(await readFile(args.at(-1),'utf8')).inputPins.baseline.sha256,null)
  } finally { await rm(directory,{recursive:true,force:true}) }
})
