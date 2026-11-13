import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.env.BLENDLINK_FLOAT_TO_INT_NATIVE??join(root,'artifacts/float-to-int'))
const profile=process.env.BLENDLINK_TEST_PROFILE??'software';assert.ok(['metal','software'].includes(profile))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),read=path=>readFile(path,'utf8').then(JSON.parse)
const cpu=await read(join(directory,'compositor53-cpu/report.json')),gpu=await read(join(directory,'compositor53-gpu/report.json'))
for(const record of [cpu,gpu]){
 assert.equal(record.fixtureSha256,hash(await readFile(join(import.meta.dirname,'compositor_probe.py'))))
 assert.equal(record.valuesSha256,hash(await readFile(join(import.meta.dirname,'values.py'))))
 assert.equal(record.oracleHelperSha256,hash(await readFile(join(root,'packages/blender-addon/tests/compositor_reference.py'))))
 assert.deepEqual(record.version,[5,3,0]);assert.equal(record.sourcePreserved,true);assert.equal(record.status,'CAPTURED_RESEARCH_ONLY')
}
const expected={}
for(const mode of ['ROUND','FLOOR','CEILING','TRUNCATE']){
 const records=[cpu,gpu].map(record=>record.rows.find(row=>row.case===mode.toLowerCase()+'-image'))
 assert.deepEqual(records[0].redWords,records[1].redWords)
 for(const[index,record]of records.entries()){
  const bytes=await readFile(join(directory,'compositor53-'+(index?'gpu':'cpu'),record.pixelFile));assert.equal(hash(bytes),record.pixelSha256)
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  assert.deepEqual(record.redWords,Array.from({length:64},(_,pixel)=>view.getUint32(pixel*16,true).toString(16).padStart(8,'0')))
 }
 expected[mode]=records[0].redWords.map(word=>parseInt(word,16))
}
assert.deepEqual(cpu.controls,gpu.controls)
const proof={controls:cpu.controls.map(control=>({...control,word:parseInt(control.word,16)})),expected}
const destination=join(directory,'browser-'+profile),fixture=join(destination,'fixture');await mkdir(fixture,{recursive:true})
const fixturePins={}
for(const name of ['browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name));assert.equal(hash(await readFile(join(fixture,name))),fixturePins[name])}
const libraryPins={}
for(const name of ['three.core.js','three.webgpu.js','three.tsl.js'])libraryPins[name]=hash(await readFile(join(root,'node_modules/three/build',name)))
const threeVersion=(await read(join(root,'node_modules/three/package.json'))).version;assert.equal(threeVersion,'0.184.0')
const report={status:'running',profile,productionCoverage:false,threeVersion,libraryPins,runnerSha256:hash(await readFile(join(import.meta.dirname,'run.mjs'))),nativePins:{cpu:hash(await readFile(join(directory,'compositor53-cpu/report.json'))),gpu:hash(await readFile(join(directory,'compositor53-gpu/report.json')))},fixturePins,rows:[]}
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root]}}})
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
 report.browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'?backend='+backend);await page.waitForFunction(()=>typeof window.runTrial==='function')
  if(backend==='webgpu'){
   const negative=await page.evaluate(async proof=>{
    const gpu=navigator.gpu;if(!gpu)throw new Error('The positive trial requires navigator.gpu')
    const original=Object.getOwnPropertyDescriptor(gpu,'requestAdapter');Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true})
    try{await window.runTrial(proof);return{refused:false}}catch(error){return{refused:true,error:String(error)}}finally{if(original)Object.defineProperty(gpu,'requestAdapter',original);else delete gpu.requestAdapter}
   },proof)
   assert.equal(negative.refused,true);assert.match(negative.error,/actual WebGPU adapter/);report.missingAdapterControl=negative
  }
  const row=await page.evaluate(proof=>window.runTrial(proof),proof);report.rows.push({...row,pageErrors:errors});await save()
  assert.equal(row.backend,backend);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(errors,[])
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
  for(const result of row.rows.filter(result=>result.scenario==='qualified-points'&&result.kernel.startsWith('candidate-')))assert.deepEqual(result.mismatches,[],backend+' '+result.kernel)
  await page.close()
 }
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu']);report.status='PRIVATE_CANDIDATE_PASSED';await save()
 console.log('BLENDLINK_FLOAT_TO_INT_PRIVATE_TRIAL '+JSON.stringify(report.rows.map(row=>({backend:row.backend,gpu:row.gpu,qualifiedCandidateMismatches:row.rows.filter(result=>result.scenario==='qualified-points'&&result.kernel.startsWith('candidate-')).reduce((sum,result)=>sum+result.mismatches.length,0)}))))
}catch(error){report.status='failed';report.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
