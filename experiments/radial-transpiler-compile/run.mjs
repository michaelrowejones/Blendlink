// Compile research only. No numeric, Final, production or scene support credit.
import assert from 'node:assert/strict'
import {copyFile,mkdir,readFile,realpath,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
const root=await realpath(resolve(import.meta.dirname,'../..')),[generatedArg,destinationArg]=process.argv.slice(2);assert.ok(generatedArg&&destinationArg)
const generated=await realpath(resolve(generatedArg)),destination=resolve(destinationArg),profile=process.env.BLENDLINK_TEST_PROFILE??'metal';assert.ok(['metal','software'].includes(profile));await mkdir(destination)
const fixture=join(destination,'fixture');await mkdir(fixture)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),pins={},pin=async file=>{const bytes=await readFile(file);pins[file]=hash(bytes);return bytes}
const contract=JSON.parse(await pin(join(import.meta.dirname,'contract.json'))),codegen=JSON.parse(await pin(join(generated,'report.json'))),variant=codegen.tailReturnLowering?'exhaustive-tail-lowered':'baseline'
assert.equal(hash(await pin(join(generated,'candidate.js'))),codegen.generatedSha256);assert.equal(hash(await pin(codegen.source.path)),codegen.source.sha256);await pin(join(generated,'preprocessed.glsl'))
for(const name of ['candidate.js','preprocessed.glsl','report.json'])await copyFile(join(generated,name),join(fixture,name))
for(const name of ['browser.js','index.html']){await pin(join(import.meta.dirname,name));await copyFile(join(import.meta.dirname,name),join(fixture,name))}
for(const name of ['run.mjs','ast-lowering.mjs'])await pin(join(import.meta.dirname,name))
await pin(join(root,'experiments/radial-segment-width/transpiler-feasibility.mjs'));await pin(join(root,'package-lock.json'))
const three=await realpath(join(root,'node_modules/three'))
for(const name of ['package.json','build/three.core.js','build/three.module.js','build/three.webgpu.js','build/three.tsl.js','examples/jsm/transpiler/Transpiler.js','examples/jsm/transpiler/GLSLDecoder.js','examples/jsm/transpiler/TSLEncoder.js','examples/jsm/transpiler/AST.js'])await pin(join(three,name))
const license='Mechanically transpiled research derivative of Blender gpu_shader_material_radial_tiling_shared.glsl, copyright 2024-2025 Blender Authors, Apache-2.0. Exact source SHA '+codegen.source.sha256+'. No production admission. Raw generated shader bytes are captured without comment changes.\n'
await writeFile(join(destination,'generated-shaders.license.txt'),license)
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,three,destination]}}})
const report={schemaVersion:1,status:'running',role:contract.role,variant,profile,contract,pins,codegen,rows:[],numericalCases:0,finalExports:0,supportCredit:0,officialSceneAcceptance:false};let browser
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
try{await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='metal'?['--use-angle=metal']:['--use-angle=swiftshader','--use-vulkan=swiftshader']),...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]});report.browserVersion=browser.version()
for(const backend of ['webgpu','webgl2']){const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});await page.goto(server.resolvedUrls.local[0]+'index.html');await page.waitForFunction(()=>typeof window.compileRadialResearch==='function')
const row=await page.evaluate(proof=>window.compileRadialResearch(proof),{backend,variant,maximumShaderBytes:contract.ceilings.fragmentShaderBytesPerProgram,maximumCompileMs:contract.ceilings.compileMillisecondsPerProgram});assert.equal(row.backend,backend);if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
for(const program of row.rows)for(const field of ['vertexShader','fragmentShader','readbackWords'])if(program[field]){const file=backend+'-'+program.case+'-'+field+(field==='readbackWords'?'.json':'.txt'),bytes=field==='readbackWords'?JSON.stringify(program[field]):program[field];await writeFile(join(destination,file),bytes);program[field+'Archive']={file,sha256:hash(bytes)};delete program[field]}
report.rows.push({...row,pageErrors:errors,codegenDiagnostics:errors.length,compileObservation:errors.length?'drawn-with-codegen-diagnostics':'clean-compile-and-draw'});await save();await page.close()}
for(const[file,expected]of Object.entries(pins))assert.equal(hash(await readFile(file)),expected,'Research source changed during capture: '+file);report.status='COMPILE_RESEARCH_RECORDED';await save();console.log(JSON.stringify(report.rows.map(row=>({backend:row.backend,gpu:row.gpu,programs:row.rows.map(p=>({case:p.case,status:p.status,error:p.error,fragmentBytes:p.fragmentBytes,nonfinite:p.nonfiniteComponents}))}))))
}finally{await save();await browser?.close();await server.close()}
