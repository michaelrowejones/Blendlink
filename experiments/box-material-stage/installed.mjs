// One transaction-owned package installation and the existing public installer.
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,cp,symlink,readdir,realpath}from'node:fs/promises'
import{resolve,join,basename}from'node:path'
import{execFileSync}from'node:child_process'
import{createHash}from'node:crypto'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
import{captureRuntimeProvenance}from'../../scripts/lib/runtime-provenance.mjs'
import{allowedRoots}from'../noise-color-export-preview-pilot/paths.mjs'
import{assertProofSdk}from'./proof-sdk.mjs'
import{targetArgument}from'./field-profile.mjs'
const sdkProof=await assertProofSdk({checkOnly:process.argv[2]==='--check-sdk'});if(process.argv[2]==='--check-sdk')process.exit(0)
assert.equal(process.argv[4],'--gpu-lease')
assert.ok(process.argv[6]===undefined||/^--packed-sha256=[a-f0-9]{64}$/.test(process.argv[6]));assert.equal(process.argv[7],undefined);const expectedPackedSha256=process.argv[6]?.slice('--packed-sha256='.length);const{targetWidth,sizes:observationSizes,control:lifecycleViewport}=targetArgument(process.argv[5])
const finalDir=await realpath(resolve(process.argv[2])),out=resolve(process.argv[3]),root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),'','Freeze tracked source before capture')
await mkdir(out);await mkdir(join(out,'node_modules'));await mkdir(join(out,'packed'))
const{provenance}=await captureRuntimeProvenance({root,built:true,label:'BOX color installed package',compilerInputs:true})
const pack=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',join(out,'packed')],{cwd:join(root,'packages/blendlink'),encoding:'utf8'}))[0],tarball=join(out,'packed',pack.filename)
if(expectedPackedSha256)assert.equal(sha(await readFile(tarball)),expectedPackedSha256,'Packed SDK differs from the immutable prior artifact; stop before browser')
execFileSync('tar',['-xzf',tarball,'-C',join(out,'node_modules')]);await import('node:fs/promises').then(fs=>fs.rename(join(out,'node_modules/package'),join(out,'node_modules/scenetoweb')))
const installedDirectory=join(out,'node_modules/scenetoweb')
const three=await realpath(join(root,'node_modules/three'));await symlink(three,join(out,'node_modules/three'));for(const name of await readdir(join(root,'node_modules'))){if(name.startsWith('.')||['scenetoweb','three'].includes(name))continue;await symlink(await realpath(join(root,'node_modules',name)),join(out,'node_modules',name))}
await cp(join(import.meta.dirname,'installed-browser.js'),join(out,'fixture.js'));await cp(join(import.meta.dirname,'poison-geometry.js'),join(out,'poison-geometry.js'));await writeFile(join(out,'index.html'),'<link rel="icon" href="data:,"><script type="module" src="/fixture.js"></script>')
const finalBytes=await readFile(join(finalDir,'final.json')),final=JSON.parse(finalBytes);assert.equal(final.status,'EXPORTED_OWNED_ORIGINAL_BOX_COLOR_FINALS_NOT_SCENE_ACCEPTANCE')
const report={status:'RUNNING_ZERO_SUPPORT_CREDIT',sdkProof,expectedPackedSha256,poisonGeometrySha256:sha(await readFile(join(out,'poison-geometry.js'))),supportCredit:0,materialCredit:0,sceneCredit:0,targetWidth,observationSizes,lifecycleViewport,projection:'Saved16:1, no framing/camera changes; unlit field not whole-scene acceptance',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),provenance,package:{directory:installedDirectory,file:tarball,sha256:sha(await readFile(tarball)),integrity:pack.integrity},finalSha256:sha(finalBytes),producerSha256:sha(await readFile(import.meta.filename)),fixtureSha256:sha(await readFile(join(out,'fixture.js'))),pins:{},apis:[]}
report.pins[join(out,'poison-geometry.js')]=report.poisonGeometrySha256
for(const module of provenance.modules){const path=join(installedDirectory,'dist',module.name+'.js'),bytes=await readFile(path);assert.deepEqual(bytes,await readFile(join(root,'packages/blendlink/dist',module.name+'.js')));report.pins[path]=sha(bytes)}
for(const entry of final.rows)for(const path of [entry.sourceFile,entry.glbPath,entry.manifestPath,entry.modulePath,entry.materialPath,entry.mipPath,entry.presentationPath].filter(Boolean))report.pins[path]=sha(await readFile(path))
const mipFiles=new Map(final.rows.map(e=>[basename(e.mipPath),e.mipPath]));const server=await createServer({root:out,publicDir:join(finalDir,'compiled/public'),cacheDir:join(out,'vite-cache'),configFile:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:[{find:'three/webgpu',replacement:join(three,'build/three.webgpu.js')},{find:'three/tsl',replacement:join(three,'build/three.tsl.js')},{find:'three/addons',replacement:join(three,'examples/jsm')},{find:/^three$/,replacement:join(three,'build/three.module.js')}]},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:await allowedRoots([root,out,resolve(process.argv[2]),finalDir,three])}}})
let browser
try{
 await server.listen();const base=server.resolvedUrls.local[0]
 for(const profile of ['metal','swiftshader']){
  browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='metal'?['--use-angle=metal']:['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader'])]})
  for(const backend of ['webgpu','webgl2']){
   const page=await browser.newPage(),pageErrors=[],consoleErrors=[],httpErrors=[],expectedResponses=[],expectedFailures=[],plannedURLs=new Set(),plannedRequests=new Set();let mode='normal',held=false,waiters=[],release
   await page.exposeFunction('boxNetworkMode',next=>{mode=next;if(next==='normal'){release?.();release=undefined;held=false}return true})
   await page.exposeFunction('boxWaitRequest',()=>held?true:new Promise(resolve=>waiters.push(resolve)))
   await page.route('**/*.boxmips.deflate',async route=>{
    const request=route.request(),url=request.url(),file=mipFiles.get(basename(new URL(url).pathname));assert.ok(file)
    if(mode==='missing'){plannedURLs.add(url);plannedRequests.add(request);await route.fulfill({status:404,body:'missing companion'});return}
    if(mode==='corrupt'){const bytes=Buffer.from(await readFile(file));bytes[0]^=1;await route.fulfill({status:200,body:bytes});return}
    if(mode==='abort'){plannedURLs.add(url);plannedRequests.add(request);held=true;for(const waiter of waiters.splice(0))waiter(true);await new Promise(resolve=>{release=resolve});await route.continue().catch(()=>{});return}
    await route.continue()
   })
   page.on('pageerror',e=>pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url})});page.on('response',response=>{if(response.status()>=400)(plannedRequests.has(response.request())?expectedResponses:httpErrors).push({url:response.url(),status:response.status()})});page.on('requestfailed',request=>{(plannedRequests.has(request)?expectedFailures:httpErrors).push({url:request.url(),failure:request.failure()?.errorText})})
   await page.goto(base);await page.waitForFunction(()=>typeof window.runBoxInstalled==='function');if(backend==='webgl2')await page.evaluate(()=>Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}))
   const entries=final.rows.map(e=>({id:e.id,glbUrl:'/@fs'+e.glbPath,moduleUrl:'/@fs'+e.modulePath,moduleExport:e.moduleExport,materialUrl:'/@fs'+e.materialPath,materialPointer:e.materialPointer,programs:e.materialPrograms}))
   let api
   try{api=await page.evaluate(proof=>window.runBoxInstalled(proof),{backend,entries,assetBaseUrl:base,targetWidth})}catch(error){api=await page.evaluate(()=>window.boxInstalledFailure).catch(()=>({status:'LOST_BROWSER_CONTEXT'}));api.failure=String(error);throw Object.assign(error,{api})}
   finally{
    if(api){for(let i=0;i<(api.rows??[]).length;i++){const row=api.rows[i],bytes=Buffer.from(new Uint32Array(row.words).buffer);row.file=profile+'-'+backend+'-'+i+'.u32';row.sha256=sha(bytes);row.words=row.words.length;await writeFile(join(out,row.file),bytes,{flag:'wx'})}
     const unexpectedConsole=consoleErrors.filter(error=>!(plannedURLs.has(error.url)&&/Failed to load resource/.test(error.text)));report.apis.push({...api,profile,pageErrors,consoleErrors,unexpectedConsole,httpErrors,expectedResponses,expectedFailures});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
    await page.close()
   }
   assert.equal(api.status,'PASSED_PUBLIC_INSTALLED_BOX_COLOR_NOT_FULL_SCENE');assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);assert.equal(expectedResponses.length,1);assert.equal(expectedResponses[0].status,404);assert.equal(expectedFailures.length,1);assert.deepEqual(report.apis.at(-1).unexpectedConsole,[])
   assert.match(JSON.stringify(api.gpu),profile==='metal'?/apple|metal/i:/swiftshader/i);if(profile==='metal')assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)
  }
  await browser.close();browser=null
 }
 for(const[path,expected]of Object.entries(report.pins))assert.equal(sha(await readFile(path)),expected)
 report.status='PUBLIC_INSTALLED_BOX_COLOR_MATRIX_CAPTURED_NOT_SCENE_ACCEPTANCE'
}catch(error){report.status='FAILED_ZERO_CREDIT';report.failure=String(error);process.exitCode=1}
finally{await browser?.close();await server.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,apis:report.apis.length,failure:report.failure}))}
