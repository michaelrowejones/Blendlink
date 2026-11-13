import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const root=new URL('../',import.meta.url)
const read=name=>readFileSync(new URL(name,root),'utf8')

test('legacy HSV coverage records actual 4.2 classes and modern migration separately',()=>{
  const map=JSON.parse(read('docs/node-capabilities.json'))
  for(const id of ['ShaderNodeCombineHSV','ShaderNodeSeparateHSV']){
    const entry=map.entries['shader:'+id]
    assert.equal(entry.category,'partial')
    assert.deepEqual(entry.runtimeOps,['color_convert'])
    assert.equal(entry.runtimePath,'packages/blendlink/src/tslColorConversion.ts')
    for(const phrase of ['EEVEE 4.2.0 only','H/S/V','no Alpha socket','absent in 5.2.0/5.3.0','actual saved-file migration','Cycles uses baking','Linux 4.2.0 OpenGL'])assert.ok(entry.limits.includes(phrase),phrase)
    assert.ok(entry.evidence.some(item=>item.path==='experiments/legacy-shader-hsv/README.md'))
    assert.ok(entry.evidence.some(item=>item.path==='packages/blender-addon/tests/legacy_shader_hsv_check.py'))
    assert.ok(!map.knownUnsupported.includes('shader:'+id))
    assert.deepEqual(entry.verification.nativeNumericVersions,['4.2.0'])
    assert.deepEqual(entry.verification.actualMigrationVersions,['5.2.0','5.3.0'])
    assert.equal(entry.verification.nativeSourceBackend,'METAL')
    assert.equal(entry.verification.hostedOpenGL42.sourceBackend,'OPENGL')
    assert.equal(entry.verification.hostedOpenGL42.cases,50)
  }
})

test('legacy HSV Linux 4.2 canary generates fresh native/calibrated references',()=>{
  const workflow=read('.github/workflows/static-noise.yml')
  const match=workflow.match(/\n  native-legacy-hsv:[\s\S]*?(?=\n  [a-z][a-z0-9-]*:|$)/)
  assert.ok(match,'Missing actual legacy HSV canary')
  const job=match[0]
  assert.match(job,/blender-4\.2\.0-linux-x64\.tar\.xz/)
  assert.match(job,/4f4fd7646af01f6fee9d420408318381a6e52571268eb7cf9cd5033bd9e7a359/)
  assert.match(job,/sha256sum --check --strict/)
  assert.match(job,/libegl1 libgl1-mesa-dri libopengl0 mesa-utils/)
  assert.match(job,/LIBGL_ALWAYS_SOFTWARE: '1'/)
  assert.match(job,/env -u BLENDLINK_TEST_CHROMIUM_CHANNEL xvfb-run --auto-servernum node experiments\/legacy-shader-hsv\/run\.mjs --built/)
  assert.match(job,/--python packages\/blender-addon\/tests\/legacy_shader_hsv_check\.py/)
  assert.match(job,/BLENDLINK_HSV_PACKAGED_ADDON:/)
  assert.doesNotMatch(job,/--reuse-reference|--disable-gpu-watchdog/)
  assert.match(job,/if: always\(\)/)
  assert.match(job,/path: artifacts\/verification-legacy-hsv-linux42/)
})

test('automatic headless discovery verifies availability without claiming modern numeric support',()=>{
  const fixture=read('packages/blender-addon/tests/legacy_shader_hsv_check.py')
  assert.match(fixture,/# blendlink-headless-sentinel: BLENDLINK_LEGACY_HSV_SOURCE_CONTRACT_PASSED/)
  assert.match(fixture,/print\('BLENDLINK_LEGACY_HSV_SOURCE_CONTRACT_PASSED /)
  assert.match(fixture,/BLENDLINK_LEGACY_SHADER_HSV_UNAVAILABLE/)
  assert.match(fixture,/assert not hasattr\(bpy\.types,identifier\)/)
  assert.match(read('scripts/test-addon-headless.mjs'),/legacy_shader_hsv_check\.py/)
  assert.match(read('package.json'),/scripts\/legacy-hsv-coverage-policy\.test\.mjs/)
  assert.match(read('docs/NODE_TRANSLATION.md'),/legacy-shader-hsv\/README\.md/)
})
