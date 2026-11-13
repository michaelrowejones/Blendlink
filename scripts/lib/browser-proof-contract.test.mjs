import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,symlink,rm,stat,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {assertBrowserProofAssembly,assertBrowserProofContract,browserProofFamilies,preflightBrowserProofContracts} from './browser-proof-contract.mjs'
const root=resolve(import.meta.dirname,'../..'),pin='a'.repeat(64)
const families=Object.keys(browserProofFamilies)
const withoutContractImport=source=>source.replace(/\bbrowserProofContract\s*,\s*|,\s*browserProofContract(?=\s*})/,'')
async function assembly(family){const folder=join(root,'experiments',family);return{family,contract:(await import(pathToFileURL(join(folder,'protocol.mjs')).href)).browserProofContract,runner:await readFile(join(folder,'run.mjs'),'utf8'),reader:await readFile(join(folder,'verify.mjs'),'utf8'),protocol:await readFile(join(folder,'protocol.mjs'),'utf8')}}

test('all six production runner/reader assemblies share their own immutable pinned protocol contract',async()=>{
 const result=await preflightBrowserProofContracts(root)
 assert.equal(result.status,'PREFLIGHTED_BROWSER_PROOF_CONTRACTS');assert.equal(result.numericalCredit,0);assert.equal(result.families.length,6)
 // Distinct family identity is essential: historical Texture and Float reports share one status token.
 assert.equal(browserProofFamilies['compositor-texture-fields'].browserStatus,browserProofFamilies['compositor-float-coordinates'].browserStatus)
 assert.notEqual(browserProofFamilies['compositor-texture-fields'].family,browserProofFamilies['compositor-float-coordinates'].family)
})
test('contract schemas refuse missing/extra fields, altered versions, mutable objects and cross-family copies',()=>{
 for(const family of families){const good=browserProofFamilies[family];assertBrowserProofContract(good,family)
  for(const mutate of [x=>delete x.family,x=>x.extra=true,x=>x.schemaVersion=2,x=>x.browserStatus='PASSED_SOMETHING_ELSE_BUILT_PROOF']){const bad={...good};mutate(bad);assert.throws(()=>assertBrowserProofContract(Object.freeze(bad),family))}
  assert.throws(()=>assertBrowserProofContract({...good},family))
  for(const other of families.filter(x=>x!==family))assert.throws(()=>assertBrowserProofContract(browserProofFamilies[other],family))
 }
 assert.throws(()=>assertBrowserProofContract(browserProofFamilies[families[0]],'invented-family'))
})
test('parsed assembly check catches copied pass strings and wrong/missing imports before native startup',async()=>{
 for(const family of families){const good=await assembly(family);assertBrowserProofAssembly(good)
  for(const mutate of [x=>x.runner=x.runner.replace('report.status=browserProofContract.browserStatus',"report.status='PASSED_WRONG_BUILT_PROOF'"),x=>x.runner=withoutContractImport(x.runner),x=>x.runner=x.runner.replace("'./protocol.mjs'","'../compositor-float-coordinates/protocol.mjs'"),x=>x.runner=x.runner.replace('report.status=browserProofContract.browserStatus','report.status=browserProofContract.finalStatus'),x=>x.runner=withoutContractImport(x.runner)+"\n// import {browserProofContract} from './protocol.mjs'\n",x=>x.reader+="\nassert.equal(report.status,'PASSED_WRONG_BUILT_PROOF')\n",x=>x.protocol=x.protocol.replace('browserProofContract.nativeStatus',"'wrong-native-label'")]){const bad={...good};mutate(bad);assert.throws(()=>assertBrowserProofAssembly(bad),family)}
 }
 const switchAssembly=await assembly('static-switch-family');assert.throws(()=>assertBrowserProofAssembly({...switchAssembly,reader:switchAssembly.reader.replaceAll('assertBrowserReport','notTheValidator')}))
})

