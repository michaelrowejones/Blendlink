// Isolated, reproducible native -> actual Final GLB -> immutable built runtime.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { verifyCameraDataSource } from '../../scripts/lib/camera-data-source.mjs'
import { join, resolve } from 'node:path'
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2)
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback
const blender=option('--blender','/Applications/Blender.app/Contents/MacOS/Blender')
const output=resolve(option('--output','artifacts/camera-data/release/native53'))
const profiles=option('--profiles','ordinary,translated,wide,close,angular-edge').split(',')
assert.ok(profiles.every(profile=>['ordinary','translated','wide','close','angular-edge'].includes(profile)))
const built=args.includes('--built'),skipNative=args.includes('--skip-native'),skipExport=args.includes('--skip-export'),nativeOnly=args.includes('--native-only')
async function run(command,arguments_,env,log){
  const stream=createWriteStream(log)
  await new Promise((resolve,reject)=>{
    const child=spawn(command,arguments_,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
    child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false})
    child.on('error',reject);child.on('close',code=>{stream.end();code===0?resolve():reject(new Error('Camera Data step failed; see '+log))})
  })
}
const rows=[]
for(const profile of profiles){
  const directory=join(output,profile);await mkdir(directory,{recursive:true})
  const env={BLENDLINK_CAMERA_DATA_REFERENCES:directory,BLENDLINK_CAMERA_DATA_NATIVE:directory,
    BLENDLINK_CAMERA_DATA_PROFILE:profile,BLENDLINK_CAMERA_DATA_BLENDER:blender,BLENDLINK_CAMERA_DATA_BUILT:built?'1':'0'}
  if(!skipNative)await run(blender,['--background','--factory-startup','--python-exit-code','1','--python',join(root,'experiments/camera-data/native_backend.py')],env,join(directory,'native.log'))
  const references=JSON.parse(await readFile(join(directory,'native-reference.json'),'utf8'))
  assert.equal(references.profile,profile);assert.equal(references.packingCalibration.cases,256);assert.equal(references.packingCalibration.maximum,0)
  if(!nativeOnly){
    if(!skipExport)await run(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','experiments/camera-data/export.test.ts'],env,join(directory,'export.log'))
    if(!skipNative){
      const legacy=references.blender==='4.2.0'
      const source=verifyCameraDataSource(directory,{root,expectedBackend:legacy?undefined:process.env.BLENDLINK_CAMERA_DATA_NATIVE_BACKEND||undefined})
      console.log('BLENDLINK_CAMERA_DATA_SOURCE_STATUS '+JSON.stringify(source))
    }
    await run(process.execPath,[join(root,'experiments/camera-data/run.mjs'),...(built?['--built']:[])],env,join(directory,'browser-'+(process.env.BLENDLINK_TEST_PROFILE??'default')+'.log'))
  }
  rows.push({profile,nativeVersion:references.blender,rows:references.rows.length,fields:references.cases.length,directory})
  console.log('BLENDLINK_CAMERA_DATA_PROFILE_PASSED '+JSON.stringify(rows.at(-1)))
}
await writeFile(join(output,'suite-'+(process.env.BLENDLINK_TEST_PROFILE??'native')+'.json'),JSON.stringify({blender,built,nativeOnly,rows},null,2)+'\n')
