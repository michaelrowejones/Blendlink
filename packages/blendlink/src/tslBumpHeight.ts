import { irInspectionChildren } from './tslIrInspection.js'
/** Bounded EEVEE affine-UV Height, guarded against the actual mesh and view. */
import { Matrix3, Vector3, Vector4, type Mesh, type Camera } from 'three'
import { float, Fn, frontFacing, max, mix, select, uniform, uv, vec3 } from 'three/tsl'
import {
  buildGeometryContext,
  validateGeometryContextBinding,
  validateGeometryContextCamera,
} from './tslGeometryContext.js'
import {
  TslIrError,
  type BuildTslOptions,
  type TslExpression,
  type TslIrExpression,
} from './tslNodeRecipe.js'

type Range = readonly [number, number]
type Coefficients = readonly [number, number, number]
type Analysis = { coefficients: Coefficients; range: Range; varying: boolean; rounding: number }
const fail = (message: string): never => {
  throw new TslIrError('Bump Height ' + message)
}

/** Input widths are Float32 and bounded [.1,10]. Multiplication by at most
 * 1e6 is exact in binary64, so this reproduces C's 6-digit ties-to-even %g. */
export function nativeBumpOffsetWidth(width: number): number {
  if (!Number.isFinite(width) || width < 0.1 || width > 10 || Math.fround(width) !== width)
    return fail('needs an actual finite Float32 Filter Width within [.1,10]')
  const scale = 10 ** (5 - Math.floor(Math.log10(width)))
  const scaled = width * scale,
    lower = Math.floor(scaled),
    fraction = scaled - lower
  const rounded =
    fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1
  return Math.fround(rounded / scale)
}

export function analyseBumpHeight(
  expression: TslIrExpression,
  uvBounds?: readonly [Range, Range],
): Analysis & { uv: TslIrExpression | null } {
  let count = 0,
    uv: TslIrExpression | null = null
  const walk = (value: unknown, depth = 0): Analysis => {
    if (++count > 63 || depth > 8 || !value || typeof value !== 'object' || Array.isArray(value))
      return fail('exceeds the verified affine expression budget')
    const node = value as TslIrExpression
    if (node.op === 'const_float') {
      if (
        typeof node.value !== 'number' ||
        !Number.isFinite(node.value) ||
        Math.abs(node.value) > 1
      )
        return fail('needs finite literal controls within [-1,1]')
      return {
        coefficients: [0, 0, node.value],
        range: [node.value, node.value],
        varying: false,
        rounding: 0,
      }
    }
    if (node.op === 'separate' && ['x', 'y'].includes(String(node.channel))) {
      const source = node.input as TslIrExpression | undefined
      if (
        !source ||
        !(
          (source.op === 'uv_active' && source.uvMap === undefined) ||
          (source.op === 'uv' && typeof source.uvMap === 'string' && source.uvMap)
        )
      )
        return fail('needs an actual active-render or named UV binding')
      if (uv && (uv.op !== source.op || uv.uvMap !== source.uvMap))
        return fail('currently needs one shared UV source')
      uv = source
      const axis = node.channel === 'x' ? 0 : 1
      return {
        coefficients: axis === 0 ? [1, 0, 0] : [0, 1, 0],
        range: uvBounds?.[axis] ?? [-2, 2],
        varying: true,
        rounding: Math.max(...(uvBounds?.[axis] ?? [-2, 2]).map(Math.abs)) + 2,
      }
    }
    if (node.op !== 'math' || !['ADD', 'SUBTRACT', 'MULTIPLY'].includes(String(node.operation)))
      return fail('currently supports affine UV Add/Subtract/Multiply only')
    const a = walk(node.a, depth + 1),
      b = walk(node.b, depth + 1)
    if (!a.varying && !b.varying)
      return fail('constant math needs separate native constant-folding proof')
    let coefficients: Coefficients, range: Range
    if (node.operation === 'MULTIPLY') {
      if (a.varying && b.varying) return fail('multiplication must have one literal scalar operand')
      if ((a.varying ? node.b : (node.a as any))?.op !== 'const_float')
        return fail('multiplication needs its actual literal scalar factor')
      const factor = (a.varying ? b : a).coefficients[2]
      coefficients = (a.varying ? a : b).coefficients.map(
        (value) => value * factor,
      ) as unknown as Coefficients
      const values = a.range.flatMap((x) => b.range.map((y) => x * y))
      range = [Math.min(...values), Math.max(...values)]
    } else {
      const sign = node.operation === 'ADD' ? 1 : -1
      coefficients = a.coefficients.map(
        (value, index) => value + sign * b.coefficients[index]!,
      ) as unknown as Coefficients
      range =
        sign === 1
          ? [a.range[0] + b.range[0], a.range[1] + b.range[1]]
          : [a.range[0] - b.range[1], a.range[1] - b.range[0]]
    }
    if (Math.max(...coefficients.slice(0, 2).map(Math.abs)) > 1)
      return fail('affine UV slopes exceed magnitude one')
    if (uvBounds && Math.max(...range.map(Math.abs)) > 4)
      return fail('intermediate range exceeds the verified finite domain')
    const rounding =
      (node.operation === 'MULTIPLY'
        ? a.varying
          ? a.rounding * Math.abs(b.coefficients[2])
          : b.rounding * Math.abs(a.coefficients[2])
        : a.rounding + b.rounding) + Math.max(...range.map(Math.abs))
    return { coefficients, range, varying: a.varying || b.varying, rounding }
  }
  return { ...walk(expression), uv }
}

