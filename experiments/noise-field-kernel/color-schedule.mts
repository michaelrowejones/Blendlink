/* SPDX-License-Identifier: Apache-2.0 */
import { Fn, Loop, int, select, vec3, vec4 } from 'three/tsl'
import type { TslExpression } from '../../packages/blendlink/src/tslNodeRecipe.js'
type Node = any
const fn = Fn as unknown as (body: (inputs: Node[]) => Node, layout?: unknown) => (...inputs: Node[]) => Node
const loop = Loop as unknown as (parameters: unknown, body: (variables: { i: Node }) => void) => Node
const integer = int as unknown as (value: unknown) => Node
const choose = select as unknown as (condition: Node, yes: Node, no: Node) => Node
const vector3 = vec3 as unknown as (...values: unknown[]) => Node
const vector4 = vec4 as unknown as (...values: unknown[]) => Node

/** Diagnostic only. Keep the existing scalar recurrence intact; compute its
 * three Color lanes through one fixed3-iteration schedule. No octave loop,
 * uniform-ended iteration, Perlin formula or floating-point budget changes. */
export function buildFieldColorSchedule(point: TslExpression, offsets: unknown,
  fractal: (point: TslExpression) => TslExpression, fail: (message: string) => never): TslExpression {
  if (!Array.isArray(offsets) || offsets.length !== 2 || !offsets.every(value => Array.isArray(value)
    && value.length === 4 && value.every(component => typeof component === 'number' && Number.isFinite(component))))
    return fail('Experimental field Color schedule requires two finite4D offsets')
  // A typed function gives every scalar recurrence its own local variables.
  // Three generates a distinct internal name; no process-wide cache retains
  // material/texture IR or cross-contaminates different source parameters.
  const scalarFbm = fn(([position]) => fractal(position), { position: 'vec4', return: 'float' })
  return fn(([position]) => {
    const result = vector3(0).toVar()
    loop({ start: 0, end: 3, type: 'int', condition: '<', update: '++' }, ({ i }) => {
      const offset = choose(i.equal(integer(0)), vector4(0), choose(i.equal(integer(1)), vector4(...offsets[0]), vector4(...offsets[1])))
      result.element(i).assign(scalarFbm(position.add(offset)))
    })
    return result
  })(point) as TslExpression
}
