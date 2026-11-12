/** Conservative native Noise amplitudes; actual-mesh coordinates certify
 * the separate non-periodic lattice domain before normals can normalize. */
import type { BufferGeometry, Mesh } from 'three'
import { TslIrError, type TslIrExpression, type BuildTslOptions } from './tslNodeRecipe.js'
import type { NormalInputBounds } from './tslNormalInputBounds.js'

const fail = (message: string): never => {
  throw new TslIrError('Normal Map Noise ' + message)
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function normalizedNormalNoiseAmplitude(expression: TslIrExpression): NormalInputBounds {
  if (
    expression.op !== 'noise_normalized' ||
    expression.normalize !== true ||
    expression.noiseType !== 'FBM' ||
    expression.roughnessNode !== undefined ||
    !['native-standard-f32', 'mf-periodic-f32', 'eevee-metal-periodic-f32'].includes(
      String(expression.perlinModel),
    ) ||
    typeof expression.dimensions !== 'number' ||
    ![1, 2, 3, 4].includes(expression.dimensions) ||
    !['fac', 'color'].includes(String(expression.output))
  )
    fail('inputs require the verified static native normalized FBM model')
  for (const [key, low, high, fallback] of [
    ['detail', -16, 6, undefined],
    ['roughness', -16, 1, undefined],
    ['lacunarity', -2, 2, 2],
    ['distortion', -1, 1, 0],
  ] as const) {
    const value = expression[key] ?? fallback
    if (!finite(value) || value < low || value > high)
      fail('inputs exceed their verified finite static controls')
  }
  const scale = expression.scale as TslIrExpression | undefined
  if (scale?.op !== 'const_float' || !finite(scale.value) || Math.abs(scale.value) > 80)
    fail('inputs need finite static Scale within magnitude80')
  // Native gradient/scaling maxima2,1.9848,1.964,2.5032 leave float32
  // headroom within signed[-3,3]. Positive normalized octave weights and
  // the final .5 remap imply[-1,2], not a mathematically assumed[0,1].
  return [
    [-1.01, 2.01],
    [-1.01, 2.01],
    [-1.01, 2.01],
  ]
}

const noiseCache = new WeakMap<TslIrExpression, TslIrExpression[]>()
function noises(value: TslIrExpression): TslIrExpression[] {
  let result = noiseCache.get(value)
  if (result) return result
  result = []
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (!entry || typeof entry !== 'object') return
    if ((entry as TslIrExpression).op === 'noise_normalized') result!.push(entry as TslIrExpression)
    Object.entries(entry).forEach(([key, child]) => {
      if (!['pixels', 'values', 'colorOffsets', 'distortionOffsets'].includes(key)) visit(child)
    })
  }
  visit(value)
  noiseCache.set(value, result)
  return result
}

const positionCache = new WeakMap<
  BufferGeometry,
  { signature: unknown[]; ranges: NormalInputBounds }
>()
function objectRanges(mesh: Mesh, options: BuildTslOptions): NormalInputBounds {
  const attribute = mesh.geometry.getAttribute('position'),
    basis = options.objectSpace?.basis
  if (!attribute || !attribute.count || !['blender-z-up', 'gltf-y-up'].includes(String(basis)))
    return fail('coordinates need actual bound geometry and its explicit basis')
  const signature = [
    attribute,
    (attribute as any).version ?? (attribute as any).data?.version,
    basis,
  ]
  const previous = positionCache.get(mesh.geometry)
  if (previous && signature.every((value, index) => value === previous.signature[index]))
    return previous.ranges
  const ranges: NormalInputBounds = [
    [Infinity, -Infinity],
    [Infinity, -Infinity],
    [Infinity, -Infinity],
  ]
  for (let index = 0; index < attribute.count; index++) {
    const x = attribute.getX(index),
      y = attribute.getY(index),
      z = attribute.getZ(index)
    const point = basis === 'gltf-y-up' ? [x, -z, y] : [x, y, z]
    point.forEach((value, axis) => {
      if (!finite(value)) fail('coordinates have no actual finite range')
      ranges[axis]![0] = Math.min(ranges[axis]![0], value)
      ranges[axis]![1] = Math.max(ranges[axis]![1], value)
    })
  }
  positionCache.set(mesh.geometry, { signature, ranges })
  return ranges
}

