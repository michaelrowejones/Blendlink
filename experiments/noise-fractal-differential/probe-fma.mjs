import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve(process.env.BLENDLINK_FMA_EVIDENCE||'artifacts/verification-noise-fma')
mkdirSync(evidence,{recursive:true});const reference=join(evidence,'reference')
execFileSync('python3',[join(import.meta.dirname,'fma_reference.py'),reference],{cwd:root,stdio:'inherit'})
const built=process.argv.includes('--built'),snapshot=join(evidence,'snapshot-'+Date.now()),extension=built?'js':'ts'
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'noise-fma'})
const harness=freezeTslHarness(root,snapshot),facade=join(snapshot,'fma-facade.ts')
const facadeSource=`export * from './tslNodeRecipe.${extension}'
import { buildTslColorNode as original, buildTslScalarNode } from './tslNodeRecipe.${extension}'
import { buildNativeNoiseFma } from './tslNativeNoisePrecision.${extension}'
import { bitcast,uint,float,vec3 } from 'three/tsl'
export function buildTslColorNode(document,options){
 if(document.output.op!=='test_fma')return original(document,options)
 const child=key=>buildTslScalarNode({...document,output:document.output[key]},options)
 const bits=bitcast(buildNativeNoiseFma(child('a'),child('b'),child('c')),'uint')
 return vec3(float(bits.bitAnd(uint(2047))),float(bits.shiftRight(uint(11)).bitAnd(uint(2047))),float(bits.shiftRight(uint(22))))
}
`
writeFileSync(facade,facadeSource)
const server=await createServer({configFile:false,root:harness.directory,cacheDir:join(evidence,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:{'@blendlink-tsl-recipe':facade}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}}})
const channel=process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL||null
assert.ok(channel===null||channel==='chromium')
const args=JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS||'[]');assert.ok(Array.isArray(args)&&args.every(value=>typeof value==='string'))
const rows=[];let browser;let browserVersion=null
const floats=buffer=>new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength))
try{await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...args],...(channel?{channel}:{})});browserVersion=browser.version()
for(const backend of ['webgpu','webgl2']){
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
 await page.goto(server.resolvedUrls.local[0]+(backend==='webgl2'?'?backend=webgl2':''));const initialized=await page.evaluate(()=>window.__tslDiffInit());assert.equal(initialized.error,null);assert.equal(initialized.backend,backend==='webgpu')
 for(const group of ['fade-first','fade-second','mix']){
  const rendered=await page.evaluate(path=>window.__tslDiffRun('fma-probe','ir',path,false,null),'/@fs/'+join(reference,group+'.json'));assert.ok(rendered.ok,rendered.error)
  const bytes=Buffer.from(rendered.base64,'base64');writeFileSync(join(evidence,backend+'-'+group+'.encoded.f32'),bytes)
  const actual=floats(bytes),expected=floats(readFileSync(join(reference,group+'.f32')))
  const maximum=flip=>{let error=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++)for(let c=0;c<3;c++){
   const offset=(y*64+x)*rendered.components;const parts=[actual[offset],actual[offset+1],actual[offset+2]];assert.ok(parts.every(Number.isInteger));
   const data=new DataView(new ArrayBuffer(4));data.setUint32(0,(parts[0]|parts[1]<<11|parts[2]<<22)>>>0,true);const value=data.getFloat32(0,true);assert.ok(Number.isFinite(value));error=Math.max(error,Math.abs(value-expected[(((flip?63-y:y)*64+x)*3)+c]))}return error}
  const forward=maximum(false),reverse=maximum(true);rows.push({backend,group,maximum:Math.min(forward,reverse),flipRows:reverse<forward,pixels:4096,browserEnvironment:await page.evaluate(()=>window.__tslDiffEnvironment())})
 }
 assert.deepEqual(errors,[]);await page.close()
}
}finally{await browser?.close();await server.close()}
const hash=source=>createHash('sha256').update(source).digest('hex')
writeFileSync(join(evidence,'report.json'),JSON.stringify({oracle:'exact-rational nearest-even float32',encoding:'uint32 float bits split into exact positive 11/11/10-bit RGB lanes',built,channel,browserVersion,browserLaunchArgs:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...args],provenance,facadeSha256:hash(facadeSource),runnerSha256:hash(readFileSync(import.meta.filename)),oracleSha256:hash(readFileSync(join(import.meta.dirname,'fma_reference.py'))),rows},null,2))
assert.ok(rows.every(row=>row.maximum===0),JSON.stringify(rows))
console.log('BLENDLINK_NOISE_FMA_PASSED',4096*3,'exact float32 controls on both backends')
