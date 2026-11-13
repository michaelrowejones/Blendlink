import { resolve } from 'node:path'
import { verifyCameraDataSource } from './lib/camera-data-source.mjs'
const directory=process.argv[2],backend=process.argv[3]
if(!directory||backend&&!['OPENGL','METAL'].includes(backend))throw new Error('usage: check-camera-data-source.mjs <profile directory> [OPENGL|METAL]')
const result=verifyCameraDataSource(resolve(directory),{expectedBackend:backend})
console.log((result.nativeBackendQualification==='SOURCE_ATTESTATION_NA'?'BLENDLINK_CAMERA_DATA_SOURCE_AND_FINAL_BACKEND_NA':'BLENDLINK_CAMERA_DATA_SOURCE_AND_FINAL_PASSED')+' '+JSON.stringify(result))