export function collectBumpHeights(value: unknown, result: TslIrExpression[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectBumpHeights(child, result))
    return
  }
  if (!value || typeof value !== 'object') return
  if ((value as TslIrExpression).op === 'bump_height_native') result.push(value as TslIrExpression)
  irInspectionChildren(value).forEach((child) => collectBumpHeights(child, result))
}

function parameters(expression: TslIrExpression) {
  const { strength, distance, filterWidth, offsetWidth } = expression
  if (
    expression.model !== 'eevee-affine-uv-v1' ||
    expression.sourceEngine !== 'EEVEE' ||
    expression.sourceGpuBackend !== 'METAL' ||
    !['4.2', '5.2', '5.3'].includes(String(expression.sourceVersion)) ||
    typeof expression.invert !== 'boolean' ||
    typeof strength !== 'number' ||
    !Number.isFinite(strength) ||
    strength < -1 ||
    strength > 2 ||
    typeof distance !== 'number' ||
    !Number.isFinite(distance) ||
    Math.abs(distance) > 1 ||
    typeof filterWidth !== 'number' ||
    offsetWidth !== nativeBumpOffsetWidth(filterWidth)
  )
    return fail('needs the verified native source profile and finite static controls')
  for (const [key, output] of [
    ['normal', 'normal'],
    ['position', 'position'],
  ] as const) {
    const value = expression[key] as TslIrExpression
    if (
      value?.op !== 'geometry_context' ||
      value.output !== output ||
      value.sourceEngine !== 'EEVEE'
    )
      return fail('needs its primary EEVEE normal and position context')
  }
  return { strength, distance, filterWidth, offsetWidth: offsetWidth as number }
}

function uvChannel(source: TslIrExpression | null, options: BuildTslOptions): number {
  if (!source) return 0
  const channel =
    source.op === 'uv_active' ? options.activeUvChannel : options.uvChannel?.(String(source.uvMap))
  if (!Number.isInteger(channel) || channel! < 0 || channel! > 3)
    return fail('needs its actual resolved UV channel within [0,3]')
  return channel!
}

type Facts = {
  points: Vector3[]
  normal: Vector3
  gradient: number
  rounding: number
  uvGradient: [number, number]
  uvBounds: readonly [Range, Range] | null
}
const verified = new WeakMap<
  object,
  WeakMap<
    object,
    {
      signature: string
      position: unknown
      normal: unknown
      index: unknown
      uv: unknown
      facts: Facts
    }
  >
>()

