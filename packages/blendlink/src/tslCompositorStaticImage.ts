import { DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat } from 'three'
import { Unzlib, unzlibSync } from 'three/addons/libs/fflate.module.js'
import * as TSL from 'three/tsl'
import type { SourceCompositorImage, SourceCompositorProgram } from './sourceDisplay.js'
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
function validateImage(record: SourceCompositorImage): void {
  const { width, height, decodedBytes, data } = record
  if (record.model !== 'native-cpu-static-image-v1' || record.encoding !== 'zlib-le-rgba32f'
    || !Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 1
    || Math.max(width, height) > 4096 || width * height > MAX_STATIC_IMAGE_PIXELS
    || decodedBytes !== width * height * 16 || typeof data !== 'string' || data.length % 4 !== 0
    || data.length < 12 || data.length > Math.ceil((decodedBytes + 65536) / 3) * 4)
    throw new Error('Static Image requires a bounded native CPU Float32 image payload')
}

function base64Bytes(data: string): Uint8Array {
  // Native conversion is available in newer browsers. The indexed fallback
  // avoids one JS callback and string iterator operation per compressed byte.
  const native = (Uint8Array as unknown as { fromBase64?: (data: string) => Uint8Array }).fromBase64
  if (native) return native(data)
  const binary = atob(data), encoded = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) encoded[index] = binary.charCodeAt(index)
  return encoded
}

export function decodeStaticCompositorImage(record: SourceCompositorImage): Float32Array {
  validateImage(record)
  const { decodedBytes, data } = record
  let raw: Uint8Array
  try {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid base64')
    const encoded = base64Bytes(data)
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
    for (let index = 0; index < values.length; index++) values[index] = view.getFloat32(index * 4, true)
  }
  for (let index = 0; index < values.length; index++)
    if (!Number.isFinite(values[index])) throw new Error('Static Image requires finite native Float32 pixels')
  return values
}

export interface PreparedStaticCompositorImages {
  readonly statistics: Readonly<{ images: number; bytes: number; yields: number; maximumSliceMilliseconds: number }>
  dispose(): void
}
export interface PrepareStaticCompositorImagesOptions {
  signal?: AbortSignal
  /** Default 4ms CPU slices; an individual bounded inflate chunk may overrun. */
  sliceMilliseconds?: number
  /** Must yield to another task, rather than only a microtask. */
  yieldControl?: () => Promise<void>
}
type ImageSnapshot = Pick<SourceCompositorImage, 'model' | 'encoding' | 'width' | 'height' | 'decodedBytes' | 'data'>
const imageKeys = ['model', 'encoding', 'width', 'height', 'decodedBytes', 'data'] as const
const preparations = new WeakMap<PreparedStaticCompositorImages, {
  program: SourceCompositorProgram
  images: Map<SourceCompositorImage, { snapshot: ImageSnapshot; pixels: Float32Array }>
}>()

/** Internal integrity boundary: a preparation cannot authorize changed bytes,
 * a different document, a disposed attempt or a fabricated public handle. */
export function assertPreparedStaticCompositorImages(handle: PreparedStaticCompositorImages, program: SourceCompositorProgram): void {
  const state = preparations.get(handle)
  if (state?.program !== program) throw new Error('Static Image preparation belongs to another compositor or is disposed')
  for (const op of program.ops) if (op.kind === 'image-input') {
    const id = op.properties.image_id, record = typeof id === 'string' ? program.images?.[id] : undefined
    const entry = record && state.images.get(record)
    if (!record || !entry || imageKeys.some(key => entry.snapshot[key] !== record[key]))
      throw new Error('Static Image preparation is stale; prepare the current pinned presentation again')
  }
}

/** Attempt-owned preparation; no global decoded-image cache and no IR edits.
 * The existing pinned presentation is decoded in bounded cooperative chunks.
 * Building textures keeps their arrays alive after this handle is disposed. */
