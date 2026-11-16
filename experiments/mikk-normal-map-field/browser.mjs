// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict'
import{mkdir,readFile,writeFile,copyFile,realpath}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
import{allowedRoots}from'../noise-color-export-preview-pilot/paths.mjs'
const[nativeArg,outArg,lease]=process.argv.slice(2);assert.equal(lease,'--gpu-lease')
const root=resolve(import.meta.dirname,'../..'),native=await realpath(resolve(nativeArg));await mkdir(resolve(outArg));const out=await realpath(resolve(outArg)),three=join(root,'node_modules/three'),sha=b=>createHash('sha256').update(b).digest('hex')
const nativeBytes=await readFile(join(native,'capture/report.json')),source=JSON.parse(nativeBytes),inputs=[];assert.equal(source.renderCalls,32)
for(const row of source.rows){const bytes=await readFile(join(native,'capture',row.file));assert.equal(sha(bytes),row.sha256);inputs.push(JSON.parse(bytes))}
for(const name of ['browser.js','candidate.mjs','canonical-corner-bytes.mjs'])await copyFile(join(import.meta.dirname,name),join(out,name))
await writeFile(join(out,'index.html'),'<link rel="icon" href="data:,"><script type="module" src="/browser.js"></script>')
await writeFile(join(out,'producer.mjs'),await readFile(import.meta.filename))
const report={status:'RUNNING',supportCredit:0,nativeReportSha256:sha(nativeBytes),producerSha256:sha(await readFile(import.meta.filename)),sourcePins:{},apis:[]}
for(const file of ['browser.js','candidate.mjs','canonical-corner-bytes.mjs','contract.json','../box-image-normal-stage/geometry-inputs.mjs'])report.sourcePins[file]=sha(await readFile(join(import.meta.dirname,file)))
const server=await createServer({root:out,publicDir:join(native,'capture'),configFile:false,cacheDir:join(out,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:[{find:'/geometry-inputs.mjs',replacement:join(root,'experiments/box-image-normal-stage/geometry-inputs.mjs')},{find:'three/addons',replacement:join(three,'examples/jsm')},{find:'three/webgpu',replacement:join(three,'build/three.webgpu.js')},{find:'three/tsl',replacement:join(three,'build/three.tsl.js')},{find:/^three$/,replacement:join(three,'build/three.module.js')}],dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:await allowedRoots([root,three,native,out])}}})
let browser,failed=false
try{await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});report.browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});let api
  try{await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.run==='function');api=await page.evaluate(([b,i])=>window.run(b,i),[backend,inputs])}
  catch(error){failed=true;api=await page.evaluate(()=>window.frameFailure??{}).catch(()=>({}));api.failure=String(error)}
  api.pageErrors=errors;if(errors.length)failed=true
  for(const row of api.rows??[]){const bytes=Buffer.alloc(row.words.length*4);row.words.forEach((v,i)=>bytes.writeUInt32LE(v,i*4));row.file=backend+'-'+(row.name??'storage')+'-'+row.kind+'.f32';row.sha256=sha(bytes);row.words=row.words.length;await writeFile(join(out,row.file),bytes,{flag:'wx'})}
  report.apis.push(api);await page.close()
 }
 report.status=failed?'CAPTURE_FAILED_RETAINED':'CAPTURED_METAL_2API_FRAME_DIAGNOSTIC_NOT_QUALIFICATION';if(failed)process.exitCode=1
}finally{await browser?.close();await server.close();for(const[file,expected]of Object.entries(report.sourcePins))assert.equal(sha(await readFile(join(import.meta.dirname,file))),expected);await writeFile(join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,apis:report.apis.map(a=>({backend:a.backend,rows:a.rows?.length,errors:a.errors,pageErrors:a.pageErrors,failure:a.failure}))}))}
