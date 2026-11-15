/* SPDX-License-Identifier: MIT */
/** Research prototype only: callers have not acquired source/domain admission. */
import {bitcast, float, uniform, vec3} from 'three/tsl'
import {coefficient, literal} from './bounded-domain.mjs'

export function createResearchNativeMatvec(center, columns) {
  if (!Array.isArray(center) || center.length !== 3 || !center.every(literal)
    || !Array.isArray(columns) || columns.length !== 3
    || !columns.every(column => Array.isArray(column) && column.length === 3 && column.every(coefficient)))
    throw Error('Vector Rotate research requires reviewed Float32 center and coefficient bounds')
  // Snapshot the reviewed capture. Caller mutations cannot alter the graph.
  const c = center.map(value => float(value))
  const m = columns.map(column => column.map(value => float(value)))
  const zero = uniform(0, 'uint')
  const stage = value => bitcast(bitcast(value, 'uint').bitOr(zero), 'float').toVar()
  return vector => {
    const delta = ['x', 'y', 'z'].map((channel, lane) => stage(vector[channel].sub(c[lane])))
    const result = [0, 1, 2].map(lane => {
      const products = m.map((column, index) => stage(column[lane].mul(delta[index])))
      const pair = stage(products[0].add(products[1]))
      return stage(stage(pair.add(products[2])).add(c[lane]))
    })
    return vec3(...result).toVar().onRenderUpdate(() => {
      if (zero.value !== 0) throw Error('Vector Rotate research requires its unchanged private rounding uniform')
    })
  }
}