const fixtures={
 'compositor-image-coordinates':{native:'assertPixelQualification',final:'assertPixelFinal',expected:'expectedPixelCases'},
 'compositor-float-coordinates':{native:'assertFloatCoordinateQualification',final:'assertFloatCoordinateFinal',expected:'expectedFloatCoordinateCases'},
 'compositor-texture-fields':{native:'assertTextureFieldQualification',final:'assertTextureFieldFinal',expected:'expectedTextureFieldCases'},
 'compositor-vector-math':{native:'assertVectorMathQualification',final:'assertVectorMathFinal'},
 'compositor-image-info':{native:'assertImageInfoQualification',final:'assertImageInfoFinal',expected:'expectedImageInfoCases'},
 'static-switch-family':{native:'assertQualification',final:'assertFinal'}
}
function nativeFixture(family,p,context){
 const spec=fixtures[family],contract=p.browserProofContract
 if(family==='static-switch-family')return{status:contract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',context,sourcePreserved:true,width:8,height:8,cases:p.expectedCases.map((name,index)=>({case:name,context,sourcePreserved:true,programSha256:pin,pixelSha256:pin,...(index<30?{sourceFile:name+'.blend'}:{})}))}
 if(family==='compositor-vector-math')return{status:contract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',device:context,width:8,height:8,cases:p.expectedCases().map(name=>({case:name,mode:name.startsWith('add-')?'ADD':p.modes.find(mode=>name.startsWith(mode.toLowerCase()+'-')),route:p.routes.find(route=>name==='add-'+route)??'default',programSha256:pin,pixelSha256:pin,...(p.expectedFinalCases().includes(name)?{sourceFile:name+'.blend',sourceSha256:pin}:{})})),refusals:p.expectedRefusals.map(kind=>({kind,diagnostics:[{code:kind==='animated-input'?'animated-tree':'unsupported-vector-math'}]}))}
 const saved=['13x9-implicit-gradient-linear-color','13x9-implicit-gradient-quadratic-color','13x9-implicit-gradient-easing-color','13x9-implicit-checker-5-color','13x9-normalized-gradient-easing-fac','13x9-normalized-checker-5-color','64x48-implicit-gradient-diagonal-color','64x48-uniform-gradient-diagonal-fac'].map(name=>'blender-5-3-'+context.toLowerCase()+'-'+name)
 return{status:contract.nativeStatus,version:[5,3,0],build:'02f0899d78e3',device:context,cases:p[spec.expected](context).map((row,index)=>({...row,programSha256:pin,pixelSha256:pin,inputSha256:pin,...((family==='compositor-texture-fields'?saved.includes(row.case):family==='compositor-image-info'?p.expectedImageInfoFinalCases(context).some(want=>want.case===row.case):family==='compositor-image-coordinates'?[13,26].includes(row.width)&&p.pixelFinalRoutes.includes(row.route):index<p.savedFinalCaseCount)?{sourceFile:row.case+'.blend'}:{})}))}
}
function finalFixture(family,p,q){return{status:p.browserProofContract.finalStatus,exporter:'built',context:q.context,sourcePreserved:true,nativeQualificationSha256:pin,rows:q.cases.filter(row=>row.sourceFile)}}
const finals=(family,p,f,q)=>family==='static-switch-family'?p.assertFinal(f,q,pin):p[fixtures[family].final](f,q,{built:true,nativeSha256:pin})
for(const family of families)test(family+' closes native and saved Final schemas before capture; rejects omitted/extra/duplicate/cross-family/refused results',async()=>{
 const p=await import(pathToFileURL(join(root,'experiments',family,'protocol.mjs')).href),native=p[fixtures[family].native]
 for(const context of family==='static-switch-family'?['shader','CPU','GPU']:['CPU','GPU']){
  const q=nativeFixture(family,p,context);native(q);const f=finalFixture(family,p,q);finals(family,p,f,q)
  for(const mutate of [x=>x.cases.pop(),x=>x.cases.push({...x.cases[0],case:'unexpected-extra-case'}),x=>x.cases[1]={...x.cases[0]},x=>x.status='failed',x=>x.status='refused',x=>x.build='other-build',x=>x.cases[0].programSha256='not-a-pin']){const bad=structuredClone(q);mutate(bad);assert.throws(()=>native(bad),family)}
  if(family==='compositor-vector-math')for(const mutate of [x=>x.refusals.pop(),x=>x.refusals.push({...x.refusals[0],kind:'unexpected-refusal'}),x=>x.refusals[1]={...x.refusals[0]},x=>x.refusals[0].diagnostics=[],x=>x.refusals[0].diagnostics=[{code:'wrong-diagnostic'}],x=>x.cases[0].mode='UNQUALIFIED',x=>x.cases[0].route='wrong-route',x=>x.cases.find(row=>row.sourceFile).sourceSha256='not-a-pin']){const bad=structuredClone(q);mutate(bad);assert.throws(()=>native(bad),family)}
  if(family==='compositor-image-info')for(const mutate of [x=>x.cases[0].infoOutput='unknown-output',x=>x.cases[0].width=999,x=>x.cases[0].route='unknown-route',x=>delete x.cases[0].inputSha256]){const bad=structuredClone(q);mutate(bad);assert.throws(()=>native(bad),family)}
  for(const mutate of [x=>x.rows.pop(),x=>x.rows.push({...x.rows[0],case:'unexpected-extra-case'}),x=>x.rows[1]={...x.rows[0]},x=>x.status='failed',x=>x.status='refused',x=>x.sourcePreserved=false,x=>x.nativeQualificationSha256='b'.repeat(64)]){const bad=structuredClone(f);mutate(bad);assert.throws(()=>finals(family,p,bad,q),family)}
  for(const other of families.filter(x=>x!==family)){const p2=await import(pathToFileURL(join(root,'experiments',other,'protocol.mjs')).href),foreign=nativeFixture(other,p2,'CPU');assert.throws(()=>native(foreign));assert.throws(()=>finals(family,p,finalFixture(other,p2,foreign),q))}
 }
})

// Deliberately broken assembly must stop at preflight, before capture/native executable startup.
test('matrix and Switch entrypoints refuse contract drift before creating any native transaction',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scenetoweb-contract-preflight-'))
 try{
  await mkdir(join(directory,'scripts'),{recursive:true})
  await symlink(join(root,'scripts/lib'),join(directory,'scripts/lib'),'dir')
  const marker=join(directory,'native-started'),fakeBlender=join(directory,'fake-blender')
  await writeFile(fakeBlender,'#!/bin/sh\ntouch "'+marker+'"\nexit 91\n');await chmod(fakeBlender,0o755)
  for(const family of families){
   const folder=join(directory,'experiments',family);await mkdir(folder,{recursive:true})
   for(const name of ['run.mjs','verify.mjs','protocol.mjs']){
    let source=await readFile(join(root,'experiments',family,name),'utf8')
    if(name==='run.mjs')source=source.replace('report.status=browserProofContract.browserStatus',"report.status='PASSED_COPIED_WRONG_BUILT_PROOF'")
    await writeFile(join(folder,name),source)
   }
   const entry=family==='static-switch-family'?'suite.mjs':'matrix.mjs'
   await writeFile(join(folder,entry),await readFile(join(root,'experiments',family,entry)))
   await writeFile(join(folder,'capture.mjs'),'import {writeFile} from "node:fs/promises";await writeFile('+JSON.stringify(marker)+',"capture started");process.exit(91)')
   const output=join(directory,'output-'+family)
   const child=spawnSync(process.execPath,[join(folder,entry),...(family==='static-switch-family'?['--built']:[output])],{cwd:directory,env:{...process.env,BLENDLINK_BLENDER:fakeBlender,SCENETOWEB_SWITCH_EVIDENCE:output},encoding:'utf8',timeout:10000})
   assert.equal(child.error,undefined);assert.notEqual(child.status,0);assert.match(child.stderr,/Runner must publish the shared pass token exactly once/)
   await assert.rejects(stat(marker),{code:'ENOENT'});await assert.rejects(stat(output),{code:'ENOENT'})
  }
 }finally{await rm(directory,{recursive:true,force:true})}
})
