import assert from 'node:assert/strict'
import{createHash}from'node:crypto'
import{readFile,writeFile,mkdir,readdir,copyFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{execFileSync}from'node:child_process'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
const[nativeArg,outArg,lease]=process.argv.slice(2);assert.equal(lease,'--gpu-lease')
const root=resolve(import.meta.dirname,'../..'),nativeDir=resolve(nativeArg),out=resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex')
// Fixed API convention, never selected/fitted from native image values.
const readbackOrigins={webgpu:'top-left',webgl2:'bottom-left'}
function nativeRows(raw,backend){
 const result=Buffer.alloc(raw.length),stride=64*16
 for(let y=0;y<4;y++)raw.copy(result,y*stride,(backend==='webgpu'?3-y:y)*stride,(backend==='webgpu'?4-y:y+1)*stride)
 return result
}
const candidate=JSON.parse(await readFile(join(import.meta.dirname,'candidate-sdk-files.json')))
assert.equal(sha(await readFile(join(import.meta.dirname,'sdk-candidate.patch'))),candidate.patchSha256)
for(const file of candidate.files)assert.equal(sha(await readFile(join(root,file.path))),file.sha256,'Private static projection candidate differs: '+file.path)
const nativeBytes=await readFile(join(nativeDir,'native.json')),native=JSON.parse(nativeBytes),inputBytes=await readFile(join(nativeDir,'geometry-inputs.json')),inputDocument=JSON.parse(inputBytes),contractBytes=await readFile(join(nativeDir,'contract.json')),contract=JSON.parse(contractBytes)
const referenceBytes=await readFile(join(import.meta.dirname,'native-cpu.json')),references=JSON.parse(referenceBytes)
assert.equal(native.geometryInputsSha256,sha(inputBytes));assert.equal(native.contractSha256,sha(contractBytes));assert.equal(native.nativeBuild,references.nativeBuild)
assert.equal(native.sourceSha256,references.sourceSha256)
assert.equal(sha(await readFile(join(root,'experiments/box-image-storage-stage/capture.py'))),native.captureSha256)
assert.equal(sha(await readFile(join(root,'experiments/box-image-storage-stage/geometry_fixture.py'))),native.fixtureSha256)
assert.equal(sha(await readFile(join(root,'experiments/native-f32-oracle-research/framebuffer_oracle.py'))),native.oracleSha256)
assert.equal(JSON.parse(await readFile(join(nativeDir,'native-archive.json'))).complete,true)
const ids=['source-Walls','source-Plane.021'],inputs=inputDocument.cases.filter(x=>ids.includes(x.id));assert.equal(inputs.length,2)
const template=references.cases.find(x=>x.derivation&&x.shift[1]<0&&x.renderExtent[0]===64),cameras={}
assert.ok(template)
const C=[[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],pins={}
for(const input of inputs){
 assert.equal(input.camera.type,template.cameraType);assert.equal(input.camera.near,template.clipNear);assert.equal(input.camera.far,template.clipFar)
 const packet=structuredClone(template),world=input.camera.matrix
 packet.cameraWorldGltf=C.flatMap(row=>[0,1,2,3].map(c=>row.reduce((sum,v,k)=>sum+v*world[k][c],0)))
 // Source-native viewFrame is an independent optical binding, not pixel fit.
 for(let i=0;i<4;i++){
  const[x,y,z]=input.camera.viewFrame[i],p=packet.projection,w=p[14]*z+p[15],ndc=[(p[0]*x+p[2]*z+p[3])/w,(p[5]*y+p[6]*z+p[7])/w],expected=[[1,1],[1,-1],[-1,-1],[-1,1]][i]
  ndc.forEach((v,c)=>assert.ok(Math.abs(v-expected[c])<2e-5,'Native matrix/viewFrame mismatch'))
 }
 cameras[input.id]=packet
}
await mkdir(out);await copyFile(import.meta.filename,join(out,'producer.mjs'))
await copyFile(join(import.meta.dirname,'browser.js'),join(out,'browser.js'))
await writeFile(join(out,'camera-packets.json'),JSON.stringify(cameras,null,2)+'\n')
async function pin(path){pins[path]=sha(await readFile(path))}
async function snapshot(folder,prefix){for(const entry of(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(folder,entry.name),relative=prefix+'/'+entry.name;if(entry.isDirectory())await snapshot(path,relative);else if(entry.isFile()&&!entry.name.endsWith('.test.ts')){await pin(path);const destination=join(out,'source',relative);await mkdir(resolve(destination,'..'),{recursive:true});await copyFile(path,destination)}}}
await snapshot(join(root,'packages/blendlink/src'),'packages/blendlink/src')
for(const file of ['browser.js','browser.mjs','reference.py','native-cpu.json'])await pin(join(import.meta.dirname,file))
await pin(join(out,'camera-packets.json'))
for(const file of ['experiments/box-image-storage-stage/geometry-inputs.mjs','experiments/box-image-storage-stage/capture.py','experiments/box-image-storage-stage/geometry_fixture.py','experiments/native-f32-oracle-research/framebuffer_oracle.py','packages/blendlink/blender/source_camera_projection.py'])await pin(join(root,file))
for(const file of ['native.json','geometry-inputs.json','contract.json','native-archive.json'])await pin(join(nativeDir,file))
const expectedRows=native.rows.filter(row=>row.profile==='SNORM10'&&ids.includes(row.case)&&['mask','normal','face','position'].includes(row.kind))
assert.equal(expectedRows.length,8)
for(const row of expectedRows){const bytes=await readFile(join(nativeDir,row.file));assert.equal(sha(bytes),row.sha256);await pin(join(nativeDir,row.file))}
const report={status:'running',sourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeReportSha256:sha(nativeBytes),nativeBuild:native.nativeBuild,sourceSha256:native.sourceSha256,sourceProjectionReferenceSha256:sha(referenceBytes),sdkCandidatePatchSha256:candidate.patchSha256,sourcePins:pins,apis:[],supportCredit:0,sceneAcceptance:false,automaticEnablement:false,fixedGates:{maskMaxAbs:0,otherMaxAbs:contract.gates.samplerDiagnosticMaxAbs},scope:'Camera transport + existing ObjectNormal primary field only; no Window/Incoming/reflection or installed original scene acceptance'}
const server=await createServer({root:import.meta.dirname,configFile:false,publicDir:false,cacheDir:join(out,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,nativeDir,out]}}})
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text())})
  try{
   await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.runProjectionProof==='function')
   const api=await page.evaluate(p=>window.runProjectionProof(p),{backend,inputs,cameras});api.pageErrors=pageErrors;report.apis.push(api)
   // Save every raw row before any backend, calibration, diagnostic or field
   // assertion, so a first-field failure cannot hide later captured controls.
   api.readbackOrigin=readbackOrigins[backend];api.nativeOrigin='bottom-left'
   for(const row of [api.calibration,...api.rows]){
    const raw=Buffer.from(new Uint32Array(row.words).buffer)
    const filename=row===api.calibration?backend+'-xy-calibration.raw.rgba32f':backend+'-'+row.case+'-'+row.kind+(row.negative?'-ignored-shift':'')+'.raw.rgba32f'
    await writeFile(join(out,filename),raw,{flag:'wx'});row.rawFile=filename;row.rawSha256=sha(raw);delete row.words
   }
   assert.equal(api.actualBackend,backend);assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)
   assert.deepEqual(pageErrors,[]);assert.deepEqual(api.errors,[])
   const calibration=await readFile(join(out,api.calibration.rawFile));let calibrationMaxAbs=0
   for(let y=0;y<4;y++)for(let x=0;x<64;x++){
    const expected=[2*(x+.5)/64-1,(backend==='webgpu'?-1:1)*(2*(y+.5)/4-1),.25,1]
    for(let c=0;c<4;c++)calibrationMaxAbs=Math.max(calibrationMaxAbs,Math.abs(calibration.readFloatLE((y*64+x)*16+c*4)-expected[c]))
   }
   api.calibration.maximum=calibrationMaxAbs;api.calibration.gate=2**-20
   assert.ok(calibrationMaxAbs<=2**-20,'Asymmetric XY calibration disagrees with fixed backend origin')
   for(const row of api.rows){
    const nativeRow=expectedRows.find(x=>x.case===row.case&&x.kind===row.kind),bytes=await readFile(join(nativeDir,nativeRow.file)),actual=nativeRows(await readFile(join(out,row.rawFile)),backend)
    assert.equal(actual.length,bytes.length);let maximum=0,violations=0
    const gate=row.kind==='mask'?0:contract.gates.samplerDiagnosticMaxAbs
    for(let i=0;i<actual.length;i+=4){const a=actual.readFloatLE(i),b=bytes.readFloatLE(i);assert.ok(Number.isFinite(a)&&Number.isFinite(b));const delta=Math.abs(a-b);maximum=Math.max(maximum,delta);if(delta>gate)violations++}
    row.maximum=maximum;row.violations=violations;row.gate=gate
    const filename=backend+'-'+row.case+'-'+row.kind+(row.negative?'-ignored-shift':'')+'.rgba32f'
    await writeFile(join(out,filename),actual,{flag:'wx'});row.file=filename;row.sha256=sha(actual)
   }
   for(const row of api.rows)if(row.negative)assert.ok(row.violations>0,'Ignored-shift negative did not discriminate');else assert.equal(row.violations,0,'Native positive field mismatch')
  }finally{await page.close()}
 }
 report.status='passed'
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1}finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();console.log(JSON.stringify({status:report.status,failure:report.failure,apis:report.apis.map(api=>({backend:api.backend,rows:api.rows.map(r=>({case:r.case,kind:r.kind,negative:r.negative,maximum:r.maximum,violations:r.violations}))}))}))}
