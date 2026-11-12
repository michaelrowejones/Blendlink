import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { captureRuntimeSnapshot } from '../../scripts/lib/runtime-provenance.mjs'
import { freezeTslHarness } from '../../scripts/lib/frozen-tsl-harness.mjs'
const root=resolve(import.meta.dirname,'../..'),evidence=resolve(process.env.BLENDLINK_NOISE_IDENTITY_EVIDENCE||'artifacts/noise-coordinate-identity')
mkdirSync(evidence,{recursive:true})
const limit=0x47c35000,points=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,limit-1,(limit-1)|0x80000000].map(v=>v>>>0)
let seed=0x1d3a17f5
while(points.length<4096){seed=(Math.imul(seed,1664525)+1013904223)>>>0;points.push(((seed%limit)|(seed&0x80000000))>>>0)}
const pixels=points.flatMap(bits=>[bits&2047,(bits>>>11)&2047,bits>>>22,1])
const image={op:'tex_image',width:64,height:64,pixels,output:'color',interpolation:'Closest',extension:'REPEAT',vector:{op:'uv'}}
const built=process.argv.includes('--built'),extension=built?'js':'ts',snapshot=join(evidence,'snapshot-'+Date.now())
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'noise-coordinate-identity'})
const harness=freezeTslHarness(root,snapshot),facade=join(snapshot,'identity-facade.ts')
const facadeSource=`export * from './tslNodeRecipe.${extension}'
import {buildTslColorNode as build}from'./tslNodeRecipe.${extension}'
import {buildMetalShaderNoiseCoordinate,buildExactNoiseCoordinate}from'./tslNoiseCoordinates.${extension}'
import {uint,bitcast,float,vec3}from'three/tsl'
export function buildTslColorNode(document,options){
 const p=build({...document,output:document.output.input},options)
 const bits=uint(p.x).bitOr(uint(p.y).shiftLeft(uint(11))).bitOr(uint(p.z).shiftLeft(uint(22)))
 const value=bitcast(bits,'float'),helper=document.output.model==='metal'?buildMetalShaderNoiseCoordinate:buildExactNoiseCoordinate
 const result=bitcast(helper(value),'uint')
 return vec3(float(result.bitAnd(uint(2047))),float(result.shiftRight(uint(11)).bitAnd(uint(2047))),float(result.shiftRight(uint(22))))
}`
writeFileSync(facade,facadeSource);writeFileSync(join(evidence,'expected.u32'),Buffer.from(new Uint32Array(points).buffer))
for(const model of ['metal','exact'])writeFileSync(join(evidence,model+'.json'),JSON.stringify({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'identity-probe',model,input:image}}))
const server=await createServer({configFile:false,root:harness.directory,cacheDir:join(evidence,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:{'@blendlink-tsl-recipe':facade}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}}})
const channel=process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL||null,args=JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS||'[]')
assert.ok(channel===null||channel==='chromium');assert.ok(Array.isArray(args)&&args.every(v=>typeof v==='string'))
const rows=[];let browser,browserVersion
try{await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...args],...(channel?{channel}:{})});browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto(server.resolvedUrls.local[0]+(backend==='webgl2'?'?backend=webgl2':''));const init=await page.evaluate(()=>window.__tslDiffInit());assert.equal(init.error,null);assert.equal(init.backend,backend==='webgpu')
  for(const model of ['metal','exact']){
   const rendered=await page.evaluate(path=>window.__tslDiffRun('coordinate-identity','ir',path,false,null),'/@fs/'+join(evidence,model+'.json'));assert.ok(rendered.ok,rendered.error)
   const bytes=Buffer.from(rendered.base64,'base64');writeFileSync(join(evidence,backend+'-'+model+'.encoded.f32'),bytes)
   const actual=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
   const mismatches=flip=>{let count=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const i=(y*64+x)*rendered.components,parts=[actual[i],actual[i+1],actual[i+2]];assert.ok(parts.every(Number.isInteger))
    if(((parts[0]|parts[1]<<11|parts[2]<<22)>>>0)!==points[(flip?63-y:y)*64+x])count++
   }return count}
   rows.push({backend,model,mismatches:Math.min(mismatches(false),mismatches(true)),browserEnvironment:await page.evaluate(()=>window.__tslDiffEnvironment())})
  }
  assert.deepEqual(errors,[]);await page.close()
 }
}finally{await browser?.close();await server.close()}
const sha=value=>createHash('sha256').update(value).digest('hex')
writeFileSync(join(evidence,'report.json'),JSON.stringify({contract:'Exact float32 bit identity when abs(point)<100000, including signed zero/subnormals',points:4096,built,channel,browserVersion,browserLaunchArgs:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...args],provenance,runnerSha256:sha(readFileSync(import.meta.filename)),facadeSha256:sha(facadeSource),rows},null,2))
assert.ok(rows.every(row=>row.mismatches===0),JSON.stringify(rows))
console.log('BLENDLINK_NOISE_COORDINATE_IDENTITY_PASSED',4096,'f32 bit patterns, both helpers/backends')
