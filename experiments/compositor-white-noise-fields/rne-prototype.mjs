// Experimental variant only. Append private exports; never rewrite native/kernel bodies.
import assert from 'node:assert/strict'
import {copyFile,cp,mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import ts from 'typescript'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),native=resolve(process.argv[2]),previous=resolve(process.argv[3]),out=resolve(process.argv[4]);await mkdir(out)
const read=async file=>JSON.parse(await readFile(file,'utf8')),q=await read(join(native,'report.json')),capture=await read(join(native,'capture.json'))
assert.equal(q.status,'RESEARCH_ONLY_AXIS_TABLE_NATIVE_INPUTS');assert.equal(q.nativeRenders,48);assert.equal(q.exactWordDifferences,0);assert.equal(hash(await readFile(join(native,'report.json'))),capture.reportSha256)
const pins={};for(const row of q.rows)assert.equal(hash(await readFile(join(native,row.pixelFile))),row.pixelSha256)
const cpuLaw=await read(join(root,'experiments/uint32-f32-exhaustive/evidence.json'));assert.equal(cpuLaw.status,'exhaustive-owned-cpu-law-pass');assert.equal(cpuLaw.measured.checked,4294967296);assert.equal(cpuLaw.measured.mismatches,0)
const runtime=join(out,'runtime');await cp(join(previous,'runtime'),runtime,{recursive:true})
const original=await readFile(join(runtime,'tslNodeRecipe.ts'),'utf8'),extension='\n// Research-only exports; function bodies and old shader callers remain byte-identical.\nexport { hashUint3, hashUint4 }\n',derived=original+extension
const functions=text=>{const file=ts.createSourceFile('hash.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(file.parseDiagnostics.length,0);return Object.fromEntries(file.statements.filter(n=>ts.isFunctionDeclaration(n)).map(n=>[n.name.text,n.body.getText(file)]))}
assert.deepEqual(functions(derived),functions(original));for(const name of ['hashUint3','hashUint4'])assert.ok(Object.hasOwn(functions(original),name))
await writeFile(join(runtime,'tslNodeRecipe.ts'),derived)
const fixture=join(out,'fixture');await mkdir(fixture)
for(const name of ['axis-table.mjs','rne-normalization.mjs','uint-cases.mjs','uint-rne.js']){const bytes=await readFile(join(import.meta.dirname,name));pins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
const oldBrowser=await readFile(join(import.meta.dirname,'browser-prototype.js'),'utf8'),oldImport="import {compositorWhiteNoiseHash} from '@exact-hash'",newImport="import {experimentalCpuWhiteNoiseHash as compositorWhiteNoiseHash} from './rne-normalization.mjs'"
assert.equal(oldBrowser.split(oldImport).length,2)
const browserSource=oldBrowser.replace(oldImport,newImport).replaceAll('EXPERIMENT_ONLY_EXACT_AXIS_TABLE','EXPERIMENT_ONLY_CPU_RNE_AXIS_TABLE')
await writeFile(join(fixture,'browser-rne.js'),browserSource);pins['browser-rne.js']=hash(browserSource)
await writeFile(join(fixture,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><script type="module" src="./browser-rne.js"></script><script type="module" src="./uint-rne.js"></script></body></html>')
const rows=q.rows.map(row=>({...row,pixelUrl:'/@fs'+join(native,row.pixelFile)})),result={status:'running',portCredit:0,savedFinalCredit:0,model:'experimental-native-cpu-u32-rne-v1',nativeReportSha256:capture.reportSha256,cpuExhaustiveLawSha256:hash(await readFile(join(root,'experiments/uint32-f32-exhaustive/evidence.json'))),originalProductionHashSourceSha256:hash(original),experimentalHashSourceSha256:hash(derived),exportTransform:{appended:extension,unchangedFunctionBodies:true},fixturePins:pins,tuples:[]}
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(result,null,2)+'\n')
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@experimental-hash':join(runtime,'tslNodeRecipe.ts'),'@old-coordinates':join(runtime,'tslCompositorFloatCoordinates.ts')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native,previous,out,await realpath(join(root,'node_modules'))]}}});let browser
try{
 await server.listen()
 for(const profile of ['software','metal']){
  browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[])]})
  for(const backend of ['webgpu','webgl2']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push({text:m.text(),location:m.location()})})
   await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runAxisTablePrototype==='function'&&typeof window.runDynamicRneProbe==='function')
   const calibration=await page.evaluate(()=>window.runDynamicRneProbe());assert.equal(calibration.backend,backend);assert.equal(calibration.exactMismatches,0);assert.equal(calibration.values,65536)
   result.tuples.push({profile,backend,browserVersion:browser.version(),calibration,fieldStatus:'pending'});await save()
   const field=await page.evaluate(proof=>window.runAxisTablePrototype(proof),{rows});Object.assign(result.tuples.at(-1),{fieldStatus:field.status,field,consoleErrors:errors});await save()
   assert.equal(field.status,'EXPERIMENT_ONLY_CPU_RNE_AXIS_TABLE');assert.equal(field.backend,backend);assert.equal(field.rows.length,48);assert.equal(field.remainingTextures,0);assert.equal(field.remainingRenderTargets,0);assert.deepEqual(errors,[])
   if(profile==='metal'){assert.match(JSON.stringify(field.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(field.gpu),/swiftshader/i)}else assert.match(JSON.stringify(field.gpu),/swiftshader/i)
   assert.ok(field.rows.every(r=>r.exactWordDifferences===0&&r.liveTableBindings===1&&r.allocation.bytes<=65536));assert.equal(field.negatives.length,4);assert.equal(field.cycles.length,3)
   await page.close()
  }
  await browser.close();browser=undefined
 }
 for(const name of ['axis-table.mjs','rne-normalization.mjs','uint-cases.mjs','uint-rne.js'])assert.equal(hash(await readFile(join(import.meta.dirname,name))),pins[name])
 assert.equal(await readFile(join(import.meta.dirname,'browser-prototype.js'),'utf8'),oldBrowser)
 assert.deepEqual(functions(await readFile(join(runtime,'tslNodeRecipe.ts'),'utf8')),functions(original))
 result.status='EXPERIMENT_ONLY_CPU_RNE_AXIS_TABLE_CLOSED';await save();console.log(JSON.stringify({status:result.status,tuples:result.tuples.length,dynamicUintValues:4*65536,fieldWords:result.tuples.reduce((n,t)=>n+t.field.rows.reduce((s,r)=>s+r.comparedWords,0),0),portCredit:0}))
}catch(error){result.status='failed';result.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
