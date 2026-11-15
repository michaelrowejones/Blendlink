/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import test from 'node:test'
import {vec3} from 'three/tsl'
import {createResearchNativeMatvec} from './staged-matvec.mjs'

test('stages every native subtract/product/pair/add without introducing resources', () => {
  const center = [.5, .5, .5], columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const build = createResearchNativeMatvec(center, columns)
  const node = build(vec3(.1, .2, .3)), uniforms = new Set(), casts = new Set(), constants = new Set()
  node.traverse(child => {
    if (child.isUniformNode) uniforms.add(child)
    if (child.isBitcastNode) casts.add(child)
    if (child.isConstNode) constants.add(child)
    assert.ok(!child.isTextureNode && !child.isRTTNode && !child.isPassNode)
  })
  assert.equal(casts.size, 42)
  assert.equal(uniforms.size, 1)
  const zero = [...uniforms][0]
  assert.equal(zero.nodeType, 'uint')
  assert.doesNotThrow(() => node.update({}))
  zero.value = 1
  assert.throws(() => node.update({}), /unchanged private rounding uniform/)
  zero.value = 0
  assert.doesNotThrow(() => node.update({}))
  center.fill(16); columns[0][0] = 2
  assert.ok([...constants].some(child => child.value === .5))
  assert.ok([...constants].every(child => child.value !== 16 && child.value !== 2))
  const otherUniforms = new Set()
  build(vec3(1)).traverse(child => { if (child.isUniformNode) otherUniforms.add(child) })
  assert.deepEqual([...otherUniforms], [zero])
})

test('refuses malformed or out-of-domain coefficient captures before graph creation', () => {
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (const center of [[-0, 0, 0], [2 ** -17, 0, 0], [17, 0, 0], [0, 0]])
    assert.throws(() => createResearchNativeMatvec(center, identity), /reviewed Float32/)
  for (const value of [2 ** -64, 4, Infinity, NaN])
    assert.throws(() => createResearchNativeMatvec([0, 0, 0], [[value, 0, 0], [0, 1, 0], [0, 0, 1]]), /reviewed Float32/)
})
