import { createServer } from 'node:http'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { resolve, extname, sep, join, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
const [id,sourceArg,websiteArg,evidenceArg,backend='webgpu',...extra]=process.argv.slice(2)
if(!id||!sourceArg||!websiteArg||!evidenceArg||extra.length)throw Error('Use website-smoke.mjs SCENE_ID ORIGINAL_BLEND WEBSITE_FOLDER NEW_EVIDENCE_DIRECTORY [webgpu|webgl2]')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const source=await realpath(sourceArg),root=await realpath(websiteArg),evidence=resolve(evidenceArg),stem=join(evidence,'website')
const evidenceRelative=relative(root,evidence)
if(!isAbsolute(evidenceRelative)&&evidenceRelative!=='..'&&!evidenceRelative.startsWith('..'+sep))throw Error('Evidence must be outside the website snapshot')
if(!['webgpu','webgl2'].includes(backend))throw Error('Unknown backend')
const corpus=JSON.parse(await readFile(new URL('../../docs/release-scene-corpus.json',import.meta.url)))
const scene=corpus.scenes.find(row=>row.id===id)
if(!scene||sha(await readFile(source))!==scene.source.sha256)throw Error('Original source does not match the selected corpus pin')
const marker=JSON.parse(await readFile(join(root,'.scenetoweb-website.json')))
if(marker.schemaVersion!==1||marker.sourceKey!==sha(source))throw Error('Website ownership does not match the original source path')
async function websiteFiles(path=root,prefix=''){
  const rows=[]
  for(const entry of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink())throw Error('Website snapshot must not contain symlinks')
    const name=join(path,entry.name),relative=prefix+entry.name
    if(entry.isDirectory())rows.push(...await websiteFiles(name,relative+'/'))
    else if(entry.isFile()){const bytes=await readFile(name);rows.push({path:relative,bytes:bytes.length,sha256:sha(bytes)})}
    else throw Error('Unexpected website entry')
  }
  return rows
}
const files=await websiteFiles(),filesSha256=sha(JSON.stringify(files))
await mkdir(evidence)
const producer=await readFile(import.meta.filename)
await writeFile(join(evidence,'producer.mjs'),producer,{flag:'wx'})
const errors=[],requests=[]
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.wasm':'application/wasm','.svg':'image/svg+xml','.ktx2':'image/ktx2'}
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    if(!path.startsWith('/showcase/'))throw Error('Outside deployment prefix')
    let file=resolve(root,path.slice('/showcase/'.length)||'index.html')
    if(!file.startsWith(root+sep))throw Error('Outside website')
    if((await stat(file)).isDirectory())file=resolve(file,'index.html')
    const bytes=await readFile(file)
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(bytes)
  }catch(error){res.writeHead(404);res.end('Not found')}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
let browser,page
const report={schemaVersion:1,role:'Original-demo standalone website smoke; not native fidelity, package qualification or release acceptance',supportCredit:0,sceneAcceptance:false,scene:id,source,sourceSha256:scene.source.sha256,harnessSourceCommit:execFileSync('git',['-C',resolve(import.meta.dirname,'../..'),'rev-parse','HEAD'],{encoding:'utf8'}).trim(),producerSha256:sha(producer),producerSnapshot:'producer.mjs',requestedBackend:backend,forcedWebGpuUnavailable:backend==='webgl2',website:root,files,filesSha256,url:`http://127.0.0.1:${server.address().port}/showcase/`,startedAt:new Date().toISOString(),status:'RUNNING',errors,requests}
try{
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']})
  report.browserVersion=browser.version()
  page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1})
  await page.addInitScript(backend=>{
    window.__sceneSmokeContexts=[]
    const original=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const result=original.apply(this,[type,...args])
      if(this===document.querySelector('canvas')&&result)window.__sceneSmokeContexts.push(type)
      return result
    }
    if(backend==='webgl2')Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined})
  },backend)
  page.on('pageerror',e=>errors.push({kind:'page',message:String(e)}))
  page.on('console',e=>{if(['error','warning'].includes(e.type()))errors.push({kind:e.type(),message:e.text()})})
  page.on('response',r=>{requests.push({url:r.url(),status:r.status()});if(r.status()>=400)errors.push({kind:'http',status:r.status(),url:r.url()})})
  const start=performance.now()
  await page.goto(report.url,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.querySelector('#status[role="alert"]'),null,{timeout:120000})
  report.terminalStateMs=performance.now()-start
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  report.state=await page.evaluate(()=>({ready:document.body.dataset.ready??null,status:document.querySelector('#status')?.textContent,contexts:window.__sceneSmokeContexts,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,data:{...c.dataset}})),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,transferSize:r.transferSize,duration:r.duration}))}))
  await page.screenshot({path:stem+'.png'})
  if(report.state.ready!=='true')throw Error('Standalone scene did not reach ready')
  if(!report.state.contexts.includes(backend))throw Error('Requested native context was not created')
  report.firstReadyMs=report.terminalStateMs
  if(errors.some(e=>e.kind!=='warning'))throw Error('Browser errors retained')
  report.status='READY_NOT_FIDELITY_QUALIFIED'
}catch(error){report.status='FAILED';report.failure=String(error);if(page)report.body=await page.locator('body').innerText().catch(()=>null);process.exitCode=1}
finally{
  try{
    report.sourceUnchanged=sha(await readFile(source))===scene.source.sha256
    report.websiteUnchanged=sha(JSON.stringify(await websiteFiles()))===filesSha256
    if(!report.sourceUnchanged||!report.websiteUnchanged)throw Error('Source or website changed during the browser smoke')
  }catch(error){report.status='FAILED';report.integrityFailure=String(error);process.exitCode=1}
  report.completedAt=new Date().toISOString()
  try{await writeFile(stem+'.json',JSON.stringify(report,null,2)+'\n')}
  finally{try{if(browser)await browser.close()}finally{await new Promise(r=>server.close(r))}}
  console.log(JSON.stringify({status:report.status,firstReadyMs:report.firstReadyMs,failure:report.failure,errors:report.errors,state:report.state?.canvas}))
}
