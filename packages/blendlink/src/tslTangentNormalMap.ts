/* SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: Apache-2.0
 * Native tangent-normal composition with independently checked finite inputs. */
import { Matrix3, type Mesh, type Camera } from 'three'
import { clamp, cross, frontFacing, mix, select, uniform, vec3 } from 'three/tsl'
import {
  TslIrError,
  type BuildTslOptions,
  type TslIrExpression,
  type TslExpression,
} from './tslNodeRecipe.js'
import { buildTslNativeTangentFrame, verifiedTangentFrameBound } from './tslTangentNodes.js'
import { normalMapCoefficientBounds, refreshNormalInputBounds } from './tslNormalInputBounds.js'
import { nativeVectorTransformMatrix } from './tslVectorTransform.js'
import type { TslRuntimeMeshExtras } from './tslMaterialProgram.js'

type Node = any

export function collectTangentNormalMaps(value: unknown, result: TslIrExpression[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectTangentNormalMaps(child, result))
    return
  }
  if (!value || typeof value !== 'object') return
  if ((value as TslIrExpression).op === 'normal_map_tangent_native')
    result.push(value as TslIrExpression)
  Object.values(value).forEach((child) => collectTangentNormalMaps(child, result))
}

function parameters(
  expression: TslIrExpression,
  options: BuildTslOptions,
): { minimum: number; maximum: number } {
  if (
    expression.model !== 'eevee-mikk-normal-v1' ||
    expression.sourceEngine !== 'EEVEE' ||
    !['OPENGL', 'DIRECTX'].includes(String(expression.convention)) ||
    !['ORIGINAL', 'DISPLACED'].includes(String(expression.base)) ||
    (expression.frame as TslIrExpression | undefined)?.op !== 'tangent_native'
  )
    throw new TslIrError(
      'Tangent Normal Map needs its verified EEVEE model, convention, base and Mikk frame',
    )
  return normalMapCoefficientBounds(
    expression.color as TslIrExpression,
    expression.strength as TslIrExpression,
    expression.convention,
    options,
  )
}

export function validateTangentNormalMapBinding(
  entries: readonly TslIrExpression[],
  mesh: Mesh,
  basis: unknown,
  extras: TslRuntimeMeshExtras | null,
  options: BuildTslOptions,
): void {
  for (const expression of entries) {
    const { minimum, maximum } = parameters(expression, options),
      frame = verifiedTangentFrameBound(expression.frame as TslIrExpression, mesh, basis, extras),
      matrix = new Matrix3().setFromMatrix4(
        nativeVectorTransformMatrix(
          { object: mesh, camera: null as unknown as Camera },
          'OBJECT',
          'WORLD',
          'NORMAL',
          basis as 'blender-z-up' | 'gltf-y-up',
        ),
      ),
      inverse = matrix.clone().invert(),
      condition = Math.sqrt(
        matrix.elements.reduce((sum, value) => sum + value * value, 0) *
          inverse.elements.reduce((sum, value) => sum + value * value, 0),
      ),
      least = (frame.normalCosine * frame.tangentCosine * frame.sine) / (2 * condition ** 4)
    if (least * minimum <= 64 * 2 ** -23 * condition * maximum)
      throw new TslIrError(
        'Normal Map tangent blend is too poorly conditioned for the verified float32 domain',
      )
  }
}

export function buildTslTangentNormalMap(
  expression: TslIrExpression,
  color: Node,
  strength: Node,
  options: BuildTslOptions,
): TslExpression {
  refreshNormalInputBounds(expression.color)
  refreshNormalInputBounds(expression.strength)
  parameters(expression, options)
  const basis = options.objectSpace?.basis,
    frame = buildTslNativeTangentFrame(expression.frame as TslIrExpression, basis),
    face = select(frontFacing, 1, -1),
    tangent = frame.tangent.mul(face),
    normal = frame.normal.mul(face)
  const approved = uniform(1).onObjectUpdate(function (context) {
    const mesh = context.object as Mesh
    validateTangentNormalMapBinding(
      [expression],
      mesh,
      basis,
      mesh.userData.blendlink_tsl_runtime ?? null,
      options,
    )
  })
  const handedness = uniform(1).onObjectUpdate(function (context) {
    this.value = (context.object as Mesh).matrixWorld.determinant() < 0 ? -1 : 1
  })
  const bitangent = cross(normal, tangent).mul(frame.sign.mul(face)).mul(handedness)
  let decoded: Node = color.mul(2).sub(1)
  if (expression.convention === 'DIRECTX') decoded = vec3(decoded.x, decoded.y.negate(), decoded.z)
  const x = decoded.x.mul(strength),
    y = decoded.y.mul(strength),
    z = mix(1, decoded.z, clamp(strength, 0, 1))
  return tangent
    .mul(x)
    .add(bitangent.mul(y))
    .add(normal.mul(z))
    .normalize()
    .mul(frame.approved)
    .mul(approved)
}
