import assert from'node:assert/strict'
import{readFile,writeFile,readdir,mkdir}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher}from'../../scripts/lib/native-proof-archive.mjs'
import{resolveConfig}from'../../packages/blendlink/dist/config.js'
import{syncAll,verifyAll,publishedAssetPath}from'../../packages/blendlink/dist/sync.js'
import{parseManifest}from'../../packages/blendlink/dist/typegen.js'
const hash=b=>createHash('sha256').update(b).digest('hex'),root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]),fixture=JSON.parse(await readFile(join(out,'fixture.json')))
assert.equal(hash(await readFile(fixture.sourceFile)),fixture.sourceSha256);const provenance=[]
for(const folder of['packages/blender-addon','packages/blendlink/blender'])for(const name of(await readdir(join(root,folder))).filter(n=>/\.(py|json)$/.test(n)).sort()){
 const source=join(root,folder,name),artifact=join(root,folder==='packages/blender-addon'?'packages/blendlink/dist/addon':'packages/blendlink/dist/blender',name),bytes=await readFile(source);assert.deepEqual(await readFile(artifact),bytes);provenance.push({source,artifact,sha256:hash(bytes)})
}
await mkdir(join(out,'compiled'));const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'export-launchers')});let passed=false
try{
 const config=resolveConfig({blenderPath:launcher.executable,outDir:'public/models',genDir:'src/generated',scenes:[{name:'noiseColorScene',file:fixture.sourceFile,automaticMaterials:true}]},join(out,'compiled'))
 await syncAll(config,{force:true});assert.deepEqual((await verifyAll(config)).filter(i=>i.severity!=='warning'),[])
 const scene=config.scenes[0],manifestBytes=await readFile(scene.manifestPath),manifest=parseManifest(manifestBytes.toString());assert.ok(manifest.materialPrograms)
 const materialPath=publishedAssetPath(scene,manifest.materialPrograms.url,manifest),materialBytes=await readFile(materialPath),programs=JSON.parse(materialBytes)
 const flatten=v=>!v||typeof v!=='object'?[]:[...('op'in v?[v]:[]),...Object.values(v).flatMap(flatten)],noises=flatten(programs).filter(n=>n.op==='noise_normalized')
 assert.equal(noises.length,1);const original=fixture.programs.flatMap(p=>flatten(p.ir)).filter(n=>n.op==='noise_normalized')[0];assert.deepEqual(noises[0],original);assert.equal(noises[0].offsetModel,'shader-folded');assert.equal(noises[0].perlinModel,'eevee-metal-periodic-f32')
 const row={moduleExport:'noiseColorScene',sourceFile:fixture.sourceFile,sourceSha256:fixture.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(await readFile(scene.glbPath)),modulePath:scene.modulePath,moduleSha256:hash(await readFile(scene.modulePath)),materialPath,materialSha256:hash(materialBytes),materialPointer:manifest.materialPrograms,materialPrograms:programs}
 if(manifest.sourcePresentation){const path=publishedAssetPath(scene,manifest.sourcePresentation.url,manifest);row.presentationPath=path;row.presentationSha256=hash(await readFile(path))}
 assert.equal(hash(await readFile(fixture.sourceFile)),fixture.sourceSha256);await writeFile(join(out,'final.json'),JSON.stringify({status:'EXPORTED_OWNED_PRODUCTION_NOISE_COLOR_SCENE',fixtureSha256:hash(await readFile(join(out,'fixture.json'))),provenance,sourcePreserved:true,row,supportCredit:0},null,2)+'\n');passed=true
}finally{try{await launcher.finalize();const proof=await archiveNativeLauncher(launcher,join(out,'export-archive'),passed);await writeFile(join(out,'export-native-proof.json'),JSON.stringify({passed,identity:launcher.identity,proof},null,2)+'\n')}finally{await launcher.dispose()}}
