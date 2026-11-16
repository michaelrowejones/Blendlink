// Fresh diagnostic profile only. Does not alter the historical17-file guard,
// apply patches, build, read scene inputs, create evidence or open hardware.
import assert from'node:assert/strict'
import{readFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{execFileSync}from'node:child_process'
import{resolve,join}from'node:path'
const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex')
export async function assertIntegratedSdk({checkOnly=false,repository=root}={}){
 const manifestPath=join(import.meta.dirname,'integrated-sdk-files-43840.json'),bytes=await readFile(manifestPath),manifest=JSON.parse(bytes)
 assert.equal(manifest.profile,'integrated-box-color-43840-target512');assert.equal(manifest.sourceCommit,'43840cc6f59c44938b80c996d05f4b24b23ffc32');assert.equal(manifest.files.length,2064)
 for(const entry of manifest.files){
  assert.ok(!entry.path.startsWith('/')&&!entry.path.split('/').includes('..'))
  let contents;try{contents=await readFile(join(repository,entry.path))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!contents||contents.length!==entry.bytes||sha(contents)!==entry.sha256)throw Error('Integrated BOX research SDK is absent or mismatched at '+entry.path+'; use the frozen private43840 diagnostic candidate. Public SDKs must refuse before inputs/output/GPU.')
 }
 try{execFileSync('git',['merge-base','--is-ancestor',manifest.sourceCommit,'HEAD'],{cwd:repository,stdio:'pipe'})}catch{throw Error('Integrated BOX research SDK needs frozen43840 ancestry in its isolated private checkout')}
 const result={status:'INTEGRATED_PRIVATE_SOURCE_BYTES_VERIFIED_DIAGNOSTIC_ONLY_NOT_QUALIFIED',profile:manifest.profile,sourceCommit:manifest.sourceCommit,manifestSha256:sha(bytes),guardSha256:sha(await readFile(import.meta.filename)),files:manifest.files.length,gpuOpened:false}
 if(checkOnly)console.log(JSON.stringify(result));return result
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){assert.equal(process.argv[2],'--check-sdk');await assertIntegratedSdk({checkOnly:true})}
