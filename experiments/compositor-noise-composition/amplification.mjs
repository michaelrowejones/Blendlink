// CPU-only projection of retained endpoint words. This does NOT measure a new
// downstream GPU/native render or assume identical downstream code generation.
import {readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
const base=resolve(process.argv[2]),output=process.argv[3],json=async p=>JSON.parse(await readFile(p)),hash=b=>createHash('sha256').update(b).digest('hex')
const q=await json(join(base,'qualification.json')),r=await json(join(base,'browser-raw-metal/report.json')),name='509x503-Fac-direct-defaults',entry=q.cases.find(x=>x.case===name),api=r.rows[0],row=api.rows.find(x=>x.case===name)
const native=await readFile(join(base,entry.pixelFile)),actual=await readFile(join(base,'browser-raw-metal',row.actualFile));let maximumAbsoluteError=0,aboveOriginalAbsoluteGate=0,example
for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++){
 const index=(y*entry.width+x)*4,actualIndex=((row.rowFlip?entry.height-1-y:y)*entry.width+x)*4,n=native.readFloatLE(index*4),a=actual.readFloatLE(actualIndex*4)
 const np=Math.fround(n*1024),ap=Math.fround(a*1024),difference=Math.abs(np-ap)
 if(difference>2**-20)aboveOriginalAbsoluteGate++
 if(difference>maximumAbsoluteError){maximumAbsoluteError=difference;example={x,y,native:n,actual:a,nativeTimes1024:np,actualTimes1024:ap,absoluteError:difference}}
}
const result={kind:'HOST_DERIVED_POWER_OF_TWO_AMPLIFICATION_OF_CAPTURED_WORDS',nativeGpuCredit:0,source:name,actualApi:api.gpu,nativePixelSha256:hash(native),actualPixelSha256:hash(actual),rowFlip:row.rowFlip,scale:1024,maximumAbsoluteError,aboveOriginalAbsoluteGate,example,limits:'Host Float32 power-of-two projection only. Actual downstream native/GPU pixels and effects of altered shader code generation were not measured. Demonstrates absent error propagation protection; grants zero numerical/support credit.'}
if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');else console.log(JSON.stringify(result))