export function validateBumpHeightBinding(
  entries: readonly TslIrExpression[],
  mesh: Mesh,
  options: BuildTslOptions,
): Facts[] {
  return entries.map((expression) => {
    const controls = parameters(expression)
    validateGeometryContextBinding(
      new Set(['normal', 'position']),
      mesh,
      options.objectSpace?.basis,
    )
    const geometry = mesh.geometry,
      position = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      index = geometry.index
    let analysis = analyseBumpHeight(expression.height as TslIrExpression)
    const channel = uvChannel(analysis.uv, options),
      coordinates = analysis.uv ? geometry.getAttribute(channel ? 'uv' + channel : 'uv') : null
    if (
      analysis.uv &&
      (!coordinates ||
        coordinates.itemSize !== 2 ||
        coordinates.count !== position.count ||
        !(coordinates.array instanceof Float32Array) ||
        coordinates.normalized)
    )
      return fail('requires its actual unquantized Float32 UV stream')
    const version = (attribute: any) => attribute?.version ?? attribute?.data?.version
    const signature = [
      version(position),
      version(normal),
      version(index),
      version(coordinates),
      options.uvSpace,
      channel,
      JSON.stringify(expression.height),
    ].join('|')
    let cache = verified.get(expression)
    if (!cache) {
      cache = new WeakMap()
      verified.set(expression, cache)
    }
    const previous = cache.get(geometry)
    let facts: Facts
    if (
      previous?.signature === signature &&
      previous.position === position &&
      previous.normal === normal &&
      previous.index === index &&
      previous.uv === coordinates
    )
      facts = previous.facts
    else {
      const ranges: [[number, number], [number, number]] = [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
      ]
      if (coordinates) {
        for (let vertex = 0; vertex < coordinates.count; vertex++)
          for (let axis = 0; axis < 2; axis++) {
            let value = axis ? coordinates.getY(vertex) : coordinates.getX(vertex)
            if (axis && options.uvSpace === 'gltf') value = Math.fround(1 - value)
            if (!Number.isFinite(value) || Math.abs(value) > 2)
              return fail('UVs exceed the verified [-2,2] domain')
            ranges[axis][0] = Math.min(ranges[axis][0], value)
            ranges[axis][1] = Math.max(ranges[axis][1], value)
          }
        analysis = analyseBumpHeight(expression.height as TslIrExpression, ranges)
      }
      if (Math.max(...analysis.range.map(Math.abs)) > 2)
        return fail('range exceeds the verified [-2,2] domain')
      const count = index?.count ?? position.count,
        first = new Vector3(),
        origin = new Vector3(),
        points: Vector3[] = [],
        n = new Vector3()
      let gradient = 0
      const uvGradient: [number, number] = [0, 0]
      for (let offset = 0; offset < count; offset += 3) {
        const vertices = [0, 1, 2].map((i) => (index ? index.getX(offset + i) : offset + i)),
          p = vertices.map((i) => new Vector3().fromBufferAttribute(position, i))
        const a = p[1]!.clone().sub(p[0]!),
          b = p[2]!.clone().sub(p[0]!),
          cross = a.clone().cross(b),
          area = cross.lengthSq(),
          face = cross.clone().normalize()
        if (!offset) {
          first.copy(face)
          origin.copy(p[0]!)
        }
        if (
          face.dot(first) < 0.999999 ||
          p.some((point) => Math.abs(point.clone().sub(origin).dot(first)) > 1e-5)
        )
          return fail('currently requires a planar primary triangle surface')
        if (vertices.some((i) => n.fromBufferAttribute(normal, i).normalize().dot(face) < 0.999999))
          return fail('currently requires geometric flat normals')
        if (area <= 1e-10 * a.lengthSq() * b.lengthSq())
          return fail('triangle basis is poorly conditioned')
        if (p.some((point) => point.toArray().some((value) => Math.abs(value) > 64)))
          return fail('positions exceed local magnitude 64')
        points.push(...p)
        if (coordinates) {
          const [x, y] = analysis.coefficients,
            h = vertices.map(
              (i) =>
                x * coordinates.getX(i) +
                y *
                  (options.uvSpace === 'gltf'
                    ? Math.fround(1 - coordinates.getY(i))
                    : coordinates.getY(i)),
            )
          const slope = b
            .clone()
            .cross(cross)
            .multiplyScalar(h[1]! - h[0]!)
            .add(
              cross
                .clone()
                .cross(a)
                .multiplyScalar(h[2]! - h[0]!),
            )
            .divideScalar(area)
          gradient = Math.max(gradient, slope.length())
          for (const axis of [0, 1] as const) {
            const values = vertices.map((i) =>
              axis
                ? options.uvSpace === 'gltf'
                  ? Math.fround(1 - coordinates.getY(i))
                  : coordinates.getY(i)
                : coordinates.getX(i),
            )
            const derivative = b
              .clone()
              .cross(cross)
              .multiplyScalar(values[1]! - values[0]!)
              .add(
                cross
                  .clone()
                  .cross(a)
                  .multiplyScalar(values[2]! - values[0]!),
              )
              .divideScalar(area)
            uvGradient[axis] = Math.max(uvGradient[axis], derivative.length())
          }
        }
      }
      // Eight true local AABB corners conservatively bound all planar vertices.
      const lower = new Vector3(Infinity, Infinity, Infinity),
        upper = new Vector3(-Infinity, -Infinity, -Infinity)
      points.forEach((point) => {
        lower.min(point)
        upper.max(point)
      })
      const corners = Array.from(
        { length: 8 },
        (_, i) =>
          new Vector3(
            i & 1 ? upper.x : lower.x,
            i & 2 ? upper.y : lower.y,
            i & 4 ? upper.z : lower.z,
          ),
      )
      facts = {
        points: corners,
        normal: first,
        gradient,
        rounding: analysis.rounding,
        uvGradient,
        uvBounds: coordinates ? ranges : null,
      }
      cache.set(geometry, { signature, position, normal, index, uv: coordinates, facts })
    }
    if (
      facts.points.some((point) =>
        point
          .clone()
          .applyMatrix4(mesh.matrixWorld)
          .toArray()
          .some((value) => Math.abs(value) > 64),
      )
    )
      return fail('positions exceed world magnitude 64')
    const inverse = new Matrix3().getNormalMatrix(mesh.matrixWorld)
    if (
      ((facts.gradient * Math.hypot(...inverse.elements)) / 0.9) *
        Math.abs(controls.distance) *
        Math.max(1, controls.strength) >
      0.1
    )
      return fail('effective world slope times Distance exceeds the verified .1 bound')
    return facts
  })
}

