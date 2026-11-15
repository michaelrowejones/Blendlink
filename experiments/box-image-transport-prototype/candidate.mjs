/* SPDX-FileCopyrightText: 2019-2023 Blender Authors
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Research transcription of gpu_shader_material_tex_image.bsl.hh.
 * This experiment is not distributed in the SceneToWeb runtime. */
import { Fn, If, abs, clamp, float, max, texture, vec2, vec3, vec4 } from 'three/tsl'

// Explicit transcription of Blender5.3 tex_box_blend. Preserve its branch
// order and divisions; conventional pow(abs(normal), sharpness) is different.
export const boxWeights = Fn(([normal, blend]) => {
  const n = abs(normal).toVar()
  n.divAssign(n.x.add(n.y).add(n.z))
  const limit = float(.5).add(blend.mul(.5))
  const weight = clamp(n.div(vec3(n.x.add(n.y), n.y.add(n.z), n.x.add(n.z)))
    .sub(float(.5).mul(float(1).sub(blend))).div(max(float(1e-8), blend)), 0, 1).toVar()
  If(n.z.lessThan(float(1).sub(limit).mul(n.y.add(n.x))), () => {
    weight.z.assign(0); weight.y.assign(float(1).sub(weight.x))
  }).ElseIf(n.x.lessThan(float(1).sub(limit).mul(n.y.add(n.z))), () => {
    weight.x.assign(0); weight.z.assign(float(1).sub(weight.y))
  }).ElseIf(n.y.lessThan(float(1).sub(limit).mul(n.x.add(n.z))), () => {
    weight.y.assign(0); weight.x.assign(float(1).sub(weight.z))
  }).Else(() => {
    weight.assign(float(2).sub(limit).mul(n).add(limit.sub(1)).div(max(float(1e-8), blend)))
  })
  return weight
})

export function boxSample(map, coordinate, normal, blend) {
  const weight = boxWeights(normal, blend).toVar()
  const choose = (condition, a, b) => condition.select(a, b)
  const x = texture(map, vec2(choose(normal.x.lessThan(0), float(1).sub(coordinate.y), coordinate.y), coordinate.z))
  const y = texture(map, vec2(choose(normal.y.greaterThan(0), float(1).sub(coordinate.x), coordinate.x), coordinate.z))
  const z = texture(map, vec2(choose(normal.z.greaterThan(0), float(1).sub(coordinate.y), coordinate.y), coordinate.x))
  return x.mul(weight.x).add(y.mul(weight.y)).add(z.mul(weight.z))
}

export function weightsColor(normal, blend) {
  const w = boxWeights(normal, blend).toVar()
  return vec4(w, w.x.add(w.y).add(w.z))
}
