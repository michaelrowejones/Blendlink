import{readFile,readdir,writeFile}from'node:fs/promises'
import{spawnSync}from'node:child_process'
import{performance}from'node:perf_hooks'
import{decode}from'./generated/contracts.ts'
import{replay,sha256}from'./transport.mjs'
const base=new URL('./',import.meta.url),manifest=JSON.parse(await readFile(new URL('fixtures/manifest.json',base))),rows=[]
for(const row of manifest.rows)rows.push({family:row.family,program:JSON.parse(await readFile(new URL('fixtures/'+row.programFile.file,base)))})
const median=x=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)],ms={tsStructuralDecode37:[],pythonStructuralDecode37IncludingStartup:[],sharedPinnedNativeReplay37:[]}
for(let i=0;i<7;i++){
 let start=performance.now();for(const row of rows)decode(row.family,row.program);ms.tsStructuralDecode37.push(performance.now()-start)
 start=performance.now();const child=spawnSync('python3',[new URL('python-check.py',base).pathname],{encoding:'utf8',input:JSON.stringify(rows),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});if(child.status!==0)throw Error(child.stderr);ms.pythonStructuralDecode37IncludingStartup.push(performance.now()-start)
 start=performance.now();await replay();ms.sharedPinnedNativeReplay37.push(performance.now()-start)
}
const files={}
for(const name of await readdir(base)){if(/\.(?:mjs|ts|py)$/.test(name)){const b=await readFile(new URL(name,base));files[name]={bytes:b.length,lines:b.toString().trimEnd().split('\n').length,sha256:sha256(b)}}}
const generated={}
for(const name of await readdir(new URL('generated/',base))){if(/\.(?:ts|py|json)$/.test(name)){const b=await readFile(new URL('generated/'+name,base));generated[name]={bytes:b.length,lines:b.toString().trimEnd().split('\n').length,sha256:sha256(b)}}}
const result={status:'CPU_ONLY_STRUCTURAL_PILOT_MEASUREMENTS',sourceBase:'61df48b64b09f27d1cbf2cf0d13e9c568e839934',node:process.version,platform:process.platform,architecture:process.arch,samples:7,timingScope:'One host process; file I/O and Python startup included as named; not renderer, GPU or development-speed measurements',timings:Object.fromEntries(Object.entries(ms).map(([k,v])=>[k,{medianMs:median(v),minimumMs:Math.min(...v),maximumMs:Math.max(...v)}])),programs:37,historicalNativeWords:9472,structuralMutations:32,numericalCredit:0,supportPromotion:false,handwritten:files,generated,sourceFixtureManifestSha256:sha256(await readFile(new URL('fixtures/manifest.json',base)))}
await writeFile(new URL('measurements.json',base),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({timings:result.timings,handwrittenLines:Object.values(files).reduce((s,f)=>s+f.lines,0),generatedLines:Object.values(generated).reduce((s,f)=>s+f.lines,0)}))
