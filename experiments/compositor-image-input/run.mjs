import assert from 'node:assert/strict'
import { cp,readFile,readdir,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve,join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'

const root=resolve(import.meta.dirname,'../..'),native=resolve(process.env.BLENDLINK_COMPOSITOR_IMAGE_FINAL)
const built=process.argv.includes('--built')
const performanceSuffix=(process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM?'-performance':'')+(process.env.BLENDLINK_IMAGE_FORCE_STREAM_FALLBACK?'-fallback':'')
const performanceBytes=process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM
  ?await readFile(resolve(process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM)):null
const report=JSON.parse(await readFile(join(native,'final-report.json'),'utf8'))
if(built)assert.equal(report.exporter,'built')
const snapshot=join(native,'final-runtime-snapshot-'+(built?'built':'source')+'-'+(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?'channel':'shell')+performanceSuffix)
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'Final static compositor Image'})
provenance.fixtureFiles=Object.fromEntries(await Promise.all(['browser.js','run.mjs','performance.js','final_scene.py','export.test.ts'].map(async name=>
  [name,createHash('sha256').update(await readFile(join(import.meta.dirname,name))).digest('hex')])))
provenance.nativeReferenceSha256=createHash('sha256').update(await readFile(join(native,'native-reference.json'))).digest('hex')
provenance.finalExportReportSha256=createHash('sha256').update(await readFile(join(native,'final-report.json'))).digest('hex')
if(performanceBytes)provenance.performanceReferenceSha256=createHash('sha256').update(performanceBytes).digest('hex')
if(built){
  await cp(join(root,'packages/blendlink/dist/vendor'),join(snapshot,'vendor'),{recursive:true})
  provenance.snapshot.vendorFiles=[]
  async function record(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name)
      if(entry.isDirectory())await record(path)
      else provenance.snapshot.vendorFiles.push({name:path.slice(snapshot.length+1),sha256:createHash('sha256').update(await readFile(path)).digest('hex')})
    }
  }
  await record(join(snapshot,'vendor'))
}
const ext=built?'.js':'.ts'
const server=await createServer({root:import.meta.dirname,publicDir:join(native,'public'),configFile:false,logLevel:'warn',
  plugins:[{name:'immutable-performance-reference',configureServer(server){server.middlewares.use((request,response,next)=>{
    if(request.url!=='/image-performance.json'||!performanceBytes)return next()
    response.setHeader('Content-Type','application/json');response.end(performanceBytes)
  })}}],
  cacheDir:join(native,'final-vite-cache'),optimizeDeps:{noDiscovery:true},
  resolve:{dedupe:['three'],alias:{'@image-source-display':join(snapshot,'sourceDisplay'+ext),
    '@image-post-pipeline':join(snapshot,'threeWebgpuPostPipeline'+ext),'@image-bindings':join(snapshot,'runtime'+ext),
    '@image-compositor':join(snapshot,'tslSourceCompositor'+ext),'@image-static-input':join(snapshot,'tslCompositorStaticImage'+ext)}},
  server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native]}}})
const rows=[];let browser
try{
  await server.listen()
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader'],
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{})})
  const manifest=JSON.parse(await readFile(report.manifestPath,'utf8'))
  const reference=JSON.parse(await readFile(join(native,'native-reference.json'),'utf8'))
  for(const backend of ['webgl2','webgpu']){
    const page=await browser.newPage(),errors=[]
    if(process.env.BLENDLINK_IMAGE_FORCE_STREAM_FALLBACK)await page.addInitScript(()=>{
      Object.defineProperty(globalThis,'DecompressionStream',{value:undefined})
      Object.defineProperty(Uint8Array,'fromBase64',{value:undefined})
    })
    page.on('pageerror',error=>errors.push(error.message))
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
    page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url())})
    await page.goto(server.resolvedUrls.local[0]+'?backend='+backend)
    await page.waitForFunction(()=>typeof window.runProof==='function')
    const performanceProgramUrl=performanceBytes?'/image-performance.json':undefined
    const row=await page.evaluate(options=>window.runProof(options),{manifest,reference,performanceProgramUrl})
    rows.push(row)
    await writeFile(join(native,'browser-final-progress'+performanceSuffix+'.json'),JSON.stringify({built,provenance,rows,errors},null,2))
    assert.deepEqual(errors,[]);assert.equal(row.backend,backend)
    assert.ok(row.maximum<=2e-5,JSON.stringify(row));assert.equal(row.imageDefinitions,1)
    await page.close()
  }
  await writeFile(join(native,'browser-final-'+(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?'metal':'software')+performanceSuffix+'.json'),JSON.stringify({built,provenance,rows},null,2))
  console.log('BLENDLINK_STATIC_IMAGE_FINAL_BROWSER_PASSED '+JSON.stringify(rows))
}finally{await browser?.close();await server.close()}
