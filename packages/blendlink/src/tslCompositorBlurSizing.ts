/** Float32 algebra shared by the bounded legacy relative Blur implementation.
 * Native sources: COM_BlurBaseOperation::init_data, BlurOperation::compute_blur_radius,
 * RE_filter_value and make_gausstab / SymmetricSeparableBlurWeights. */
const f = Math.fround
const add = (a: number, b: number): number => f(a + b)
const sub = (a: number, b: number): number => f(a - b)
const mul = (a: number, b: number): number => f(a * b)
const div = (a: number, b: number): number => f(a / b)

export interface RelativeBlurSettings {
  percent: [number, number]
  aspect: 'NONE' | 'X' | 'Y'
  multiplier: number
  legacyCpu: boolean
}

export function relativeBlurRadii(settings: RelativeBlurSettings, width: number, height: number): [number, number] {
  const extent = settings.aspect === 'X' ? [height, height] : settings.aspect === 'Y' ? [width, width] : [width, height]
  return extent.map((dimension, axis) => {
    const percent = f(settings.percent[axis]!)
    if (settings.legacyCpu) {
      // Native round_fl_to_int adds .5 in float32 before floorf. CPU rounds
      // the percentage radius before multiplying by the Size socket.
      const base = Math.floor(add(mul(mul(percent, f(.01)), f(dimension)), f(.5)))
      return mul(f(settings.multiplier), base)
    }
    // GPU divides percent by100, multiplies extent, then the clamped Size.
    return mul(mul(f(dimension), div(percent, f(100))), f(settings.multiplier))
  }) as [number, number]
}

function polynomialFilter(kind: string, coordinate: number): number {
  let x = f(Math.abs(coordinate))
  if (kind === 'Flat') return x <= 1 ? 1 : 0
  if (kind === 'Tent') return x <= 1 ? sub(1, x) : 0
  x = mul(x, f(1.6))
  const x2 = mul(x, x)
  if (kind === 'Quadratic') return x < .5 ? sub(f(.75), x2)
    : x < 1.5 ? mul(mul(f(.5), sub(x, f(1.5))), sub(x, f(1.5))) : 0
  if (kind === 'Cubic') return x < 1 ? add(sub(mul(mul(f(.5), x), x2), x2), div(2, 3))
    : x < 2 ? div(mul(mul(sub(2, x), sub(2, x)), sub(2, x)), 6) : 0
  if (kind === 'Catrom') return x < 1 ? add(sub(mul(mul(f(1.5), x2), x), mul(f(2.5), x2)), 1)
    : x < 2 ? add(sub(add(mul(mul(f(-.5), x2), x), mul(f(2.5), x2)), mul(4, x)), 2) : 0
  if (kind === 'Mitch') {
    const b = div(1, 3), c = b
    const p0 = div(sub(6, mul(2, b)), 6)
    const p2 = div(add(add(-18, mul(12, b)), mul(6, c)), 6)
    const p3 = div(sub(sub(12, mul(9, b)), mul(6, c)), 6)
    const q0 = div(add(mul(8, b), mul(24, c)), 6)
    const q1 = div(sub(mul(-12, b), mul(48, c)), 6)
    const q2 = div(add(mul(6, b), mul(30, c)), 6)
    const q3 = div(sub(-b, mul(6, c)), 6)
    return x < 1 ? add(p0, mul(x2, add(p2, mul(x, p3))))
      : x < 2 ? add(q0, mul(x, add(q1, mul(x, add(q2, mul(x, q3)))))) : 0
  }
  throw new Error('Relative Blur has no verified portable filter ' + kind)
}

export function relativeBlurWeights(kind: string, radius: number, legacyCpu: boolean): number[] {
  if (!Number.isFinite(radius) || radius < 0 || radius > 128)
    throw new Error('Relative Blur requires resolved radii between 0 and 128 pixels per axis')
  const count = Math.ceil(radius), scale = radius > 0 ? div(1, radius) : 0
  if (legacyCpu) {
    const raw = Array.from({ length: count * 2 + 1 }, (_, i) => polynomialFilter(kind, mul(i - count, scale)))
    const inverse = div(1, raw.reduce((sum, weight) => add(sum, weight), 0))
    return raw.slice(count).map(weight => mul(weight, inverse))
  }
  const raw = Array.from({ length: count + 1 }, (_, i) => polynomialFilter(kind, mul(i, scale)))
  let total = raw[0]!
  for (const weight of raw.slice(1)) total = add(total, mul(weight, 2))
  return raw.map(weight => div(weight, total))
}
