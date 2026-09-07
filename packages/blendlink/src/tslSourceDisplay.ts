/** OCIO typed operations lowered to TSL, without shader parsing or evaluation. */
import { Data3DTexture, DataTexture, FloatType, NearestFilter, RGBAFormat, Texture } from 'three'
import * as TSL from 'three/tsl'
import type { SourceDisplayOperation, SourceDisplayProgram } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

// Like the material IR builder, node types vary at runtime across operations.
const {
  abs,
  clamp,
  dot,
  float,
  floor,
  log,
  max,
  min,
  mix,
  pow,
  select,
  sign,
  texture3D,
  textureLoad,
  vec2,
  vec3,
  vec4,
} = TSL as unknown as {
  [
    K in
      | 'abs'
      | 'clamp'
      | 'dot'
      | 'float'
      | 'floor'
      | 'log'
      | 'max'
      | 'min'
      | 'mix'
      | 'pow'
      | 'select'
      | 'sign'
      | 'texture3D'
      | 'textureLoad'
      | 'vec2'
      | 'vec3'
      | 'vec4'
  ]: (...values: TslEffectNode[]) => TslEffectNode
}

function number(op: SourceDisplayOperation, key: string): number {
  const v = op[key]
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new Error(`Invalid OCIO ${op.type}.${key}`)
  return v
}

function array(op: SourceDisplayOperation, key: string, count: number): number[] {
  const v = op[key]
  if (
    !Array.isArray(v) ||
    v.length !== count ||
    v.some((x) => typeof x !== 'number' || !Number.isFinite(x))
  ) {
    throw new Error(`Invalid OCIO ${op.type}.${key}`)
  }
  return v as number[]
}

function values(op: SourceDisplayOperation, count: number): Float32Array {
  const buffer = op.values as { encoding?: string; count?: number; data?: string } | undefined
  if (
    buffer?.encoding !== 'base64-f32le' ||
    buffer.count !== count ||
    typeof buffer.data !== 'string'
  ) {
    throw new Error('Invalid OCIO LUT buffer')
  }
  const bytes = Uint8Array.from(atob(buffer.data), (c) => c.charCodeAt(0))
  if (bytes.length !== count * 4) throw new Error('Truncated OCIO LUT buffer')
  const view = new DataView(bytes.buffer)
  const rgba = new Float32Array((count / 3) * 4)
  for (let i = 0; i < count; i++) {
    const value = view.getFloat32(i * 4, true)
    if (!Number.isFinite(value)) throw new Error('Non-finite OCIO LUT sample')
    rgba[Math.floor(i / 3) * 4 + (i % 3)] = value
  }
  return rgba
}

function configure(texture: Texture, resources: Texture[]): void {
  texture.type = FloatType
  texture.format = RGBAFormat
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  resources.push(texture)
}

/** Transform straight RGB, then restore premultiplication for the canvas.
 * Alpha zero retains Blender's emissive RGB convention. The caller must
 * disable a second output transform. */
