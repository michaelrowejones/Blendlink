import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {hashWords} from '../compositor-white-noise/protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),native=resolve(process.argv[2]),previous=resolve(process.argv[3]),out=resolve(process.argv[4]);await mkdir(out)
const report=JSON.parse(await readFile(join(native,'report.json'))),coordinate=report.rows.find(row=>row.case==='13x9-raw-uniform'),x=coordinate.sourceAxes[0],y=coordinate.sourceAxes[1]
const f32word=value=>new Uint32Array(new Float32Array([value]).buffer)[0],asFloat=word=>new Float32Array(new Uint32Array([word]).buffer)[0]
const expected=[]
for(let py=0;py<9;py++)for(let px=0;px<13;px++){const h=hashWords([x[px],y[py]]);expected.push({x:px,y:py,sourceWords:[x[px],y[py]],hash:h,convertedWord:f32word(h),unitWord:f32word(Math.fround(h)/2**32)})}
const fixture=join(out,'fixture');await mkdir(fixture);const pins={}
for(const name of ['diagnostic.js','diagnostic.html','axis-table.mjs']){const source=name==='axis-table.mjs'?join(previous,'fixture',name):join(import.meta.dirname,name),bytes=await readFile(source);pins[source]=hash(bytes);await copyFile(source,join(fixture,name))}
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@exact-hash':join(previous,'runtime/tslNodeRecipe.ts'),'@constant-compositor':join(previous,'runtime/tslCompositorWhiteNoise.ts')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native,previous,out,await realpath(join(root,'node_modules'))]}}})
const result={status:'running',portCredit:0,nativeReportSha256:hash(await readFile(join(native,'report.json'))),productionHashSnapshotSha256:hash(await readFile(join(previous,'runtime/tslNodeRecipe.ts'))),productionCompositorSnapshotSha256:hash(await readFile(join(previous,'runtime/tslCompositorWhiteNoise.ts'))),fixturePins:pins,expected,tuples:[]};let browser
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(result,null,2)+'\n')
try{
 await server.listen()
 for(const profile of ['software','metal']){
  browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[])]})
  for(const backend of ['webgpu','webgl2']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push({text:m.text(),location:m.location()})})
   await page.goto(server.resolvedUrls.local[0]+'diagnostic.html?backend='+backend);await page.waitForFunction(()=>typeof window.diagnoseAxisHash==='function')
   const actual=await page.evaluate(proof=>window.diagnoseAxisHash(proof),{literalVector:[asFloat(x[0]),asFloat(y[0]),0],literalHash:expected[0].hash});assert.equal(actual.backend,backend);assert.deepEqual(errors,[])
   const summary=actual.rows.map(row=>{
    let mismatches=0;const examples=[]
    for(let i=0;i<expected.length;i++){
     const e=expected[i],c=expected[0],wanted=row.kind==='source-x-bits'||row.kind==='source-y-bits'?(()=>{const word=e.sourceWords[row.kind==='source-x-bits'?0:1];return [f32word(word&65535),f32word(word>>>16),word,f32word(1)]})():row.kind==='same-fixed-seeds-production-compositor'?[c.unitWord,c.unitWord,c.unitWord,f32word(1)]:row.kind.startsWith('uint-')?[c.convertedWord,c.unitWord,c.unitWord,f32word(1)]:[f32word(e.hash&65535),f32word(e.hash>>>16),e.convertedWord,e.unitWord]
     if(row.words[i].some((word,j)=>word!==wanted[j])){mismatches++;if(examples.length<8)examples.push({pixel:[e.x,e.y],sourceWords:e.sourceWords,hash:e.hash,actualWords:row.words[i],expectedWords:wanted,actualValues:row.values[i]})}
    }
    return {kind:row.kind,differingPixels:mismatches,examples}
   })
   result.tuples.push({profile,backend,...actual,summary});await save();console.log(JSON.stringify({profile,backend,summary}))
   await page.close()
  }
  await browser.close();browser=undefined
 }
 result.status='EXPERIMENT_ONLY_HASH_STAGE_DIAGNOSTIC_COMPLETE';await save()
}catch(error){result.status='failed';result.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
