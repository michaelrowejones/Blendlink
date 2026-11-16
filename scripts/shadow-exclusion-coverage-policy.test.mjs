import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const map = JSON.parse(read('docs/node-capabilities.json')), key = 'shader:ShaderNodeLightPath', entry = map.entries[key]

test('Light Path credit is only the pinned terminal 5.3 shadow closure, never a general field', () => {
  assert.equal(entry.category,'unsupported')
  assert.deepEqual(Object.keys(entry.versionOverrides),['5.3.0'])
  assert.equal(entry.versionOverrides['5.3.0'].category,'partial')
  assert.deepEqual(entry.runtimeOps,['shadow_exclusion_native'])
  assert.equal(entry.runtimePath,'packages/blendlink/src/tslNodeRecipe.ts')
  assert.equal(Object.hasOwn(entry,'compileTime'),false)
  assert.equal(map.knownUnsupported.includes(key),false)
  assert.equal(entry.verification.status,'QUALIFIED_BOUNDED_TERMINAL_SHADOW_BRANCH')
  assert.equal(entry.verification.nativeBuild,'02f0899d78e3')
  assert.deepEqual(entry.verification.nativeNumericVersions,['5.3.0'])
  assert.equal(entry.verification.nativeHost,'darwin-arm64')
  assert.equal(entry.verification.sourceBackend,'METAL')
  assert.equal(entry.verification.standaloneLightPathFields,'unsupported')
  assert.deepEqual(entry.verification.actualRuntimeBackends,['WebGPU','WebGL2 via WebGPURenderer'])
  assert.deepEqual(entry.verification.actualRuntimeProfiles,['Apple Metal','SwiftShader'])
  for (const phrase of ['same non-shadow primary closure','unlinked static Alpha','Principled Alpha is one','Float32 constant','Groups, linked primary Alpha','all five','without source/runtime skips','stock carrier is unchanged','fresh node-renderer declarations','no Three global patch','No arbitrary ray-dependent','general Cycles live behavior','whole original-demo acceptance'])
    assert.ok(entry.versionOverrides['5.3.0'].limits.toLowerCase().includes(phrase.toLowerCase()),phrase)
  assert.ok(entry.versionOverrides['5.3.0'].limits.includes('never general Is Shadow Ray=0'))
})

test('source admission retains the exact authored predicate, primary/white branch, profile and static Alpha', () => {
  const source=read('packages/blender-addon/shadow_branch_ir.py')
  for(const anchor of ["ir.get_evaluation_engine() != 'EEVEE'","tuple(bpy.app.version) != (5, 3, 0)","bpy.app.build_hash != b'02f0899d78e3'","sys.platform != 'darwin'","platform.machine() != 'arm64'","gpu_backend != 'METAL'","node.bl_idname != 'ShaderNodeLightPath'","socket.identifier != 'Is Shadow Ray'","primary_link != cycles_link","transparent.bl_idname != 'ShaderNodeBsdfTransparent'","tuple(transparent.inputs['Color'].default_value) != (1., 1., 1., 1.)","ir._require_static_tree(owner)","not expression['node'].inputs['Alpha'].is_linked","leaf['node'].inputs['Alpha'].default_value==1","alpha = ir._fold_constant_scalar(value)","struct.unpack('<f',struct.pack('<f',alpha))[0]","'input': {'op':'const_float','value':alpha}, 'visibleAlpha':alpha"])
    assert.ok(source.includes(anchor),anchor)
  const ir=read('packages/blender-addon/tsl_ir.py')
  assert.ok(ir.includes('primary = primary_surface(expression, sys.modules[__name__])'))
  assert.ok(ir.includes("channels['Alpha'] = wrap_alpha(channels['Alpha'], sys.modules[__name__])"))
  // No standalone source field dispatcher was added under the surface helper.
  assert.equal(/(?:idname|node\.bl_idname)\s*==\s*["']ShaderNodeLightPath["']/.test(ir),false)
  const checks=read('packages/blender-addon/tests/shadow_branch_check.py')
  assert.ok(checks.includes("ir.emit_output(light,light.outputs['Is Shadow Ray'])"))
  assert.ok(checks.includes("General Light Path field unexpectedly admitted"))
})

test('runtime state remains explicit, complete and reversible on owned clones and shadow callbacks', () => {
  const state=read('packages/blendlink/src/tslShadowExclusion.ts'),builder=read('packages/blendlink/src/tslMaterialProgram.ts'),runtime=read('packages/blendlink/src/tslMaterialRuntime.ts'),callbacks=read('packages/blendlink/src/tslMaterialShadowCache.ts')
  for(const anchor of ["Math.fround(value.visibleAlpha) !== value.visibleAlpha","value.input.op !== 'const_float' || value.input.value !== value.visibleAlpha","'colorNode', 'metalnessNode', 'roughnessNode', 'emissiveNode', 'opacityNode'","alpha.value !== validated.visibleAlpha","mask.value !== false"])
    assert.ok(state.includes(anchor),anchor)
  assert.ok(builder.includes("if (skipped.length) fail('Shadow material state requires every supplied surface channel to build without skips')"))
  assert.ok(runtime.includes('program.materialState && programs.materials[source]?.skipped?.length'))
  assert.ok(runtime.includes('installCompiledProgramMaterial(material,program.nodes,!!ownership,program.materialState)'))
  for(const anchor of ['clone.transparent = shadowState.visibleAlpha < 1','clone.depthWrite = shadowState.visibleAlpha === 1','clone.alphaTest = 0','clone.alphaHash = false','clone.alphaToCoverage = false'])assert.ok(runtime.includes(anchor),anchor)
  assert.ok(callbacks.includes('isShadowPassMaterial'));assert.ok(callbacks.includes('args[5].needsUpdate = true'));assert.ok(callbacks.includes('finally'))
  const compiler=read('packages/blender-addon/material_compiler.py'),requirements=read('packages/blendlink/src/materialProgramRendererRequirements.ts')
  assert.ok(compiler.includes('("shadow_exclusion_native", "eevee53-white-shadow-branch-v1")'))
  assert.ok(compiler.includes('entry["requiresNodeRenderer"]'))
  assert.match(requirements,/const freshPrograms\s*=\s*\[[^\]]*\bSHADOW_EXCLUSION\b[^\]]*\]/)
})

