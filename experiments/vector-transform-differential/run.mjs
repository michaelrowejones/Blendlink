import assert from 'node:assert/strict'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot,hash } from '../../scripts/lib/runtime-provenance.mjs'

const root=resolve(import.meta.dirname,'../..')
const built=process.argv.includes('--built')
const native=resolve(process.argv.slice(2).find(value=>!value.startsWith('--'))??join(root,'artifacts/verification-vector-transform/native53'))
const compiled=join(native,'compiled'),snapshot=join(native,'runtime-snapshot-'+(built?'built':'source'))
const proof=JSON.parse(await readFile(join(compiled,'proof.json'),'utf8'))
if(built)assert.equal(proof.exporter,'built','Repeat actual Final export with BLENDLINK_VECTOR_TRANSFORM_BUILT=1 before built-runtime proof')
const browserProof={...proof,scenes:proof.scenes.map(scene=>({...scene,manifestUrl:'/@fs'+join(compiled,scene.manifestUrl.replace(/^\//,''))}))}
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'Vector Transform'})
provenance.nativeFixtureSha256=hash(await readFile(join(root,'packages/blender-addon/tests/vector_transform_check.py')))
provenance.exportProofSha256=hash(await readFile(join(compiled,'proof.json')))
const extension=built?'.js':'.ts'
const server=await createServer({root:import.meta.dirname,publicDir:join(compiled,'public'),configFile:false,logLevel:'warn',
  cacheDir:join(native,'vite-cache'),optimizeDeps:{noDiscovery:true},
  resolve:{dedupe:['three'],alias:{'@blendlink-vector-runtime':join(snapshot,'tslMaterialRuntime'+extension)}},
  server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native]}}})
let browser
const rows=[],failures=[]
try{
  await server.listen()
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
  for(const backend of ['webgpu','webgl2']){
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
    await page.goto(server.resolvedUrls.local[0]+'?backend='+backend)
    await page.waitForFunction(()=>typeof window.runProof==='function')
    const result=await page.evaluate(proof=>window.runProof(proof),browserProof)
    assert.deepEqual(errors,[])
    assert.equal(result.backend,backend)
    rows.push(result)
    failures.push(...result.failures)
    await page.close()
  }
  await writeFile(join(native,'browser-report'+(built?'-built':'')+'.json'),JSON.stringify({built,nativeVersion:proof.nativeVersion,provenance,rows,failures},null,2))
  assert.deepEqual(failures,[],'Native Vector Transform pixels differ; see browser-report.json')
  console.log('BLENDLINK_VECTOR_TRANSFORM_BROWSER_PASSED '+JSON.stringify(rows.map(row=>({backend:row.backend,maximum:row.maximum,cases:row.cases,matrices:row.matrixMaximum}))))
}finally{await browser?.close();await server.close()}
