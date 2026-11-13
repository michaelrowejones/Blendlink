import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat } from 'three'
import { unzlibSync } from 'three/addons/libs/fflate.module.js'
import * as TSL from 'three/tsl'
import type { SourceCompositorImage } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorAffineSamplingMatrix, IDENTITY_COMPOSITOR_AFFINE } from './tslCompositorAffineMath.js'

export const MAX_STATIC_IMAGE_PIXELS = 2048 * 2048
export const MAX_STATIC_PROGRAM_PIXELS = 2 * MAX_STATIC_IMAGE_PIXELS
export interface StaticCompositorWindow {
  width: number
  height: number
  model: 'legacy-cpu-even-v1' | 'modern-cpu-v1'
}
const { ivec2, textureLoad, uv, vec2 } = TSL as unknown as Record<
  'ivec2' | 'textureLoad' | 'uv' | 'vec2', (...args: TslEffectNode[]) => TslEffectNode>

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(start + 5552, bytes.length)
    for (let index = start; index < end; index++) { a += bytes[index]!; b += a }
    a %= 65521; b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Decode only the compiler's bounded lossless Float32 payload. The enclosing
 * presentation asset is pinned before parsing; no browser image/color decode
 * reinterprets Blender's associated or data-color pixels. */
export function decodeStaticCompositorImage(record: SourceCompositorImage): Float32Array {
  const { width, height, decodedBytes, data } = record
  if (record.model !== 'native-cpu-static-image-v1' || record.encoding !== 'zlib-le-rgba32f'
    || !Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 1
    || Math.max(width, height) > 4096 || width * height > MAX_STATIC_IMAGE_PIXELS
    || decodedBytes !== width * height * 16 || typeof data !== 'string' || data.length % 4 !== 0
    || data.length < 12 || data.length > Math.ceil((decodedBytes + 65536) / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new Error('Static Image requires a bounded native CPU Float32 image payload')
  let raw: Uint8Array
  try {
    const binary = atob(data), encoded = Uint8Array.from(binary, value => value.charCodeAt(0))
    // One spare byte distinguishes oversized decoded streams without an
    // unbounded allocation. Short streams retain their real output length.
    raw = unzlibSync(encoded, { out: new Uint8Array(decodedBytes + 1) })
    const checksum = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(encoded.byteLength - 4)
    if (raw.byteLength !== decodedBytes || adler32(raw) !== checksum) throw new Error('Decoded size/checksum differs')
  } catch (error) {
    throw new Error('Static Image lossless input decode failed: ' + String(error))
  }
  const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4
  const values = littleEndian ? new Float32Array(raw.buffer, raw.byteOffset, decodedBytes / 4) : new Float32Array(decodedBytes / 4)
  if (!littleEndian) {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    values.forEach((_, index) => { values[index] = view.getFloat32(index * 4, true) })
  }
  if (values.some(value => !Number.isFinite(value))) throw new Error('Static Image requires finite native Float32 pixels')
  return values
}

export function staticCompositorTexture(record: SourceCompositorImage): { texture: DataTexture; node: TslEffectNode } {
  const texture = new DataTexture(decodeStaticCompositorImage(record), record.width, record.height, RGBAFormat, FloatType)
  texture.colorSpace = NoColorSpace
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false; texture.flipY = false; texture.unpackAlignment = 1; texture.needsUpdate = true
  return { texture, node: textureLoad(texture, ivec2(uv().mul(vec2(record.width, record.height)))) }
}

/** Independently rounded native CPU pixel coordinates for terminal finite
 * windows. Unequal modern windows preserve RealizeOnDomain's parity fix and
 * floor(f32(coordinate+1)) neighbor, including its near-zero boundary cases. */
export function staticImageAxisMappings(from: StaticCompositorWindow, width: number, height: number): [Float32Array, Float32Array] {
  if (!['modern-cpu-v1', 'legacy-cpu-even-v1'].includes(from.model)
    || ![from.width, from.height, width, height].every(size => Number.isInteger(size) && size >= 1 && size <= 8192))
    throw new Error('Static Image realization requires verified finite image/render extents within 1..8192')
  const legacy = from.model === 'legacy-cpu-even-v1'
  if (legacy && [from.width, from.height, width, height].some(size => size % 2 !== 0))
    throw new Error('Legacy CPU Static Image preview currently requires even source and drawing-buffer dimensions; odd native windows remain unqualified')
  const equal = width === from.width && height === from.height, f = Math.fround
  const domain = (size: readonly [number, number]) => ({ dataSize: size, displaySize: size,
    dataOffset: [0, 0] as const, matrix: IDENTITY_COMPOSITOR_AFFINE })
  const m = compositorAffineSamplingMatrix(domain([from.width, from.height]), domain([width, height]), false)
  return ([width, height] as const).map((size, axis) => {
    const inputSize = axis === 0 ? from.width : from.height
    const result = new Float32Array(size * 4)
    for (let index = 0; index < size; index++) {
      const coordinate = equal || legacy ? index - (size - inputSize) / 2
        : f(f(f(f(m[axis === 0 ? 0 : 4] * index) + m[axis === 0 ? 2 : 5]) * inputSize) - .5)
      const low = Math.floor(coordinate), high = equal || legacy ? low : Math.floor(f(coordinate + 1))
      result.set([low, high, equal || legacy ? 0 : f(coordinate - low), 1], index * 4)
    }
    return result
  }) as [Float32Array, Float32Array]
}
