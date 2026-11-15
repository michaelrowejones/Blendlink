import assert from 'node:assert/strict'
import {readFile,realpath,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {hash,plainFile} from './stage-cache.mjs'
const read=async(root,path)=>JSON.parse(await readFile(await plainFile(root,path),'utf8'))
const word=n=>{const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,n,true);return v.getUint32(0,true)}
export async function validateRetainedInt3({root,evidence,upstreamDirectory}){
 root=await realpath(root);evidence=await realpath(evidence)
 const reportBytes=await readFile(await plainFile(evidence,'report.json'));assert.equal(hash(reportBytes),'1d378a48a052694fe430022456ab937479a70abec0120cbf1fb906081d50689b','This pilot imports only the exact retained next56 corpus');const report=JSON.parse(reportBytes);assert.equal(report.status,'qualified');assert.equal(report.manifestId,'compositor-integer-vector3');assert.equal(report.workspaceStable,true);assert.equal(report.productionCredit,true);assert.equal(report.supportPromotion,false)
 const closedBytes=await readFile(await plainFile(evidence,'closed-receipt.json'));assert.deepEqual(closedBytes,await readFile(await plainFile(evidence,'adapter-closed.json')));assert.equal(hash(closedBytes),'002be9743d6081b56cece4c03d841aba103c4d9e255828364e72c9cbc33311d4');const closed=JSON.parse(closedBytes);assert.equal(closed.variant,'integer-vector3');assert.equal(closed.wordMismatches,0);assert.equal(closed.nativeGraphs,16)
 const suite=await read(evidence,'suite-matrix.json');assert.equal(suite.receiptSha256,hash(closedBytes));assert.equal(suite.status,'passed')
 const q=await read(evidence,'cpu/qualification.json'),archive=await read(evidence,'native-python-proof.json'),spec=JSON.parse(await readFile(join(root,'experiments/static-switch-family/int-vector3-cases.json'),'utf8'))
 assert.equal(q.status,'CAPTURED_STATIC_SELECTION');assert.equal(q.context,'CPU');assert.deepEqual(q.version,[5,3,0]);assert.equal(q.build,'02f0899d78e3');assert.equal(q.sourcePreserved,true);assert.equal(q.pythonGpuInitializationCalls,0);assert.deepEqual([q.width,q.height],[8,8]);assert.deepEqual(q.nativeBackend,{evaluator:'native-cpu-compositor',requestedCompositorDevice:'CPU',gpuInitialized:false,gpuEvaluationCredit:false})
 assert.deepEqual(q.cases.map(row=>row.case),spec.map(row=>row.case));assert.equal(q.cases.length,16)
 assert.equal(closed.receipts[0].nativeQualificationSha256,hash(await readFile(await plainFile(evidence,'cpu/qualification.json'))))
 const sourcePins=[]
 for(const[path,sha256]of Object.entries(q.sourceHashes).sort(([a],[b])=>a<b?-1:1)){assert.equal(hash(await readFile(await plainFile(root,path))),sha256,'Retained native source changed: '+path);sourcePins.push({path,sha256})}
 const upstream=await read(root,'experiments/compositor-int-vector3/sources.json');assert.equal(upstream.revision,'02f0899d78e374b63e7181d9061e1f7ab03419cc');assert.ok(upstream.revision.startsWith(q.build))
 for(const row of upstream.sources)assert.equal(hash(await readFile(await plainFile(upstreamDirectory,row.path))),row.sha256,'Pinned Blender C++ source changed')
 const artifacts=[],add=async(path,pin)=>{const file=await plainFile(evidence,path),bytes=await readFile(file);if(pin)assert.equal(hash(bytes),pin,'Retained reference bytes changed');artifacts.push({path,bytes:bytes.length,sha256:hash(bytes)})}
 await add('cpu/qualification.json');const finalSources=[]
 for(let i=0;i<q.cases.length;i++){
  const row=q.cases[i],entry=spec[i];for(const[k,v]of Object.entries(entry))assert.deepEqual(row[k],v)
  const expected=entry.kind==='control'?[.125,.25,.5,1]:[...entry.value,1];if(entry.value)assert.ok(entry.value.every(n=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647));assert.deepEqual(expected.map(word),entry.expectedWords)
  assert.equal(row.programFile,row.case+'.program.json');assert.equal(row.pixelFile,row.case+'.rgba32f');const bytes=await readFile(await plainFile(evidence,'cpu/'+row.pixelFile));assert.equal(bytes.length,1024);for(let lane=0;lane<256;lane++)assert.equal(bytes.readUInt32LE(lane*4),entry.expectedWords[lane%4],'Independent retained native word mismatch')
  const program=await read(evidence,'cpu/'+row.programFile);assert.equal(program.status,'extracted');assert.deepEqual(program.passes,[]);assert.equal(program.ops.length,1);const op=program.ops[0]
  if(entry.kind==='control')assert.equal(op.kind,'rgb');else{assert.equal(op.kind,'integer-vector');assert.equal(op.source.nodeType,'FunctionNodeInputIntVector');assert.equal(op.type,'INT_VECTOR3');assert.equal(op.properties.integer_vector_model,'native-int3-constant-53-v1');assert.deepEqual(op.value,entry.value)}
  await add('cpu/'+row.pixelFile,row.pixelSha256);await add('cpu/'+row.programFile,row.programSha256)
  if(row.sourceFile){assert.equal(row.sourceFile,row.case+'.blend');await add('cpu/'+row.sourceFile,row.sourceSha256);finalSources.push(join(evidence,'cpu',row.sourceFile))}
 }
 const originalRoot=resolve(evidence,'../..'),nativeProof=await validateNativeArchive(archive,evidence,{expectedFinalSources:finalSources,expectedScripts:[{path:join(originalRoot,'experiments/static-switch-family/reference.py'),invocations:1},{path:join(originalRoot,'experiments/compositor-int-vector3/policy.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const actualNative=await realpath(archive.identity.native.path);assert.equal((await stat(actualNative)).size,archive.identity.native.bytes);assert.equal(hash(await readFile(actualNative)),archive.identity.native.sha256);assert.equal(report.nativeIdentity.sha256,archive.identity.native.sha256)
 const input={schemaVersion:1,stage:'native-reference',family:'compositor-integer-vector3',native:{sha256:archive.identity.native.sha256,bytes:archive.identity.native.bytes,version:'5.3.0',build:q.build},upstream:{revision:upstream.revision,sources:upstream.sources.map(({path,sha256})=>({path,sha256}))},settings:{context:'CPU',engine:'CYCLES',compositorPrecision:'FULL',cyclesSamples:1,width:8,height:8,pixelRatio:1,view:'Raw',look:'None',exposure:0,gamma:1,output:'EXR32-RGBA',settingsAuthority:'pinned reference.py plus saved original .blend bytes'},sourcePins,cases:spec,referenceContract:{model:'retained-native-int3-rne-rgba32-v1',validatorSha256:hash(await readFile(import.meta.filename)),cacheSchemaSha256:hash(await readFile(new URL('./stage-cache.mjs',import.meta.url)))}}
 return{input,artifacts,owner:evidence,validation:{closedReceiptSha256:hash(closedBytes),nativeQualificationSha256:hash(await readFile(join(evidence,'cpu/qualification.json'))),sourcePins:sourcePins.length,upstreamCppPins:upstream.sources.length,nativeGraphs:16,productionGraphs:15,nativeWords:4096,guardedPythonInvocations:nativeProof.pythonInvocations,nativeBinarySha256:archive.identity.native.sha256,numericalCredit:0}}
}
