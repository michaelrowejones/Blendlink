import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
const required=process.argv.includes('--expect-required'),phase=required?'after-contract':'before-contract'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve('artifacts/verification-magic-roughness'),website=join(evidence,'website')
const hash=b=>createHash('sha256').update(b).digest('hex'),source=join(evidence,'MagicRoughness.blend'),native=JSON.parse(await readFile(join(evidence,'native.json')))
assert.equal(hash(await readFile(source)),native.sourceSha256)
const program=await readFile(join(website,'models/MagicRoughness.materials.json')),glb=await readFile(join(website,'models/MagicRoughness.glb'))
const descriptor={url:'/models/MagicRoughness.glb',materialPrograms:{url:'/models/MagicRoughness.materials.json',bytes:program.length,hash:hash(program).slice(0,16)}}
const snapshot=join(evidence,'runtime-'+phase),{provenance}=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'Magic Roughness renderer requirement'})
const harness=join(snapshot,'harness');await mkdir(harness,{recursive:true})
provenance.harnessSha256={}
for(const name of ['browser.js','index.html']){await copyFile(join(import.meta.dirname,name),join(harness,name));provenance.harnessSha256[name]=hash(await readFile(join(harness,name)))}
const server=await createServer({root:harness,configFile:false,publicDir:website,logLevel:'warn',cacheDir:join(evidence,'vite-cache-'+phase),optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@required-runtime':join(snapshot,'tslMaterialRuntime.js'),'@required-document':join(snapshot,'materialProgramDocument.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence]}}})
let browser;const rows=[]
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:'chromium',args:['--enable-unsafe-webgpu']})
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto(server.resolvedUrls.local[0]+'?backend='+backend);await page.waitForFunction(()=>typeof window.runRequiredRenderer==='function')
  const row=await page.evaluate(d=>window.runRequiredRenderer(d),descriptor);rows.push({...row,errors});await writeFile(join(evidence,phase+'-partial.json'),JSON.stringify({provenance,rows},null,2)+'\n');await page.close();assert.deepEqual(errors,[])
 }
 const report={kind:'actual-Final-Magic-Roughness-renderer-requirement',phase,sourcePreserved:true,sourceSha256:native.sourceSha256,native,glbSha256:hash(glb),programSha256:hash(program),provenance,rows}
 await writeFile(join(evidence,phase+'.json'),JSON.stringify(report,null,2)+'\n')
 for(const row of rows){assert.equal(row.stock.roughness,1);assert.equal(row.stock.roughnessMap,false);assert.equal(row.legacyLoads,required?1:0);if(required)assert.match(row.legacyError,/Legacy WebGLRenderer.*Magic Texture/);else assert.equal(row.legacyError,null);assert.ok(row.installedCenter[0]<.9);assert.ok(native.nativeRange[1]<row.stock.roughness)}
 console.log('MAGIC_ROUGHNESS_RENDERER_REQUIREMENT_PASSED '+JSON.stringify(rows))
}finally{await browser?.close();await server.close()}