export async function prepareStaticCompositorImages(
  program: SourceCompositorProgram,
  options: PrepareStaticCompositorImagesOptions = {},
): Promise<PreparedStaticCompositorImages> {
  const slice = options.sliceMilliseconds ?? 4
  if (!Number.isFinite(slice) || slice < .25 || slice > 8) throw new RangeError('Image preparation slice must be .25..8 milliseconds')
  const statistics = { images: 0, bytes: 0, yields: 0, maximumSliceMilliseconds: 0 }
  const images = new Map<SourceCompositorImage, { snapshot: ImageSnapshot; pixels: Float32Array }>()
  const handle: PreparedStaticCompositorImages = { statistics, dispose() { images.clear(); preparations.delete(handle) } }
  const signal = options.signal, yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  let started = performance.now()
  const checkpoint = async (force = false): Promise<void> => {
    signal?.throwIfAborted()
    const elapsed = performance.now() - started
    if (!force && elapsed < slice) return
    statistics.maximumSliceMilliseconds = Math.max(statistics.maximumSliceMilliseconds, elapsed)
    statistics.yields++
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true; signal?.removeEventListener('abort', onAbort)
        if (error !== undefined) reject(error); else resolve()
      }
      const onAbort = (): void => { try { signal?.throwIfAborted() } catch (error) { finish(error) } }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      try { Promise.resolve(yieldControl()).then(() => finish(), finish) } catch (error) { finish(error) }
    })
    signal?.throwIfAborted(); started = performance.now()
  }
  signal?.throwIfAborted()
  try {
    if (!Array.isArray(program.ops) || program.ops.length > 2048) throw new Error('Static Image preparation requires a bounded compositor graph')
    const records = new Set<SourceCompositorImage>()
    for (const op of program.ops) if (op.kind === 'image-input') {
      const id = op.properties.image_id, record = typeof id === 'string' ? program.images?.[id] : undefined
      if (!record) throw new Error('Static Image preparation requires its published image payload')
      records.add(record)
    }
    for (const record of records) {
      validateImage(record)
      statistics.bytes += record.decodedBytes
      if (statistics.bytes > MAX_STATIC_PROGRAM_PIXELS * 16) throw new Error('Static Image preparation exceeds the 8-megapixel program budget')
      const snapshot = Object.fromEntries(imageKeys.map(key => [key, record[key]])) as ImageSnapshot
      const { data, decodedBytes } = snapshot
      await checkpoint(true)
      const encoded = new Uint8Array(data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0))
      for (let offset = 0, output = 0; offset < data.length; offset += 32768) {
        const part = data.slice(offset, offset + 32768), last = offset + 32768 >= data.length
        if (!(last ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9+/]*$/).test(part)) throw new Error('Static Image invalid base64 payload')
        const chunk = base64Bytes(part)
        encoded.set(chunk, output); output += chunk.length
        await checkpoint()
      }
      const raw = new Uint8Array(decodedBytes)
      let written = 0, a = 1, b = 0
      const accept = (chunk: Uint8Array): void => {
        if (written + chunk.byteLength > decodedBytes) throw new Error('Static Image decoded size differs')
        raw.set(chunk, written); written += chunk.byteLength
        for (let offset = 0; offset < chunk.length; offset += 5552) {
          const end = Math.min(offset + 5552, chunk.length)
          for (let index = offset; index < end; index++) { a += chunk[index]!; b += a }
          a %= 65521; b %= 65521
        }
      }
      // Native streaming inflation still needs bounded input pulls: feeding a
      // whole Blob lets Chromium inflate it in one long main-thread task.
      // fflate remains the feature-detected fallback, with the same input cap.
      if (typeof DecompressionStream === 'function') {
        let offset = 0
        const source = new ReadableStream<BufferSource>({ async pull(controller) {
          signal?.throwIfAborted()
          if (offset === encoded.length) { controller.close(); return }
          controller.enqueue(encoded.subarray(offset, offset + 2048)); offset = Math.min(offset + 2048, encoded.length)
          await checkpoint()
        } })
        const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader()
        const cancel = (): void => { void reader.cancel(signal?.reason).catch(() => {}) }
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          while (true) {
            signal?.throwIfAborted()
            const next = await reader.read()
            signal?.throwIfAborted()
            if (next.done) break
            accept(next.value); await checkpoint()
          }
        } finally {
          signal?.removeEventListener('abort', cancel)
          await reader.cancel().catch(() => {}); reader.releaseLock()
        }
      } else {
        const inflate = new Unzlib(accept)
        // At most 2KiB compressed work per checkpoint bounds a single expand
        // even for highly compressible inputs; no whole-image JS task.
        for (let offset = 0; offset < encoded.length; offset += 2048) {
          inflate.push(encoded.subarray(offset, offset + 2048), offset + 2048 >= encoded.length)
          await checkpoint()
        }
      }
      const expected = new DataView(encoded.buffer).getUint32(encoded.length - 4)
      if (written !== decodedBytes || (((b << 16) | a) >>> 0) !== expected) throw new Error('Static Image decoded size/checksum differs')
      const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4
      const values = littleEndian ? new Float32Array(raw.buffer) : new Float32Array(decodedBytes / 4)
      const view = new DataView(raw.buffer)
      for (let offset = 0; offset < values.length; offset += 32768) {
        const end = Math.min(offset + 32768, values.length)
        for (let index = offset; index < end; index++) {
          if (!littleEndian) values[index] = view.getFloat32(index * 4, true)
          if (!Number.isFinite(values[index])) throw new Error('Static Image requires finite native Float32 pixels')
        }
        await checkpoint()
      }
      signal?.throwIfAborted()
      images.set(record, { snapshot, pixels: values }); statistics.images++
    }
    statistics.maximumSliceMilliseconds = Math.max(statistics.maximumSliceMilliseconds, performance.now() - started)
    preparations.set(handle, { program, images })
    return handle
  } catch (error) {
    handle.dispose(); signal?.throwIfAborted()
    throw new Error('Static Image preparation failed: ' + String(error))
  }
}

export function staticCompositorTexture(record: SourceCompositorImage,
  preparation?: { handle: PreparedStaticCompositorImages; program: SourceCompositorProgram },
): { texture: DataTexture; node: TslEffectNode } {
  const state = preparation && preparations.get(preparation.handle), entry = state?.images.get(record)
  if (preparation && (state?.program !== preparation.program || !entry
    || imageKeys.some(key => entry.snapshot[key] !== record[key])))
    throw new Error('Static Image preparation is stale, disposed or belongs to another compositor; prepare the current pinned presentation again')
  const texture = new DataTexture(entry?.pixels ?? decodeStaticCompositorImage(record), record.width, record.height, RGBAFormat, FloatType)
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
