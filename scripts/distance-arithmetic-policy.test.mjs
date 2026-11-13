import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateDistanceArithmeticReference } from './lib/distance-arithmetic-reference.mjs'

function reference(ratio = false) {
  return { native: '5.2.0 LTS', hash: 'fbe6228777e7', sourceDevice: 'CPU', sourceEngine: 'BLENDER_EEVEE',
    fixtureSha256: 'a'.repeat(64), count: 16384, width: 128, height: 128, inputWords: new Array(16384).fill(0x3e800000),
    expected: new Array(16384).fill(.5), ...(ratio ? { divisorWords: new Array(16384).fill(0x3f000000) } : {}) }
}
test('native primitive accounting requires actual bounded values and measured CPU identity', () => {
  for (const ratio of [false, true]) assert.equal(validateDistanceArithmeticReference(reference(ratio), '5.2.0').nativeValues, 16384)
  for (const patch of [{ count: 0 }, { native: '5.2.1' }, { hash: 'b'.repeat(12) }, { sourceDevice: 'GPU' },
    { inputWords: [] }, { expected: [] }, { sourceEngine: 'CYCLES' }]) {
    assert.throws(() => validateDistanceArithmeticReference({ ...reference(), ...patch }))
  }
  const incorrect = reference(); incorrect.expected[0] = .5000001
  assert.throws(() => validateDistanceArithmeticReference(incorrect))
  const subnormal = reference(); subnormal.inputWords[0] = 1
  assert.throws(() => validateDistanceArithmeticReference(subnormal), /normal inputs/)
  const outside = reference(true); outside.divisorWords[0] = 0
  assert.throws(() => validateDistanceArithmeticReference(outside))
})
test('Distance evidence separates numeric programs, controls, adapters and primitive source proof', () => {
  const entry = JSON.parse(readFileSync(new URL('../docs/node-capabilities.json', import.meta.url))).entries['compositor:CompositorNodeDistanceMatte']
  const proof = entry.verification
  assert.equal(proof.nativeCases, 146); assert.equal(proof.numericalDistancePrograms, 134); assert.equal(proof.independentControls, 12)
  assert.equal(proof.nativeCases, proof.numericalDistancePrograms + proof.independentControls)
  assert.equal(proof.builtGraphChecks, 584); assert.equal(proof.maximumAbsoluteError, 0)
  assert.equal(proof.shaderSourceGateBytes, 16000); assert.ok(proof.maximumFragmentSourceBytes <= 16000)
  assert.equal(proof.independentArithmetic.nativePrimitiveValues, 98304)
  assert.equal(proof.independentArithmetic.mathematicalBitControls, 73)
  assert.equal(proof.independentArithmetic.adapterApiProfiles, 4)
  assert.match(entry.limits, /zero Tolerance.*zero Falloff/)
  const workflow = readFileSync(new URL('../.github/workflows/static-noise.yml', import.meta.url), 'utf8').split('  native-compositor:\n')[1]
  assert.match(workflow, /if: always\(\) && steps\.build\.outcome == 'success' && matrix\.family == 'Distance Key' && matrix\.source_device == 'CPU'/)
  assert.match(workflow, /native_sqrt\.py/); assert.match(workflow, /native_ratio\.py/); assert.match(workflow, /sqrt-run\.mjs/)
  assert.match(workflow, /BLENDLINK_DISTANCE_EXPECTED_NATIVE: '5\.2\.0'/)
})
