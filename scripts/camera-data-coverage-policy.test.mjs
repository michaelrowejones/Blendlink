import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyCameraDataSource } from './lib/camera-data-source.mjs'
import { CAMERA_LINUX_BROWSER_ARGS, CAMERA_LINUX_BROWSER_PROFILE, cameraDataBrowserEnvironment,
  validateCameraLinuxBrowserIdentity, validateCameraLinuxCanvas, validateCameraLinuxBrowserReport } from './lib/camera-data-browser.mjs'
const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8')
const hash=value=>createHash('sha256').update(value).digest('hex')

test('Camera Data credits only the measured View Vector slice and retains its storage/camera limits',()=>{
  const map=JSON.parse(read('docs/node-capabilities.json')),entry=map.entries['shader:ShaderNodeCameraData']
  assert.equal(entry.category,'partial');assert.deepEqual(entry.runtimeOps,['camera_data_native'])
  assert.equal(entry.runtimePath,'packages/blendlink/src/tslNodeRecipe.ts')
  assert.deepEqual(entry.verification.outputs,{supported:['View Vector'],refused:['View Z Depth','View Distance']})
  assert.deepEqual(entry.verification.nativeVersions,['4.2.0','5.2.0','5.3.0'])
  assert.equal(entry.verification.privateGeometryOwnership,true);assert.equal(entry.verification.nativeSourceBackend,'METAL')
  assert.deepEqual(entry.verification.nativeSourceBackendVersions,['5.2.0','5.3.0'])
  assert.equal(entry.verification.nativeLegacyBackendAttestation.status,'SOURCE_ATTESTATION_NA')
  assert.equal(entry.verification.nativeOpenGL.status,'qualified-ordinary-headed-x11');assert.equal(entry.verification.nativeOpenGL.canary,'native-camera-data')
  for(const text of ['installTslMaterials','extra private CPU/GPU memory','Static-geometry/single-renderer','angular footprint<=1/256','bounds within +/-64','staging<=128','distance>=1','View Z Depth and View Distance remain','Fresh Linux5.2 OpenGL ordinary-source qualification passed'])assert.ok(entry.limits.includes(text),text)
  assert.ok(!map.knownUnsupported.includes('shader:ShaderNodeCameraData'))
  for(const path of ['packages/blender-addon/camera_data_ir.py','packages/blendlink/src/tslCameraGeometry.ts','experiments/camera-data/ownership.js'])assert.ok(entry.evidence.some(item=>item.path===path))
})

