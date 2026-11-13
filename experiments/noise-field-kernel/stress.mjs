import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
import {freezeTslHarness} from '../../scripts/lib/frozen-tsl-harness.mjs'
import {applyFieldTableOverlay} from './overlay.mjs'
const root=resolve(import.meta.dirname,'../..'),reference=resolve(process.argv[2]),evidence=resolve(process.argv[3])
const sha=data=>createHash('sha256').update(data).digest('hex')
const snapshot=join(evidence,'baseline'),capture=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'finite-field-ownership'})
const overlay=await applyFieldTableOverlay({root,snapshot,built:true,provenance:capture.provenance})
const harness=freezeTslHarness(root,snapshot),mainPath=join(harness.directory,'main.js')
let main=readFileSync(mainPath,'utf8').replace('const SIZE = 64','let SIZE = 64')
main+=`
window.__fieldOwned=()=>({ownedTextures:state.resources?.textures.length??0,environment:window.__tslDiffEnvironment()})
window.__fieldResize=size=>{SIZE=size;state.target.setSize(size,size);state.renderer.setSize(size,size,false)}
`
writeFileSync(mainPath,main)
const index=JSON.parse(readFileSync(join(reference,'index.json'))),cell=index.cases.find(c=>c.id==='cycles-fbm-raw-4d-color-image-4')
const original=JSON.parse(readFileSync(join(reference,'ir',cell.id+'.json'))),changed=structuredClone(original)
const mutate=x=>{if(!x||typeof x!=='object')return;if(x.op==='tex_image'){for(let i=0;i<x.pixels.length;i+=4){const[a,b,c]=x.pixels.slice(i,i+3);x.pixels.splice(i,3,b,c,a)}}else for(const y of Object.values(x))if(typeof y==='object')mutate(y)}
mutate(changed)
mkdirSync(join(evidence,'ir'),{recursive:true})
for(const[name,document]of Object.entries({original,changed,control:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'const_vec3',value:[.25,.5,.75]}}}))writeFileSync(join(evidence,'ir',name+'.json'),JSON.stringify(document))
const server=await createServer({configFile:false,root:harness.directory,cacheDir:join(evidence,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},
resolve:{alias:{'@blendlink-tsl-recipe':join(overlay.snapshot,'tslNodeRecipe.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence]}}})
const rows=[],failures=[];let browser
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader']})
 for(const backend of['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  try{
   await page.goto(server.resolvedUrls.local[0]+(backend==='webgl2'?'?backend=webgl2':''));const initialized=await page.evaluate(()=>window.__tslDiffInit());assert.equal(initialized.error,null)
   const hashes=new Map()
   const render=async(name,size)=>{
    const started=Date.now(),out=await page.evaluate(({name,path})=>window.__tslDiffRun(name,'ir',path,false,null),{name,path:'/@fs/'+join(evidence,'ir',name+'.json')})
    assert.ok(out.ok,out.error);assert.deepEqual(errors,[])
    const bytes=Buffer.from(out.base64,'base64'),values=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.equal(values.length,size*size*4)
    assert.ok(values.every(Number.isFinite));for(let i=0;i<values.length;i+=4)assert.equal(values[i+3],1)
    const owned=await page.evaluate(()=>window.__fieldOwned());assert.equal(owned.ownedTextures,name==='control'?0:1)
    assert.equal(owned.environment.deviceLoss,null)
    assert.equal(owned.environment.memory.textures,name==='control'?1:2)
    if(name==='control')for(let i=0;i<values.length;i+=4)assert.deepEqual(Array.from(values.subarray(i,i+3)),[.25,.5,.75])
    const key=name+'-'+size,hash=sha(bytes);if(hashes.has(key))assert.equal(hash,hashes.get(key),'Stale/reapply/resize output changed');else hashes.set(key,hash)
    rows.push({backend,name,size,sha256:hash,elapsedMs:Date.now()-started,...owned})
   }
   for(let index=0;index<12;index++){await render('original',64);await render('changed',64)}
   assert.notEqual(hashes.get('original-64'),hashes.get('changed-64'),'New immutable image data reused stale table')
   await render('control',64)
   for(const size of[128,32,64,128,64]){await page.evaluate(size=>window.__fieldResize(size),size);await render('original',size);await render('control',size)}
  }catch(error){failures.push({backend,error:String(error),errors})}finally{await page.close()}
 }
}finally{await browser?.close();await server.close();writeFileSync(join(evidence,'report.json'),JSON.stringify({provenance:overlay.provenance,harnessSha256:sha(main),rows,failures},null,2))}
assert.deepEqual(failures,[]);console.log('FIELD_TABLE_OWNERSHIP_PASSED',rows.length,'reapply/resize/dispose draws')
