import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {writeCaptureManifest,assertCaptureManifest} from './archive.mjs'
test('producer manifest refuses changed/missing/extra artifacts and wrong manifest pins',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'normal-capture-manifest-'))
 try{
  for(const path of ['report.json','material.glb','material.glb.materials.json','source-pins.json','native-python-proof.json','float-1.npy'])await writeFile(join(directory,path),path)
  await writeCaptureManifest(directory,true);const bytes=await readFile(join(directory,'capture-manifest.json')),pin=hash(bytes);await assertCaptureManifest(directory,pin)
  for(const mutate of[value=>value.complete=false,value=>value.glb=value.report,value=>value.files.pop(),value=>value.files.push(value.files[0])]){const value=JSON.parse(bytes);mutate(value);await writeFile(join(directory,'capture-manifest.json'),JSON.stringify(value));await assert.rejects(assertCaptureManifest(directory))}
  await writeFile(join(directory,'capture-manifest.json'),bytes)
  await assert.rejects(writeCaptureManifest(directory,true),{code:'EEXIST'});await assert.rejects(assertCaptureManifest(directory,'0'.repeat(64)))
  for(const path of ['material.glb','report.json','float-1.npy','material.glb.materials.json']){const file=join(directory,path),before=await readFile(file);await writeFile(file,Buffer.alloc(before.length,1));await assert.rejects(assertCaptureManifest(directory,pin));await writeFile(file,before)}
  const file=join(directory,'float-1.npy'),before=await readFile(file);await rm(file);await assert.rejects(assertCaptureManifest(directory,pin));await writeFile(file,before)
  await writeFile(join(directory,'extra'),'unexpected');await assert.rejects(assertCaptureManifest(directory,pin));await rm(join(directory,'extra'))
  await symlink(file,join(directory,'linked'));await assert.rejects(assertCaptureManifest(directory,pin));await rm(join(directory,'linked'))
  await assertCaptureManifest(directory,pin)
 }finally{await rm(directory,{recursive:true,force:true})}
})
