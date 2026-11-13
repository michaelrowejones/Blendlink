import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve(process.env.BLENDLINK_MAGIC_FINAL||join(root,'artifacts/verification-magic-final'))
const blender=process.env.BLENDLINK_BLENDER
assert.ok(blender&&existsSync(blender),'Set BLENDLINK_BLENDER to the actual native executable')
mkdirSync(evidence,{recursive:true})
const snapshot=join(evidence,'runtime-'+Date.now()+'-'+process.pid),{provenance}=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'Magic Final'})
const fixture=join(snapshot,'final.py');copyFileSync(join(import.meta.dirname,'final.py'),fixture)
const env={...process.env,BLENDLINK_MAGIC_FINAL:evidence,BLENDLINK_BLENDER:blender}
if(!process.argv.includes('--reuse-reference'))writeFileSync(join(evidence,'native.log'),execFileSync(blender,['--background','--factory-startup','--python-exit-code','1','--python',fixture],{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024}))
const source=join(evidence,'Magic.blend'),sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex')
const website=join(evidence,'website')
if(!process.argv.includes('--reuse-export'))writeFileSync(join(evidence,'export.log'),execFileSync(process.execPath,[join(root,'packages/blendlink/dist/cli.js'),'export','--blend',source,'--out',website],{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024}))
assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sourceHash,'Final export changed the saved artist scene')
const modelRoot=join(website,'models'),glbName=readdirSync(modelRoot).find(name=>name.endsWith('.glb'))
assert.ok(glbName,'Final did not publish its GLB')
const materialName=glbName.replace(/\.glb$/,'.materials.json'),programBytes=readFileSync(join(modelRoot,materialName)),programs=JSON.parse(programBytes)
assert.equal(Object.keys(programs.materials).length,3)
const descriptor={url:'/models/'+glbName,materialPrograms:{url:'/models/'+materialName,bytes:programBytes.length,
  hash:createHash('sha256').update(programBytes).digest('hex').slice(0,16),materials:3}}
// The standalone site embeds its descriptor in JS rather than publishing a
// manifest JSON. This pointer binds exactly the GLB and sidecar it shipped.
writeFileSync(join(evidence,'actual-export-descriptor.json'),JSON.stringify(descriptor))
const reference=JSON.parse(readFileSync(join(evidence,'native.json'),'utf8'))
const expectedBytes=readFileSync(join(evidence,'native.f32')),expected=new Float32Array(expectedBytes.buffer.slice(expectedBytes.byteOffset,expectedBytes.byteOffset+expectedBytes.byteLength))
const harness=join(snapshot,'harness');mkdirSync(harness)
for(const name of ['final-browser.js','final.html'])copyFileSync(join(import.meta.dirname,name),join(harness,name))
const server=await createServer({root:harness,publicDir:website,configFile:false,logLevel:'warn',cacheDir:join(evidence,'vite-cache-final'),optimizeDeps:{noDiscovery:true},
  resolve:{dedupe:['three'],alias:{'@blendlink-magic-runtime':join(snapshot,'tslMaterialRuntime.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence]}}})
let browser;const rows=[];let visitor
try{
  await server.listen()
  const channel=process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL;assert.ok(!channel||channel==='chromium')
  const args=JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS||'[]');assert.ok(Array.isArray(args)&&args.every(value=>typeof value==='string'))
  browser=await chromium.launch({headless:true,...(channel?{channel}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...args]})
  for(const backend of ['webgpu','webgl2']){
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
    await page.goto(server.resolvedUrls.local[0]+'final.html?backend='+backend)
    await page.waitForFunction(()=>typeof window.runMagicFinal==='function')
    const result=await page.evaluate(options=>window.runMagicFinal(options),{...reference,descriptor})
    assert.deepEqual(errors,[])
    const bytes=Buffer.from(result.base64,'base64'),actual=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
    const measure=flip=>{
      let maximum=0,ratio=0
      for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++)for(let c=0;c<3;c++){
        const index=((flip?reference.height-1-y:y)*reference.width+x)*3+c,value=actual[(y*reference.width+x)*result.components+c]
        assert.ok(Number.isFinite(value))
        const error=Math.abs(value-expected[index]),halfUlp=Math.max(2**(Math.floor(Math.log2(Math.abs(expected[index])||2**-14))-10),2**-24)
        maximum=Math.max(maximum,error);ratio=Math.max(ratio,error/(2e-5+(reference.nativeResidualReconstruction?.quantizationBound??halfUlp)))
      }
      return{maximum,ratio,flip}
    }
    const a=measure(false),b=measure(true),metrics=a.maximum<b.maximum?a:b
    rows.push({backend,...metrics,materials:result.materials,gpu:result.gpu})
    assert.ok(metrics.ratio<=1,'Actual Final Magic differs from independent native emission: '+JSON.stringify(rows.at(-1)))
    await page.close()
  }
  const page=await browser.newPage({viewport:{width:768,height:256}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'index.html')
  await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:60000})
  assert.deepEqual(errors,[])
  await page.screenshot({path:join(evidence,'visitor-'+(channel?'physical':'software')+'.png')})
  visitor={ready:true,errors};await page.close()
  const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
  const report={provenance,sourceHash,reference,visitor,glbSha256:sha(join(modelRoot,glbName)),nativePixelsSha256:createHash('sha256').update(expectedBytes).digest('hex'),
    harnessSha256:{'final.py':sha(fixture),'final-browser.js':sha(join(harness,'final-browser.js')),'final.html':sha(join(harness,'final.html'))},rows}
  writeFileSync(join(evidence,'report-'+(channel?'physical':'software')+'.json'),JSON.stringify(report,null,2))
  console.log('BLENDLINK_MAGIC_FINAL_PASSED '+JSON.stringify(rows))
}finally{await browser?.close();await server.close()}
