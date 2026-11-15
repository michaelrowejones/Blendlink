import assert from 'node:assert/strict'
import test from 'node:test'
import { geometryFrame } from './geometry-inputs.mjs'
import { compare } from '../box-image-transport-prototype/compare.mjs'

const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const input = { basis: 'gltf-y-up', modelMatrix: identity, position: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], normal: [[.6000000238418579, .7999999523162842, 0], [.6000000238418579, .7999999523162842, 0], [.6000000238418579, .7999999523162842, 0]], index: [0, 1, 2], camera: { type: 'PERSP', near: .1, far: 100, matrix: identity, viewFrame: [[-1, -.4, -1], [1, -.4, -1], [1, .6, -1], [-1, .6, -1]] } }
test('basis transport preserves raw normal words and native camera shift without normalizing or fitting', () => {
    const frame = geometryFrame(input)
    try {
        const a = frame.mesh.geometry.getAttribute('normal').array
        const restored = []
        for (let i = 0; i < a.length; i += 3) restored.push(a[i], -a[i + 2], a[i + 1])
        assert.deepEqual(new Uint32Array(new Float32Array(restored).buffer), new Uint32Array(new Float32Array(input.normal.flat()).buffer))
        assert.notEqual(frame.camera.projectionMatrix.elements[9], 0)
    } finally { frame.dispose() }
})
test('material image gate remains unchanged for normal, weight and sampler stage diagnostics', () => {
    const raw = values => Buffer.from(new Float32Array(values).buffer)
    assert.equal(compare(raw([.5]), raw([.5 + 2 ** -11]), 2 ** -10).violations, 0)
    assert.equal(compare(raw([.5]), raw([.5 + 2 ** -9]), 2 ** -10).violations, 1)
})
