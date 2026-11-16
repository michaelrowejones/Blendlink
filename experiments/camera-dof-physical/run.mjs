import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]??'/tmp/scenetoweb-camera-dof-browser-r1')
// Public SDKs intentionally have no candidate mode. Never apply a patch here.
// Verify every private implementation byte before reading inputs or opening GPU.
const candidate=JSON.parse(await readFile(join(import.meta.dirname,'candidate-sdk-files.json')))
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
if(digest(await readFile(join(import.meta.dirname,'sdk-candidate.patch')))!==candidate.patchSha256)throw Error('Private camera DOF research patch bytes differ from the pinned candidate')
for(const entry of candidate.files){
 let bytes
 try{bytes=await readFile(join(root,entry.path))}catch(error){if(error.code!=='ENOENT')throw error}
 if(!bytes||bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('Private camera DOF research SDK patch is absent or mismatched at '+entry.path+'. Apply sdk-candidate.patch with --unidiff-zero in an isolated checkout of 751dcff; the published SDK deliberately does not expose this mode.')
}
if(process.argv[2]==='--check-sdk'){console.log(JSON.stringify({status:'private-sdk-bytes-verified',baseSourceCommit:candidate.baseSourceCommit,privateCaptureCommit:candidate.capturedPrivateSourceCommit,patchSha256:candidate.patchSha256,files:candidate.files.length,gpuOpened:false}));process.exit(0)}
const website=resolve(process.argv[3]??'/tmp/scenetoweb-impact-original-website-099e993')
const descriptor=resolve(process.argv[4]??'/tmp/scenetoweb-impact-original-final-cache/scenetoweb/preview-studio/website-exports/impactfracture-21b4fec6bb56cf79/src/generated/impactFracture.gen.ts')
const optics=await readFile(join(import.meta.dirname,'impact-optics.json')),presentation=JSON.parse(await readFile(join(website,'models/impactFracture.presentation.json')))
presentation.cameraDepthOfField=JSON.parse(optics).cameraDepthOfField
const body=JSON.stringify(presentation),sha=b=>createHash('sha256').update(b).digest('hex')
await mkdir(out);await writeFile(join(out,'producer.mjs'),await readFile(import.meta.filename));await writeFile(join(out,'browser.js'),await readFile(join(import.meta.dirname,'browser.js')))
const sourceFiles=[]
async function captureSource(directory,prefix){
 for(const entry of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const relative=prefix+'/'+entry.name,path=join(directory,entry.name)
  if(entry.isDirectory())await captureSource(path,relative)
  else if(entry.name.endsWith('.ts')&&!entry.name.endsWith('.test.ts')){
   const bytes=await readFile(path),snapshot=join(out,'runtime-source',relative)
   await mkdir(resolve(snapshot,'..'),{recursive:true});await writeFile(snapshot,bytes,{flag:'wx'})
   sourceFiles.push({path:relative,bytes:bytes.length,sha256:sha(bytes)})
  }
 }
}
await captureSource(join(root,'packages/blendlink/src'),'packages/blendlink/src')
const frozenAssets=[]
for(const entry of JSON.parse(await readFile('/tmp/scenetoweb-impact-original-browser-r2/website.json')).files){
 const bytes=await readFile(join(website,entry.path))
 if(sha(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw Error('Preserved099 asset bytes changed: '+entry.path)
 frozenAssets.push(entry)
}
const nativeReport=await readFile('/tmp/scenetoweb-impact-native-reference-r2/report.json'),nativeImage=await readFile('/tmp/scenetoweb-impact-native-reference-r2/native.png')
if(sha(nativeImage)!==JSON.parse(nativeReport).imageSha256)throw Error('Original native image reference pin changed')
const sourceOriginal='/tmp/scenetoweb-v1-corpus-positives/artifacts/v1-corpus/sources/impact-fracture.blend',sourceOriginalSha256=sha(await readFile(sourceOriginal))
if(sourceOriginalSha256!==JSON.parse(optics).sourceSha256)throw Error('Original blend source pin changed')
await writeFile(join(out,'runtime-source.json'),JSON.stringify({sourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:sourceFiles},null,2)+'\n')
const server=await createServer({root:import.meta.dirname,configFile:false,publicDir:website,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@impact-descriptor':descriptor}},plugins:[{name:'candidate-data',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/optics.json'){res.setHeader('Content-Type','application/json');res.end(optics)}else if(req.url==='/candidate-presentation.json'){res.setHeader('Content-Type','application/json');res.end(body)}else next()})}}],server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,website,resolve(descriptor,'..')]}}})
let browser;const rows=[],report={status:'running',rows,sceneAcceptance:false,supportCredit:0,producerSha256:sha(await readFile(import.meta.filename)),browserSha256:sha(await readFile(join(import.meta.dirname,'browser.js'))),opticsSha256:sha(optics),sdkCandidatePatchSha256:sha(await readFile(join(import.meta.dirname,'sdk-candidate.patch'))),runtimeSourceSha256:sha(await readFile(join(out,'runtime-source.json'))),inputAssetFilesSha256:sha(JSON.stringify(frozenAssets)),descriptorSha256:sha(await readFile(descriptor)),nativeReferenceReportSha256:sha(nativeReport),nativeReferenceImageSha256:sha(nativeImage),sourceOriginalSha256}
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
 for(const backend of ['webgpu','webgl2'])for(const enabled of [false,true]){
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),errors=[]
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  const row={backend,enabled,errors};rows.push(row)
  try{await page.goto(server.resolvedUrls.local[0]+`?backend=${backend}&enabled=${enabled}`);await page.waitForFunction(()=>typeof window.runProof==='function');Object.assign(row,await page.evaluate(()=>window.runProof()));await page.screenshot({path:join(out,`${backend}-${enabled?'dof':'sharp'}.png`)});if(errors.length)throw Error('Browser errors')}catch(error){row.failure=String(error);throw error}finally{await page.close()}
 }
 if(sha(await readFile(sourceOriginal))!==sourceOriginalSha256)throw Error('Original blend bytes changed during browser capture')
 report.sourceUnchanged=true;report.status='passed'
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1}finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();console.log(JSON.stringify({status:report.status,failure:report.failure,rows:rows.map(row=>({backend:row.backend,enabled:row.enabled,failure:row.failure,readyMilliseconds:row.readyMilliseconds}))}))}
