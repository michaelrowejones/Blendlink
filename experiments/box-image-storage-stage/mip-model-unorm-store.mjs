// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2021 NVIDIA Corporation
// SPDX-FileCopyrightText: 2026 Blender Foundation
// Research model of the pinned Blender power-of-two mip reduction and
// SharedSRGB intermediate storage. No runtime admission or GPU proof.
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
export const f = Math.fround
export const decode = x => x < .04045 ? f(x / 12.92) : f(((x + .055) / 1.055) ** 2.4)
export const encode = x => x < .0031308 ? f(12.92 * x) : f(1.055 * x ** (1 / 2.4) - .055)
export const roundEven = x => { const n=Math.floor(x),r=x-n; return r===.5?(n%2===0?n:n+1):Math.round(x) }
// CPU typed-store hypothesis: retain the Float32 input, but avoid an
// extra Float32 rounding of the scaled conversion before quantization.
// Native imageStore itself delegates to typed texture.write; no explicit
// Float32 multiply-by-255 occurs in the source. This needs an independent
// typed-store oracle before any native-equivalence claim.
const byte = x => Math.max(0, Math.min(255, roundEven(x * 255)))
const norm = x => f(byte(x) / 255)
export function readRgb8Png(bytes) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    let width, height, channels, interlace, payload = []
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length)
        if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); channels = ({ 2: 3, 6: 4 })[data[9]]; assert.ok(channels); interlace = data[12]; assert.equal(interlace, 0) }
        if (type === 'IDAT') payload.push(data)
        offset += length + 12
    }
    const raw = inflateSync(Buffer.concat(payload)), stride = width * channels, pixels = new Uint8Array(width * height * 4)
    let previous = new Uint8Array(stride), offset = 0
    for (let y = 0; y < height; y++) {
        const filter = raw[offset++], row = new Uint8Array(stride)
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0
            const estimate = a + b - c, da = Math.abs(estimate - a), db = Math.abs(estimate - b), dc = Math.abs(estimate - c)
            const predictor = [0, a, b, (a + b) >> 1, da <= db && da <= dc ? a : db <= dc ? b : c][filter]; assert.notEqual(predictor, undefined)
            row[x] = raw[offset++] + predictor
        }
        for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) pixels[((height - 1 - y) * width + x) * 4 + channel] = channel === 3 && channels === 3 ? 255 : row[x * channels + channel]
        previous = row
    }
    assert.equal(offset, raw.length)
    return { width, height, pixels }
}
export function mipChain(image, srgb, sharedSrgb) {
    assert.equal(image.width, image.height); assert.equal(image.width & (image.width - 1), 0)
    let linear = Float32Array.from(image.pixels, (v, i) => srgb && i % 4 !== 3 ? decode(f(v / 255)) : f(v / 255)), size = image.width
    const levels = [{ size, linear }]
    for (let level = 1; size > 1; level++) {
        const nextSize = size >> 1, exact = new Float32Array(nextSize * nextSize * 4), stored = new Float32Array(exact.length)
        for (let y = 0; y < nextSize; y++) for (let x = 0; x < nextSize; x++) for (let c = 0; c < 4; c++) {
            const at = (xx, yy) => linear[(yy * size + xx) * 4 + c]
            const value = f(.5 * f(f(.5 * f(at(x * 2, y * 2) + at(x * 2, y * 2 + 1))) + f(.5 * f(at(x * 2 + 1, y * 2) + at(x * 2 + 1, y * 2 + 1)))))
            const index = (y * nextSize + x) * 4 + c; exact[index] = value
            stored[index] = srgb && c !== 3 ? decode(norm(encode(value))) : norm(value)
        }
        levels.push({ size: nextSize, linear: stored })
        // Native dispatches two levels together. Its SharedSRGB packs and
        // decodes ALL RGBA8 intermediates, including Non-Color images.
        linear = sharedSrgb && level % 2 === 1 ? Float32Array.from(exact, (v, i) => i % 4 === 3 ? norm(v) : decode(norm(encode(v)))) : stored
        size = nextSize
    }
    return levels
}
export function bilinear(level, u, v) {
    const { size, linear } = level, px = f(f(u * size) - .5), py = f(f(v * size) - .5), x = Math.floor(px), y = Math.floor(py), tx = px - x, ty = py - y
    const wrap = v => (v % size + size) % size
    return [0, 1, 2, 3].map(c => {
        const at = (xx, yy) => linear[(wrap(yy) * size + wrap(xx)) * 4 + c]
        return f((1 - tx) * ((1 - ty) * at(x, y) + ty * at(x, y + 1)) + tx * ((1 - ty) * at(x + 1, y) + ty * at(x + 1, y + 1)))
    })
}
