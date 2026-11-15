import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const here=import.meta.dirname,root=await realpath(resolve(here,'../..'));
const [generatedArg,outArg,profile='metal']=process.argv.slice(2);
assert.ok(generatedArg&&outArg);assert.equal(profile,'metal','This bounded source-profile capture is Metal only');
const generated=await realpath(generatedArg);await mkdir(resolve(outArg));const out=await realpath(resolve(outArg));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const input=JSON.parse(await readFile(join(root,'experiments/shader-kernel-bridge-next/input.json'),'utf8'));const apis=['webgpu','webgl2'];
const generation=JSON.parse(await readFile(join(generated,'generation.json'),'utf8'));
assert.equal(generation.status,'STATIC_NOISE_COLOR_LIBRARY_GENERATED');
const moduleBytes=await readFile(join(generated,'module.json'));assert.equal(hash(moduleBytes),generation.moduleSha256);
for(const [path,sha]of Object.entries(generation.sourcePins))assert.equal(hash(await readFile(path)),sha,path);
const module=JSON.parse(moduleBytes),fixture=join(out,'fixture');await mkdir(fixture);
for(const file of ['index.html','browser.js','adapter.mjs'])await copyFile(join(here,file),join(fixture,file));
const three=await realpath(join(root,'node_modules/three'));
const report={schemaVersion:1,status:'running',profile,inputSha256:hash(await readFile(join(root,'experiments/shader-kernel-bridge-next/input.json'))),generationSha256:hash(await readFile(join(generated,'generation.json'))),modulesSha256:hash(moduleBytes),rows:[],pins:{},supportCredit:0,nativeBlenderParityCredit:0,finalExports:0};
for(const path of [join(here,'run.mjs'),join(here,'browser.js'),join(root,'experiments/shader-kernel-bridge-next/input.json'),join(here,'generate.py'),join(here,'adapter.mjs'),join(root,'package-lock.json'),...['package.json','LICENSE','build/three.core.js','build/three.webgpu.js','build/three.tsl.js','src/nodes/code/FunctionNode.js','src/nodes/code/CodeNode.js'].map(p=>join(three,p))])report.pins[path]=hash(await readFile(path));
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:[{find:'three/webgpu',replacement:join(three,'build/three.webgpu.js')},{find:'three/tsl',replacement:join(three,'build/three.tsl.js')},{find:/^three$/,replacement:join(three,'build/three.module.js')}],dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,three,out]}}});
let browser;
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
try{
 await server.listen();
 browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='metal'?['--use-angle=metal']:['--use-angle=swiftshader','--use-vulkan=swiftshader'])]});
 report.browserVersion=browser.version();
 for(const backend of apis){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.setDefaultTimeout(120000);
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.captureStaticNoiseColor==='function');
  let row;
  try{row=await page.evaluate(payload=>window.captureStaticNoiseColor(payload),{backend,module,inputWords:input.rows.flatMap(r=>r.words)});}
  catch(error){row=await page.evaluate(()=>window.staticNoiseFailure);report.rows.push({...row,pageErrors:errors});await save();throw error;}
  assert.equal(row.backend,backend);
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i);}else assert.match(JSON.stringify(row.gpu),/swiftshader/i);
  for(const sample of row.rows)for(const field of ['vertexShader','fragmentShader','words']){
   const raw=field==='words'?Buffer.from(new Uint32Array(sample.words).buffer):Buffer.from(sample[field]);
   const file=backend+'-'+sample.case+'-'+field+(field==='words'?'.u32':'.txt');
   await writeFile(join(out,file),raw);sample[field+'Archive']={file,sha256:hash(raw),bytes:raw.length};delete sample[field];
  }
  report.rows.push({...row,pageErrors:errors});await save();assert.deepEqual(errors,[]);await page.close();
 }
 for(const[path,sha]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),sha,path);
 report.status='STATIC_NOISE_COLOR_CAPTURE_COMPLETE';
}catch(error){report.status='FAILED_ZERO_CREDIT';report.error=String(error);throw error;}
finally{await save();await browser?.close();await server.close();}
console.log(JSON.stringify({status:report.status,profile,cases:report.rows.reduce((s,r)=>s+r.rows.length,0)}));
