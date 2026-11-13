import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFloat32Words, MAX_ORACLE_WORDS } from './word-transport.mjs'

test('JSON word transport retains subnormals, signed zeros and NaN payload words exactly', () => {
  const words = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x3f800000, 0x7fc00001]
  const packet = JSON.parse(JSON.stringify({ model: 'float32-word-array-v1', length: words.length, words }))
  const decoded = decodeFloat32Words(packet, words.length)
  assert.deepEqual([...new Uint32Array(decoded.buffer)], words)
  assert.equal(Object.is(decoded[1], -0), true)
  // Transporting a NaN payload is not permission for a node to accept NaN.
})

test('word transport refuses stale dimensions, sparse arrays and coerced/invalid words', () => {
  const packet = words => ({ model: 'float32-word-array-v1', length: words.length, words })
  for (const words of [[-1], [2 ** 32], [.5], ['1'], [true], [NaN], [Infinity], new Array(1)])
    assert.throws(() => decodeFloat32Words(packet(words), 1), /oracle/)
  assert.throws(() => decodeFloat32Words(packet([1]), 2), /oracle/)
  assert.throws(() => decodeFloat32Words(packet([1]), MAX_ORACLE_WORDS + 1), /oracle/)
  assert.throws(() => decodeFloat32Words({ ...packet([1]), model: 'unmeasured' }, 1), /oracle/)
})