test('the central geometry shard and lightweight Linux canary exercise fresh source and actual Final storage',()=>{
  const gate=read('scripts/test-node-parity.mjs'),workflow=read('.github/workflows/static-noise.yml')
  assert.match(gate,/if \(plan\.geometry\) \{[\s\S]*?attempt\('camera-data-addon'/)
  assert.match(gate,/\['experiments\/camera-data\/suite\.mjs','--built','--blender',blender,'--output',directory\]/)
  assert.match(gate,/\['experiments\/camera-data\/run\.mjs','--built','--ownership'\]/)
  const job=workflow.match(/\n  native-camera-data:[\s\S]*?(?=\n  [a-z][a-z0-9-]*:|$)/)?.[0]
  assert.ok(job);assert.match(job,/blender-5\.2\.0-linux-x64\.tar\.xz/)
  assert.match(job,/96f6c181a30f4950607839dc84d42a354b250d8a0231b098b59b7bc69c351c48/)
  assert.match(job,/sha256sum --check --strict/);assert.match(job,/LIBGL_ALWAYS_SOFTWARE: '1'/)
  assert.match(job,/BLENDLINK_CAMERA_DATA_NATIVE_BACKEND: OPENGL/)
  assert.match(job,/--profiles ordinary --output artifacts\/verification-camera-data-linux52/)
  assert.match(job,/check-camera-data-source\.mjs artifacts\/verification-camera-data-linux52\/ordinary OPENGL/)
  assert.match(job,/run\.mjs --built --ownership/);assert.match(job,/package_probe\.py/)
  assert.match(job,/BLENDLINK_TEST_CHROMIUM_HEADLESS: '0'/)
  assert.match(job,/BLENDLINK_TEST_CHROMIUM_CHANNEL: chromium/)
  assert.match(job,/--ozone-platform=x11/)
  assert.ok(job.indexOf('canvas-probe.mjs') < job.indexOf('suite.mjs'))
  assert.match(job,/check-camera-data-browser\.mjs artifacts\/verification-camera-data-linux52 --canvas-only/)
  assert.match(job,/check-camera-data-browser\.mjs artifacts\/verification-camera-data-linux52\n/)
  assert.match(gate,/const cameraEnvironment=cameraDataBrowserEnvironment\(\)/)
  assert.match(gate,/camera-data-public-canvas/)
  assert.match(gate,/check-camera-data-browser\.mjs',directory,'--all-profiles'/)
  assert.doesNotMatch(job,/--gpu-launcher|--disable-gpu-sandbox/)
  assert.doesNotMatch(job,/--skip-native|--skip-export|--reuse|--disable-gpu-watchdog/)
  assert.match(job,/if: always\(\)/)
  assert.match(read('experiments/camera-data/suite.mjs'),/native_backend\.py/)
})

function browserIdentity() {
  return { requestedHeadless: false, browserVersion: '158.0.8127.18',
    systemInfo: { commandLine: 'chrome ' + CAMERA_LINUX_BROWSER_ARGS.join(' '),
      gpu: { featureStatus: { skia_graphite: 'enabled_on' },
        auxAttributes: { skiaBackendType: 'GraphiteDawnVulkan', glRenderer: 'ANGLE SwiftShader Subzero' } } } }
}
function browserReport(kind='browser') {
  return { ...browserIdentity(), built: true, complete: true, completedAllBackends: true, diagnosticDeviceLoss: false,
    failures: [], provenance: { mode: 'built', modules: [{ emitterMatchesSource: true }] },
    backendRuns: ['webgpu','webgl2'].map(backend=>({backend,status:'completed',errors:[]})),
    rows: ['webgpu','webgl2'].map(backend=>({ backend,cases:kind==='ownership'?8:240,failures:[],gpu:'SwiftShader' })) }
}
function canvasReport() {
  return { ...browserIdentity(), kind: 'public-WebGPU-canvas-control-no-Three-no-Camera-Data',
    complete: true, errors: [], result: { complete: true, rgba: [255,0,0,255],
      adapter: { architecture: 'swiftshader' }, uncapturedErrors: [], deviceLosses: [] } }
}

test('Camera Linux overrides are child-only and other platforms retain their requested profile',()=>{
  const before={...process.env},environment=cameraDataBrowserEnvironment('linux')
  assert.equal(environment.BLENDLINK_TEST_PROFILE,CAMERA_LINUX_BROWSER_PROFILE)
  assert.equal(environment.BLENDLINK_TEST_CHROMIUM_HEADLESS,'0')
  assert.equal(environment.BLENDLINK_TEST_CHROMIUM_CHANNEL,'chromium')
  assert.deepEqual(JSON.parse(environment.BLENDLINK_TEST_CHROMIUM_ARGS),CAMERA_LINUX_BROWSER_ARGS)
  assert.deepEqual(cameraDataBrowserEnvironment('darwin'),{})
  assert.deepEqual(cameraDataBrowserEnvironment('win32'),{})
  assert.deepEqual({...process.env},before)
  environment.BLENDLINK_TEST_PROFILE='changed'
  assert.equal(cameraDataBrowserEnvironment('linux').BLENDLINK_TEST_PROFILE,CAMERA_LINUX_BROWSER_PROFILE)
  const gate=read('scripts/test-node-parity.mjs'),camera=gate.match(/if \(plan\.geometry\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(camera)
  assert.equal(gate.replace(camera,'').includes('cameraEnvironment'),false)
})

test('Camera presentation requires actual pinned headed X11 Graphite identity, not requested flags alone',()=>{
  validateCameraLinuxBrowserIdentity(browserIdentity())
  for(const mutate of [
    r=>r.requestedHeadless=true,
    r=>r.browserVersion='159.0.0.0',
    r=>r.systemInfo.commandLine+=' --headless=new',
    r=>r.systemInfo.commandLine=r.systemInfo.commandLine.replace('--ozone-platform=x11','--ozone-platform=headless'),
    r=>r.systemInfo.commandLine+=' --gpu-launcher=/tmp/debugger',
    r=>r.systemInfo.commandLine+=' --disable-gpu-sandbox',
    r=>r.systemInfo.commandLine=r.systemInfo.commandLine.replace('--enable-skia-graphite',''),
    r=>r.systemInfo.gpu.auxAttributes.skiaBackendType='GaneshGL',
    r=>r.systemInfo.gpu.auxAttributes.glRenderer='hardware',
    r=>r.systemInfo.gpu.featureStatus.skia_graphite='disabled_off',
  ]) { const report=browserIdentity();mutate(report);assert.throws(()=>validateCameraLinuxBrowserIdentity(report)) }
})

test('Camera profile proof retains strict canvas, complete API, numeric and ownership failures',()=>{
  validateCameraLinuxCanvas(canvasReport())
  validateCameraLinuxBrowserReport(browserReport())
  validateCameraLinuxBrowserReport(browserReport('ownership'),'ownership')
  for(const mutate of [r=>r.result.rgba=[0,0,0,255],r=>r.result.complete=false,
    r=>r.errors.push('validation'),r=>r.result.deviceLosses.push({reason:'unknown'}),
    r=>r.result.adapter.architecture='hardware']) {
    const report=canvasReport();mutate(report);assert.throws(()=>validateCameraLinuxCanvas(report))
  }
  for(const mutate of [r=>r.built=false,r=>r.completedAllBackends=false,r=>r.diagnosticDeviceLoss=true,
    r=>r.failures.push({error:'numeric'}),r=>r.rows.pop(),r=>r.rows[1].backend='webgpu',
    r=>r.rows[0].cases=239,r=>r.backendRuns[0].status='failed',r=>r.backendRuns[0].errors.push('validation'),
    r=>r.rows[0].deviceLosses=[{reason:'unknown'}],r=>r.provenance.modules=[],
    r=>r.provenance.modules[0].emitterMatchesSource=false]) {
    const report=browserReport();mutate(report);assert.throws(()=>validateCameraLinuxBrowserReport(report))
  }
  const ownership=browserReport('ownership');ownership.rows[0].cases=7
  assert.throws(()=>validateCameraLinuxBrowserReport(ownership,'ownership'))
})

test('the hosted X11 receipt binds its exact source/profile and keeps partial qualification explicit',()=>{
  const receipt=JSON.parse(read('experiments/camera-data/linux-x11-qualification.json'))
  assert.equal(receipt.runId,43421749306);assert.equal(receipt.artifactId,14034642003)
  assert.equal(receipt.artifactSha256,'51b4d16fa67cdf0590a7f3a4ae6e5cee89a56763e560e56be8785960eb17aa0a')
  assert.deepEqual(receipt.native.version,[5,2,0]);assert.equal(receipt.native.backend.backend,'OPENGL')
  assert.equal(receipt.native.nativeSamples,120);assert.equal(receipt.native.packingControls,256)
  assert.equal(receipt.native.fixtureSha256,hash(read('packages/blender-addon/tests/camera_data_check.py')))
  assert.equal(receipt.native.wrapperSha256,hash(read('experiments/camera-data/native_backend.py')))
  assert.equal(receipt.browser.requestedHeadless,false);assert.equal(receipt.browser.actualOzone,'x11')
  assert.equal(receipt.browser.skiaBackend,'GraphiteDawnVulkan')
  assert.equal(receipt.results.actualFinalGlbs,8)
  assert.deepEqual(receipt.results.numeric.map(row=>[row.backend,row.cases,row.maximumOutsideNativeQuantization,row.failures]),
    [['webgpu',240,0,0],['webgl2',240,0,0]])
  assert.deepEqual(receipt.results.ownership.map(row=>[row.backend,row.cases,row.maximum,row.failures]),
    [['webgpu',8,0,0],['webgl2',8,0,0]])
  assert.equal(receipt.retainedReports.length,6)
  assert.ok(receipt.auditLimitations.some(value=>value.includes('not retained in this ZIP')))
  assert.ok(receipt.priorFailuresRetained.some(value=>value.artifactId===14033915425))
})

function corpus(){
  const directory=mkdtempSync(join(tmpdir(),'blendlink-camera-source-')),repository=join(directory,'repo'),profile=join(directory,'profile')
  const put=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value))}
  const fixture='packages/blender-addon/tests/camera_data_check.py',wrapper='experiments/camera-data/native_backend.py'
  put(join(repository,fixture),'fixture');put(join(repository,wrapper),'wrapper')
  const pythonSources=[
    'packages/blender-addon/camera_data_ir.py','packages/blender-addon/engine_fallback.py',
    'packages/blender-addon/shader_domains.py','packages/blender-addon/geometry_ir.py',
    'packages/blender-addon/material_compiler.py','packages/blender-addon/tsl_ir.py',
    'packages/blender-addon/normal_direction_ir.py','packages/blendlink/blender/geometry_export.py',
    'packages/blendlink/blender/export_scene.py',
  ]
  const provenance=pythonSources.map(source=>{const artifact='packages/blendlink/dist/blender/'+source.split('/').at(-1),bytes=source===fixture?'fixture':'canonical';put(join(repository,source),bytes);put(join(repository,artifact),bytes);return{source,artifact,sha256:hash(bytes)}})
  const sources=['eevee_persp_front','eevee_persp_back','eevee_ortho_front','eevee_ortho_back']
  const sceneNames=['eeveePerspFront','eeveePerspBack','eeveeOrthoFront','eeveeOrthoBack'].flatMap(name=>[name+'Yup',name+'Zup'])
  const reference={fixtureSha256:hash('fixture'),build:'fbe6228777e7',nativeGpuBackend:'OPENGL',blender:'5.2.0 LTS',sources:sources.map(name=>({name})),profile:'ordinary',cases:['view-X','view-Y','view-Z','view-composed','control'].map(output=>({output})),rows:sources.flatMap(source=>[1,3,5].flatMap(frame=>['Geometry Owner 0','Geometry Owner 1'].map(owner=>({source,engine:'BLENDER_EEVEE',frame,owner,samples:Array.from({length:5},(_,index)=>({pixel:[10,10],rgb:index===4?[.3125,.125,1.25]:[.125,.25,.5]}))})))),packingCalibration:{cases:256,maximum:0}}
  put(join(profile,'native-reference.json'),reference)
  const scenes=[]
  for(let index=0;index<8;index++){
    const manifest={url:'/models/'+index+'.glb',materialPrograms:{url:'/models/'+index+'.materials.json'}}
    put(join(profile,'compiled/public',manifest.url),'GLB'+index);put(join(profile,'compiled/public',manifest.materialPrograms.url),'program'+index)
    const manifestPath='/src/generated/'+index+'.json';put(join(profile,'compiled',manifestPath),manifest)
    scenes.push({name:sceneNames[index],manifestUrl:manifestPath,manifestSha256:hash(readFileSync(join(profile,'compiled',manifestPath))),glbSha256:hash('GLB'+index),programSha256:hash('program'+index)})
  }
  const referenceSha256=hash(readFileSync(join(profile,'native-reference.json')))
  const audit={schemaVersion:1,model:'blendlink-camera-data-native-backend-v1',completed:true,requested:'OPENGL',before:{backend:'OPENGL',renderer:'actual native renderer'},after:{backend:'OPENGL'},version:[5,2,0],blenderHash:reference.build,fixtureSha256:hash('fixture'),wrapperSha256:hash('wrapper'),nativeReferenceSha256:referenceSha256}
  put(join(profile,'native-backend.json'),audit)
  put(join(profile,'compiled/proof.json'),{exporter:'built',sourceUnchanged:true,nativeReferenceSha256:referenceSha256,pythonProvenance:provenance,scenes})
  return{directory,repository,profile,audit,put,verify:()=>verifyCameraDataSource(profile,{root:repository,expectedBackend:'OPENGL'})}
}

test('same-process backend reader binds actual source, canonical Python and every Final pin',()=>{
  const state=corpus();try{
    assert.equal(state.verify().status,'verified-native-backend-and-final-pins')
    state.put(join(state.repository,'packages/blendlink/dist/blender/camera_data_ir.py'),'stale');assert.throws(state.verify)
    state.put(join(state.repository,'packages/blendlink/dist/blender/camera_data_ir.py'),'canonical')
    state.put(join(state.profile,'compiled/public/models/3.glb'),'changed');assert.throws(state.verify)
  }finally{rmSync(state.directory,{recursive:true,force:true})}
})

test('refused/incomplete, unrequested or switched GPU backends cannot impersonate native OpenGL evidence',()=>{
  for(const patch of [{completed:false},{requested:null},{before:{backend:'METAL',renderer:'Metal'}},{after:{backend:'METAL'}},{version:[5,2,1]},{wrapperSha256:'0'.repeat(64)},{nativeReferenceSha256:'0'.repeat(64)}]){
    const state=corpus();try{state.put(join(state.profile,'native-backend.json'),{...state.audit,...patch});assert.throws(state.verify)}finally{rmSync(state.directory,{recursive:true,force:true})}
  }
})

test('source coverage cannot omit canonical files, duplicate native fields or replay one Final scene',()=>{
  for(const defect of ['missing-python','duplicate-native','duplicate-final']){
    const state=corpus();try{
      if(defect==='duplicate-native'){
        const referencePath=join(state.profile,'native-reference.json'),reference=JSON.parse(readFileSync(referencePath,'utf8'))
        reference.rows[1]={...reference.rows[0]};state.put(referencePath,reference)
        state.audit.nativeReferenceSha256=hash(readFileSync(referencePath));state.put(join(state.profile,'native-backend.json'),state.audit)
      }else{
        const proofPath=join(state.profile,'compiled/proof.json'),proof=JSON.parse(readFileSync(proofPath,'utf8'))
        if(defect==='missing-python')proof.pythonProvenance.pop()
        else proof.scenes[1]={...proof.scenes[0]}
        state.put(proofPath,proof)
      }
      assert.throws(state.verify,defect)
    }finally{rmSync(state.directory,{recursive:true,force:true})}
  }
})

test('legacy source/Final pins remain numerical proof while backend attestation is explicitly N/A',()=>{
  const state=corpus();try{
    const referencePath=join(state.profile,'native-reference.json'),reference=JSON.parse(readFileSync(referencePath,'utf8'))
    reference.blender='4.2.0'
    for(const row of reference.rows)row.engine='BLENDER_EEVEE_NEXT'
    state.put(referencePath,reference)
    const referenceSha256=hash(readFileSync(referencePath))
    Object.assign(state.audit,{version:[4,2,0],backendAttestation:'SOURCE_ATTESTATION_NA',initializationApi:'unavailable',
      before:null,after:null,limitation:'Blender 4.2.0 background GPU initialization/platform attestation API unavailable',nativeReferenceSha256:referenceSha256})
    state.put(join(state.profile,'native-backend.json'),state.audit)
    const proofPath=join(state.profile,'compiled/proof.json'),proof=JSON.parse(readFileSync(proofPath,'utf8'))
    proof.nativeReferenceSha256=referenceSha256;state.put(proofPath,proof)
    const result=verifyCameraDataSource(state.profile,{root:state.repository})
    assert.equal(result.nativeBackendQualification,'SOURCE_ATTESTATION_NA');assert.equal(result.nativeBackend,null)
    assert.equal(result.actualFinalGlbs,8);assert.equal(result.nativeSamples,120)
    assert.throws(state.verify,/cannot qualify a requested GPU backend/)
    state.audit.version=[5,2,0];state.put(join(state.profile,'native-backend.json'),state.audit)
    assert.throws(()=>verifyCameraDataSource(state.profile,{root:state.repository}))
    state.audit.version=[4,2,0];state.audit.backendAttestation='VERIFIED_NATIVE_BACKEND'
    state.audit.before={backend:'METAL',renderer:'pretend initialized'};state.audit.after={backend:'METAL'}
    state.put(join(state.profile,'native-backend.json'),state.audit)
    assert.throws(()=>verifyCameraDataSource(state.profile,{root:state.repository}),/Legacy Blender background/)
  }finally{rmSync(state.directory,{recursive:true,force:true})}
})
