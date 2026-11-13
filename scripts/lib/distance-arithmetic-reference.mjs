import assert from 'node:assert/strict'

const builds = { '4.2.0': 'a51f293548ad', '5.2.0': 'fbe6228777e7', '5.3.0': '02f0899d78e3' }
const memory = new DataView(new ArrayBuffer(4))
function value(word) { memory.setUint32(0, word, true); return memory.getFloat32(0, true) }

/** Fresh native primitive evidence is distinct from mathematical bit controls
 * and the separate built Distance graph corpus. Reject empty/wrong profiles. */
export function validateDistanceArithmeticReference(record, expectedNative) {
  const version = record.native?.replace(/ LTS$/, '')
  assert.ok(Object.hasOwn(builds, version), 'Unmeasured native arithmetic version')
  assert.equal(record.hash, builds[version]); if (expectedNative) assert.equal(version, expectedNative)
  assert.equal(record.sourceDevice, 'CPU'); assert.ok(['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'].includes(record.sourceEngine))
  assert.match(record.fixtureSha256, /^[a-f0-9]{64}$/)
  assert.ok(Number.isInteger(record.width) && record.width > 0 && Number.isInteger(record.height) && record.height > 0)
  assert.equal(record.count, 16384); assert.equal(record.width * record.height, 16384)
  assert.ok(Array.isArray(record.inputWords) && Array.isArray(record.expected))
  assert.equal(record.inputWords?.length, 16384); assert.equal(record.expected?.length, 16384)
  const ratio = record.divisorWords !== undefined
  if (ratio) { assert.ok(Array.isArray(record.divisorWords)); assert.equal(record.divisorWords.length, 16384) }
  for (let index = 0; index < 16384; index++) {
    const word = record.inputWords[index]
    assert.ok(Number.isInteger(word) && word >= 0 && word <= 0x7f7fffff)
    const input = value(word)
    let ideal
    if (ratio) {
      const denominator = record.divisorWords[index]
      assert.ok(Number.isInteger(denominator) && denominator >= 0x3c800000 && denominator <= 0x3f800000)
      assert.ok(input === 0 || input >= 2 ** -74 && input <= 16)
      ideal = Math.fround(input / value(denominator))
    } else {
      assert.ok(word === 0 || word >= 0x800000, 'Native sqrt field must use normal inputs or positive zero')
      ideal = Math.fround(Math.sqrt(input))
    }
    assert.equal(record.expected[index], ideal, 'Native primitive differs from independent mathematical control')
  }
  return { operation: ratio ? 'ratio' : 'sqrt', native: record.native, hash: record.hash, nativeValues: 16384 }
}
