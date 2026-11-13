import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const root=new URL('../',import.meta.url)
const read=name=>readFileSync(new URL(name,root),'utf8')

test('Magic coverage keeps measured source and renderer scopes explicit',()=>{
  const entry=JSON.parse(read('docs/node-capabilities.json')).entries['shader:ShaderNodeTexMagic']
  assert.equal(entry.category,'partial')
  assert.deepEqual(entry.runtimeOps,['tex_magic_native'])
  assert.equal(entry.runtimePath,'packages/blendlink/src/tslMagicNodes.ts')
  for(const text of ['4.2.0/5.2.0/5.3.0','depths 0..10','Distortion zero','actual static mesh/UV/texspace','unknown source versions','Linux 5.2.0 OpenGL source precision is qualified','Other OpenGL versions remain unmeasured','Fresh Cycles uses baking','old serialized tex_magic'])assert.ok(entry.limits.includes(text),text)
  assert.equal(entry.verification.hostedLinux52.sourceBackend,'OPENGL')
  assert.equal(entry.verification.hostedLinux52.cases,206)
  assert.deepEqual(entry.verification.unmeasuredOpenGLVersions,['4.2.0','5.3.0'])
  assert.ok(entry.evidence.some(item=>item.path==='experiments/magic-node-differential/README.md'))
  assert.ok(entry.evidence.some(item=>item.path==='packages/blender-addon/tests/magic_translation_check.py'))
})

test('the Linux canary earns fresh OpenGL evidence against the actual built runtime',()=>{
  const workflow=read('.github/workflows/static-noise.yml')
  const job=workflow.slice(workflow.indexOf('\n  native-magic:'),workflow.indexOf('\n  native-compositor:'))
  assert.ok(job.startsWith('\n  native-magic:'))
  assert.match(job,/blender-5\.2\.0-linux-x64\.tar\.xz/)
  assert.match(job,/96f6c181a30f4950607839dc84d42a354b250d8a0231b098b59b7bc69c351c48/)
  assert.match(job,/sha256sum --check --strict/)
  assert.match(job,/libegl1 libgl1-mesa-dri libopengl0 mesa-utils/)
  assert.match(job,/LIBGL_ALWAYS_SOFTWARE: '1'/)
  assert.match(job,/env -u BLENDLINK_TEST_CHROMIUM_CHANNEL xvfb-run --auto-servernum node experiments\/magic-node-differential\/run\.mjs --built/)
  assert.doesNotMatch(job,/--reuse-reference|--disable-gpu-watchdog/)
  assert.match(job,/if: always\(\)/)
  assert.match(job,/path: artifacts\/verification-magic-linux52/)
})

test('old Cycles Magic cells are explicit serialized-runtime fixtures with unchanged budgets',()=>{
  const cells=JSON.parse(read('experiments/tsl-node-differential/cells.json')).cells
  for(const id of ['tex-magic','tex-magic-fac']){
    const cell=cells.find(item=>item.id===id)
    assert.equal(cell.pipeline,'legacy-ir');assert.equal(cell.scope,'legacy-serialized-runtime-only')
    assert.deepEqual(cell.tolerance,{meanAbs:.001,p99Abs:.005,maxAbs:.01})
    assert.match(cell.notes,/current producer explicitly refuses fresh Cycles live translation/)
  }
  const runner=read('experiments/tsl-node-differential/run.mjs')
  assert.match(runner,/reference\.cells\[cell\.id\]\.freshSourceRefusal !== 'Magic Texture native live translation requires EEVEE; use source baking for Cycles'/)
  assert.match(runner,/legacyRuntimeOnly:/)
})
