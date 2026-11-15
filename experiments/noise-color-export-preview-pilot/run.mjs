import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,copyFile,readdir}from'node:fs/promises'
import{resolve,join,dirname}from'node:path'
import{createHash}from'node:crypto'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
import{allowedRoots}from'./paths.mjs'
import{makeReferencePng,checkVisibleCanvas}from'./visible.mjs'
if(process.argv[5]!=='--gpu-lease')throw Error('Root GPU lease required')
const source=resolve(process.argv[2]),native=resolve(process.argv[3]),out=resolve(process.argv[4]),root=resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex'),final=JSON.parse(await readFile(join(source,'final.json'))),reference=JSON.parse(await readFile(join(native,'reference.json')))
assert.equal(reference.status,'CAPTURED_OWNED_EEVEE_NOISE_COLOR_SCENE');assert.equal(reference.sourceSha256,final.row.sourceSha256);assert.equal(hash(await readFile(final.row.sourceFile)),final.row.sourceSha256)
await mkdir(out);const fixture=join(out,'fixture');await mkdir(fixture);const report={status:'running',rows:[],sourcePins:{},fixturePins:{},supportCredit:0}
const nativeVisibleRef=reference.rows.find(r=>r.kind==='color'&&r.width===128),nativeVisibleRaw=await readFile(nativeVisibleRef.pixelFile),nativeVisiblePath=join(out,'native-color128-display.png');await writeFile(nativeVisiblePath,await makeReferencePng(nativeVisibleRaw,128,128));report.nativeDisplayReference={source:nativeVisibleRef.pixelFile,sourceSha256:nativeVisibleRef.pixelSha256,file:'native-color128-display.png',sha256:hash(await readFile(nativeVisiblePath)),conversion:'native linear raw Float32 clamp/round RGBA8; bottom-to-top PNG convention'};
for(const file of['index.html','browser.js']){const bytes=await readFile(join(import.meta.dirname,file));await copyFile(join(import.meta.dirname,file),join(fixture,file));report.fixturePins[file]=hash(bytes)}
for(const file of['final.json','fixture.json'])report.sourcePins[join(source,file)]=hash(await readFile(join(source,file)))
for(const path of[final.row.sourceFile,final.row.manifestPath,final.row.modulePath,final.row.glbPath,final.row.materialPath,final.row.presentationPath,join(native,'reference.json'),...reference.rows.map(r=>r.pixelFile),reference.rows.find(r=>r.visualFile).visualFile])report.sourcePins[path]=hash(await readFile(path))
const three=resolve(root,'node_modules/three'),dist=resolve(root,'packages/blendlink/dist');
async function pinTree(folder){for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())await pinTree(path);else if(item.isFile())report.sourcePins[path]=hash(await readFile(path))}}
await pinTree(dist);await pinTree(three);
const server=await createServer({root:fixture,cacheDir:join(out,'vite-cache'),configFile:false,publicDir:join(source,'compiled/public'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:[{find:'@runtime',replacement:join(dist,'threeRuntime.js')},{find:'three/webgpu',replacement:join(three,'build/three.webgpu.js')},{find:'three/tsl',replacement:join(three,'build/three.tsl.js')},{find:/^three$/,replacement:join(three,'build/three.module.js')}],dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:await allowedRoots([root,source,native,out,three])}}})
let browser;const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:'chromium',args:['--enable-unsafe-webgpu','--use-angle=metal']});report.browserVersion=browser.version()
 for(const backend of['webgpu','webgl2']){
  const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.noiseColorPreview==='function');await page.locator('#native').evaluate((img,url)=>img.src=url,'/@fs'+nativeVisiblePath)
  let row
  try{row=await page.evaluate(p=>window.noiseColorPreview(p),{backend,keepVisible:true,moduleUrl:'/@fs'+final.row.modulePath,assetBaseUrl:server.resolvedUrls.local[0],assetPins:Object.fromEntries([final.row.manifestPath,final.row.glbPath,final.row.materialPath,final.row.presentationPath].map(path=>['/@fs'+path,report.sourcePins[path]??final.row.manifestSha256])),references:reference.rows.map(r=>({...r,url:'/@fs'+r.pixelFile}))})}
  catch(error){row=await page.evaluate(()=>window.noiseColorFailure);report.rows.push({...row,pageErrors:errors});throw error}
  assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2')
  for(const measured of row.rows){const bytes=Buffer.alloc(measured.actualWords.length*4);measured.actualWords.forEach((w,i)=>bytes.writeUInt32LE(w,i*4));const file=backend+'-'+measured.kind+'-'+measured.width+'.u32';await writeFile(join(out,file),bytes,{flag:'wx'});measured.actualArchive={file,sha256:hash(bytes),words:measured.actualWords.length};delete measured.actualWords}
  assert.match(row.visibleCanvas.dataUrl,/^data:image\/png;base64,/);const canvasBytes=Buffer.from(row.visibleCanvas.dataUrl.split(',')[1],'base64'),canvasFile=backend+'-actual-canvas.png';await writeFile(join(out,canvasFile),canvasBytes);row.visibleCanvas.archive={file:canvasFile,sha256:hash(canvasBytes)};delete row.visibleCanvas.dataUrl;row.visibleCanvas.comparison=await checkVisibleCanvas(canvasBytes,nativeVisibleRaw,128,128);assert.equal(row.visibleCanvas.comparison.violations,0);assert.equal(row.visibleCanvas.comparison.alphaDifferences,0);
  await page.locator('#native').evaluate(img=>img.decode());const screenshot=backend+'-preview.png';await page.screenshot({path:join(out,screenshot),fullPage:true});row.visual={file:screenshot,sha256:hash(await readFile(join(out,screenshot)))};row.cleanup=await page.evaluate(()=>window.disposeNoiseColorPreview());report.rows.push({...row,pageErrors:errors});await save();assert.deepEqual(errors,[]);await page.close()
 }
 for(const[path,pin]of Object.entries(report.sourcePins))assert.equal(hash(await readFile(path)),pin)
 report.status='INSTALLED_OWNED_NOISE_COLOR_PREVIEW_PASSED'
}catch(error){report.status='FAILED_ZERO_CREDIT';report.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
