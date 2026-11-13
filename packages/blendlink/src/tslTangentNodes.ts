import { irInspectionChildren } from './tslIrInspection.js'
/* SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: Apache-2.0
 * Native UV tangent transforms, packing and interpolation expressed in Three TSL. */
import { Matrix3, Vector3, type Mesh, type BufferGeometry, type Camera } from 'three'
import { attribute, normalize, trunc, uniform, vec3 } from 'three/tsl'
import { TslIrError, type TslIrExpression, type TslExpression } from './tslNodeRecipe.js'
import {
  validateGeometryContextBinding,
  validateGeometryContextCamera,
} from './tslGeometryContext.js'
import { nativeVectorTransformMatrix } from './tslVectorTransform.js'
import type { TslRuntimeMeshExtras } from './tslMaterialProgram.js'

type Node = any
const normals = new Set(['normal'] as const)

export function collectTangentRequirements(value: unknown, result: TslIrExpression[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectTangentRequirements(child, result))
    return
  }
  if (!value || typeof value !== 'object') return
  if ((value as TslIrExpression).op === 'tangent_native') result.push(value as TslIrExpression)
  irInspectionChildren(value).forEach((child) => collectTangentRequirements(child, result))
}

function shape(expression: TslIrExpression): void {
  const normal = expression.normal as TslIrExpression | undefined
  if (
    expression.model !== 'primary-mikk-tangent-v1' ||
    expression.sourceEngine !== 'EEVEE' ||
    expression.frameSource !== 'blender-mikk-uv-v1' ||
    typeof expression.uvMap !== 'string' ||
    !expression.uvMap ||
    normal?.op !== 'geometry_context' ||
    normal.output !== 'normal' ||
    normal.model !== 'primary-triangles-v1' ||
    normal.sourceEngine !== expression.sourceEngine ||
    !(
      expression.tangentStorage === normal.normalStorage &&
      ['SNORM10', 'SNORM16'].includes(String(expression.tangentStorage))
    )
  )
    throw new TslIrError('UV Tangent needs its verified native frame/UV/engine/storage context')
}

function cone(values: Vector3[]): { axis: Vector3; radius: number } {
  const axis = values.reduce((sum, value) => sum.add(value), new Vector3())
  if (axis.length() < 1e-6)
    throw new TslIrError('UV Tangent has no nonzero interpolated frame cone')
  axis.normalize()
  const cosine = Math.min(...values.map((value) => axis.dot(value.clone().normalize())))
  if (cosine <= 0.05) throw new TslIrError('UV Tangent has no nonzero interpolated frame cone')
  return { axis, radius: Math.acos(Math.min(1, cosine)) }
}

export interface TangentFrameBound {
  sine: number
  normalCosine: number
  tangentCosine: number
}
const cache = new WeakMap<BufferGeometry, { signature: unknown[]; bound: TangentFrameBound }>()
function localFrameBound(
  geometry: BufferGeometry,
  uvAttribute: string,
  storage: unknown,
): TangentFrameBound {
  const tangent = geometry.getAttribute('tangent'),
    normal = geometry.getAttribute('normal'),
    uv = geometry.getAttribute(uvAttribute),
    position = geometry.getAttribute('position'),
    index = geometry.getIndex(),
    signature = [
      position,
      normal,
      tangent,
      uv,
      index,
      storage,
      ...[position, normal, tangent, uv, index].map(
        (value) => (value as any)?.version ?? (value as any)?.data?.version,
      ),
    ]
  const previous = cache.get(geometry)
  if (previous && signature.every((value, index) => value === previous.signature[index]))
    return previous.bound
  if (
    !tangent ||
    tangent.itemSize !== 4 ||
    tangent.count !== position.count ||
    tangent.normalized ||
    !(tangent.array instanceof Float32Array) ||
    !uv ||
    uv.itemSize !== 2 ||
    uv.count !== position.count ||
    uv.normalized ||
    !(uv.array instanceof Float32Array)
  )
    throw new TslIrError('UV Tangent needs actual Float32 Mikk TANGENT and bound UV attributes')
  const get = (attribute: typeof normal, vertex: number) =>
    new Vector3(attribute.getX(vertex), attribute.getY(vertex), attribute.getZ(vertex))
  const bound: TangentFrameBound = { sine: 1, normalCosine: 1, tangentCosine: 1 }
  const count = index?.count ?? position.count
  for (let offset = 0; offset < count; offset += 3) {
    const vertices = [0, 1, 2].map((corner) =>
      index ? index.getX(offset + corner) : offset + corner,
    )
    const tangents = vertices.map((vertex) => get(tangent, vertex)),
      normals = vertices.map((vertex) => get(normal, vertex))
    if (
      tangents.some(
        (value) =>
          ![value.x, value.y, value.z].every(Number.isFinite) ||
          Math.abs(value.length() - 1) > 1e-4,
      ) ||
      vertices.some((vertex) => ![1, -1].includes(tangent.getW(vertex)))
    )
      throw new TslIrError('UV Tangent needs finite unit Mikk vectors and exact handedness')
    if (vertices.some((vertex) => tangent.getW(vertex) !== tangent.getW(vertices[0]!)))
      throw new TslIrError('Native tangent frames need one handedness sign per triangle')
    const divisor = storage === 'SNORM10' ? 511 : 32767
    for (const value of [...normals, ...tangents]) {
      value.set(
        ...([value.x, value.y, value.z].map(
          (item) => Math.trunc(Math.fround(item * divisor)) / divisor,
        ) as [number, number, number]),
      )
    }
    const [a, b, c] = vertices.map((vertex) => [uv.getX(vertex), uv.getY(vertex)]) as [
      number[],
      number[],
      number[],
    ]
    if (
      ![...a, ...b, ...c].every(Number.isFinite) ||
      Math.abs((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)) < 1e-8
    )
      throw new TslIrError('UV Tangent requires finite nondegenerate UV triangles')
    const n = cone(normals),
      t = cone(tangents),
      separation = Math.acos(Math.min(1, Math.abs(n.axis.dot(t.axis)))) - n.radius - t.radius
    if (separation <= 0.05)
      throw new TslIrError(
        'UV Tangent cannot prove its tangent/normal interpolation stays independent',
      )
    bound.sine = Math.min(bound.sine, Math.sin(separation))
    bound.normalCosine = Math.min(bound.normalCosine, Math.cos(n.radius))
    bound.tangentCosine = Math.min(bound.tangentCosine, Math.cos(t.radius))
  }
  cache.set(geometry, { signature, bound })
  return bound
}