export function validateBumpHeightView(
  expression: TslIrExpression,
  mesh: Mesh,
  camera: Camera,
  viewport: { width: number; height: number },
  options: BuildTslOptions,
): void {
  const controls = parameters(expression),
    [facts] = validateBumpHeightBinding([expression], mesh, options)
  validateGeometryContextCamera(camera)
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return fail('needs the actual active renderer viewport')
  const projection = camera.projectionMatrix.elements
  if (
    projection.some((value) => !Number.isFinite(Math.fround(value))) ||
    [projection[0], projection[5]].some((value) => !value || value <= 0) ||
    [1, 3, 4, 7].some((index) => projection[index] !== 0)
  )
    return fail('needs a finite active camera projection')
  const normal = facts!.normal
    .clone()
    .applyNormalMatrix(new Matrix3().getNormalMatrix(mesh.matrixWorld))
  const perspective = Boolean((camera as any).isPerspectiveCamera),
    view = camera.matrixWorldInverse,
    world = facts!.points.map((point) => point.clone().applyMatrix4(mesh.matrixWorld))
  let pixel = Infinity,
    maximumStep = 0,
    minimumDepth = Infinity,
    maximumDepth = 0,
    maximumX = 0,
    maximumY = 0,
    minimumIncidence = 1,
    facing = 0
  for (const point of world) {
    const position = point.clone().applyMatrix4(view),
      depth = -position.z
    if (perspective && depth <= (camera as any).near)
      return fail(
        'surface crosses the active near plane; move the camera back or return to the authored view',
      )
    const ray = perspective
      ? point.clone().sub(new Vector3().setFromMatrixPosition(camera.matrixWorld)).normalize()
      : new Vector3(0, 0, -1).transformDirection(camera.matrixWorld)
    const cosine = ray.dot(normal),
      sign = Math.sign(cosine)
    if (Math.abs(cosine) < 0.2 || (facing && facing !== sign))
      return fail(
        'view is outside the verified surface incidence bound; orbit closer to face-on or return to the authored view',
      )
    facing = sign
    minimumIncidence = Math.min(minimumIncidence, Math.abs(cosine))
    minimumDepth = Math.min(minimumDepth, depth)
    maximumDepth = Math.max(maximumDepth, depth)
    if (perspective) {
      maximumX = Math.max(maximumX, Math.abs(position.x / depth))
      maximumY = Math.max(maximumY, Math.abs(position.y / depth))
    }
  }
  const focalMaximum = Math.max(
    Math.abs(projection[0]!) * viewport.width,
    Math.abs(projection[5]!) * viewport.height,
  )
  const focalMinimum = Math.min(
    Math.abs(projection[0]!) * viewport.width,
    Math.abs(projection[5]!) * viewport.height,
  )
  const rayBound = perspective ? Math.sqrt(1 + maximumX ** 2 + maximumY ** 2) : 1
  // Independent extrema bound the complete convex surface, not merely its
  // corners. Absolute incidence also needs a consistent facing half-space.
  pixel = (2 * (perspective ? minimumDepth : 1)) / (focalMaximum * rayBound)
  maximumStep =
    (4 * (perspective ? maximumDepth : 1) * rayBound) / (focalMinimum * minimumIncidence)

  // Both reevaluations and interpolated world-position differences must fit
  // the qualified binary32 cancellation budget. This is an admission limit,
  // not a claim of exact arbitrary-resolution/native raster equivalence.
  const worldSlope =
    (facts!.gradient * Math.hypot(...new Matrix3().getNormalMatrix(mesh.matrixWorld).elements)) /
    0.9
  const worldMagnitude = Math.max(1, ...world.flatMap((point) => point.toArray().map(Math.abs)))
  let rounding = facts!.rounding
  if (facts!.uvBounds) {
    const scale = Math.hypot(...new Matrix3().getNormalMatrix(mesh.matrixWorld).elements)
    const ranges = facts!.uvBounds.map((range, axis) => {
      const shift = facts!.uvGradient[axis]! * scale * maximumStep * controls.offsetWidth
      if (!Number.isFinite(shift))
        return fail('shifted UV evaluation exceeds the verified finite view domain')
      return [range[0] - shift, range[1] + shift] as Range
    }) as unknown as readonly [Range, Range]
    const shifted = analyseBumpHeight(expression.height as TslIrExpression, ranges)
    if (Math.max(...shifted.range.map(Math.abs)) > 4)
      return fail(
        'shifted Height range exceeds the verified finite view domain; move the camera closer or reduce Filter Width',
      )
    rounding = Math.max(rounding, shifted.rounding)
  }
  if (
    worldMagnitude / pixel > 4096 ||
    (worldSlope * Math.abs(controls.distance) * Math.max(1, controls.strength) * worldMagnitude) /
      pixel >
      32 ||
    pixel < 1e-4 ||
    pixel > 100 ||
    (Math.abs(controls.distance) * Math.max(1, controls.strength) * rounding) /
      (controls.filterWidth * pixel) >
      32
  )
    return fail(
      'view precision is unproven for ' +
        mesh.name +
        ': reduce Height amplitude or Distance, increase Filter Width, or move the camera back',
    )
}

