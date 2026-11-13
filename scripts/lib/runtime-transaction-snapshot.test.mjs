import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,utimes,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import ts from 'typescript'
import {captureRuntimeTransaction,loadRuntimeTransaction} from './runtime-transaction-snapshot.mjs'
const actualRoot=resolve(import.meta.dirname,'../..')
test('transaction pins compiler closure, source/dist/build/vendor/snapshot and refuses drift or stale reuse',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'runtime-transaction-'))),sdk=join(root,'packages/blendlink'),source=join(sdk,'src'),dist=join(sdk,'dist'),library=join(sdk,'node_modules/enum-lib')
 try{
  for(const p of [source,join(dist,'vendor'),library,join(sdk,'scripts'),join(root,'scripts/lib')])await mkdir(p,{recursive:true})
  for(const name of ['runtime-provenance.mjs','runtime-compiler-trace.mjs','runtime-transaction-snapshot.mjs'])await writeFile(join(root,'scripts/lib',name),await readFile(join(actualRoot,'scripts/lib',name)))
  await writeFile(join(root,'package.json'),'{}');await writeFile(join(root,'package-lock.json'),'{}');await writeFile(join(sdk,'package.json'),'{"type":"module"}');await writeFile(join(sdk,'scripts/copy-assets.mjs'),'// fixture build\n')
  await writeFile(join(sdk,'tsconfig.base.json'),'{"compilerOptions":{"strict":true}}');
  const config={extends:'./tsconfig.base.json',compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',outDir:'dist',rootDir:'src',sourceMap:true,skipLibCheck:true},include:['src/**/*.ts']}
  await writeFile(join(sdk,'tsconfig.json'),JSON.stringify(config));await writeFile(join(library,'package.json'),'{"name":"enum-lib","main":"index.js"}');await writeFile(join(library,'index.d.ts'),'export declare const enum Factor { Value=7 }\n')
  await writeFile(join(source,'entry.ts'),"import { Factor } from 'enum-lib'; export const result=Factor.Value\n");await writeFile(join(dist,'vendor/test.js'),'export const vendor=1\n')
  const parsed=ts.parseJsonConfigFileContent(config,ts.sys,sdk);assert.equal(ts.createProgram({rootNames:parsed.fileNames,options:parsed.options}).emit().emitSkipped,false)
  const pin=await captureRuntimeTransaction({root,directory:join(root,'transaction')}),load=()=>loadRuntimeTransaction({root,...pin}),original=await load()
  assert.ok(original.provenance.compilerAttestation.sourceFiles.some(x=>x.path===join(library,'index.d.ts')));assert.ok(original.provenance.compilerAttestation.sourceFiles.some(x=>x.path.includes('/typescript/lib/lib.')))
  assert.ok(original.provenance.compilerAttestation.operations.some(x=>x.method==='fileExists'&&x.result===false))
  await assert.rejects(captureRuntimeTransaction({root,directory:join(root,'transaction')}),{code:'EEXIST'})
  await assert.rejects(loadRuntimeTransaction({root,path:pin.path}));await assert.rejects(loadRuntimeTransaction({root,...pin,sha256:'0'.repeat(64)}),/manifest changed/)
  for(const path of [join(source,'entry.ts'),join(dist,'entry.js'),join(dist,'entry.js.map'),join(dist,'vendor/test.js'),join(root,'transaction/runtime/entry.js'),join(root,'transaction/runtime/vendor/test.js'),join(sdk,'tsconfig.json'),join(sdk,'tsconfig.base.json'),join(sdk,'scripts/copy-assets.mjs'),join(library,'index.d.ts'),join(library,'package.json'),join(root,'package-lock.json')]){
   const bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('\n// drift')]));await assert.rejects(load(),undefined,'Must reject '+path);await writeFile(path,bytes)
  }
  for(const path of [join(source,'added.ts'),join(dist,'extra.js'),join(dist,'vendor/extra.js'),join(root,'transaction/runtime/extra.js'),join(library,'index.ts')]){await writeFile(path,'export const changed=1\n');await assert.rejects(load(),undefined,'Must reject addition '+path);await rm(path)}
  const file=join(root,'transaction/runtime/entry.js'),bytes=await readFile(file);await rm(file);await assert.rejects(load());await writeFile(file,bytes)
  const declaration=join(library,'index.d.ts'),declarationBytes=await readFile(declaration);await rm(declaration);await assert.rejects(load());await writeFile(declaration,declarationBytes)
  assert.equal((await load()).provenance.modules.length,1)
 }finally{await rm(root,{recursive:true,force:true})}
})
