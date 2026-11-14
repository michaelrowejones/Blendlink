// Exercises real runner setup with synthetic schema packets and hard-stubbed browser entrypoints.
// No native process, actual browser, numerical case or GPU is launched by these tests.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,symlink,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import ts from 'typescript'
import {captureRuntimeTransaction} from './runtime-transaction-snapshot.mjs'
import {hash} from './runtime-provenance.mjs'
const actualRoot=resolve(import.meta.dirname,'../..')
const families={
 'compositor-image-coordinates':{references:'BLENDLINK_IMAGE_COORDINATES_REFERENCES',expected:'expectedPixelCases'},
 'compositor-float-coordinates':{references:'BLENDLINK_FLOAT_COORDINATES_REFERENCES',expected:'expectedFloatCoordinateCases'},
 'compositor-texture-fields':{references:'SCENETOWEB_TEXTURE_FIELD_REFERENCES',expected:'expectedTextureFieldCases'},
 'radial-segment-width':{references:'SCENETOWEB_RADIAL_WIDTH_REFERENCES'}
}
const textureSaved=['13x9-implicit-gradient-linear-color','13x9-implicit-gradient-quadratic-color','13x9-implicit-gradient-easing-color','13x9-implicit-checker-5-color','13x9-normalized-gradient-easing-fac','13x9-normalized-checker-5-color','64x48-implicit-gradient-diagonal-color','64x48-uniform-gradient-diagonal-fac'].map(name=>'blender-5-3-cpu-'+name)
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'field-proof-runtime-'))),sdk=join(root,'packages/blendlink')
 for(const p of ['src','dist/vendor','scripts'])await mkdir(join(sdk,p),{recursive:true})
 await mkdir(join(root,'scripts/lib'),{recursive:true});await symlink(join(actualRoot,'node_modules'),join(root,'node_modules'),'dir')
 for(const name of ['runtime-provenance.mjs','runtime-compiler-trace.mjs','runtime-transaction-snapshot.mjs'])await writeFile(join(root,'scripts/lib',name),await readFile(join(actualRoot,'scripts/lib',name)))
 await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'package-lock.json'),'{}');await writeFile(join(sdk,'package.json'),'{"type":"module"}')
 await writeFile(join(sdk,'scripts/copy-assets.mjs'),'// synthetic fixture build\n');await writeFile(join(sdk,'src/entry.ts'),'export const value=7\n');await writeFile(join(sdk,'dist/vendor/test.js'),'export const vendor=1\n')
 const config={compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',outDir:'dist',rootDir:'src',sourceMap:true,skipLibCheck:true,types:[]},include:['src/**/*.ts']}
 await writeFile(join(sdk,'tsconfig.json'),JSON.stringify(config));const parsed=ts.parseJsonConfigFileContent(config,ts.sys,sdk);assert.equal(ts.createProgram({rootNames:parsed.fileNames,options:parsed.options}).emit().emitSkipped,false)
 await writeFile(join(root,'vite-stub.mjs'),"export async function createServer(){return{listen:async()=>{throw new Error('ATTESTATION_ONLY_NO_GPU')},close:async()=>{}}}\n")
 await writeFile(join(root,'playwright-stub.mjs'),"export const chromium={launch(){throw new Error('UNEXPECTED_BROWSER_STARTUP')}}\n")
 await writeFile(join(root,'loader.mjs'),"export async function resolve(name,context,next){if(name==='vite'||name==='@playwright/test')return{url:new URL(name==='vite'?'./vite-stub.mjs':'./playwright-stub.mjs',import.meta.url).href,shortCircuit:true};return next(name,context)}\n")
 for(const [family,spec]of Object.entries(families)){
  const folder=join(root,'experiments',family);await mkdir(folder,{recursive:true})
  for(const name of ['run.mjs','protocol.mjs','browser.js','index.html'])await writeFile(join(folder,name),await readFile(join(actualRoot,'experiments',family,name)))
  if(family==='radial-segment-width')await writeFile(join(folder,'cases.json'),await readFile(join(actualRoot,'experiments',family,'cases.json')))
  const p=await import(pathToFileURL(join(folder,'protocol.mjs')).href),references=join(root,'references-'+family);await mkdir(references)
  const bytes=Buffer.from('synthetic data; never rendered'),pin=hash(bytes);await writeFile(join(references,'data.bin'),bytes)
  const q={status:p.browserProofContract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',device:'CPU',sourceHashes:{},...(family==='radial-segment-width'?{width:8,height:8,refusals:p.expectedRefusals.map(kind=>({kind,diagnostics:[{code:kind==='animated-input'?'animated-tree':'unsupported-radial-width'}]}))}:{}),cases:(spec.expected?p[spec.expected]('CPU'):p.specifications).map((row,index)=>{
   const saved=family==='radial-segment-width'?row.saved:family==='compositor-image-coordinates'?[13,26].includes(row.width)&&p.pixelFinalRoutes.includes(row.route):family==='compositor-texture-fields'?textureSaved.includes(row.case):index<p.savedFinalCaseCount
   return{...row,programFile:'data.bin',programSha256:pin,pixelFile:'data.bin',pixelSha256:pin,inputFile:'data.bin',inputSha256:pin,...(family==='radial-segment-width'?{shaderIrFile:'data.bin',shaderIrSha256:pin,shaderPixelFile:'data.bin',shaderPixelSha256:pin}:{}),...(saved?{sourceFile:row.case+'.blend'}:{})}
  })}
  await writeFile(join(references,'qualification.json'),JSON.stringify(q))
 }
 return root
}
async function run(root,family,transaction={},built=true){
 const references=join(root,'references-'+family),destination=join(references,'browser-raw-software');await rm(destination,{recursive:true,force:true})
 const env={...process.env,BLENDLINK_TEST_PROFILE:'software',[families[family].references]:references};delete env.SCENETOWEB_RUNTIME_TRANSACTION;delete env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256;Object.assign(env,transaction)
 const result=spawnSync(process.execPath,['--loader',join(root,'loader.mjs'),join(root,'experiments',family,'run.mjs'),...(built?['--built']:[])],{cwd:root,env,encoding:'utf8',timeout:20000})
 assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/UNEXPECTED_BROWSER_STARTUP/)
 return{...result,destination}
}
test('all registered field runners select only an explicit validated transaction; standalone ignores existing snapshots',async()=>{
 const root=await fixture()
 try{
  const pin=await captureRuntimeTransaction({root,directory:join(root,'transaction')}),record=JSON.parse(await readFile(pin.path,'utf8'))
  for(const family of Object.keys(families)){
   const shared=await run(root,family,{SCENETOWEB_RUNTIME_TRANSACTION:pin.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:pin.sha256});assert.match(shared.stderr,/ATTESTATION_ONLY_NO_GPU/)
   const report=JSON.parse(await readFile(join(shared.destination,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.provenance.snapshot.directory,record.provenance.snapshot.directory);assert.deepEqual(report.provenance.transaction,{path:pin.path,sha256:pin.sha256,id:record.id});assert.deepEqual(report.provenance.compilerAttestation,record.provenance.compilerAttestation)
   await assert.rejects(stat(join(shared.destination,'runtime')),{code:'ENOENT'})
   // A perfectly valid prior transaction exists on disk, but neither env variable was supplied.
   const standalone=await run(root,family);assert.match(standalone.stderr,/ATTESTATION_ONLY_NO_GPU/)
   const plain=JSON.parse(await readFile(join(standalone.destination,'report.json'),'utf8'));assert.equal(plain.status,'failed');assert.equal(plain.provenance.transaction,undefined);assert.equal(plain.provenance.snapshot.directory,join(standalone.destination,'runtime'));await stat(join(standalone.destination,'runtime/entry.js'))
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
test('all registered field runners refuse missing/incorrect pins, absent manifests, source drift and source mode without GPU startup',async()=>{
 const root=await fixture()
 try{
  const pin=await captureRuntimeTransaction({root,directory:join(root,'transaction')}),good={SCENETOWEB_RUNTIME_TRANSACTION:pin.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:pin.sha256}
  for(const family of Object.keys(families)){
   for(const [env,message]of [[{SCENETOWEB_RUNTIME_TRANSACTION:pin.path},/parent-pinned transaction digest/],[{SCENETOWEB_RUNTIME_TRANSACTION_SHA256:pin.sha256},/path.*string|undefined/i],[{...good,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:'0'.repeat(64)},/Transaction manifest changed/],[{...good,SCENETOWEB_RUNTIME_TRANSACTION:join(root,'missing.json')},/ENOENT/]]){
    const result=await run(root,family,env);assert.match(result.stderr,message);assert.doesNotMatch(result.stderr,/ATTESTATION_ONLY_NO_GPU/);await assert.rejects(stat(join(result.destination,'report.json')),{code:'ENOENT'})
   }
   const source=join(root,'packages/blendlink/src/entry.ts'),bytes=await readFile(source)
   try{await writeFile(source,Buffer.concat([bytes,Buffer.from('// drift\n')]));const result=await run(root,family,good);assert.match(result.stderr,/Source\/dist\/build inventory drift/);assert.doesNotMatch(result.stderr,/ATTESTATION_ONLY_NO_GPU/)}finally{await writeFile(source,bytes)}
   const sourceMode=await run(root,family,good,false);assert.doesNotMatch(sourceMode.stderr,/ATTESTATION_ONLY_NO_GPU/);await assert.rejects(stat(join(sourceMode.destination,'report.json')),{code:'ENOENT'})
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
