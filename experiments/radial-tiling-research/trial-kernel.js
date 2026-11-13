// SPDX-FileCopyrightText: 2024-2025 Blender Authors
// SPDX-License-Identifier: Apache-2.0
// PRIVATE RESEARCH ONLY. Derived from pinned gpu_shader_material_radial_tiling_shared.glsl.
// No production opcode/dispatcher. Native MF/Cycles are NOT modeled here.
import { Fn, If, abs, atan, cos, float, floor, select, sqrt, tan, vec4 } from 'three/tsl'
import { buildPortableCosine, buildPortableSine } from '@radial-portable-trig'

const PI = Math.fround(Math.PI), TAU = Math.fround(2 * Math.PI)
const functions = new Map()

function coordinatesFunction(normalize, variant) {
  const key = `${normalize}-${variant}`
  if (functions.has(key)) return functions.get(key)
  if (!['intrinsic-v1', 'portable-trig-v1'].includes(variant)) throw new Error('Unknown private Radial trial')
  const cosine = variant === 'intrinsic-v1' ? cos : buildPortableCosine
  const tangent = variant === 'intrinsic-v1' ? tan : value => buildPortableSine(value).div(buildPortableCosine(value))
  const fn = Fn(([coord, sides]) => {
    const radius = sqrt(coord.x.mul(coord.x).add(coord.y.mul(coord.y))).toVar()
    const angle = atan(coord.y, coord.x).add(select(coord.y.lessThan(0), float(TAU), float(0))).toVar()
    const halfSegment = float(PI).div(sides).toVar()
    const segment = halfSegment.mul(2).toVar()
    const index = floor(angle.div(segment)).toVar()
    const local = angle.sub(index.mul(segment)).toVar()
    const projected = radius.mul(cosine(halfSegment.sub(local))).toVar()
    const parameter = projected.mul(tangent(abs(halfSegment.sub(local)))).toVar()
    If(local.lessThan(halfSegment), () => { parameter.mulAssign(-1) })
    const width = tangent(halfSegment).toVar()
    if (normalize) parameter.divAssign(projected.mul(width))
    // Exact source branch. This does not certify that atan2(0,0) is finite.
    If(coord.x.equal(0).and(coord.y.equal(0)), () => { parameter.assign(0) })
    if (normalize) parameter.assign(parameter.mul(.5).add(.5))
    const radial = normalize ? projected : projected.sub(1)
    const rotation = index.mul(segment).add(halfSegment)
    return vec4(parameter, radial, width, rotation)
  }).setLayout({ name: `privateRadialUnrounded${normalize ? 'Normalized' : 'Raw'}${variant === 'intrinsic-v1' ? 'IntrinsicV1' : 'PortableV1'}`, type: 'vec4', inputs: [{ name: 'coord', type: 'vec2' }, { name: 'sides', type: 'float' }] })
  functions.set(key, fn)
  return fn
}

const idFunction = Fn(([coord, sides]) => floor(sides.mul(atan(coord.y, coord.x).div(TAU).add(select(coord.y.lessThan(0), float(1), float(0))))))
  .setLayout({ name: 'privateRadialUnroundedIdV1', type: 'float', inputs: [{ name: 'coord', type: 'vec2' }, { name: 'sides', type: 'float' }] })

export function privateRadialTrial(coord, sides, normalize, variant) {
  if (!Number.isInteger(sides) || sides < 3) throw new Error('Private trial requires integer Sides >=3')
  const variables = coordinatesFunction(normalize, variant)(coord, float(sides))
  return { x: variables.x, y: variables.y, width: variables.z, rotation: variables.w, id: idFunction(coord, float(sides)) }
}
