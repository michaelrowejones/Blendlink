import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {acceptancePlan,hash,loadNativeStage,nativeReferenceKey,storeNativeStage} from './stage-cache.mjs'
import {validateRetainedInt3} from './retained-int3.mjs'
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),options={}
for(let i=0;i<args.length;i+=2){assert.ok(['--evidence','--upstream','--output'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]));options[args[i]]=resolve(args[i+1])}
assert.equal(Object.keys(options).length,3,'Pass --evidence retained-Int3-folder --upstream verified-source-root --output fresh-report.json')
const steps=[],time=async(name,fn)=>{const start=performance.now(),result=await fn();steps.push({name,milliseconds:performance.now()-start});return result}
const retained=await time('validate-retained-native-source-schema-words-archive-binary',()=>validateRetainedInt3({root,evidence:options['--evidence'],upstreamDirectory:options['--upstream']}))
const cache=await mkdtemp(join(tmpdir(),'port-stage-cache-pilot-')),key=nativeReferenceKey(retained.input)
assert.equal((await time('cold-lookup',()=>loadNativeStage(cache,retained.input))).status,'miss')
const stored=await time('import-verified-reference-bytes',()=>storeNativeStage(cache,retained.input,retained));assert.equal(stored.status,'hit')
const runtimeBytes=await readFile(join(root,'packages/blendlink/src/tslSourceCompositor.ts')),runtimeA=hash(runtimeBytes),runtimeB=hash(Buffer.concat([runtimeBytes,Buffer.from('\n// Counterfactual runtime-only revision; original SDK remains unchanged.\n')]))
assert.notEqual(runtimeA,runtimeB)
const warm=await time('warm-content-verified-lookup',()=>loadNativeStage(cache,retained.input)),runtimeOnly=await time('runtime-only-revision-content-verified-lookup',()=>loadNativeStage(cache,retained.input));assert.equal(warm.status,'hit');assert.equal(runtimeOnly.status,'hit')
const misses=[]
for(const[name,mutate]of[['native-binary',x=>x.native.sha256=hash('different native')],['upstream-source',x=>x.upstream.sources[0].sha256=hash('different upstream')],['reference-code',x=>x.sourcePins.find(r=>r.path.endsWith('/reference.py')).sha256=hash('different reference')],['settings',x=>x.settings.width=9]]){const changed=structuredClone(retained.input);mutate(changed);const result=await time('miss-'+name,()=>loadNativeStage(cache,changed));assert.equal(result.status,'miss');misses.push({mutation:name,key:result.key,status:result.status})}
const file=join(stored.folder,retained.artifacts.find(x=>x.path.endsWith('.rgba32f')).path),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes);let tamper
await time('tampered-cache-refusal',async()=>{try{await loadNativeStage(cache,retained.input)}catch(error){tamper=error.message}});assert.match(tamper,/bytes changed/)
const acceptanceA=acceptancePlan({nativeKey:key,runtimeKey:runtimeA}),acceptanceB=acceptancePlan({nativeKey:key,runtimeKey:runtimeB});assert.equal(acceptanceA.reuse,false);assert.equal(acceptanceB.reuse,false);assert.notEqual(acceptanceA.runNonce,acceptanceB.runNonce)
const scriptNames=['stage-cache.mjs','stage-cache.test.mjs','retained-int3.mjs','pilot.mjs'],scriptPins=Object.fromEntries(await Promise.all(scriptNames.map(async name=>[name,hash(await readFile(join(import.meta.dirname,name)))])))
const report={schemaVersion:1,status:'PASSED_EXPERIMENTAL_NATIVE_REFERENCE_CACHE_PILOT',productionCredit:false,supportCredit:0,numericalCredit:0,nativeRenders:0,browserRuns:0,gpuJobs:0,retainedEvidence:options['--evidence'],cacheDirectory:cache,inputKey:key,input:retained.input,validation:retained.validation,artifactFiles:retained.artifacts.length,artifactBytes:retained.artifacts.reduce((n,r)=>n+r.bytes,0),runtimeExperiment:{kind:'counterfactual-byte-change-only-no-SDK-edit',before:runtimeA,after:runtimeB,nativeReferenceKeyBefore:key,nativeReferenceKeyAfter:runtimeOnly.key},outcomes:{cold:'miss',warm:warm.status,runtimeOnly:runtimeOnly.status,misses,tamper:{refused:true,error:tamper,failedBytesPreserved:file}},acceptancePlans:[acceptanceA,acceptanceB],steps,scriptPins,limitations:['Imported expected bytes from a historical qualification; no new numerical or current-SDK acceptance credit.','Native key conservatively includes all150 captured Python/addon/reference source pins; it does not claim a minimal semantic closure.','Runtime mutation is a key-selection counterfactual, not actual GPU validation of modified code.','Final acceptance is outside the native cache and always requires current admission/public install/canary/browser/independent close.','Full-tree compiler/package/vendor/native identity attestation still belongs to each frozen SDK checkpoint.','Canary implementation is reused from the separate Root experiments/port-speed-pilot; this pilot launches no canary.']}
await writeFile(options['--output'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,inputKey:key,artifactFiles:report.artifactFiles,steps,numericalCredit:0}))
