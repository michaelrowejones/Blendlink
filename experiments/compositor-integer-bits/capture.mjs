// One bounded fresh-Python native capture. CPU/GPU scheduling belongs to the caller.
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {runNodePortBlender,nodePortPythonFileIdentity} from '../../scripts/lib/node-port-python.mjs'
import {assertIntegerBitsQualification} from './protocol.mjs'
const args=process.argv.slice(2),options={}
for(let i=0;i<args.length;i+=2){assert.ok(['--blender','--device','--output'].includes(args[i])&&args[i+1]);options[args[i].slice(2)]=args[i+1]}
const root=resolve(import.meta.dirname,'../..'),blender=resolve(options.blender),device=options.device,output=resolve(options.output)
assert.ok(['CPU','GPU'].includes(device));await mkdir(output,{recursive:true})
const native=await nodePortPythonFileIdentity(blender)
const result=await runNodePortBlender({blender,directory:join(output,'fresh-python'),timeoutMs:300_000,cwd:root,
 args:['--background','--factory-startup','-t','1','--python-exit-code','1','--python','packages/blender-addon/tests/compositor_integer_bits_check.py'],
 env:{...process.env,SCENETOWEB_INTEGER_REFERENCES:output,SCENETOWEB_INTEGER_DEVICE:device}})
await writeFile(join(output,'native-invocation.json'),JSON.stringify({native,result},null,2)+'\n')
assert.equal(result.exitCode,0);assert.equal(result.pythonGuardApplied,true);assert.equal(result.cacheDisposed,true)
const qualified=assertIntegerBitsQualification(JSON.parse(await readFile(join(output,'qualification.json'))))
console.log('SCENETOWEB_INTEGER_BITS_CAPTURED '+JSON.stringify({device,cases:qualified.cases.length,saved:qualified.cases.filter(row=>row.sourceFile).length}))