test('all declared Light Path evidence anchors remain reachable source files', () => {
  assert.ok(entry.evidence.length>=2)
  for(const row of entry.evidence){const text=read(row.path);if(row.anchor)assert.ok(text.includes(row.anchor),row.path+': '+row.anchor)}
  assert.equal(entry.verification.evidence,'experiments/shadow-transparent-branch/qualified-evidence.json')
  assert.match(entry.verification.evidenceSha256,/^[a-f0-9]{64}$/)
  assert.equal(hash(read(entry.verification.evidence)),entry.verification.evidenceSha256)
})

test('Light Path qualification retains independent binary closure and no broader acceptance credit', () => {
  const proof=JSON.parse(read(entry.verification.evidence))
  assert.equal(proof.schemaVersion,1);assert.equal(proof.status,'QUALIFIED_BOUNDED_TERMINAL_SHADOW_BRANCH')
  assert.equal(proof.node,key);assert.equal(proof.support,'partial')
  for(const field of ['sceneAcceptance','generalLightPathFields','performanceAcceptance'])assert.equal(proof[field],false)
  for(const field of ['sceneAcceptance','generalLightPathFields','performanceAcceptance'])assert.equal(entry.verification[field],false)
  assert.deepEqual(proof.sourceProfile,{version:[5,3,0],build:'02f0899d78e3',engine:'EEVEE',platform:'darwin',machine:'arm64',backend:'METAL',observedDevice:'Apple M5 Pro'})
  assert.deepEqual(proof.operator,{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1'})
  assert.equal(proof.materialStateModel,'eevee53-static-shadow-alpha-v1')
  assert.equal(proof.closedReader.path,'experiments/shadow-transparent-branch/read.mjs')
  assert.equal(hash(read(proof.closedReader.path)),proof.closedReader.sha256)
  assert.deepEqual(entry.verification.closedReader,proof.closedReader)
  assert.deepEqual(entry.verification.counts,proof.counts)
  assert.equal(proof.cases.length,2)
  assert.deepEqual(proof.cases.map(row=>row.closed.fixture),['original-archviz-glass','opaque-primary'])
  assert.equal(proof.cases[0].closed.visibleAlpha,Math.fround(0.05000001192092896));assert.equal(proof.cases[1].closed.visibleAlpha,1)
  let nativeWords=0,installedWords=0,halfAlpha=0,floatAlpha=0,tuples=0
  for(const row of proof.cases){
    assert.equal(hash(JSON.stringify(row.closed,null,2)+'\n'),row.closedSha256)
    assert.equal(row.closed.status,'BOUNDED_SHADOW_AND_OWNED_ALPHA_CLOSED_NOT_SCENE_ACCEPTANCE')
    assert.equal(row.closed.sceneAcceptance,false);assert.equal(row.closed.generalLightPathFields,false)
    assert.equal(row.closed.nativeWordsPerField,65536);assert.ok(row.closed.nativeNegativeWords>100)
    for(const field of ['nativeReportSha256','browserReportSha256','nativeProducerSha256','browserProducerSha256','finalGlbSha256'])assert.match(row.closed[field],/^[a-f0-9]{64}$/)
    assert.equal(row.closed.rows.length,4);assert.deepEqual(row.closed.rows.map(r=>r.profile+'/'+r.backend),['metal/webgpu','metal/webgl2','swiftshader/webgpu','swiftshader/webgl2'])
    nativeWords+=row.closed.nativeWordsPerField*3
    for(const tuple of row.closed.rows){
      assert.equal(tuple.wordsPerField,65536);assert.equal(tuple.fields,11);assert.equal(tuple.implicitColorWords,65536)
      for(const name of ['negativeWords','otherCasterWords','visibleCasterWords'])assert.ok(tuple[name]>100)
      assert.equal(tuple.alphaWords.alphaProbe,1024);assert.equal(tuple.alphaWords.f32AlphaProbe,1024)
      installedWords+=tuple.wordsPerField*tuple.fields;halfAlpha+=tuple.alphaWords.alphaProbe;floatAlpha+=tuple.alphaWords.f32AlphaProbe;tuples++
    }
  }
  assert.equal(proof.counts.nativeWords,nativeWords);assert.equal(proof.counts.installedWords,installedWords)
  assert.equal(proof.counts.coveredHalfAlphaWords,halfAlpha);assert.equal(proof.counts.coveredFloat32AlphaWords,floatAlpha);assert.equal(proof.counts.installedTuples,tuples)
  assert.ok(proof.failedDiagnosticsRetained.length>=10)
  assert.match(proof.proofRoles.comparison,/not Blender-versus-Three BRDF/)
  assert.match(proof.proofRoles.installed,/RGBA16Float/);assert.match(proof.proofRoles.installed,/unblended RGBA32Float/)
  const reader=read(proof.closedReader.path)
  for(const anchor of ['nr.native.actualGpu.backend_type','nr.sourceHashes','br.runtimeHashes','readUInt32LE','different(f.actual,f.clear)','different(f.negative,f.disposedStock)','different(f.visibleMasked,f.visibleUnmasked)',"['alphaProbe','f32AlphaProbe']"])
    assert.ok(reader.includes(anchor),anchor)
})
