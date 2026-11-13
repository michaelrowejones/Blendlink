import assert from 'node:assert/strict'
import { cp,readFile,readdir,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve,join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'

const root=resolve(import.meta.dirname,'../..'),native=resolve(process.env.BLENDLINK_COMPOSITOR_IMAGE_FINAL)
const built=process.argv.includes('--built')
const extraArgs=JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')
assert.ok(Array.isArray(extraArgs)&&extraArgs.every(value=>typeof value==='string'))
const profile=process.env.BLENDLINK_IMAGE_PROFILE??(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?'metal':'software')
assert.match(profile,/^[a-zA-Z0-9-]{1,40}$/)
const backends=process.env.BLENDLINK_IMAGE_BACKENDS?process.env.BLENDLINK_IMAGE_BACKENDS.split(','):['webgl2','webgpu']
const readbackRows=process.env.BLENDLINK_IMAGE_READBACK_ROWS?Number(process.env.BLENDLINK_IMAGE_READBACK_ROWS):undefined
if(readbackRows!==undefined)assert.ok(Number.isInteger(readbackRows)&&readbackRows>=1&&readbackRows<=8192)
assert.ok(backends.length>0&&backends.every(backend=>['webgl2','webgpu'].includes(backend)))
const performanceSuffix=(process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM?'-performance':'')+(process.env.BLENDLINK_IMAGE_FORCE_STREAM_FALLBACK?'-fallback':'')+(process.env.BLENDLINK_IMAGE_BACKENDS?'-'+backends.join('-'):'')+(readbackRows?'-rows'+readbackRows:'')
const performanceBytes=process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM
  ?await readFile(resolve(process.env.BLENDLINK_IMAGE_PERFORMANCE_PROGRAM)):null
const report=JSON.parse(await readFile(join(native,'final-report.json'),'utf8'))
const nativeReference=JSON.parse(await readFile(join(native,'native-reference.json'),'utf8'))
const binaryReferences=new Map(await Promise.all(['expected','calibration'].filter(key=>nativeReference[key+'File']).map(async key=>{
  const name=nativeReference[key+'File']
  assert.ok(['expected.rgba32f','calibration.rgba32f'].includes(name))
  const bytes=await readFile(join(native,name))
  assert.equal(createHash('sha256').update(bytes).digest('hex'),nativeReference[key+'Sha256'])
  return ['/image-reference/'+name,bytes]
})))
let replacement,replacementBytes
if(process.env.BLENDLINK_IMAGE_REINSTALL_DIR){
  const directory=resolve(process.env.BLENDLINK_IMAGE_REINSTALL_DIR)
  const final=JSON.parse(await readFile(join(directory,'final-report.json'),'utf8'))
  const manifest=JSON.parse(await readFile(final.manifestPath,'utf8'))
  const reference=JSON.parse(await readFile(join(directory,'native-reference.json'),'utf8'))
  assert.equal(reference.width,nativeReference.width);assert.equal(reference.height,nativeReference.height)
  assert.notEqual(reference.nativeInputSha256,nativeReference.nativeInputSha256)
  assert.notEqual(reference.expectedSha256,nativeReference.expectedSha256)
  replacementBytes=await readFile(final.presentationPath)
  assert.equal(replacementBytes.length,manifest.sourcePresentation.bytes)
  assert.equal(createHash('sha256').update(replacementBytes).digest('hex').slice(0,16),manifest.sourcePresentation.hash)
  const expected=await readFile(join(directory,reference.expectedFile))
  assert.equal(createHash('sha256').update(expected).digest('hex'),reference.expectedSha256)
  binaryReferences.set('/image-reference/replacement.rgba32f',expected)
  replacement={asset:{...manifest.sourcePresentation,url:'/replacement.presentation.json'},expectedFile:'replacement.rgba32f',expectedSha256:reference.expectedSha256,
    nativeInputSha256:reference.nativeInputSha256,sourceUnchanged:final.sourceUnchanged,actualPublishedUrl:manifest.sourcePresentation.url}
}
if(built)assert.equal(report.exporter,'built')
const snapshot=join(native,'final-runtime-snapshot-'+(built?'built':'source')+'-'+(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?'channel':'shell')+performanceSuffix)
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'Final static compositor Image'})
provenance.browserLaunch={channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL??'headless-shell',extraArgs,profile}
provenance.fixtureFiles=Object.fromEntries(await Promise.all(['browser.js','run.mjs','performance.js','final_scene.py','export.test.ts'].map(async name=>
  [name,createHash('sha256').update(await readFile(join(import.meta.dirname,name))).digest('hex')])))
provenance.nativeReferenceSha256=createHash('sha256').update(await readFile(join(native,'native-reference.json'))).digest('hex')
provenance.finalExportReportSha256=createHash('sha256').update(await readFile(join(native,'final-report.json'))).digest('hex')
if(performanceBytes)provenance.performanceReferenceSha256=createHash('sha256').update(performanceBytes).digest('hex')
provenance.binaryReferences=Object.fromEntries([...binaryReferences].map(([name,bytes])=>[name,{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]))
if(replacement)provenance.replacement=replacement
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
    if(request.url==='/replacement.presentation.json'&&replacementBytes){
      response.setHeader('Content-Type','application/json');response.end(replacementBytes);return
    }
    if(binaryReferences.has(request.url)){
      response.setHeader('Content-Type','application/octet-stream');response.end(binaryReferences.get(request.url));return
    }
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
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...extraArgs],
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{})})
  const manifest=JSON.parse(await readFile(report.manifestPath,'utf8'))
  const reference=nativeReference
  for(const backend of backends){
    const page=await browser.newPage(reference.fullViewport?{viewport:{width:reference.width,height:reference.height}}:{}),errors=[]
    if(process.env.BLENDLINK_IMAGE_FORCE_STREAM_FALLBACK)await page.addInitScript(()=>{
      Object.defineProperty(globalThis,'DecompressionStream',{value:undefined})
      Object.defineProperty(Uint8Array,'fromBase64',{value:undefined})
    })
    page.on('pageerror',error=>errors.push(error.message))
    page.on('crash',()=>errors.push('Browser page crashed'))
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
    page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url())})
    await page.goto(server.resolvedUrls.local[0]+'?backend='+backend)
    await page.waitForFunction(()=>typeof window.runProof==='function')
    const performanceProgramUrl=performanceBytes?'/image-performance.json':undefined
    let row
    try{row=await page.evaluate(options=>window.runProof(options),{manifest,reference,performanceProgramUrl,readbackRows,replacement})}
    catch(error){
      const state=await page.evaluate(()=>({stage:window.imageStage})).catch(()=>({stage:'page-unavailable'}))
      await writeFile(join(native,'browser-failure-'+backend+'-'+profile+performanceSuffix+'.json'),JSON.stringify({built,provenance,state,errors,message:String(error)},null,2))
      throw error
    }
    rows.push(row)
    await writeFile(join(native,'browser-final-progress'+performanceSuffix+'.json'),JSON.stringify({built,provenance,rows,errors},null,2))
    assert.deepEqual(errors,[]);assert.equal(row.backend,backend)
    assert.ok(row.maximum<=2e-5,JSON.stringify(row));assert.equal(row.imageDefinitions,1)
    await page.close()
  }
  await writeFile(join(native,'browser-final-'+profile+performanceSuffix+'.json'),JSON.stringify({built,provenance,rows},null,2))
  console.log('BLENDLINK_STATIC_IMAGE_FINAL_BROWSER_PASSED '+JSON.stringify(rows))
}finally{await browser?.close();await server.close()}