function coordinates(
  expression: TslIrExpression | undefined,
  mesh: Mesh,
  options: BuildTslOptions,
): NormalInputBounds {
  if (!expression) return fail('coordinates have no actual finite range')
  const child = (key: string): NormalInputBounds =>
    coordinates(expression[key] as TslIrExpression, mesh, options)
  let result: NormalInputBounds
  switch (expression.op) {
    case 'const_float':
      result = [
        [expression.value, expression.value],
        [expression.value, expression.value],
        [expression.value, expression.value],
      ] as NormalInputBounds
      break
    case 'const_vec3':
      if (!Array.isArray(expression.value) || expression.value.length !== 3)
        return fail('coordinates have no actual finite range')
      result = expression.value.map((value) => [value, value]) as NormalInputBounds
      break
    case 'object_coords':
    case 'generated': {
      result = objectRanges(mesh, options)
      if (expression.op === 'generated') {
        const space = options.generatedTexspace
        if (!space || ![...space.location, ...space.size].every(finite))
          return fail('Generated coordinates need their actual exported finite texspace')
        result = result.map((pair, axis) => {
          const values = pair.map(
            (value) => (value - space.location[axis]!) / (2 * (space.size[axis] || 1)) + 0.5,
          )
          return [Math.min(...values), Math.max(...values)]
        }) as NormalInputBounds
      }
      break
    }
    case 'combine':
      result = ['x', 'y', 'z'].map((key) => child(key)[0]) as NormalInputBounds
      break
    case 'separate': {
      if (!['x', 'y', 'z'].includes(String(expression.channel)))
        return fail('coordinates need a known vector channel')
      const pair = child('input')[{ x: 0, y: 1, z: 2 }[expression.channel as 'x' | 'y' | 'z']]
      result = [pair, pair, pair]
      break
    }
    case 'vector_math': {
      if (!['ADD', 'SUBTRACT', 'MULTIPLY'].includes(String(expression.operation)))
        return fail('coordinates need proved object/generated or static coordinate arithmetic')
      const a = child('a'),
        b = child('b')
      result = a.map((pair, index) => {
        const values = pair.flatMap((x) =>
          b[index]!.map((y) =>
            expression.operation === 'ADD'
              ? x + y
              : expression.operation === 'SUBTRACT'
                ? x - y
                : x * y,
          ),
        )
        return [Math.min(...values), Math.max(...values)]
      }) as NormalInputBounds
      break
    }
    case 'vector_scale': {
      const scales = child('scale')
      result = child('input').map((pair, axis) => {
        const values = pair.flatMap((x) => scales[axis]!.map((y) => x * y))
        return [Math.min(...values), Math.max(...values)]
      }) as NormalInputBounds
      break
    }
    default:
      return fail('coordinates need proved object/generated or static coordinate arithmetic')
  }
  if (result.some((pair) => pair.some((value) => !finite(value) || Math.abs(value) > 1e20)))
    return fail('coordinates have no actual finite range')
  return result.map(([lo, hi]) => {
    const padding = Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -20
    return [lo - padding, hi + padding]
  }) as NormalInputBounds
}

function coordinateSlope(
  expression: TslIrExpression,
  mesh: Mesh,
  options: BuildTslOptions,
): number {
  const child = (key: string): number =>
    coordinateSlope(expression[key] as TslIrExpression, mesh, options)
  switch (expression.op) {
    case 'const_float':
    case 'const_vec3':
      return 0
    case 'object_coords':
      return 1
    case 'generated':
      return Math.max(
        ...options.generatedTexspace!.size.map((value, axis) => {
          const pair = objectRanges(mesh, options)[axis]!
          return pair[0] === pair[1] ? 0 : 1 / (2 * Math.abs(value || 1))
        }),
      )
    case 'combine':
      return Math.max(...['x', 'y', 'z'].map(child))
    case 'separate':
      return child('input')
    case 'vector_math':
      if (['ADD', 'SUBTRACT'].includes(String(expression.operation))) return child('a') + child('b')
      if (expression.operation !== 'MULTIPLY')
        return fail('coordinates have no proved affine frequency bound')
    case 'vector_scale': {
      const [a, b] = expression.op === 'vector_scale' ? ['input', 'scale'] : ['a', 'b']
      const magnitude = (key: string): number =>
        Math.max(
          ...coordinates(expression[key] as TslIrExpression, mesh, options)
            .flat()
            .map(Math.abs),
        )
      return magnitude(a!) * child(b!) + magnitude(b!) * child(a!)
    }
    default:
      return fail('coordinates have no proved affine frequency bound')
  }
}

export function validateNormalNoiseCoordinates(
  value: TslIrExpression,
  mesh: Mesh,
  options: BuildTslOptions,
): void {
  for (const expression of noises(value)) {
    normalizedNormalNoiseAmplitude(expression)
    const dimension = Number(expression.dimensions),
      ranges = coordinates(expression.input as TslIrExpression, mesh, options).slice(0, dimension)
    if (dimension === 4) ranges.push(coordinates(expression.w as TslIrExpression, mesh, options)[0])
    const slope = Math.max(
        coordinateSlope(expression.input as TslIrExpression, mesh, options),
        dimension === 4 ? coordinateSlope(expression.w as TslIrExpression, mesh, options) : 0,
      ),
      scale = Math.abs(Number((expression.scale as TslIrExpression).value))
    const ratio = Math.max(0, Number(expression.roughness)),
      count = Math.ceil(Math.max(0, Number(expression.detail)))
    let weights = 0,
      frequencies = 0
    for (let index = 0; index <= count; index++) {
      weights += ratio ** index
      frequencies += ratio ** index * Math.abs(Number(expression.lacunarity ?? 2)) ** index
    }
    if (
      slope &&
      (scale > 1 ||
        Number(expression.detail) > 2 ||
        Number(expression.distortion ?? 0) !== 0 ||
        scale * slope * Math.max(1, frequencies / weights) > 0.2500025)
    )
      fail(
        'live inputs need Scale magnitude<=1, Detail<=2, zero Distortion and actual coordinate frequency<=0.25; higher frequencies need native coordinate transport proof',
      )
    const input = Math.max(...ranges.flat().map(Math.abs))
    const offsets = (key: string, count: number): number => {
      const rows = expression[key]
      if (
        !Array.isArray(rows) ||
        rows.length !== count ||
        rows.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== dimension ||
            row.some((item) => !finite(item) || Math.abs(item) > 200.001),
        )
      )
        return fail('needs its exact finite seed-offset vectors')
      return Math.max(0, ...rows.flat().map(Math.abs))
    }
    const color = expression.output === 'color' ? offsets('colorOffsets', 2) : 0,
      distortion = Math.abs(Number(expression.distortion ?? 0)),
      distortionOffset =
        expression.distortion !== undefined ? offsets('distortionOffsets', dimension) : 0,
      scaled = input * scale,
      octave =
        Math.max(1, Math.abs(Number(expression.lacunarity ?? 2))) **
        (Math.ceil(Math.max(0, Number(expression.detail))) + 1)
    if (Math.max(scaled + distortionOffset, (scaled + 3 * distortion + color) * octave) >= 90000)
      fail('coordinates exceed the proved non-periodic native range below90000')
  }
}
