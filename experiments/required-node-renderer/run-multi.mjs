import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
import {readGlbJson} from '../../packages/blendlink/dist/gltfRuntimeCompatibility.js'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve('artifacts/verification-magic-roughness'),website=join(evidence,'multi-website')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const model=join(website,'models/MagicSqueezeMulti.glb'),sidecar=join(website,'models/MagicSqueezeMulti.materials.json')
const glb=await readFile(model),programs=await readFile(sidecar),raw=readGlbJson(glb,'actual shared Magic and Squeeze mesh')
assert.equal(raw.meshes.length,1);assert.equal(raw.meshes[0].primitives.length,2)
assert.deepEqual(raw.meshes[0].extras.blendlink_tsl_runtime.requiresNodeRenderer.programs,[
 {op:'squeeze_native',model:'eevee-squeeze-f32-v1'},{op:'tex_magic_native',model:'eevee-magic-f32-v1'},
])
const descriptor={url:'/@fs'+model,materialPrograms:{url:'/@fs'+sidecar,bytes:programs.length,hash:hash(programs).slice(0,16)}}
const snapshot=join(evidence,'runtime-multi'),{provenance}=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'actual material requirement union'})
const harness=join(snapshot,'harness');await mkdir(harness,{recursive:true})
provenance.harnessSha256={}
for(const name of ['browser.js','index.html']){await copyFile(join(import.meta.dirname,name),join(harness,name));provenance.harnessSha256[name]=hash(await readFile(join(harness,name)))}
const server=await createServer({root:harness,configFile:false,publicDir:false,logLevel:'warn',cacheDir:join(evidence,'vite-cache-multi'),optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@required-runtime':join(snapshot,'tslMaterialRuntime.js'),'@required-document':join(snapshot,'materialProgramDocument.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence]}}})
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:'chromium'})
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.runRequiredRendererMulti==='function')
 const result=await page.evaluate(d=>window.runRequiredRendererMulti(d),descriptor)
 const report={kind:'actual-Final-native-producer-multimaterial-renderer-requirement-union',glbSha256:hash(glb),programsSha256:hash(programs),provenance,result,errors}
 await writeFile(join(evidence,'multi-contract.json'),JSON.stringify(report,null,2)+'\n');assert.deepEqual(errors,[])
 console.log('REQUIRED_RENDERER_ACTUAL_MULTIMATERIAL_PASSED '+JSON.stringify(result))
}finally{await browser?.close();await server.close()}
