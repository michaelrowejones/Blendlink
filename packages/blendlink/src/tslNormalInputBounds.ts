import { FloatType, NoColorSpace, RGBAFormat, UnsignedByteType, type Texture } from 'three'
import { TslIrError, type BuildTslOptions, type TslIrExpression } from './tslNodeRecipe.js'
import { normalizedNormalNoiseAmplitude } from './tslNormalNoiseBounds.js'

type Pair = [number, number]
export type NormalInputBounds = [Pair, Pair, Pair]
const fail = (): never => {
  throw new TslIrError(
    'Normal Map tangent input has no verified finite range; use supported bounded image/procedural inputs',
  )
}
const colorCache = new WeakMap<
  Texture,
  { signature: unknown[]; bounds: NormalInputBounds; alpha: Pair; opaque: boolean }
>()
const embeddedCache = new WeakMap<
  TslIrExpression,
  { pixels: unknown; data: ReturnType<typeof pixelBounds> }
>()

/** A new shader build allocates a new immutable copy of embedded pixels.
 * Draw-time checks reuse that copy's ranges instead of scanning a table. */
export function refreshNormalInputBounds(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(refreshNormalInputBounds)
    return
  }
  if (!value || typeof value !== 'object') return
  if ((value as TslIrExpression).op === 'tex_image') embeddedCache.delete(value as TslIrExpression)
  Object.values(value).forEach(refreshNormalInputBounds)
}

function pixelBounds(
  values: ArrayLike<number>,
  scale: number,
): { bounds: NormalInputBounds; alpha: Pair; opaque: boolean } {
  if (!values.length || values.length % 4) fail()
  const all: [Pair, Pair, Pair, Pair] = [
    [Infinity, -Infinity],
    [Infinity, -Infinity],
    [Infinity, -Infinity],
    [Infinity, -Infinity],
  ]
  for (let offset = 0; offset < values.length; offset++) {
    const value = values[offset]! / scale
    if (!Number.isFinite(value)) fail()
    const range = all[offset % 4]!
    range[0] = Math.min(range[0], value)
    range[1] = Math.max(range[1], value)
  }
  return {
    bounds: all.slice(0, 3) as NormalInputBounds,
    alpha: all[3],
    opaque: all[3][0] === 1 && all[3][1] === 1,
  }
}

