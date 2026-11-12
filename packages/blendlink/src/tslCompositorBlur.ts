import { DataTexture, FloatType, RGBAFormat } from 'three'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, Loop, abs, clamp, convertToTexture, int, ivec2, rtt, textureLoad, textureSize, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'abs' | 'clamp' | 'convertToTexture' | 'int' | 'ivec2' | 'rtt' | 'textureLoad' | 'textureSize' | 'uniform' | 'uv' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>

/** Three 0.184 RTTNode.dispose only emits a Node event. Its target and quad
 * material need explicit ownership; the quad's shared geometry must stay alive. */
export function ownBlurRtt(node: TslEffectNode): { dispose(): void } {
  let disposed = false
  return { dispose() {
    if (disposed) return
    disposed = true
    node.renderTarget.dispose()
    node._quadMesh.material.dispose()
    node.dispose()
  } }
}

export function buildNativeCompositorBlur(op: SourceCompositorOperation, input: TslEffectNode,
  single: boolean, resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const model = op.properties.blur_model
  if (model !== 'legacy-cpu-f32-v1' && model !== 'symmetric-separable-f32-v1')
    fail('Blur requires a verified native separable filter model')
  const size = op.inputs.Size?.value, type = op.inputs.Type?.value
  const extended = op.inputs['Extend Bounds']?.value, separable = op.inputs.Separable?.value
  if (type?.kind !== 'constant' || !['Flat', 'Tent', 'Quadratic', 'Cubic', 'Gaussian', 'Catrom', 'Mitch'].includes(String(type.value))
    || extended?.kind !== 'constant' || extended.value !== false || separable?.kind !== 'constant' || separable.value !== true)
    fail('Blur requires a static supported separable filter with Extend Bounds disabled')
  if (size?.kind !== 'constant' || !Array.isArray(size.value) || size.value.length !== 2
    || size.value.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 128))
    fail('Blur requires constant radii between 0 and 128 pixels per axis')
  const radii = size.value as number[], weights = op.properties.blur_weights
  if (!Array.isArray(weights) || weights.length !== 2 || weights.some((row, axis) => !Array.isArray(row)
    || row.length !== Math.ceil(radii[axis]!) + 1 || row.some(value => typeof value !== 'number' || !Number.isFinite(value))
    || Math.abs(row[0] + 2 * row.slice(1).reduce((a: number, b: number) => a + b, 0) - 1) > 1e-4))
    fail('Blur requires finite normalized native filter tables matching its radii')
  if (single || radii.every(radius => radius === 0)) return input
  let node = input
  for (let axis = 0; axis < 2; axis++) {
    const taps = weights[axis] as number[]
    if (taps.length === 1 && taps[0] === 1) continue
    // Keep the shader structure independent of radius and filter. Native Blur
    // also loads float32 coefficients from a table instead of embedding hundreds
    // of separately compiled literal texture reads when an artist changes Size.
    const coefficients = new Float32Array(129 * 4)
    taps.forEach((weight, index) => { coefficients[index * 4] = weight })
    const table = new DataTexture(coefficients, 129, 1, RGBAFormat, FloatType)
    table.needsUpdate = true
    let tableDisposed = false
    resources.push({ dispose() { if (!tableDisposed) { tableDisposed = true; table.dispose() } } })
    const count = uniform(taps.length, 'int')
    const weight = (index: TslEffectNode): TslEffectNode => textureLoad(table, ivec2(index, 0)).r
    const image = convertToTexture(node, null, null, { type: FloatType, depthBuffer: false })
    if (image !== node && image.isRTTNode) resources.push(ownBlurRtt(image))
    const sample = (offset: TslEffectNode): TslEffectNode => {
      const dimensions = textureSize(image)
      return image.load(clamp(ivec2(uv().mul(dimensions)).add(ivec2(axis === 0 ? offset : 0, axis === 1 ? offset : 0)),
        ivec2(0), ivec2(dimensions).sub(1)))
    }
    const filtered = Fn(() => {
      const sum = vec4(0).toVar()
      if (model === 'legacy-cpu-f32-v1') {
        // Full-frame 4.2 CPU accumulates left-to-right, using a full signed table.
        Loop({ start: int(1).sub(count), end: count, type: 'int', condition: '<' }, ({ i }: TslEffectNode) => {
          sum.addAssign(sample(i).mul(weight(abs(i))))
        })
      } else {
        // Modern CPU and GPU accumulate center, then +i and -i separately.
        sum.addAssign(sample(0).mul(weight(0)))
        Loop({ start: int(1), end: count, type: 'int', condition: '<' }, ({ i }: TslEffectNode) => {
          const coefficient = weight(i).toVar()
          sum.addAssign(sample(i).mul(coefficient))
          sum.addAssign(sample(i.negate()).mul(coefficient))
        })
      }
      return sum
    })()
    node = rtt(filtered, null, null, { type: FloatType, depthBuffer: false })
    resources.push(ownBlurRtt(node))
  }
  return node
}
