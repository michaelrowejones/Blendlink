import{mkdir,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{spawn}from'node:child_process'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher}from'../../scripts/lib/native-proof-archive.mjs'
if(process.argv[4]!=='--render-lease')throw Error('Explicit Root render lease required')
const source=resolve(process.argv[2]),out=resolve(process.argv[3]);await mkdir(out);const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'launchers')});let passed=false
try{await new Promise((done,fail)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,'reference.py'),'--',source,out],{stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.on('error',fail);child.on('close',async code=>{clearTimeout(timer);await writeFile(join(out,'native.log'),log);code===0?done():fail(Error('Native scene reference failed '+code))})});passed=true}finally{try{await launcher.finalize();const proof=await archiveNativeLauncher(launcher,join(out,'reference-archive'),passed);await writeFile(join(out,'native-proof.json'),JSON.stringify({passed,identity:launcher.identity,proof},null,2)+'\n')}finally{await launcher.dispose()}}