function textureBounds(texture: Texture, alpha: boolean): NormalInputBounds {
  const image = texture.image as
    | { data?: ArrayLike<number>; width?: number; height?: number }
    | undefined
  const width = image?.width,
    height = image?.height
  if (
    !image ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width! < 1 ||
    height! < 1 ||
    width! * height! > 4096 * 4096 ||
    texture.format !== RGBAFormat
  )
    throw new TslIrError(
      'Normal Map tangent image-range inspection needs actual RGBA pixels within its 16-million-pixel budget',
    )
  if (!alpha && texture.colorSpace !== NoColorSpace)
    throw new TslIrError('Normal Map tangent external Color currently needs non-color image data')
  const signature = [
    image,
    image.data,
    texture.version,
    texture.source.version,
    texture.type,
    texture.colorSpace,
  ]
  let previous = colorCache.get(texture)
  if (!previous || !signature.every((value, index) => value === previous!.signature[index])) {
    let values: ArrayLike<number>, scale: number
    if (image.data) {
      if (image.data.length !== width! * height! * 4) fail()
      if (
        texture.type === UnsignedByteType &&
        (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
      )
        scale = 255
      else if (texture.type === FloatType && image.data instanceof Float32Array) scale = 1
      else
        throw new TslIrError(
          'Normal Map tangent range proof needs actual decoded byte/float RGBA texture data',
        )
      values = image.data
    } else {
      // Default verified image transport uses an immutable ImageBitmap.
      // Opaque non-color RGB and alpha survive this byte readback; associated
      // RGB with non-unit alpha is refused below rather than inventing data.
      const canvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width!, height!)
          : typeof document === 'object'
            ? Object.assign(document.createElement('canvas'), { width: width!, height: height! })
            : null
      const context = canvas?.getContext('2d', {
        willReadFrequently: true,
        colorSpace: 'srgb',
      }) as OffscreenCanvasRenderingContext2D | null
      if (!canvas || !context)
        throw new TslIrError(
          'Normal Map tangent image bounds need a readable decoded image; provide an actual data-texture decoder',
        )
      try {
        context.drawImage(image as CanvasImageSource, 0, 0)
        values = context.getImageData(0, 0, width!, height!).data
      } catch {
        throw new TslIrError(
          'Normal Map tangent could not independently inspect its decoded image pixels',
        )
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
      scale = 255
    }
    previous = { signature, ...pixelBounds(values, scale) }
    colorCache.set(texture, previous)
  }
  if (alpha) return [previous.alpha, previous.alpha, previous.alpha]
  if (!previous.opaque)
    throw new TslIrError(
      'Normal Map tangent Color currently needs opaque image data; alpha association needs its own range proof',
    )
  return previous.bounds
}

export function normalInputBounds(
  expression: TslIrExpression | undefined,
  options: BuildTslOptions,
): NormalInputBounds {
  if (!expression) return fail()
  const child = (key: string): NormalInputBounds =>
    normalInputBounds(expression[key] as TslIrExpression, options)
  let result: NormalInputBounds
  switch (expression.op) {
    case 'const_float':
      result = Array.from({ length: 3 }, () => [
        expression.value,
        expression.value,
      ]) as NormalInputBounds
      break
    case 'const_vec3':
      if (!Array.isArray(expression.value) || expression.value.length !== 3) return fail()
      result = expression.value.map((value) => [value, value]) as NormalInputBounds
      break
    case 'combine':
      result = ['x', 'y', 'z'].map((key) => child(key)[0]) as NormalInputBounds
      break
    case 'separate': {
      if (!['x', 'y', 'z'].includes(String(expression.channel))) fail()
      const pair = child('input')[{ x: 0, y: 1, z: 2 }[expression.channel as 'x' | 'y' | 'z']]
      result = [pair, pair, pair]
      break
    }
    case 'color_convert':
      if (expression.mode !== 'RGB') return fail()
      result = child('input')
      break
    case 'rgb_to_bw': {
      const incoming = child('input'),
        lo = Math.min(...incoming.map((pair) => pair[0])),
        hi = Math.max(...incoming.map((pair) => pair[1])),
        padding = Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -22,
        pair: Pair = [lo - padding, hi + padding]
      result = [pair, pair, pair]
      break
    }
    case 'tex_image': {
      if (expression.sourceImageStorage !== 'rgba8' || !Array.isArray(expression.pixels))
        throw new TslIrError('Normal Map tangent embedded image ranges currently need byte storage')
      let cached = embeddedCache.get(expression)
      if (!cached || cached.pixels !== expression.pixels) {
        cached = { pixels: expression.pixels, data: pixelBounds(expression.pixels, 1) }
        embeddedCache.set(expression, cached)
      }
      const data = cached.data
      if (expression.output === 'alpha') result = [data.alpha, data.alpha, data.alpha]
      else {
        if (!data.opaque)
          throw new TslIrError('Normal Map tangent Color currently needs opaque image data')
        result = data.bounds
      }
      if (expression.extension === 'CLIP')
        result = result.map(([lo, hi]) => [Math.min(0, lo), Math.max(0, hi)]) as NormalInputBounds
      break
    }
    case 'texture_ref': {
      const ref = expression.ref
      const resolver = options.textures
      if (!ref || typeof ref !== 'object' || !resolver) return fail()
      const texture = resolver(ref as Record<string, unknown>) as Texture | null
      const descriptor = expression.image as Record<string, unknown> | undefined
      const image = texture?.image as { width?: number; height?: number } | undefined
      if (
        !texture?.isTexture ||
        image?.width !== descriptor?.width ||
        image?.height !== descriptor?.height
      )
        throw new TslIrError(
          'Normal Map tangent external image range proof needs actual pinned decoded dimensions',
        )
      result = textureBounds(texture, expression.output === 'alpha')
      break
    }
    case 'noise_normalized':
      result = normalizedNormalNoiseAmplitude(expression)
      break
    case 'tex_checker':
      result =
        expression.output === 'fac'
          ? [
              [0, 1],
              [0, 1],
              [0, 1],
            ]
          : (child('color1').map((a, index) => {
              const b = child('color2')[index]!
              return [Math.min(a[0], b[0]), Math.max(a[1], b[1])]
            }) as NormalInputBounds)
      break
    case 'mix_color': {
      if (expression.blendType !== 'MIX' || expression.clampFactor === false) fail()
      child('factor')
      const a = child('a'),
        b = child('b')
      result = a.map((pair, index) => [
        Math.min(pair[0], b[index]![0]),
        Math.max(pair[1], b[index]![1]),
      ]) as NormalInputBounds
      result = result.map(([lo, hi]) => {
        const padding = Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -22
        return expression.clampResult === true
          ? [Math.max(0, Math.min(1, lo - padding)), Math.max(0, Math.min(1, hi + padding))]
          : [lo - padding, hi + padding]
      }) as NormalInputBounds
      break
    }
    case 'math': {
      const operation = expression.operation
      if (!['ADD', 'SUBTRACT', 'MULTIPLY', 'MINIMUM', 'MAXIMUM'].includes(String(operation))) fail()
      const a = child('a'),
        b = child('b')
      result = a.map((pair, index) => {
        const values = pair.flatMap((x) =>
            b[index]!.map((y) =>
              operation === 'ADD'
                ? x + y
                : operation === 'SUBTRACT'
                  ? x - y
                  : operation === 'MULTIPLY'
                    ? x * y
                    : operation === 'MINIMUM'
                      ? Math.min(x, y)
                      : Math.max(x, y),
            ),
          ),
          lo = Math.min(...values),
          hi = Math.max(...values),
          padding = Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -22
        return [lo - padding, hi + padding]
      }) as NormalInputBounds
      break
    }
    case 'clamp01':
      child('input')
      result = [
        [0, 1],
        [0, 1],
        [0, 1],
      ]
      break
    default:
      return fail()
  }
  if (
    result.some((pair) =>
      pair.some(
        (value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 16,
      ),
    )
  )
    fail()
  return result
}

export function normalMapCoefficientBounds(
  color: TslIrExpression,
  strength: TslIrExpression,
  convention: unknown,
  options: BuildTslOptions,
): { minimum: number; maximum: number } {
  const rgb = normalInputBounds(color, options),
    s = normalInputBounds(strength, options)[0],
    decoded = rgb.map(([lo, hi]) => [2 * lo - 1, 2 * hi - 1] as Pair)
  if (convention === 'DIRECTX') decoded[1] = [-decoded[1]![1], -decoded[1]![0]]
  const result: Pair[] = decoded.slice(0, 2).map((pair) => {
    const values = pair.flatMap((value) => s.map((amount) => value * amount))
    return [Math.min(...values), Math.max(...values)]
  })
  const values = decoded[2]!.flatMap((value) =>
    s.map((amount) => 1 + (value - 1) * Math.max(0, Math.min(1, amount))),
  )
  result.push([Math.min(...values), Math.max(...values)])
  const expanded = result.map(([lo, hi]) => {
    const padding = Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -21
    return [lo - padding, hi + padding] as Pair
  })
  const minimum = Math.hypot(...expanded.map(([lo, hi]) => (lo > 0 ? lo : hi < 0 ? -hi : 0))),
    maximum = expanded.reduce((sum, [lo, hi]) => sum + Math.max(Math.abs(lo), Math.abs(hi)), 0)
  if (minimum <= 0)
    throw new TslIrError('Normal Map tangent input ranges cannot certify a nonzero native normal')
  return { minimum, maximum }
}
