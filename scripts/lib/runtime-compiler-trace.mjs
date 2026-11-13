// Opt-in compiler filesystem attestation. Existing numerical callers keep their old path.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import ts from 'typescript'
import {createHash} from 'node:crypto'
const hash=x=>createHash('sha256').update(x).digest('hex')
const bytesPin=path=>{try{return hash(readFileSync(path))}catch(error){if(['ENOENT','ENOTDIR','EISDIR'].includes(error.code))return null;throw error}}
export function createCompilerTrace(){
 const operations=new Map(),reads=new Map()
 const record=(method,args,result)=>{const key=JSON.stringify([method,args]);const value={method,args:args.map(x=>x===undefined?{runtimeUndefined:true}:x),result};if(operations.has(key))assert.deepEqual(operations.get(key),value,'Compiler input drifted during independent emission');operations.set(key,value)}
 return{
  wrap(original,mutate=false){const host=mutate?original:{...original};for(const method of ['readFile','fileExists','directoryExists','getDirectories','readDirectory','realpath'])if(typeof original[method]==='function'){const operation=original[method].bind(original);host[method]=(...args)=>{
   const result=operation(...args)
   if(method==='readFile'){const path=resolve(args[0]),pin=bytesPin(path);record(method,[path],pin);if(result!==undefined)reads.set(path,result)}
   else record(method,args,Array.isArray(result)?[...result].sort():result)
   return result
  }};return host},
  finish(program){
   const sourceFiles=program.getSourceFiles().map(source=>{
    const path=resolve(source.fileName),contents=reads.get(path)
    assert.equal(typeof contents,'string','Every compiler source must have a recorded read: '+path)
    assert.equal(source.text,contents,'Compiler source differs from recorded input: '+path)
    assert.equal(ts.sys.readFile(path),contents,'Compiler source drifted during emission: '+path)
    return{path,sha256:bytesPin(path),compilerTextSha256:hash(source.text)}
   }).sort((a,b)=>a.path.localeCompare(b.path))
   const require=createRequire(import.meta.url),compiler=require.resolve('typescript'),compilerPackage=require.resolve('typescript/package.json')
   return{typescript:ts.version,compiler:{path:compiler,sha256:bytesPin(compiler),package:{path:compilerPackage,sha256:bytesPin(compilerPackage)}},rootNames:[...program.getRootFileNames()].map(path=>resolve(path)).sort(),sourceFiles,operations:[...operations.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}
  }
 }
}
export function validateCompilerTrace(trace){
 assert.equal(trace.typescript,ts.version);const require=createRequire(import.meta.url);assert.equal(require.resolve('typescript'),trace.compiler.path);assert.equal(require.resolve('typescript/package.json'),trace.compiler.package.path);assert.equal(bytesPin(trace.compiler.path),trace.compiler.sha256);assert.equal(bytesPin(trace.compiler.package.path),trace.compiler.package.sha256)
 for(const row of trace.sourceFiles)assert.equal(bytesPin(row.path),row.sha256,'Compiler source changed: '+row.path)
 for(const row of trace.operations){assert.ok(['readFile','fileExists','directoryExists','getDirectories','readDirectory','realpath'].includes(row.method));const result=row.method==='readFile'?bytesPin(row.args[0]):ts.sys[row.method](...row.args.map(x=>x?.runtimeUndefined===true?undefined:x));assert.deepEqual(Array.isArray(result)?[...result].sort():result,row.result,'Compiler filesystem input changed: '+row.method+' '+row.args[0])}
}
