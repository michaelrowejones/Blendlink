import assert from 'node:assert/strict'

export const literalSourceFiles=[
 'packages/blender-addon/tests/compositor_float_to_int_check.py',
 'packages/blendlink/blender/compositor_float_to_int.py',
 'packages/blendlink/blender/compositor_graph.py',
 'experiments/float-to-int-native/values.py'
]
const modes=['round','floor','ceiling','truncate']
const compositions=['linked','group','instances','integer-consumer','compare-consumer']
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/)

/** Closed producer receipt: native absence and empty/partial captures cannot qualify. */
export function assertLiteralQualification(packet){
 assert.equal(packet.status,'CAPTURED_LITERAL_PRODUCTION_CANDIDATE')
 assert.deepEqual(packet.version,[5,3,0]);assert.equal(packet.build,'02f0899d78e3')
 assert.ok(['CPU','GPU'].includes(packet.device));assert.equal(packet.sourceEvaluator,'CPU-MF including GPU single values')
 assert.equal(packet.width,8);assert.equal(packet.height,8)
 assert.equal(packet.sourcePreserved,true);assert.equal(packet.copiedNamespace,true)
 assert.deepEqual(Object.keys(packet.sourceHashes).sort(),[...literalSourceFiles].sort())
 Object.values(packet.sourceHashes).forEach(sha)
 assert.equal(packet.cases.length,156);assert.equal(new Set(packet.cases.map(row=>row.case)).size,156)
 for(const mode of modes){
  const entries=packet.cases.filter(row=>row.case.startsWith(mode+'-'))
  assert.equal(entries.length,39)
  const literals=entries.filter(row=>new RegExp('^'+mode+'-literal-[a-f0-9]{8}$').test(row.case))
  assert.equal(literals.length,34)
  for(const suffix of compositions)assert.equal(entries.filter(row=>row.case===mode+'-'+suffix).length,1)
 }
 for(const row of packet.cases){
  assert.equal(row.sourcePreserved,true)
  assert.equal(row.programFile,row.case+'.program.json');sha(row.programSha256)
  assert.equal(row.pixelFile,row.case+'.rgba32f');sha(row.pixelSha256)
  const saved=/-literal-3f000000$|-group$|-instances$|-integer-consumer$/.test(row.case)
  if(saved){assert.equal(row.sourceFile,row.case+'.blend');sha(row.sourceSha256)}
  else{assert.equal(row.sourceFile,undefined);assert.equal(row.sourceSha256,undefined)}
 }
 return packet
}

export function assertLiteralFinal(packet,qualification,{built,nativeSha256}){
 assert.equal(packet.status,'published-literal-candidate')
 assert.equal(packet.exporter,built?'built':'source');assert.equal(packet.sourcePreserved,true)
 assert.equal(packet.nativeQualificationSha256,nativeSha256)
 const names=['compositor_graph.py','compositor_float_to_int.py','source_presentation.py','export_scene.py']
 assert.equal(packet.provenance.length,names.length)
 assert.deepEqual(packet.provenance.map(row=>row.source).sort(),names.map(name=>'packages/blendlink/blender/'+name).sort())
 for(const row of packet.provenance){
  assert.equal(row.artifact,built?row.source.replace('/blender/','/dist/blender/'):row.source);sha(row.sha256)
 }
 const sources=qualification.cases.filter(row=>row.sourceFile)
 assert.equal(sources.length,16);assert.equal(packet.rows.length,16)
 assert.deepEqual(packet.rows.map(row=>row.case).sort(),sources.map(row=>row.case).sort())
 for(const row of packet.rows){
  const source=sources.find(entry=>entry.case===row.case)
  assert.equal(row.sourceFile,source.sourceFile);assert.equal(row.sourceSha256,source.sourceSha256)
  for(const key of ['manifestSha256','glbSha256','presentationSha256'])sha(row[key])
 }
 return packet
}

/** Closed browser census; a passing summary with missing APIs or cases is insufficient. */
export function assertLiteralBrowserReport(report,{device,profile,final,cases}){
 assert.equal(report.status,'PASSED_LITERAL_BUILT_PROOF');assert.equal(report.built,true)
 assert.equal(report.final,final);assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
 assert.equal(report.missingAdapterControl.refused,true)
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
 const expected=[...cases].sort();let caseRuns=0
 for(const row of report.rows){
  assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2')
  const identity=JSON.stringify(row.gpu)
  if(profile==='metal'){assert.match(identity,/apple|metal/i);assert.doesNotMatch(identity,/swiftshader/i)}
  else{assert.equal(profile,'software');assert.match(identity,/swiftshader/i)}
  assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[])
  assert.deepEqual(row.rows.map(result=>result.case).sort(),expected)
  for(const result of row.rows){
   assert.equal(result.wordMismatches,0);assert.equal(result.remainingTextures,0)
   if(final){assert.equal(result.pinRejected,true);assert.ok(result.meshCount>0);assert.equal(result.pipeline,'blender-compositor');assert.equal(result.sourceMaterialsPreserved,true)}
  }
  assert.equal(row.negatives.length,10)
  const names=['model','version','source-profile','evaluator','subnormal','nonfinite','f64','magnitude','color-conversion','depth']
  assert.deepEqual(row.negatives.map(result=>result.kind).sort(),names.sort())
  for(const negative of row.negatives){assert.match(negative.error,/Float to Integer/);assert.equal(negative.remainingTextures,0)}
  caseRuns+=row.rows.length
 }
 return caseRuns
}
