import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const sha=b=>createHash('sha256').update(b).digest('hex')
async function website(directory){
 const r=JSON.parse(await readFile(join(directory,'website.json')))
 assert.equal(r.status,'READY_NOT_FIDELITY_QUALIFIED');assert.equal(r.sourceUnchanged,true);assert.equal(r.websiteUnchanged,true)
 for(const file of r.files)assert.equal(sha(await readFile(join(r.website,file.path))),file.sha256)
 for(const row of r.startup.sources)assert.equal(sha(await readFile(join(directory,row.file))),row.sha256)
 return r
}
const difference=(a,b)=>{assert.equal(a.length,b.length);let differences=0,maxAbs=0;for(let i=0;i<a.length;i++){differences+=a[i]!==b[i];maxAbs=Math.max(maxAbs,Math.abs(a[i]-b[i]))}return{bytes:a.length,differences,maxAbs}}
export async function closeUniform(baselineDir,candidateDir,repeatDir,controlsDir){
 const [a,b,r]=await Promise.all([website(baselineDir),website(candidateDir),website(repeatDir)])
 const png=async d=>{const image=await sharp(join(d,'website.png')).raw().toBuffer({resolveWithObject:true});assert.deepEqual([image.info.width,image.info.height,image.info.channels],[1280,720,3]);return image.data}
 const [ap,bp,rp]=await Promise.all([png(baselineDir),png(candidateDir),png(repeatDir)]),controlBytes=await readFile(join(controlsDir,'controls.json')),controls=JSON.parse(controlBytes),rows=[]
 assert.deepEqual(controls.errors,[])
 for(const api of controls.apis)for(const ref of api.rows.filter(r=>r.mode==='literal'))for(const mode of ['uniform','wrong-bbox']){
  const actual=api.rows.find(r=>r.id===ref.id&&r.basis===ref.basis&&r.mode===mode);assert.ok(actual)
  const av=new Float32Array(new Uint32Array(actual.words).buffer),rv=new Float32Array(new Uint32Array(ref.words).buffer);let differences=0,maxAbs=0
  for(let i=0;i<av.length;i++){assert.ok(Number.isFinite(av[i])&&Number.isFinite(rv[i]));differences+=actual.words[i]!==ref.words[i];maxAbs=Math.max(maxAbs,Math.abs(av[i]-rv[i]))}
  rows.push({api:api.backend,id:ref.id,basis:ref.basis,mode,words:av.length,differences,maxAbs})
 }
 const phases=report=>{const events=report.startup.appPhases;const span=(start,end)=>events.find(e=>e.kind===end).at-events.find(e=>e.kind===start).at;return{firstReadyMs:report.firstReadyMs,initMs:span('renderer-init-start','renderer-init-end'),installMs:span('install-start','install-end'),compileMs:span('compile-start','compile-end'),firstRenderMs:span('first-render-start','first-render-end'),uniqueFragmentSources:report.startup.uniqueFragmentSources,uniqueVertexSources:report.startup.uniqueVertexSources}}
 const image=difference(ap,bp),repeat=difference(ap,rp),positive=rows.filter(r=>r.mode==='uniform'),negative=rows.filter(r=>r.mode==='wrong-bbox'),passed=image.differences===0&&repeat.differences===0&&positive.every(r=>r.differences===0)&&negative.every(r=>r.differences>0)
 return{status:passed?'EXACT_UNIFORM_CANDIDATE_PASSED_NOT_RELEASE_QUALIFIED':'EXACT_UNIFORM_CANDIDATE_FAILED',supportCredit:0,performanceBudgetAcceptance:false,gate:'Exact RGB8 final screenshots and exact Float32 source-control words; no tolerance',passed,image,literalSelfRepeat:repeat,controls:rows,baseline:phases(a),candidate:phases(b),repeat:phases(r),inputHashes:{baselineReport:sha(await readFile(join(baselineDir,'website.json'))),candidateReport:sha(await readFile(join(candidateDir,'website.json'))),repeatReport:sha(await readFile(join(repeatDir,'website.json'))),controls:sha(controlBytes)}}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){const r=await closeUniform(...process.argv.slice(2,6).map(path=>resolve(path)));await writeFile(resolve(process.argv[6]),JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:r.status,image:r.image,literalSelfRepeat:r.literalSelfRepeat,baseline:r.baseline,candidate:r.candidate}))}
