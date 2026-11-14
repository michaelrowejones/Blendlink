// Research only: preprocessing/translation is not numeric or scene qualification.
import assert from'node:assert/strict'
import{readFile,mkdir,writeFile}from'node:fs/promises'
import{join,resolve}from'node:path'
import{execFileSync}from'node:child_process'
import{createHash}from'node:crypto'
import Transpiler from'three/addons/transpiler/Transpiler.js'
import GLSLDecoder from'three/addons/transpiler/GLSLDecoder.js'
import TSLEncoder from'three/addons/transpiler/TSLEncoder.js'
import{inspectReturns,lowerExhaustiveTailReturns}from'../radial-transpiler-compile/ast-lowering.mjs'
import{assertGlslSourceCensus}from'../../scripts/lib/glsl-source-census.mjs'
const[source,destination,...flags]=process.argv.slice(2);assert.ok(flags.every(flag=>flag==='--lower-tail-returns'));const lower=flags.includes('--lower-tail-returns');assert.ok(source&&destination,'Pass pinned upstream shared GLSL and a new ignored research output directory')
const raw=await readFile(resolve(source)),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(raw),'adab763a5772baca55f40e9ad0aa0cc1942b8bee87f898fe3e4aaa0601ebeeb3','Unmeasured upstream GPU source')
const upstreamHeader=raw.toString('utf8').match(/^\/\* SPDX-FileCopyrightText:[\s\S]*?\*\//)?.[0];assert.ok(upstreamHeader?.includes('SPDX-License-Identifier: Apache-2.0'))
let preprocessed=execFileSync('/usr/bin/clang',['-E','-P','-x','c','-'],{input:raw,encoding:'utf8'})
// Explicit native aliases only; no Radial arithmetic or output fitting.
preprocessed=upstreamHeader+'\nfloat square(float x) { return x*x; }\n'+preprocessed.replace(/\bfloat2\b/g,'vec2').replace(/\bfloat4\b/g,'vec4').replace(/\batan2\b/g,'atan').replace(/\bM_PI\b/g,'3.14159265358979323846').replace(/\bM_TAU\b/g,'6.28318530717958647692')
const decoder=new GLSLDecoder(),encoder=new TSLEncoder(),transpiler=new Transpiler(decoder,encoder)
// TSLEncoder r184 does not mark initialized locals as mutable variables. Source
// contains assignments/addAssign/mulAssign; conservative research output must
// materialize local declarations before any future compile/numerical pilot.
const original=decoder.parse.bind(decoder);let locals=0,returnsBefore,returnsAfter,loweredReturns=[],sourceCensus
decoder.parse=input=>{const ast=original(input),seen=new Set();sourceCensus=assertGlslSourceCensus(input,ast);returnsBefore=inspectReturns(ast);if(lower)loweredReturns=lowerExhaustiveTailReturns(ast);returnsAfter=inspectReturns(ast);const visit=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(value.isVariableDeclaration){value.needsToVar=true;locals++}for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else visit(child)};visit(ast);return ast}
const body=transpiler.parse(preprocessed),generated=upstreamHeader+'\n// Mechanically transpiled research derivative; no production admission.\n// Source: https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/gpu/shaders/material/gpu_shader_material_radial_tiling_shared.glsl\n'+body,output=resolve(destination);assert.ok(Buffer.byteLength(generated)<=256*1024);await mkdir(output)
await writeFile(join(output,'preprocessed.glsl'),preprocessed);await writeFile(join(output,'candidate.js'),generated)
const report={status:'GENERATED_RADIAL_RESEARCH_ONLY',sourceCensus,numericalCases:0,finalExports:0,officialSceneAcceptance:false,source:{path:resolve(source),sha256:sha(raw)},preprocessor:execFileSync('/usr/bin/clang',['--version'],{encoding:'utf8'}).trim(),threeRevision:184,normalizedAliases:['float2→vec2','float4→vec4','atan2→atan (two-argument overload)','M_PI/M_TAU→explicit decimal literals','square scalar helper'],materializedLocalDeclarations:locals,upstreamLicense:'Apache-2.0',upstreamCopyright:'2024-2025 Blender Authors',tailReturnLowering:lower,returnsBefore,returnsAfter,loweredReturns,inputBytes:raw.length,preprocessedBytes:Buffer.byteLength(preprocessed),generatedBytes:Buffer.byteLength(generated),generatedSha256:sha(generated),fixtureSha256:sha(await readFile(import.meta.filename)),astAdapterSha256:sha(await readFile(new URL('../radial-transpiler-compile/ast-lowering.mjs',import.meta.url))),remainingGates:['Actual WebGPU and WebGL2 generated-shader compile/validation','Actual native shader-vs-browser fractional full-roundness numeric and branch controls','Origin/sector seam policy and unchanged authored official-scene acceptance','Shader size, register pressure and completed-draw costs versus source-shaped and specialized kernels'],productionAdmission:false}
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
