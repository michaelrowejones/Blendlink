import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
import {applyFieldScheduleOverlay,applyFieldTableOverlay} from './overlay.mjs'
import {freezeTslHarness} from '../../scripts/lib/frozen-tsl-harness.mjs'
const root=resolve(import.meta.dirname,'../..'), references=resolve(process.argv[2]), evidence=resolve(process.argv[3])
const ids=process.argv[4].split(','), built=process.argv.includes('--built')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
let snapshot=join(evidence,'module-snapshot')
let {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'field-kernel-diagnostic'})
if(process.argv.includes('--table'))({snapshot,provenance}=await applyFieldTableOverlay({root,snapshot,built,provenance}))
if(process.argv.includes('--schedule'))({snapshot,provenance}=await applyFieldScheduleOverlay({root,snapshot,built,provenance}))
const harness=freezeTslHarness(root,snapshot), file=join(harness.directory,'main.js')
let source=readFileSync(file,'utf8')
const anchor='    await renderer.init()'
assert.equal(source.split(anchor).length,2)
source=source.replace(anchor,anchor+`
    state.programs = []
    state.fieldTables=[]
    window.__fieldTableDiagnostic=stats=>state.fieldTables.push(stats)
    const cache=renderer._nodes.nodeBuilderCache, put=cache.set.bind(cache)
    cache.set=(key,program)=>{
      const captured={vertex:program.vertexShader,fragment:program.fragmentShader}
      state.programs.push(captured)
      window.__retainFieldProgram?.(captured)
      return put(key,program)
    }
`)
source=source.replace('  if (state.error) return { ok: false, error: state.error }','  if (state.error) return { ok: false, error: state.error }\n  state.programs=[];state.fieldTables=[]')
source=source.replace('      base64: btoa(binary),','      base64: btoa(binary),\n      programs:state.programs,fieldTables:state.fieldTables,')
writeFileSync(file,source)
const server=await createServer({configFile:false,root:harness.directory,cacheDir:join(evidence,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},
 resolve:{alias:{'@blendlink-tsl-recipe':join(snapshot,'tslNodeRecipe.'+(built?'js':'ts'))}},
 server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence,references]}}})
const rows=[], failures=[]
let browser
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader']})
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage();let current=null,programIndex=0
  await page.exposeFunction('__retainFieldProgram',program=>{
   if(!current)return
   const name=backend+'-'+current+'-'+programIndex++;writeFileSync(join(evidence,name+'.vertex.txt'),program.vertex);writeFileSync(join(evidence,name+'.fragment.txt'),program.fragment)
  })
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  try{
   await page.goto(server.resolvedUrls.local[0]+(backend==='webgl2'?'?backend=webgl2':''));const init=await page.evaluate(()=>window.__tslDiffInit());assert.equal(init.error,null)
   for(const id of ids){
    current=id;programIndex=0;const start=Date.now(), document=readFileSync(join(references,'ir',id+'.json'))
    const out=await page.evaluate(({id,path})=>window.__tslDiffRun(id,'ir',path,false,null),{id,path:'/@fs/'+join(references,'ir',id+'.json')})
    assert.ok(out.ok,out.error);assert.deepEqual(errors,[])
    const pixels=Buffer.from(out.base64,'base64');writeFileSync(join(evidence,backend+'-'+id+'.f32'),pixels)
    const programs=out.programs.map(program=>({vertexSha256:sha(program.vertex),fragmentSha256:sha(program.fragment),fragmentBytes:Buffer.byteLength(program.fragment),
     perlin4dReferences:(program.fragment.match(/blendlinkFractalPerlin4dV1\(/g)||[]).length,
     loops:(program.fragment.match(/for \(/g)||[]).length,
     uniforms:(program.fragment.match(/nodeUniform\d+/g)||[]).length}))
    rows.push({backend,id,irSha256:sha(document),actualSha256:sha(pixels),programs,fieldTables:out.fieldTables,elapsedMs:Date.now()-start,environment:await page.evaluate(()=>window.__tslDiffEnvironment())})
    console.log('FIELD_KERNEL_CAPTURED',backend,id,JSON.stringify(programs),JSON.stringify(out.fieldTables))
   }
  }catch(error){failures.push({backend,id:current,error:String(error),errors})}
  finally{await page.close()}
 }
}finally{
 await browser?.close();await server.close();mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'report.json'),JSON.stringify({provenance,harnessSha256:sha(source),references,ids,rows,failures},null,2))
}
assert.equal(failures.length,0)
