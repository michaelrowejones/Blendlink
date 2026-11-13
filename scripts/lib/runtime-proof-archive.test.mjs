import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {hash,normalizeEmit} from './runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from './runtime-proof-archive.mjs'
const fixture=async callback=>{
 const root=await mkdtemp(join(tmpdir(),'scenetoweb-runtime-reader-')),runtimeDirectory=join(root,'capture/runtime'),fixtureDirectory=join(root,'capture/fixture'),fixtureSourceDirectory=join(root,'fixture-source')
 try{
  const src='export const pixel = 1\n',js='export const pixel = 1;\n//# sourceMappingURL=pixel.js.map\n',map='{"version":3}',vendor='export const vendor = 2\n'
  for(const dir of ['packages/blendlink/src','packages/blendlink/dist/vendor','capture/runtime/vendor','capture/fixture','fixture-source'])await mkdir(join(root,dir),{recursive:true})
  for(const dir of ['packages/blendlink/dist','capture/runtime']){await writeFile(join(root,dir,'pixel.js'),js);await writeFile(join(root,dir,'pixel.js.map'),map);await writeFile(join(root,dir,'vendor/test.js'),vendor)}
  await writeFile(join(root,'packages/blendlink/src/pixel.ts'),src)
  for(const dir of [fixtureDirectory,fixtureSourceDirectory])for(const name of ['browser.js','index.html'])await writeFile(join(dir,name),name)
  const module={name:'pixel',sourceSha256:hash(src),expectedEmitterSha256:hash(normalizeEmit(js)),emitterSha256:hash(normalizeEmit(js)),emitterMatchesSource:true,postEmitTransform:null}
  const current={mode:'built',typescript:'test',copyAssetsSha256:'assets',postEmitRules:[],modules:[module]}
  const provenance={...structuredClone(current),modules:[{...module,testedSnapshotSha256:hash(js)}],snapshot:{mode:'built',directory:runtimeDirectory,files:[{name:'pixel.js',sha256:hash(js)}],sourceMaps:[{name:'pixel.js.map',sha256:hash(map)}],vendorFiles:[{name:'vendor/test.js',sha256:hash(vendor)}]},fixturePins:{'browser.js':hash('browser.js'),'index.html':hash('index.html')}}
  await callback({root,current,provenance,runtimeDirectory,fixtureDirectory,fixtureSourceDirectory})
 }finally{await rm(root,{recursive:true,force:true})}
}
test('accepts the exact closed built archive, source maps, vendor and fixtures',()=>fixture(async args=>assert.match(await assertBuiltRuntimeArchive(args),/^[a-f0-9]{64}$/)))
for(const [name,mutate]of [
 ['missing module',async a=>{a.provenance.modules=[]}],
 ['forged expected emitter',async a=>{a.provenance.modules[0].expectedEmitterSha256='forged'}],
 ['dist bytes changed with identical normalized code',async a=>{await writeFile(join(a.root,'packages/blendlink/dist/pixel.js'),'export const pixel = 1;\n//# sourceMappingURL=forged.js.map\n')}],
 ['extra snapshot module',async a=>{await writeFile(join(a.runtimeDirectory,'extra.js'),'unexpected')}],
 ['omitted source map receipt',async a=>{a.provenance.snapshot.sourceMaps=[]}],
 ['source map snapshot drift',async a=>{await writeFile(join(a.runtimeDirectory,'pixel.js.map'),'changed')}],
 ['vendor snapshot drift',async a=>{await writeFile(join(a.runtimeDirectory,'vendor/test.js'),'changed')}],
 ['extra vendor receipt',async a=>{a.provenance.snapshot.vendorFiles.push({name:'vendor/extra.js',sha256:'forged'})}],
 ['fixture snapshot drift',async a=>{await writeFile(join(a.fixtureDirectory,'browser.js'),'changed')}],
 ['fixture current drift',async a=>{await writeFile(join(a.fixtureSourceDirectory,'browser.js'),'changed')}],
 ['fixture manifest omission',async a=>{delete a.provenance.fixturePins['browser.js']}],
 ['snapshot symbolic link',async a=>{await rm(join(a.runtimeDirectory,'pixel.js'));await symlink(join(a.root,'packages/blendlink/dist/pixel.js'),join(a.runtimeDirectory,'pixel.js'))}],
])test('refuses '+name,()=>fixture(async args=>{await mutate(args);await assert.rejects(assertBuiltRuntimeArchive(args))}))
