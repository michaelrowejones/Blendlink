// Startup-only control; bounded CPU commands, no render/export/browser and zero numerical credit.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {runNodePortBlender} from '../../scripts/lib/node-port-python.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.env.SCENETOWEB_EXPORT_STARTUP_OUTPUT??'artifacts/guarded-export-startup'),blender=process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',exec=promisify(execFile),rows=[]
await mkdir(output,{recursive:true})
for(let sample=0;sample<6;sample++)for(const kind of ['version','plain-python','fresh-prefix-python']){
 const start=performance.now(),args=kind==='version'?['--version']:['--background','--factory-startup','--python-exit-code','1','--python-expr',"print('CPU_STARTUP_CONTROL_PASSED')"]
 if(kind==='fresh-prefix-python'){const r=await runNodePortBlender({blender,args,directory:join(output,'prefixes'),timeoutMs:120000,cwd:root,stdio:'ignore'});if(r.exitCode!==0||!r.cacheDisposed)throw new Error('Startup control failed')}
 else await exec(blender,args,{cwd:root,timeout:120000,maxBuffer:4*1024*1024})
 rows.push({sample,kind,milliseconds:performance.now()-start})
}
await writeFile(join(output,'startup.json'),JSON.stringify({numericalCredit:0,noGPUWork:true,rows},null,2)+'\n');console.log(JSON.stringify(rows))
