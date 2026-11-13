import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=path=>JSON.parse(readFileSync(path,'utf8'))
const pythonSources=[
  'packages/blender-addon/camera_data_ir.py','packages/blender-addon/engine_fallback.py',
  'packages/blender-addon/shader_domains.py','packages/blender-addon/geometry_ir.py',
  'packages/blender-addon/material_compiler.py','packages/blender-addon/tsl_ir.py',
  'packages/blender-addon/normal_direction_ir.py','packages/blendlink/blender/geometry_export.py',
  'packages/blendlink/blender/export_scene.py',
]
const nativeSources=['eevee_persp_front','eevee_persp_back','eevee_ortho_front','eevee_ortho_back']
const sceneNames=['eeveePerspFront','eeveePerspBack','eeveeOrthoFront','eeveeOrthoBack'].flatMap(name=>[name+'Yup',name+'Zup'])
export function verifyCameraDataSource(directory,{root=resolve(import.meta.dirname,'../..'),expectedBackend}={}){
  const audit=json(join(directory,'native-backend.json')),reference=json(join(directory,'native-reference.json'))
  assert.equal(audit.schemaVersion,1);assert.equal(audit.model,'blendlink-camera-data-native-backend-v1')
  assert.equal(audit.completed,true,'The native renderer must actually finish; no absence/refusal can impersonate numeric proof')
  assert.ok([[4,2,0],[5,2,0],[5,3,0]].some(version=>JSON.stringify(version)===JSON.stringify(audit.version)))
  const legacyBackendNA=audit.backendAttestation==='SOURCE_ATTESTATION_NA'
  if(legacyBackendNA){
    assert.deepEqual(audit.version,[4,2,0]);assert.equal(audit.initializationApi,'unavailable')
    assert.equal(audit.before,null);assert.equal(audit.after,null)
    assert.equal(audit.limitation,'Blender 4.2.0 background GPU initialization/platform attestation API unavailable')
    assert.equal(expectedBackend,undefined,'Legacy numeric/Final evidence cannot qualify a requested GPU backend')
  }else{
    assert.notEqual(audit.version[0],4,'Legacy Blender background evidence requires explicit backend-attestation N/A')
    assert.ok(audit.backendAttestation===undefined||audit.backendAttestation==='VERIFIED_NATIVE_BACKEND')
    assert.ok(['METAL','OPENGL'].includes(audit.before?.backend));assert.equal(audit.after?.backend,audit.before.backend)
    assert.equal(typeof audit.before?.renderer,'string');assert.ok(audit.before.renderer.length)
    if(expectedBackend){assert.equal(audit.requested,expectedBackend);assert.equal(audit.before.backend,expectedBackend)}
  }
  assert.equal(audit.fixtureSha256,digest(readFileSync(join(root,'packages/blender-addon/tests/camera_data_check.py'))))
  assert.equal(audit.wrapperSha256,digest(readFileSync(join(root,'experiments/camera-data/native_backend.py'))))
  assert.equal(audit.fixtureSha256,reference.fixtureSha256)
  assert.equal(audit.blenderHash,reference.build)
  assert.equal(audit.nativeReferenceSha256,digest(readFileSync(join(directory,'native-reference.json'))))
  if(!legacyBackendNA)assert.equal(reference.nativeGpuBackend,audit.after.backend)
  assert.ok(reference.blender===audit.version.join('.')||reference.blender.startsWith(audit.version.join('.')+' '))
  assert.deepEqual(reference.sources.map(source=>source.name),nativeSources)
  assert.deepEqual(reference.cases.map(value=>value.output),['view-X','view-Y','view-Z','view-composed','control'])
  assert.equal(reference.rows.length,24);assert.equal(reference.packingCalibration.cases,256)
  const rowKeys=new Set()
  for(const row of reference.rows){
    assert.ok(nativeSources.includes(row.source));assert.equal(row.engine,audit.version[0]===4?'BLENDER_EEVEE_NEXT':'BLENDER_EEVEE')
    assert.ok(['Geometry Owner 0','Geometry Owner 1'].includes(row.owner))
    const key=[row.source,row.frame,row.owner].join(':');assert.ok(!rowKeys.has(key),'Duplicate native source/frame/owner');rowKeys.add(key)
    assert.ok([1,3,5].includes(row.frame));assert.equal(row.samples.length,5)
    for(const [index,sample] of row.samples.entries()){
      assert.ok(Array.isArray(sample.pixel)&&sample.pixel.length===2&&sample.pixel.every((value,axis)=>Number.isInteger(value)&&value>=0&&value<(axis?512:1024)))
      assert.ok(Array.isArray(sample.rgb)&&sample.rgb.length===3&&sample.rgb.every(Number.isFinite))
      if(index<4)assert.ok(sample.rgb.every(value=>value>=0&&value<1&&value*256===Math.round(value*256)))
      else assert.deepEqual(sample.rgb,[.3125,.125,1.25])
    }
  }
  assert.equal(reference.packingCalibration.maximum,0)
  const proof=json(join(directory,'compiled/proof.json'))
  assert.equal(proof.exporter,'built');assert.equal(proof.sourceUnchanged,true)
  assert.equal(proof.nativeReferenceSha256,audit.nativeReferenceSha256)
  assert.deepEqual(proof.scenes.map(scene=>scene.name),sceneNames)
  assert.deepEqual(proof.pythonProvenance.map(source=>source.source),pythonSources)
  for(const source of proof.pythonProvenance){
    assert.equal(source.artifact,'packages/blendlink/dist/blender/'+source.source.split('/').at(-1))
    assert.equal(source.sha256,digest(readFileSync(join(root,source.source))))
    assert.equal(source.sha256,digest(readFileSync(join(root,source.artifact))))
  }
  for(const scene of proof.scenes){
    const manifestPath=join(directory,'compiled',scene.manifestUrl.replace(/^\//,'')),manifest=json(manifestPath)
    assert.equal(scene.manifestSha256,digest(readFileSync(manifestPath)))
    assert.equal(scene.glbSha256,digest(readFileSync(join(directory,'compiled/public',manifest.url.replace(/^\//,'')))))
    assert.equal(scene.programSha256,digest(readFileSync(join(directory,'compiled/public',manifest.materialPrograms.url.replace(/^\//,'')))))
  }
  return{status:legacyBackendNA?'verified-native-source-and-final-pins-backend-na':'verified-native-backend-and-final-pins',
    nativeBackend:legacyBackendNA?null:audit.after.backend,nativeBackendQualification:legacyBackendNA?'SOURCE_ATTESTATION_NA':'VERIFIED_NATIVE_BACKEND',version:audit.version,
    profile:reference.profile,nativeSamples:120,actualFinalGlbs:8,fixtureSha256:audit.fixtureSha256}
}
