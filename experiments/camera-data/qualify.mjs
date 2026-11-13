// Fail if a reference, publication, current Python or immutable runtime drifted.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const root=resolve(import.meta.dirname,'../..'),base=resolve(process.argv[2]??'artifacts/camera-data/owned')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const fixtureSha256=hash(await readFile(join(root,'packages/blender-addon/tests/camera_data_check.py')))
const rows=[]
for(const version of ['42','52','53'])for(const profile of ['ordinary','translated','wide','close','angular-edge']){
  const directory=join(base,version,profile),references=await read(join(directory,'native-reference.json'))
  const proof=await read(join(directory,'compiled/proof.json'))
  assert.equal(references.fixtureSha256,fixtureSha256);assert.equal(references.profile,profile)
  assert.equal(references.packingCalibration.cases,256);assert.equal(references.packingCalibration.maximum,0)
  assert.equal(proof.exporter,'built');assert.equal(proof.sourceUnchanged,true)
  assert.equal(proof.nativeReferenceSha256,hash(await readFile(join(directory,'native-reference.json'))))
  for(const item of proof.pythonProvenance){
    assert.equal(item.sha256,hash(await readFile(join(root,item.source))))
    assert.equal(item.sha256,hash(await readFile(join(root,item.artifact))))
  }
  assert.equal(proof.scenes.length,8)
  for(const scene of proof.scenes){
    const manifestPath=join(directory,'compiled',scene.manifestUrl.replace(/^\//,''))
    const manifest=await read(manifestPath)
    assert.equal(scene.manifestSha256,hash(await readFile(manifestPath)))
    assert.equal(scene.glbSha256,hash(await readFile(join(directory,'compiled/public',manifest.url.replace(/^\//,'')))))
    assert.equal(scene.programSha256,hash(await readFile(join(directory,'compiled/public',manifest.materialPrograms.url.replace(/^\//,'')))))
  }
  for(const environment of ['metal','software']){
    const report=await read(join(directory,'browser-report-'+environment+'.json'))
    assert.equal(report.built,true);assert.deepEqual(report.failures,[])
    assert.equal(report.provenance.nativeFixtureSha256,fixtureSha256)
    assert.equal(report.provenance.copyAssetsSha256,hash(await readFile(join(root,'packages/blendlink/scripts/copy-assets.mjs'))))
    for(const module of report.provenance.modules){
      assert.equal(module.emitterMatchesSource,true)
      assert.equal(module.testedSnapshotSha256,hash(await readFile(join(root,'packages/blendlink/dist',module.name+'.js'))))
      assert.equal(module.sourceSha256,hash(await readFile(join(root,'packages/blendlink/src',module.name+'.ts'))))
    }
    for(const file of [...report.provenance.snapshot.files,...report.provenance.snapshot.sourceMaps]){
      assert.equal(file.sha256,hash(await readFile(join(report.provenance.snapshot.directory,file.name))))
    }
    for(const result of report.rows){
      assert.equal(result.cases,240);assert.deepEqual(result.failures,[])
      assert.ok(result.maximumKernelError<=2e-5)
      assert.equal(result.negativeChecks.length,32)
      const adapter=JSON.stringify(result.gpu)
      assert.match(adapter,environment==='software'?/swiftshader/i:/apple/i)
      rows.push({version:references.blender,profile,environment,backend:result.backend,gpu:result.gpu,
        readbacks:result.cases,maximum:result.maximum,maximumKernelError:result.maximumKernelError,
        report:join(directory,'browser-report-'+environment+'.json'),sha256:hash(await readFile(join(directory,'browser-report-'+environment+'.json')))})
    }
  }
}
const ownership=[]
for(const environment of ['metal','software']){
  const path=join(base,'53/ordinary','ownership-report-'+environment+'.json'),report=await read(path)
  assert.equal(report.provenance.browserFixtureSha256,hash(await readFile(join(root,'experiments/camera-data/ownership.js'))))
  assert.deepEqual(report.failures,[])
  for(const module of report.provenance.modules){
    assert.equal(module.sourceSha256,hash(await readFile(join(root,'packages/blendlink/src',module.name+'.ts'))))
    assert.equal(module.testedSnapshotSha256,hash(await readFile(join(root,'packages/blendlink/dist',module.name+'.js'))))
  }
  for(const file of [...report.provenance.snapshot.files,...report.provenance.snapshot.sourceMaps])
    assert.equal(file.sha256,hash(await readFile(join(report.provenance.snapshot.directory,file.name))))
  for(const row of report.rows){
    assert.equal(row.threeRevision,'184');assert.equal(row.cases,8);assert.deepEqual(row.failures,[])
    const prior=row.rows.find(value=>value.kind==='previous-two-renderer-uploads')
    assert.ok(prior.sourceArraysUnchanged&&prior.sourceDisposed===0&&prior.actualBackendCopy&&prior.currentPrivateGpuExact)
    assert.notEqual(prior.uploadedPositionWords.previousGpu,prior.uploadedPositionWords.sourceCpu)
    assert.equal(prior.uploadedPositionWords.sourceCpu,prior.uploadedPositionWords.privateGpu)
    ownership.push({environment,backend:row.backend,cases:row.cases,gpu:row.gpu,report:path,sha256:hash(await readFile(path))})
  }
}
const summary={model:'eevee-primary-camera-v1',outputs:['View Vector'],fixtureSha256,
  nativeSourceBackend:'METAL',nativeSamples:15*24*5,finalGlbs:15*8,readbacks:rows.reduce((sum,row)=>sum+row.readbacks,0),
  maximumKernelError:Math.max(...rows.map(row=>row.maximumKernelError)),ownership,rows}
await writeFile(join(base,'qualification.json'),JSON.stringify(summary,null,2)+'\n')
console.log('BLENDLINK_CAMERA_DATA_QUALIFIED '+JSON.stringify({nativeSamples:summary.nativeSamples,finalGlbs:summary.finalGlbs,readbacks:summary.readbacks,maximumKernelError:summary.maximumKernelError}))
