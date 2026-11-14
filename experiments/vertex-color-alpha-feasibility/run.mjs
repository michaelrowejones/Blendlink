import assert from'node:assert/strict'
import{spawn}from'node:child_process'
import{mkdir,readFile,writeFile,open}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]);await mkdir(resolve(output,'..'),{recursive:true});await mkdir(output)
const files=['probe.py','saved-scalar.py','run.mjs','sources.json'].map(name=>join(import.meta.dirname,name)),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),pins=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])))
const sources=JSON.parse(await readFile(join(import.meta.dirname,'sources.json')));for(const item of[...sources.installedExporter,...sources.three])assert.equal(sha(await readFile(item.path)),item.sha256)
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const packet={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,output,complete)};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(packet,null,2)+'\n');archived=true;return packet}
try{
 for(const[script,folder]of[['probe.py','stock'],['saved-scalar.py','saved']]){
  const destination=join(output,folder),log=await open(join(output,folder+'.log'),'wx')
  try{const code=await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,script)],{cwd:root,env:{...process.env,SCENETOWEB_VERTEX_ALPHA:destination},stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},120000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);done(code)})});assert.equal(code,0)}finally{await log.close()}
 }
 const packet=await archive(true),nativePythonProof=await validateNativeArchive(packet,output,{expectedFinalSources:[],expectedScripts:files.slice(0,2).map(path=>({path,invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const stock=JSON.parse(await readFile(join(output,'stock/report.json'))),saved=JSON.parse(await readFile(join(output,'saved/report.json')))
 assert.equal(stock.status,'VERTEX_COLOR_ALPHA_GLTF_FEASIBILITY_CAPTURED');assert.equal(saved.status,'SAVED_VERTEX_ALPHA_SCALAR_TRANSPORT_PASSED');assert.deepEqual(saved.version,[5,3,0]);assert.equal(saved.build,'02f0899d78e3');assert.equal(saved.sourcePreserved,true);assert.equal(saved.sourceOwnershipRestored,true)
 const attrs=row=>row.attributes[0];assert.deepEqual(attrs(stock.rows[0]),{});assert.deepEqual(attrs(stock.rows[2]),{});assert.deepEqual(Object.keys(attrs(stock.rows[1])),['COLOR_0']);assert.equal(attrs(stock.rows[1]).COLOR_0.type,'VEC4');assert.equal(attrs(stock.rows[1]).COLOR_0.componentType,5123);assert.equal(attrs(stock.rows[1]).COLOR_0.normalized,true)
 const privateRGBA=attrs(stock.rows[3])._SCENETOWEB_TEST_RGBA;assert.equal(privateRGBA.componentType,5126);assert.equal(privateRGBA.normalized,false)
 for(const row of stock.rows)assert.equal(sha(await readFile(join(output,'stock',row.case+'.glb'))),row.sha256)
 assert.equal(saved.accessor.componentType,5126);assert.equal(saved.accessor.type,'SCALAR');assert.equal(saved.accessor.normalized,false);assert.equal(saved.accessor.count,saved.accessor.positionCount);assert.deepEqual(saved.accessor.wordValues,saved.alphaWords)
 assert.equal(sha(await readFile(join(output,'saved',saved.source))),saved.sourceSha256);assert.equal(sha(await readFile(join(output,'saved',saved.glb))),saved.glbSha256)
 const{GLTFLoader}=await import('/Users/michaeljones/Documents/GitHub/Blendlink/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
 const glbBytes=await readFile(join(output,'saved',saved.glb)),gltf=await new GLTFLoader().parseAsync(glbBytes.buffer.slice(glbBytes.byteOffset,glbBytes.byteOffset+glbBytes.byteLength),'https://scenetoweb.invalid/')
 const decoded=[];gltf.scene.traverse(object=>{if(!object.isMesh)return;const alpha=object.geometry.getAttribute('_scenetoweb_vcol_alpha'),position=object.geometry.getAttribute('position');assert.ok(alpha,'Actual GLTFLoader did not bind lowercase custom semantic');assert.equal(alpha.itemSize,1);assert.equal(alpha.normalized,false);assert.ok(alpha.array instanceof Float32Array);assert.equal(alpha.count,position.count);assert.deepEqual([...new Uint32Array(alpha.array.buffer,alpha.array.byteOffset,alpha.array.length)],saved.alphaWords);decoded.push({attribute:'_scenetoweb_vcol_alpha',itemSize:alpha.itemSize,normalized:alpha.normalized,count:alpha.count,arrayType:'Float32Array'});object.geometry.dispose();for(const material of(Array.isArray(object.material)?object.material:[object.material]))material.dispose()});assert.equal(decoded.length,1)
 for(const[path,pin]of Object.entries(pins))assert.equal(sha(await readFile(path)),pin);for(const item of[...sources.installedExporter,...sources.three])assert.equal(sha(await readFile(item.path)),item.sha256)
 const receipt={status:'CLOSED_VERTEX_ALPHA_SAVED_SCALAR_TRANSPORT_RESEARCH',portCredit:0,nativeShaderCredit:0,browserCredit:0,sourceHashes:pins,sourcePins:sources,nativePythonProof,stock,saved,actualGLTFLoaderBindings:decoded};await writeFile(join(output,'closed-research.json'),JSON.stringify(receipt,null,2)+'\n');console.log('Closed Vertex Alpha transport research:4stock/private GLBs +actualsaved scalar GLB; exact F32alpha, zeroShader/browsercredit.')
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
