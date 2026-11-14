import{createHash}from'node:crypto'
import{mkdirSync,readFileSync,writeFileSync}from'node:fs'
import{join,resolve}from'node:path'
import{it,expect}from'vitest'
import{resolveConfig}from'../../packages/blendlink/src/config.js'
import{parseManifest}from'../../packages/blendlink/src/typegen.js'
import{browserProofContract}from'./protocol.mjs'
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
it('publishes the actual eight saved native Radial coordinate graphs',async()=>{const directory=resolve(process.env.SCENETOWEB_RADIAL_STATIC!),native=JSON.parse(readFileSync(join(directory,'qualification.json'),'utf8')),root=join(directory,'compiled');mkdirSync(root,{recursive:true});const{syncAll,verifyAll,publishedAssetPath}=await import('../../packages/blendlink/dist/sync.js')
const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER!,outDir:'public/models',genDir:'src/generated',scenes:native.finals.map((row:any,i:number)=>({name:'radial-static-'+i,file:join(directory,row.sourceFile)}))},root)
try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
const rows=[];for(const[i,scene]of config.scenes.entries()){const reference=native.finals[i],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!;expect(manifest.materialPrograms).toBeTruthy();const materialPath=publishedAssetPath(scene,manifest.materialPrograms!.url,manifest)!,materialBytes=readFileSync(materialPath),programs=JSON.parse(materialBytes.toString()),ir=JSON.parse(readFileSync(join(directory,reference.irFile),'utf8'));expect(programs.materials['Artist Radial Coordinates'].channels['Base Color'].tslIr).toEqual(ir);expect(hash(materialBytes).slice(0,16)).toBe(manifest.materialPrograms!.hash);expect(hash(readFileSync(join(directory,reference.sourceFile)))).toBe(reference.sourceSha256);rows.push({...reference,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),materialPath,materialSha256:hash(materialBytes),materialPointer:manifest.materialPrograms})}
expect((await verifyAll(config)).filter(issue=>issue.severity!=='warning')).toEqual([]);writeFileSync(join(directory,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,nativeSha256:hash(readFileSync(join(directory,'qualification.json'))),exporter:'built',sourcePreserved:true,rows},null,2)+'\n')
},240000)
