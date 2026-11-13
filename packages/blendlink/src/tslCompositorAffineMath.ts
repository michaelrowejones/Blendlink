/** CPU-side Float32 image-domain algebra. A matrix is row-major; physical image
 * dimensions stay separate from its location in virtual compositing space. */
export type CompositorAffineMatrix = readonly [number, number, number, number, number, number, number, number, number]
export interface ResolvedCompositorDomain {
  dataSize: readonly [number, number]
  displaySize: readonly [number, number]
  dataOffset: readonly [number, number]
  matrix: CompositorAffineMatrix
}
export const IDENTITY_COMPOSITOR_AFFINE: CompositorAffineMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const F = Math.fround, add = (a: number, b: number): number => F(a + b),
  sub = (a: number, b: number): number => F(a - b), mul = (a: number, b: number): number => F(a * b)

/** BLI's explicit scalar float3x3 operator*, not binary64 matrix algebra. */
export function multiplyCompositorAffine(a: CompositorAffineMatrix, b: CompositorAffineMatrix): CompositorAffineMatrix {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3), column = index % 3
    return add(add(mul(a[row * 3]!, b[column]!), mul(a[row * 3 + 1]!, b[column + 3]!)),
      mul(a[row * 3 + 2]!, b[column + 6]!))
  }) as unknown as CompositorAffineMatrix
}

/** BLI math::translate starts at the location, then adds each axis separately. */
export function translateCompositorAffine(a: CompositorAffineMatrix, x: number, y: number): CompositorAffineMatrix {
  const result = [...a]
  result[2] = add(add(a[2], mul(x, a[0])), mul(y, a[1]))
  result[5] = add(add(a[5], mul(x, a[3])), mul(y, a[4]))
  return result as unknown as CompositorAffineMatrix
}

/** Eigen's float3x3 cofactor/invdet path used by BLI math::invert. This seam
 * deliberately accepts affine matrices only; projective/degenerate windows
 * need a separate domain contract. */
export function invertCompositorAffine(a: CompositorAffineMatrix): CompositorAffineMatrix {
  if (a[6] !== 0 || a[7] !== 0 || a[8] !== 1 || a.some(value => !Number.isFinite(value)))
    throw new Error('Compositor image domains require a finite affine matrix')
  const determinant = sub(mul(a[0], a[4]), mul(a[3], a[1]))
  if (determinant === 0 || !Number.isFinite(determinant)) throw new Error('Compositor image domain matrix is singular')
  const reciprocal = F(1 / determinant)
  return [mul(a[4], reciprocal), mul(-a[1], reciprocal),
    mul(sub(mul(a[1], a[5]), mul(a[2], a[4])), reciprocal),
    mul(-a[3], reciprocal), mul(a[0], reciprocal),
    mul(sub(mul(a[2], a[3]), mul(a[0], a[5])), reciprocal), 0, 0, 1]
}

export function compositorAffinePoint(a: CompositorAffineMatrix, x: number, y: number): [number, number] {
  return [add(add(mul(a[0], x), mul(a[1], y)), a[2]), add(add(mul(a[3], x), mul(a[4], y)), a[5])]
}

/** RealizeOnDomainOperation: data→virtual centers, checked inverse, normalized
 * input size, and the output half-pixel translation, in native operation order. */
export function compositorAffineSamplingMatrix(from: ResolvedCompositorDomain, to: ResolvedCompositorDomain,
  nearest: boolean): CompositorAffineMatrix {
  const bias = nearest ? F(2 ** -23 * 10000) : 0
  const parity = (axis: number): number => nearest ? bias : (from.dataSize[axis]! ^ to.dataSize[axis]!) & 1 ? -.5 : 0
  const input = translateCompositorAffine(from.matrix,
    add(sub(from.dataOffset[0], F(from.displaySize[0] / 2)), parity(0)),
    add(sub(from.dataOffset[1], F(from.displaySize[1] / 2)), parity(1)))
  const output = translateCompositorAffine(to.matrix,
    sub(to.dataOffset[0], F(to.displaySize[0] / 2)), sub(to.dataOffset[1], F(to.displaySize[1] / 2)))
  const relative = multiplyCompositorAffine(invertCompositorAffine(input), output)
  const normalized: CompositorAffineMatrix = [F(1 / from.dataSize[0]), 0, 0, 0, F(1 / from.dataSize[1]), 0, 0, 0, 1]
  return multiplyCompositorAffine(multiplyCompositorAffine(normalized, relative), [1, 0, .5, 0, 1, .5, 0, 0, 1])
}

/** Domain::realize_transformation preserves translation but realizes the linear
 * part into its integer display/data bounding windows. Existing crop refusal
 * remains: callers must separately qualify nonzero source data offsets. */
export function realizeCompositorAffineDomain(domain: ResolvedCompositorDomain, translation: boolean): ResolvedCompositorDomain {
  const a = domain.matrix, outputMatrix: CompositorAffineMatrix = [1, 0, translation ? 0 : a[2], 0, 1, translation ? 0 : a[5], 0, 0, 1]
  if (Math.abs(a[0] - 1) <= 1e-5 && Math.abs(a[1]) <= 1e-5 && Math.abs(a[3]) <= 1e-5 && Math.abs(a[4] - 1) <= 1e-5)
    return { ...domain, matrix: outputMatrix }
  const linear: CompositorAffineMatrix = [a[0], a[1], 0, a[3], a[4], 0, 0, 0, 1]
  const centered = translateCompositorAffine(linear, -F(domain.displaySize[0] / 2), -F(domain.displaySize[1] / 2))
  const bounds = (minimum: readonly [number, number], size: readonly [number, number]): { min: [number, number], size: [number, number] } => {
    const points = [compositorAffinePoint(centered, minimum[0], minimum[1]),
      compositorAffinePoint(centered, minimum[0] + size[0], minimum[1]),
      compositorAffinePoint(centered, minimum[0], minimum[1] + size[1]),
      compositorAffinePoint(centered, minimum[0] + size[0], minimum[1] + size[1])]
    const min: [number, number] = [0, 0], extent: [number, number] = [0, 0]
    for (const axis of [0, 1]) {
      min[axis] = Math.floor(Math.min(...points.map(point => point[axis]!)))
      extent[axis] = Math.max(1, Math.ceil(Math.max(...points.map(point => point[axis]!))) - min[axis]!)
    }
    return { min, size: extent }
  }
  const display = bounds([0, 0], domain.displaySize), data = bounds(domain.dataOffset, domain.dataSize)
  return { matrix: outputMatrix, displaySize: display.size, dataSize: data.size,
    dataOffset: [data.min[0] - display.min[0], data.min[1] - display.min[1]] }
}
