// SPDX-License-Identifier: GPL-3.0-or-later
// Independent binary close: never trusts the producer's reported differences.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const root = resolve(import.meta.dirname, '../..')
const different = (a,b) => {
  assert.equal(a.length,b.length)
  let n=0;for(let i=0;i<a.length;i+=4)if(a.readUInt32LE(i)!==b.readUInt32LE(i))n++
  return n
}
async function binary(directory, field) {
  assert.equal(field.file, field.file.split('/').at(-1))
  const bytes=await readFile(join(directory,field.file))
  assert.equal(sha(bytes),field.sha256);assert.equal(bytes.length,128*128*16)
  for(let i=0;i<bytes.length;i+=4)assert.ok(Number.isFinite(bytes.readFloatLE(i)))
  return bytes
}
export async function closeShadow(nativeDirectory, browserDirectory) {
  const nbytes=await readFile(join(nativeDirectory,'report.json')),nr=JSON.parse(nbytes)
  const bbytes=await readFile(join(browserDirectory,'report.json')),br=JSON.parse(bbytes)
  assert.equal(nr.native.version,'5.3.0');assert.equal(nr.native.build,'02f0899d78e3')
  assert.equal(nr.native.actualGpu.backend_type,'METAL');assert.equal(nr.native.actualGpu.vendor,'Apple M5 Pro')
  assert.equal(nr.trackedSourceClean,true);assert.deepEqual(nr.source.dimensions,[128,128]);assert.equal(nr.source.samples,64)
  assert.equal(nr.producerSha256,sha(await readFile(join(nativeDirectory,'producer.py'))))
  assert.equal(nr.producerSha256,sha(await readFile(new URL('native.py',import.meta.url))))
  for(const [path,hash] of Object.entries(nr.sourceHashes))assert.equal(sha(await readFile(join(root,path))),hash)
  assert.equal(nr.rows.length,3)
  const nativeFields=await Promise.all(nr.rows.map(row=>binary(nativeDirectory,row)))
  assert.deepEqual(nr.rows.map(row=>row.id),['shadow-branch','transparent-control','opaque-negative'])
  assert.equal(different(nativeFields[0],nativeFields[1]),0)
  const nativeNegative=different(nativeFields[2],nativeFields[1]);assert.ok(nativeNegative>100)
  if(nr.fixture==='original-archviz-glass') {
    assert.equal(nr.originalSource.sha256,'9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e')
    assert.equal(nr.originalSource.load,'full-original-file')
    assert.equal(sha(await readFile(nr.originalSource.path)),nr.originalSource.sha256)
    assert.equal(nr.expectedVisibleAlpha,0.050000011920928955)
  } else { assert.equal(nr.fixture,'opaque-primary');assert.equal(nr.expectedVisibleAlpha,1) }
  const glb=await readFile(join(nativeDirectory,'shadow.glb'))
  assert.equal(sha(glb),nr.finalGlbSha256);assert.equal(sha(glb),br.finalGlbSha256)
  const document=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)))
  const marked=document.materials.map((m,i)=>({m,i})).filter(({m})=>m.extras?.blendlink_source_material==='White Shadow Branch')
  assert.equal(marked.length,1)
  const mesh=document.meshes.find(mesh=>mesh.primitives.some(p=>p.material===marked[0].i))
  assert.deepEqual(mesh.extras.blendlink_tsl_runtime.requiresNodeRenderer.programs,[{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1'}])
  const final=JSON.parse(await readFile(join(nativeDirectory,'final.json')))
  const programs=await readFile(join(nativeDirectory,'shadow.glb.materials.json'))
  assert.equal(programs.length,final.materialPrograms.bytes);assert.equal(sha(programs).slice(0,16),final.materialPrograms.hash)
  const alpha=JSON.parse(programs).materials['White Shadow Branch'].channels.Alpha.tslIr.output
  assert.equal(alpha.visibleAlpha,nr.expectedVisibleAlpha);assert.deepEqual(alpha.input,{op:'const_float',value:nr.expectedVisibleAlpha})
  assert.equal(br.status,'PASSED_NATIVE_AND_INSTALLED_SHADOW_CONTROLS_NOT_SCENE_ACCEPTANCE')
  assert.equal(br.nativeReportSha256,sha(nbytes));assert.equal(br.producerSha256,sha(await readFile(join(browserDirectory,'producer.mjs'))))
  assert.equal(br.producerSha256,sha(await readFile(new URL('browser.mjs',import.meta.url))))
  for(const [path,hash] of Object.entries(br.runtimeHashes))assert.equal(sha(await readFile(join(root,'packages/blendlink/dist',path))),hash)
  assert.deepEqual(br.errors,[]);assert.equal(br.rows.length,4)
  assert.equal(new Set(br.rows.map(r=>r.profile+'/'+r.backend)).size,4)
  const rows=[]
  for(const profile of ['metal','swiftshader'])for(const backend of ['webgpu','webgl2']) {
    const row=br.rows.find(r=>r.profile===profile&&r.backend===backend);assert.ok(row)
    const identity=JSON.stringify(row.gpu)
    if(profile==='metal'){assert.match(identity,/apple|metal/i);assert.doesNotMatch(identity,/swiftshader/i)}else assert.match(identity,/swiftshader/i)
    assert.equal(row.applied,1);assert.equal(row.skipped,0);assert.equal(row.materialRestored,true);assert.deepEqual(row.errors,[])
    assert.equal(row.mainStorage,'RGBA16Float decoded losslessly to Float32');assert.equal(row.f32ProbeStorage,'unblended RGBA32Float')
    const f=Object.fromEntries(await Promise.all(Object.entries(row.fields).map(async([key,value])=>[key,await binary(browserDirectory,value)])))
    assert.equal(Object.keys(f).length,11)
    assert.equal(different(f.actual,f.clear),0);assert.equal(different(f.actual,f.remount),0)
    assert.equal(different(f.negative,f.disposedStock),0);assert.equal(different(f.visibleMasked,f.visibleUnmasked),0);assert.equal(different(f.visibleMasked,f.implicitColorControl),0)
    const negative=different(f.negative,f.clear),other=different(f.clear,f.otherClear),visible=different(f.otherClear,f.visibleMasked)
    assert.ok(negative>100);assert.ok(other>100);assert.ok(visible>100)
    const alphaWords={}
    for(const key of ['alphaProbe','f32AlphaProbe']) {
      const expected=key==='alphaProbe'?Math.f16round(nr.expectedVisibleAlpha):nr.expectedVisibleAlpha
      let covered=0;for(let i=12;i<f[key].length;i+=16){const value=f[key].readFloatLE(i);if(value!==0){covered++;assert.equal(value,expected)}}
      assert.ok(covered>100);alphaWords[key]=covered
    }
    rows.push({profile,backend,wordsPerField:65536,fields:11,implicitColorWords:65536,negativeWords:negative,otherCasterWords:other,visibleCasterWords:visible,alphaWords})
  }
  return {status:'BOUNDED_SHADOW_AND_OWNED_ALPHA_CLOSED_NOT_SCENE_ACCEPTANCE',fixture:nr.fixture,
    sourceCommit:nr.sourceCommit,browserSourceCommit:br.sourceCommit,nativeReportSha256:sha(nbytes),browserReportSha256:sha(bbytes),
    nativeProducerSha256:nr.producerSha256,browserProducerSha256:br.producerSha256,finalGlbSha256:sha(glb),
    nativeWordsPerField:65536,nativeNegativeWords:nativeNegative,visibleAlpha:nr.expectedVisibleAlpha,rows,
    sceneAcceptance:false,generalLightPathFields:false}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
  const result=await closeShadow(resolve(process.argv[2]),resolve(process.argv[3]))
  await writeFile(resolve(process.argv[4]),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({status:result.status,fixture:result.fixture,tuples:result.rows.length}))
}