export function buildSourceDisplay(
  program: SourceDisplayProgram,
  input: TslEffectNode,
  options: {
    inputAlpha?: 'premultiplied' | 'straight'
  } = {},
): {
  node: TslEffectNode
  dispose(): void
} {
  if (
    program.version !== 1 ||
    program.outputDisplay !== 'sRGB' ||
    program.inputColorSpace !== 'Linear Rec.709'
  ) {
    throw new Error('Source display requires scene-linear Rec.709 input and an sRGB display.')
  }
  const resources: Texture[] = []
  try {
    const alphaScale =
      options.inputAlpha === 'straight' ? float(1) : select(input.a.equal(0), 1, input.a)
    let rgb = input.rgb.div(alphaScale)
    for (const op of program.ops) {
      const inverse = op.direction === 'TRANSFORM_DIR_INVERSE'
      if (!inverse && op.direction !== 'TRANSFORM_DIR_FORWARD')
        throw new Error('Invalid OCIO operation direction')
      switch (op.type) {
        case 'MatrixTransform': {
          if (inverse || op.matrixOrder !== 'row-major')
            throw new Error('Unsupported OCIO matrix order/direction')
          const m = array(op, 'matrix', 16),
            offset = array(op, 'offset', 4)
          const v = vec4(rgb, input.a)
          rgb = vec3(
            ...([0, 1, 2].map((row) =>
              dot(
                v,
                vec4(...(m.slice(row * 4, row * 4 + 4) as [number, number, number, number])),
              ).add(offset[row]!),
            ) as [TslEffectNode, TslEffectNode, TslEffectNode]),
          )
          break
        }
        case 'LogTransform': {
          const base = number(op, 'base')
          if (base <= 0 || base === 1) throw new Error('Invalid OCIO logarithm base')
          rgb = inverse
            ? pow(base, rgb)
            : log(max(rgb, number(op, 'minPositive'))).div(Math.log(base))
          break
        }
        case 'LogAffineTransform': {
          const base = number(op, 'base')
          if (base <= 0 || base === 1) throw new Error('Invalid OCIO logarithm base')
          const ls = vec3(...(array(op, 'logSideSlope', 3) as [number, number, number]))
          const lo = vec3(...(array(op, 'logSideOffset', 3) as [number, number, number]))
          const ns = vec3(...(array(op, 'linSideSlope', 3) as [number, number, number]))
          const no = vec3(...(array(op, 'linSideOffset', 3) as [number, number, number]))
          rgb = inverse
            ? pow(base, rgb.sub(lo).div(ls)).sub(no).div(ns)
            : log(max(rgb.mul(ns).add(no), number(op, 'minPositive')))
                .div(Math.log(base))
                .mul(ls)
                .add(lo)
          break
        }
        case 'ExponentTransform': {
          const exponents = array(op, 'value', 4).slice(0, 3)
          const exponent = vec3(
            ...(exponents.map((v) => (inverse ? 1 / v : v)) as [number, number, number]),
          )
          if (op.negativeStyle === 'NEGATIVE_CLAMP') rgb = pow(max(rgb, 0), exponent)
          else if (op.negativeStyle === 'NEGATIVE_MIRROR')
            rgb = pow(abs(rgb), exponent).mul(sign(rgb))
          else if (op.negativeStyle === 'NEGATIVE_PASS_THRU')
            rgb = vec3(
              ...['r', 'g', 'b'].map((c) =>
                select(rgb[c].lessThan(0), rgb[c], pow(max(rgb[c], 0), exponent[c])),
              ),
            )
          else
            throw new Error(`Unsupported OCIO exponent negative style ${String(op.negativeStyle)}`)
          break
        }
        case 'ExponentWithLinearTransform': {
          const gamma = array(op, 'gamma', 4),
            offset = array(op, 'offset', 4)
          if (op.negativeStyle !== 'NEGATIVE_LINEAR' && op.negativeStyle !== 'NEGATIVE_MIRROR')
            throw new Error('Unsupported OCIO linear exponent negative style')
          rgb = vec3(
            ...(['r', 'g', 'b'].map((channel, i) => {
              const g = gamma[i]!,
                a = offset[i]!,
                original = rgb[channel]
              if (g < 1 || a < 0) throw new Error('Unsupported OCIO linear exponent parameters')
              const x = op.negativeStyle === 'NEGATIVE_MIRROR' ? abs(original) : original
              let value: TslEffectNode
              if (g === 1) value = x
              else if (a === 0) value = pow(max(x, 0), inverse ? 1 / g : g)
              else {
                const b = Math.pow((g * a) / ((g - 1) * (1 + a)), g)
                const slope = a / (g - 1) / b
                value = inverse
                  ? select(
                      x.greaterThan(b),
                      pow(max(x, 0), 1 / g)
                        .mul(1 + a)
                        .sub(a),
                      x.mul(slope),
                    )
                  : select(
                      x.greaterThan(a / (g - 1)),
                      pow(max(x.add(a).div(1 + a), 0), g),
                      x.div(slope),
                    )
              }
              return op.negativeStyle === 'NEGATIVE_MIRROR' ? value.mul(sign(original)) : value
            }) as [TslEffectNode, TslEffectNode, TslEffectNode]),
          )
          break
        }
        case 'Lut1DTransform': {
          const n = number(op, 'length')
          if (
            inverse ||
            !Number.isInteger(n) ||
            n < 2 ||
            n > 1048576 ||
            !['INTERP_LINEAR', 'INTERP_DEFAULT'].includes(String(op.interpolation))
          )
            throw new Error('Unsupported OCIO 1D LUT')
          const width = Math.min(n, 256),
            height = Math.ceil(n / width)
          const padded = new Float32Array(width * height * 4)
          padded.set(values(op, n * 3))
          const texture = new DataTexture(padded, width, height)
          configure(texture, resources)
          const lookup = (index: TslEffectNode): TslEffectNode =>
            textureLoad(texture, vec2(index.mod(width), floor(index.div(width))))
          rgb = vec3(
            ...(['r', 'g', 'b'].map((c) => {
              const p = clamp(rgb[c], 0, 1).mul(n - 1),
                low = floor(p),
                high = min(low.add(1), n - 1)
              return mix(lookup(low)[c], lookup(high)[c], p.sub(low))
            }) as [TslEffectNode, TslEffectNode, TslEffectNode]),
          )
          break
        }
        case 'Lut3DTransform': {
          const n = number(op, 'size')
          if (
            inverse ||
            !Number.isInteger(n) ||
            n < 2 ||
            n > 128 ||
            op.interpolation !== 'INTERP_TETRAHEDRAL'
          )
            throw new Error('Unsupported OCIO 3D LUT')
          const texture = new Data3DTexture(values(op, n * n * n * 3), n, n, n)
          configure(texture, resources)
          const p = clamp(rgb, 0, 1).mul(n - 1),
            low = floor(p),
            f = p.sub(low)
          // Sort fractional axes; ties produce zero middle weights and are harmless.
          const first = select(
            f.r.greaterThanEqual(f.g).and(f.r.greaterThanEqual(f.b)),
            vec3(1, 0, 0),
            select(f.g.greaterThanEqual(f.b), vec3(0, 1, 0), vec3(0, 0, 1)),
          )
          const last = select(
            f.b.lessThanEqual(f.r).and(f.b.lessThanEqual(f.g)),
            vec3(0, 0, 1),
            select(f.g.lessThanEqual(f.r), vec3(0, 1, 0), vec3(1, 0, 0)),
          )
          const largest = max(f.r, max(f.g, f.b)),
            smallest = min(f.r, min(f.g, f.b))
          const middle = f.r.add(f.g).add(f.b).sub(largest).sub(smallest)
          const lookup = (point: TslEffectNode): TslEffectNode =>
            texture3D(texture).load(min(point, n - 1).zyx).rgb
          rgb = lookup(low)
            .mul(float(1).sub(largest))
            .add(lookup(low.add(first)).mul(largest.sub(middle)))
            .add(lookup(low.add(vec3(1).sub(last))).mul(middle.sub(smallest)))
            .add(lookup(low.add(1)).mul(smallest))
          break
        }
        default:
          throw new Error(`Unsupported OCIO operation ${op.type}`)
      }
      rgb = rgb.toVar()
    }
    return {
      node: vec4(rgb.mul(alphaScale), input.a),
      dispose: () => resources.forEach((resource) => resource.dispose()),
    }
  } catch (error) {
    resources.forEach((resource) => resource.dispose())
    throw error
  }
}
