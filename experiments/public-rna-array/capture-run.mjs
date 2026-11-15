import {createNodePortBlenderLauncher} from '/Users/michaeljones/Documents/GitHub/Blendlink/scripts/lib/node-port-python.mjs'
import {spawnSync} from 'node:child_process'
import {writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const base='/tmp/scenetoweb-public-rna-array-probe',launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:base,timeoutMs:60000})
try{
const result=spawnSync(launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python',base+'/probe.py','--',base+'/report.json'],{stdio:['ignore','pipe','pipe'],encoding:'utf8'})
writeFileSync(base+'/native.log',result.stdout+result.stderr)
const invocations=JSON.parse((await import('node:fs/promises')).readFile?await (await import('node:fs/promises')).readFile(launcher.directory+'/launcher.json','utf8'):'{}')
writeFileSync(base+'/receipt.json',JSON.stringify({status:result.status,signal:result.signal,identity:launcher.identity,scriptSha256:createHash('sha256').update(readFileSync(base+'/probe.py')).digest('hex'),reportSha256:createHash('sha256').update(readFileSync(base+'/report.json')).digest('hex')},null,2)+'\n')
console.log(result.stdout);if(result.status!==0){console.error(result.stderr);process.exitCode=1}
}finally{await launcher.dispose()}
