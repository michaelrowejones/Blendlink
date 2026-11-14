/* SPDX-License-Identifier: MIT */
/** Read-only native compiler diagnosis. No GPU, Blender job or production port. */
import{execFile}from'node:child_process'
import{promisify}from'node:util'
import{mkdir,readFile,writeFile,realpath}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
const exec=promisify(execFile),sha=data=>createHash('sha256').update(data).digest('hex')
const root=await realpath(resolve(import.meta.dirname,'../..')),directory=resolve(process.argv[2]??'artifacts/verification-wave-sinf-compiler')
await mkdir(directory)
const blender='/Applications/Blender.app/Contents/MacOS/Blender',binarySha256=sha(await readFile(blender))
if(binarySha256!=='53c8e8266f4e3f619a7c3e87c3a8d34a846339d50f55ebe193cf9ad3528153da')throw Error('Unreviewed native binary; function addresses are profile-specific')
const commands=[],run=async args=>{commands.push(['xcrun',...args]);const{stdout,stderr}=await exec('xcrun',args,{maxBuffer:32*1024*1024,timeout:30000});if(stderr)throw Error(stderr);return stdout}
const lambda=await run(['llvm-objdump','-d','--demangle','--start-address=0x102912da8','--stop-address=0x1029130d0',blender])
const caller=await run(['llvm-objdump','-d','--demangle','--start-address=0x10291271c','--stop-address=0x102912da8',blender])
const indirect=(await run(['llvm-objdump','--macho','--indirect-symbols',blender])).split('\n').filter(line=>line.includes('_sinf')).join('\n')+'\n'
const bind=(await run(['llvm-objdump','--macho','--bind',blender])).split('\n').filter(line=>/\s_sinf$/.test(line)).join('\n')+'\n'
for(const[file,data]of Object.entries({'lambda.asm':lambda,'caller.asm':caller,'indirect-sinf.txt':indirect,'bind-sinf.txt':bind}))await writeFile(join(directory,file),data)
if(!caller.includes('bl\t0x102912da8')||!lambda.includes('fcvt\td0, s13')||!lambda.includes('fcvt\ts0, d0')||!lambda.includes('bl\t0x1066cac94')||!indirect.includes('0x00000001066cac94')||!bind.includes('libSystem'))throw Error('Actual call/argument/libm path missing')
const compiler=await run(['clang++','--version']),probe=join(directory,'sinf-probe')
await run(['clang++','-O2','-ffp-contract=off','-fno-builtin-sinf',join(root,'experiments/compositor-wave-axis-research/sinf_probe.cpp'),'-o',probe])
commands.push([probe]);const{stdout:output}=await exec(probe,[],{timeout:10000});await writeFile(join(directory,'probe.txt'),output)
if(!output.includes('nativeSinf bf800000')||!output.includes('roundedDoubleSin bf7fffff')||!output.includes('nativeFactor 00000000')||!output.includes('doubleFactor 33000000'))throw Error('Libm result changed')
const report={schemaVersion:1,status:'RESEARCH_WAVE_SINF_LIBRARY_DIAGNOSIS',supportCredit:0,binary:{path:blender,sha256:binarySha256},compiler,commands,source:{path:'experiments/compositor-wave-axis-research/sinf_probe.cpp',sha256:sha(await readFile(join(root,'experiments/compositor-wave-axis-research/sinf_probe.cpp')))},files:{},argumentWord:'4308a8d7',nativeSinfWord:'bf800000',roundedDoubleSinWord:'bf7fffff',nativeFactorWord:'00000000',hostFactorWord:'33000000',claim:'Actual pinned Wave call/lambda machine instructions confirm the staged Float32 arithmetic and double pi/2 subtraction before the imported libSystem sinf call. Intermediate words are reconstructed from the native Uniform input and actual instructions, not live register instrumentation. The independent real-libm probe confirms the divergent result for exactly that argument; no function body/output repair or FPU-state changes.'}
for(const file of['lambda.asm','caller.asm','indirect-sinf.txt','bind-sinf.txt','probe.txt'])report.files[file]=sha(await readFile(join(directory,file)))
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(report.status)