/** Independent mathematical surface-gradient construction. Height is
 * reevaluated at shifted UVs in authored operation order, never dFdx(final H). */
export function buildTslBumpHeight(
  expression: TslIrExpression,
  options: BuildTslOptions,
): TslExpression {
  const controls = parameters(expression),
    analysis = analyseBumpHeight(expression.height as TslIrExpression),
    channel = uvChannel(analysis.uv, options)
  const approved = uniform(1).onObjectUpdate(function (frame) {
    const renderer = frame.renderer as any,
      target = renderer.getRenderTarget(),
      viewport = target?.viewport ?? renderer.getViewport(new Vector4()),
      ratio = target ? 1 : renderer.getPixelRatio()
    validateGeometryContextCamera(frame.camera)
    validateBumpHeightView(
      expression,
      frame.object as Mesh,
      frame.camera,
      { width: viewport.z * ratio, height: viewport.w * ratio },
      options,
    )
  })
  return Fn(() => {
    const source = analysis.uv ? uv(channel) : null,
      coordinates = (
        source
          ? vec3(source.x, options.uvSpace === 'gltf' ? source.y.oneMinus() : source.y, 0)
          : vec3(0)
      ).toVar()
    const evaluate = (value: TslIrExpression, point: any): any => {
      if (value.op === 'const_float') return float(value.value as number)
      if (value.op === 'separate') return value.channel === 'x' ? point.x : point.y
      const a = evaluate(value.a as TslIrExpression, point),
        b = evaluate(value.b as TslIrExpression, point)
      return value.operation === 'MULTIPLY'
        ? a.mul(b)
        : value.operation === 'ADD'
          ? a.add(b)
          : a.sub(b)
    }
    const center = evaluate(expression.height as TslIrExpression, coordinates).toVar()
    const deltaX = evaluate(
      expression.height as TslIrExpression,
      coordinates.add(coordinates.dFdx().mul(controls.offsetWidth)),
    )
      .sub(center)
      .toVar()
    const deltaY = evaluate(
      expression.height as TslIrExpression,
      coordinates.add(coordinates.dFdy().mul(controls.offsetWidth)),
    )
      .sub(center)
      .toVar()
    const p: any = buildGeometryContext(
        expression.position as TslIrExpression,
        options.objectSpace?.basis,
      ),
      n: any = (
        buildGeometryContext(
          expression.normal as TslIrExpression,
          options.objectSpace?.basis,
        ) as any
      )
        .normalize()
        .toVar()
    const px = p.dFdx().toVar(),
      py = p.dFdy().toVar(),
      dualX = py.cross(n).toVar(),
      dualY = n.cross(px).toVar(),
      area = px.dot(dualX).toVar()
    const gradient = dualX.mul(deltaX).add(dualY.mul(deltaY)).toVar(),
      distance = float(controls.distance).mul(
        select(frontFacing, expression.invert ? -1 : 1, expression.invert ? 1 : -1),
      )
    const tilted = n
      .mul(area.abs().mul(controls.filterWidth))
      .sub(gradient.mul(area.sign()).mul(distance))
      .normalize()
    return (mix(n, tilted, max(float(controls.strength), 0)) as any).normalize().mul(approved)
  })()
}
