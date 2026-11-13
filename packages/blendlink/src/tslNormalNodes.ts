import { irInspectionChildren } from './tslIrInspection.js'
// Native normal-map functions adapt Cycles svm/tex_coord.h (Apache-2.0).
// Copyright 2011-2026 Blender Foundation. Three.js bindings and domain guards
// are supplied by Blendlink. See assets/blender-spectral-NOTICE.txt and license.
import { Matrix3, Vector3, type BufferGeometry, type Mesh, type Camera, type Object3D } from 'three'
import { dot, frontFacing, max, mix, select, uniform, vec3 } from 'three/tsl'
import { TslIrError, type TslExpression, type TslIrExpression } from './tslNodeRecipe.js'
import {
  validateGeometryContextBinding,
  validateGeometryContextCamera,
  validateGeometryContextMatrix,
} from './tslGeometryContext.js'
import { nativeVectorTransformMatrix } from './tslVectorTransform.js'

type Node = any
type Basis = 'blender-z-up' | 'gltf-y-up'
const spaces = new Set(['OBJECT', 'WORLD', 'BLENDER_OBJECT', 'BLENDER_WORLD'])
const epsilon = 1e-3
const normals = new Set(['normal'] as const)
type Bounds = [number[], number[]]

function scalar(value: unknown): number | null {
  const expression = value as TslIrExpression | undefined
  return expression?.op === 'const_float' &&
    typeof expression.value === 'number' &&
    Number.isFinite(expression.value)
    ? expression.value
    : null
}
function vector(value: unknown): number[] | null {
  const expression = value as TslIrExpression | undefined
  if (!expression) return null
  if (
    expression.op === 'const_vec3' &&
    Array.isArray(expression.value) &&
    expression.value.length === 3 &&
    expression.value.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
    return expression.value
  if (expression.op === 'const_float') {
    const value = scalar(expression)
    return value === null ? null : [value, value, value]
  }
  if (expression.op === 'combine') {
    const values = ['x', 'y', 'z'].map((axis) => scalar(expression[axis]))
    return values.every((value) => value !== null) ? (values as number[]) : null
  }
  if (expression.op === 'color_convert' && expression.mode === 'RGB')
    return vector(expression.input)
  return null
}

function parameters(expression: TslIrExpression): { color: number[]; strength: number } {
  if (
    expression.model !== 'primary-normal-map-v1' ||
    !spaces.has(String(expression.space)) ||
    !['CYCLES', 'EEVEE'].includes(String(expression.sourceEngine)) ||
    !['OPENGL', 'DIRECTX'].includes(String(expression.convention)) ||
    !['ORIGINAL', 'DISPLACED'].includes(String(expression.base))
  )
    throw new TslIrError(
      'Normal Map needs verified native model/space/engine/convention/base fields',
    )
  const color = vector(expression.color),
    strength = scalar(expression.strength)
  if (!color || strength === null || [...color, strength].some((value) => Math.abs(value) > 16))
    throw new TslIrError(
      'Object/World Normal Map needs supported constant Color and Strength inputs within [-16, 16]',
    )
  const context = expression.normal as TslIrExpression | undefined
  if (
    context?.op !== 'geometry_context' ||
    context.output !== 'normal' ||
    context.sourceEngine !== expression.sourceEngine ||
    context.model !== 'primary-triangles-v1'
  )
    throw new TslIrError('Normal Map needs its verified primary-surface normal context')
  return { color, strength }
}
function decoded(color: number[], expression: TslIrExpression): Vector3 {
  const result = new Vector3(...(color as [number, number, number])).multiplyScalar(2).subScalar(1)
  if (String(expression.space).startsWith('BLENDER_')) {
    if (expression.sourceEngine === 'CYCLES') {
      result.y = -result.y
      result.z = -result.z
    } else {
      result.y = -2 * color[1]! - 1
      result.z = -2 * color[2]! - 1
    }
  }
  if (expression.convention === 'DIRECTX') result.y = -result.y
  return result
}

const cache = new WeakMap<
  BufferGeometry,
  { attribute: unknown; version: unknown; storage: unknown; basis: Basis; bounds: Bounds }
>()
function normalBounds(geometry: BufferGeometry, storage: unknown, basis: Basis): Bounds {
  const normal = geometry.getAttribute('normal'),
    version = (normal as any).version ?? (normal as any).data?.version
  const previous = cache.get(geometry)
  if (
    previous?.attribute === normal &&
    previous.version === version &&
    previous.storage === storage &&
    previous.basis === basis
  )
    return previous.bounds
  const divisor = storage === 'SNORM10' ? 511 : storage === 'SNORM16' ? 32767 : 0
  if (!divisor) throw new TslIrError('EEVEE Normal Map needs native packed normal storage')
  const bounds: Bounds = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ]
  for (let index = 0; index < normal.count; index++) {
    const xyz =
      basis === 'gltf-y-up'
        ? [normal.getX(index), -normal.getZ(index), normal.getY(index)]
        : [normal.getX(index), normal.getY(index), normal.getZ(index)]
    for (let axis = 0; axis < 3; axis++) {
      const value = Math.trunc(Math.fround(xyz[axis]! * divisor)) / divisor
      bounds[0][axis] = Math.min(bounds[0][axis]!, value - 1e-6)
      bounds[1][axis] = Math.max(bounds[1][axis]!, value + 1e-6)
    }
  }
  cache.set(geometry, { attribute: normal, version, storage, basis, bounds })
  return bounds
}

/** Positive normal interpolation stays within the transformed bounds' cone.
 * Reject either face's possible zero-normal blend without a saved camera pose. */
