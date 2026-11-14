import assert from'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{execFile}from'node:child_process'
import{promisify}from'node:util'
import{resolve,join}from'node:path'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{hash}from'../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]),read=async p=>JSON.parse(await readFile(p)),receipt=await read(join(out,'research-receipt.json'))
assert.equal(receipt.reportSha256,hash(await readFile(join(out,'report.json'))));assert.equal(receipt.contractSha256,hash(await readFile(join(import.meta.dirname,'contract.json'))));assert.equal(receipt.scriptSha256,hash(await readFile(join(import.meta.dirname,'native.py'))))
const archive=await validateNativeArchive(receipt.nativeArchive,out,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'native.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const result=await promisify(execFile)('python3',[join(import.meta.dirname,'verify_native.py'),out],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});process.stdout.write(result.stdout)
const summary=await read(join(out,'independent-summary.json'));await writeFile(join(out,'independent-archive.json'),JSON.stringify({status:'CLOSED_RESEARCH_ONLY_NOISE_UNIFORM',summarySha256:hash(await readFile(join(out,'independent-summary.json'))),archive,native:receipt.nativeArchive.identity.native,portCredit:0,gpuRuns:0,finalCredit:0,browserCredit:0},null,2)+'\n')
console.log('CLOSED_RESEARCH_ONLY_NOISE_UNIFORM '+JSON.stringify(summary.models))
