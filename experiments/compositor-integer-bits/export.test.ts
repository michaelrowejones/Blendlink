import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {expect,it} from 'vitest'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
import {assertIntegerBitsQualification} from './protocol.mjs'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes actual saved literal/group/integer-consumer compositor IntegerBits family source presentations',async()=>{
 const native=resolve(process.env.SCENETOWEB_INTEGER_REFERENCES!),qualification=assertIntegerBitsQualification(JSON.parse(readFileSync(join(native,'qualification.json'),'utf8')))
 const cases=qualification.cases.filter((entry:any)=>entry.sourceFile),root=join(native,'compiled');mkdirSync(root,{recursive:true})
 const built=process.env.SCENETOWEB_INTEGER_BUILT==='1'
 const {syncAll,verifyAll,publishedAssetPath}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
 const provenance=['compositor_graph.py','compositor_integer_bits.py','source_presentation.py','export_scene.py'].map(name=>{
  const source='packages/blendlink/blender/'+name,artifact=built?'packages/blendlink/dist/blender/'+name:source
  expect(readFileSync(artifact)).toEqual(readFileSync(source));return{source,artifact,sha256:hash(readFileSync(source))}
 })
 for(const entry of cases)expect(hash(readFileSync(join(native,entry.sourceFile)))).toBe(entry.sourceSha256)
 const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(native,'final-python')})
 try {
 const config=resolveConfig({blenderPath:launcher.executable,outDir:'public/models',genDir:'src/generated',scenes:cases.map((entry:any,index:number)=>({name:'integer-bits'+index,file:join(native,entry.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const reference=cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.sourcePresentation).toBeTruthy()
  const pointer=manifest.sourcePresentation!,assetPath=publishedAssetPath(scene,pointer.url,manifest)!,bytes=readFileSync(assetPath),presentation=JSON.parse(bytes.toString())
  expect(bytes.length).toBe(pointer.bytes);expect(hash(bytes).slice(0,16)).toBe(pointer.hash)
  const nativeProgram=JSON.parse(readFileSync(join(native,reference.programFile),'utf8'))
  for(const field of ['status','ops','passes','output'])expect(presentation.compositor[field],reference.case+' '+field).toEqual(nativeProgram[field])
  expect(presentation.compositor.ops.some((op:any)=>op.kind==='bit-math' || op.kind==='hash-value')).toBe(true)
  expect(hash(readFileSync(join(native,reference.sourceFile)))).toBe(reference.sourceSha256)
  rows.push({case:reference.case,sourceFile:reference.sourceFile,sourceSha256:reference.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),presentationPath:assetPath,presentationSha256:hash(bytes),presentationPointer:pointer})
 }
 const issues=await verifyAll(config);expect(issues.filter(issue=>issue.severity!=='warning')).toEqual([])
 cpSync(launcher.directory,join(native,'final-native-launcher'),{recursive:true})
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({nativeLauncher:launcher.identity,status:'published-integer-bits-family',exporter:built?'built':'source',nativeQualificationSha256:hash(readFileSync(join(native,'qualification.json'))),sourcePreserved:true,provenance,rows},null,2)+'\n')
 } finally {await launcher.dispose()}
},240_000)