function certify(color: Vector3, strength: number, matrix: Matrix3, bounds: () => Bounds): void {
  const magnitude = color.length(),
    amount = Math.max(strength, 0),
    a = 1 - amount
  if (Math.abs(Math.abs(a) - amount * magnitude) > epsilon) return
  if (magnitude < epsilon) throw new TslIrError('Normal Map has a zero-length native normal blend')
  const box = bounds(),
    corners: Vector3[] = []
  for (const x of [box[0][0]!, box[1][0]!])
    for (const y of [box[0][1]!, box[1][1]!])
      for (const z of [box[0][2]!, box[1][2]!])
        corners.push(new Vector3(x, y, z).applyMatrix3(matrix).normalize())
  const axis = corners.reduce((sum, value) => sum.add(value), new Vector3()).normalize(),
    cosine = Math.min(...corners.map((value) => axis.dot(value)))
  if (cosine <= 0 || Math.abs(axis.dot(color.clone().normalize())) >= cosine - epsilon)
    throw new TslIrError('Normal Map cannot certify a nonzero blend over this normal cone')
}

export function collectNormalMapRequirements(value: unknown, result: TslIrExpression[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectNormalMapRequirements(child, result))
    return
  }
  if (!value || typeof value !== 'object') return
  if ((value as TslIrExpression).op === 'normal_map_native') result.push(value as TslIrExpression)
  irInspectionChildren(value).forEach((child) => collectNormalMapRequirements(child, result))
}

export function validateNormalMapBinding(
  entries: readonly TslIrExpression[],
  object: Object3D,
  basis: unknown,
): void {
  if (!entries.length) return
  const mesh = object as Mesh
  if (mesh.isMesh) validateGeometryContextBinding(normals, mesh, basis)
  else validateGeometryContextMatrix(object, basis)
  const matrix = new Matrix3().setFromMatrix4(
    nativeVectorTransformMatrix(
      { object, camera: null as unknown as Camera },
      'OBJECT',
      'WORLD',
      'NORMAL',
      basis as Basis,
    ),
  )
  for (const expression of entries) {
    const { color, strength } = parameters(expression),
      value = decoded(color, expression)
    if (expression.sourceEngine === 'CYCLES') {
      if (String(expression.space).endsWith('OBJECT') && value.length() < epsilon)
        throw new TslIrError('Cycles Object Normal Map needs a nonzero decoded normal')
      continue
    }
    if (String(expression.space).endsWith('OBJECT')) value.applyMatrix3(matrix)
    const context = expression.normal as TslIrExpression
    certify(value, strength, matrix, () => {
      if (!mesh.isMesh)
        throw new TslIrError(
          'Normal Map needs actual bound normal data to certify its normalization',
        )
      return normalBounds(mesh.geometry, context.normalStorage, basis as Basis)
    })
  }
}

export function buildTslNativeNormalMap(
  expression: TslIrExpression,
  color: Node,
  strength: Node,
  normal: Node,
  basis: unknown,
): TslExpression {
  const input = parameters(expression)
  if (basis !== 'blender-z-up' && basis !== 'gltf-y-up')
    throw new TslIrError('Normal Map needs an explicit exported coordinate basis')
  const cycles = expression.sourceEngine === 'CYCLES',
    legacy = String(expression.space).startsWith('BLENDER_')
  const normalColor = decoded(input.color, expression)
  if (cycles && String(expression.space).endsWith('OBJECT') && normalColor.length() < epsilon)
    throw new TslIrError('Cycles Object Normal Map needs a nonzero decoded normal')
  const approved = uniform(1).onObjectUpdate(function (frame) {
    validateNormalMapBinding([expression], frame.object as Mesh, basis)
    validateGeometryContextCamera(frame.camera)
  })
  let value: Node = cycles ? color.sub(0.5).mul(2) : color.mul(2).sub(1)
  if (legacy)
    value = cycles
      ? vec3(value.x, value.y.negate(), value.z.negate())
      : vec3(value.x, color.y.mul(-2).sub(1), color.z.mul(-2).sub(1))
  if (expression.convention === 'DIRECTX') value = vec3(value.x, value.y.negate(), value.z)
  if (String(expression.space).endsWith('OBJECT')) {
    const matrix = uniform(new Matrix3()).onObjectUpdate(function (frame) {
      this.value.setFromMatrix4(
        nativeVectorTransformMatrix(
          frame as unknown as { object: Mesh; camera: Camera },
          'OBJECT',
          'WORLD',
          'NORMAL',
          basis,
        ),
      )
    })
    value = (matrix as Node).mul(value)
  }
  const safe = (value: Node, fallback: Node): Node => {
    const square = dot(value, value),
      zero = square.equal(0)
    return select(zero, fallback, value.div(select(zero, 1, square).sqrt()))
  }
  if (cycles) {
    value = safe(value, vec3(0)).mul(select(frontFacing, 1, -1))
    const amount = max(strength, 0)
    value = select(
      strength.equal(1),
      value,
      safe(normal.add(value.sub(normal).mul(amount)), vec3(0)),
    )
    value = select(dot(value, value).equal(0), normal, value)
  } else value = (mix(normal, value, max(strength, 0)) as Node).normalize()
  return value.mul(approved)
}

export function buildNativeNormalView(input: Node, basis: unknown): TslExpression {
  if (basis !== 'blender-z-up' && basis !== 'gltf-y-up')
    throw new TslIrError('Normal channel needs an explicit exported coordinate basis')
  const change =
    basis === 'gltf-y-up' ? new Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0) : new Matrix3()
  const view = uniform(new Matrix3()).onObjectUpdate(function (frame) {
    validateGeometryContextCamera(frame.camera)
    this.value.setFromMatrix4(frame.camera!.matrixWorldInverse).multiply(change)
  })
  return (view as Node).mul(input).normalize()
}
