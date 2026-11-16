// Experiments-only guard. Never installs/applies a private patch or opens GPU.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
const root=resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function assertCandidateSdk({checkOnly=false,repository=root}={}){
 const candidate=JSON.parse(await readFile(join(import.meta.dirname,'candidate-sdk-files.json')))
 if(sha(await readFile(join(import.meta.dirname,'sdk-candidate.patch')))!==candidate.patchSha256)throw Error('Private BOX color research patch differs from its pinned bytes')
 for(const entry of candidate.files){
  let bytes
  try{bytes=await readFile(join(repository,entry.path))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!bytes||bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Private BOX color research SDK patch is absent or mismatched at '+entry.path+'. Apply sdk-candidate.patch with --unidiff-zero in an isolated checkout of '+candidate.baseSourceCommit+'; the public SDK deliberately does not admit this failed candidate.')
 }
 const result={status:'private-box-candidate-sdk-bytes-verified-not-qualified',baseSourceCommit:candidate.baseSourceCommit,privateCaptureCommit:candidate.capturedPrivateSourceCommit,patchSha256:candidate.patchSha256,files:candidate.files.length,gpuOpened:false}
 if(checkOnly){console.log(JSON.stringify(result));return result}
 return result
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){if(process.argv[2]!=='--check-sdk')throw Error('Expected --check-sdk');await assertCandidateSdk({checkOnly:true})}