export function validateTangentBinding(
  entries: readonly TslIrExpression[],
  mesh: Mesh,
  basis: unknown,
  extras: TslRuntimeMeshExtras | null,
): void {
  if (!entries.length) return
  validateGeometryContextBinding(normals, mesh, basis)
  for (const expression of entries) {
    shape(expression)
    const frame = extras?.tangentFrame,
      index = extras?.uvChannels?.[String(expression.uvMap)]
    if (
      frame?.schemaVersion !== 1 ||
      frame.model !== 'blender-mikk-uv-v1' ||
      frame.uvMap !== expression.uvMap ||
      !Number.isInteger(index) ||
      index! < 0 ||
      index! > 3
    )
      throw new TslIrError(
        'UV Tangent needs its exported Mikk/UV frame declaration and actual UV channel',
      )
    localFrameBound(mesh.geometry, index === 0 ? 'uv' : 'uv' + index, expression.tangentStorage)
  }
}

export function verifiedTangentFrameBound(
  expression: TslIrExpression,
  mesh: Mesh,
  basis: unknown,
  extras: TslRuntimeMeshExtras | null,
): TangentFrameBound {
  validateTangentBinding([expression], mesh, basis, extras)
  const index = extras!.uvChannels![String(expression.uvMap)]!
  return localFrameBound(
    mesh.geometry,
    index === 0 ? 'uv' : 'uv' + index,
    expression.tangentStorage,
  )
}

export function buildTslNativeTangentFrame(
  expression: TslIrExpression,
  basis: unknown,
): { tangent: Node; normal: Node; sign: Node; approved: Node } {
  shape(expression)
  if (basis !== 'blender-z-up' && basis !== 'gltf-y-up')
    throw new TslIrError('UV Tangent needs an explicit exported coordinate basis')
  const approved = uniform(1).onObjectUpdate(function (frame) {
    validateTangentBinding(
      [expression],
      frame.object as Mesh,
      basis,
      (frame.object as Mesh).userData.blendlink_tsl_runtime ?? null,
    )
    validateGeometryContextCamera(frame.camera)
  })
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
  const tangentAttribute: Node = attribute('tangent', 'vec4')
  const raw: Node = tangentAttribute.xyz,
    local: Node = basis === 'gltf-y-up' ? vec3(raw.x, raw.z.negate(), raw.y) : raw
  const divisor = expression.tangentStorage === 'SNORM10' ? 511 : 32767
  const tangent: Node = normalize(
    (matrix as Node).mul(trunc(local.mul(divisor)).div(divisor)),
  ).toVarying()
  const rawNormal: Node = attribute('normal', 'vec3'),
    localNormal: Node =
      basis === 'gltf-y-up' ? vec3(rawNormal.x, rawNormal.z.negate(), rawNormal.y) : rawNormal
  const normal: Node = normalize(
    (matrix as Node).mul(trunc(localNormal.mul(divisor)).div(divisor)),
  ).toVarying()
  return { tangent, normal, sign: tangentAttribute.w.toVarying(), approved }
}

export function buildTslNativeTangent(expression: TslIrExpression, basis: unknown): TslExpression {
  const frame = buildTslNativeTangentFrame(expression, basis)
  const tangent: Node = normalize(frame.tangent)
  return tangent.mul(frame.approved)
}
