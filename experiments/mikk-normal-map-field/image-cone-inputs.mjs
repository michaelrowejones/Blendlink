// SPDX-License-Identifier: MIT
// CPU statistics only. Higher mip levels below are modeled, not native observations.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readRgb8Png, mipChain } from '../box-image-storage-stage/mip-model-unorm-store.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const input = '/tmp/scenetoweb-box-storage-native-r3/Plaster-normal.png'
const bytes = readFileSync(input)
assert.equal(sha(bytes), '4effabbaf2127fb1639af151bd1dc64a3ad8d73c5e7fbc9dd6436c13e1724b55')
const image = readRgb8Png(bytes)
const levels = mipChain(image, false, true).map(({ size, linear }, level) => {
    const minimum = [Infinity, Infinity, Infinity, Infinity], maximum = minimum.map(() => -Infinity)
    const blueMinimumByRed = Array(256).fill(null)
    let qzMinusAbsQxMinimum = Infinity
    for (let i = 0; i < linear.length; i += 4) {
        for (let c = 0; c < 4; c++) { minimum[c] = Math.min(minimum[c], linear[i+c]); maximum[c] = Math.max(maximum[c], linear[i+c]) }
        const red = Math.round(linear[i] * 255), blue = Math.round(linear[i+2] * 255)
        assert.equal(linear[i], Math.fround(red / 255)); assert.equal(linear[i+2], Math.fround(blue / 255))
        blueMinimumByRed[red] = Math.min(blueMinimumByRed[red] ?? Infinity, blue)
        qzMinusAbsQxMinimum = Math.min(qzMinusAbsQxMinimum, 2 * linear[i+2] - 1 - Math.abs(2 * linear[i] - 1))
    }
    return { level, size, rgbaMinimum: minimum, rgbaMaximum: maximum, qzMinusAbsQxMinimum, blueMinimumByRed,
        pixelSha256: sha(Buffer.from(linear.buffer)), evidence: level === 0 ? 'EXACT_PNG_RGBA8_FLOAT32_DECODE' : 'SOURCE_SPECIALIZED_CPU_MIP_MODEL_NOT_NATIVE_ORACLE' }
})
const model = new URL('../box-image-storage-stage/mip-model-unorm-store.mjs', import.meta.url)
const observation = '/tmp/scenetoweb-box-storage-native-r3/texture-observations.json'
const observed = JSON.parse(readFileSync(observation)).textures.find(row => row.image === 'Plaster-normal.png')
assert.equal(observed.gpuFormat, 'RGBA8'); assert.equal(observed.colorSpace, 'Non-Color')
writeFileSync(process.argv[2], JSON.stringify({ status: 'CPU_IMAGE_STATISTICS_NO_QUALIFICATION', supportCredit: 0,
    image: { path: input, sha256: sha(bytes), width: image.width, height: image.height, colorSpace: 'Non-Color', nativeObservedFormat: 'RGBA8' },
    sourceObservation: { path: observation, sha256: sha(readFileSync(observation)),
        warning: 'Its level>0 fetch rows are invalid mip oracles; only the image format metadata is used here.' },
    producerSha256: sha(readFileSync(new URL(import.meta.url))), modelSha256: sha(readFileSync(model)), levels }, null, 2) + '\n')
