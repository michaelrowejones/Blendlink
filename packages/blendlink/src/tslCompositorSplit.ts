import { Vector2 } from 'three'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import type { CompositorImageOrigin } from './tslCompositorImageDomain.js'
import { validateCompositorExtent } from './tslCompositorImageDomain.js'

const { Fn, bitcast, float, int, ivec2, select, uint, uniform, uv } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'float' | 'int' | 'ivec2' | 'select' | 'uint' | 'uniform' | 'uv',
  (...values: TslEffectNode[]) => TslEffectNode>
const rounded = (value: TslEffectNode): TslEffectNode => {
  const bits = bitcast(value, 'uint').toVar()
  return bitcast(select(bits.equal(uint(0x7fc00000)), uint(0), bits), 'float').toVar()
}

export function buildCompositorSplit(op: SourceCompositorOperation, input: (name: string) => TslEffectNode,
  single: (name: string) => boolean, domain: CompositorImageOrigin | null,
  fail: (message: string) => never): TslEffectNode {
  const model = op.properties.split_model, device = op.properties.evaluation_device
  if (op.type !== 'RGBA' || op.source.output !== 'Image' || typeof device !== 'string' || !['CPU', 'GPU'].includes(device)
    || !['Image', 'Image_001'].every(name => op.inputs[name]?.value.type === 'RGBA'))
    return fail('Split requires native Color inputs/output and a verified compositor device')
  if (!domain || single('Image') && single('Image_001')) return fail('Split requires at least one verified finite image input')
  if (domain.x !== 0 || domain.y !== 0 || domain.affineMatrix || domain.croppedWindow)
    return fail('Split requires matching unshifted input canvases')
  if (model === 'native-line-f32-v1') {
    const position = op.properties.split_position, normal = op.properties.split_normal, rotation = op.properties.split_rotation
    if (!Array.isArray(position) || !Array.isArray(normal) || position.length !== 2 || normal.length !== 2
      || ![0, 1].every(index => typeof position[index] === 'number' && Number.isFinite(position[index])
        && Math.fround(position[index]) === position[index] && position[index] >= 0 && position[index] <= 1
        && (position[index] === 0 || position[index] >= 2 ** -50)
        && typeof normal[index] === 'number' && Number.isFinite(normal[index]) && Math.fround(normal[index]) === normal[index]
        && Math.abs(normal[index]) <= 1 && (normal[index] === 0 || Math.abs(normal[index]) >= 2 ** -50))
      || Math.abs(normal[0] ** 2 + normal[1] ** 2 - 1) > 2e-6
      || typeof rotation !== 'number' || !Number.isFinite(rotation) || Math.abs(rotation) > Math.fround(2 * Math.PI)
      || device === 'GPU' && op.properties.native_gpu_backend !== 'METAL')
      return fail('Split requires its verified bounded native line coefficients')
  } else if (typeof model !== 'string' || !['legacy-cpu-axis-v1', 'legacy-gpu-axis-v1'].includes(model)
    || (model === 'legacy-cpu-axis-v1') !== (device === 'CPU')
    || typeof op.properties.split_axis !== 'string' || !['X', 'Y'].includes(op.properties.split_axis)
    || !Number.isInteger(op.properties.split_factor) || Number(op.properties.split_factor) < 0 || Number(op.properties.split_factor) > 100)
    return fail('Split requires its native fixed-axis percentage model')
  // Fn builds its shader later. Own the validated controls so caller edits do
  // not change an already installed graph or bypass its admission checks.
  const position = Array.isArray(op.properties.split_position) ? [...op.properties.split_position] : []
  const normal = Array.isArray(op.properties.split_normal) ? [...op.properties.split_normal] : []
  const axis = op.properties.split_axis, factor = Number(op.properties.split_factor)
  const size = new Vector2(1, 1)
  const dimensionsNode = uniform(size).onRenderUpdate((frame: TslEffectNode) => {
    if (domain.staticWindow) size.set(domain.staticWindow.width, domain.staticWindow.height)
    else { frame.renderer.getDrawingBufferSize(size); validateCompositorExtent(domain, frame.renderer, size.x, size.y, fail) }
    if (!Number.isInteger(size.x) || !Number.isInteger(size.y) || Math.min(size.x, size.y) < 1 || Math.max(size.x, size.y) > 8192)
      return fail('Split requires finite input dimensions within 1..8192')
    return size
  })
  const values = ['Image', 'Image_001'].map(name => input(name))
  return Fn(() => {
    const dimensions = ivec2(dimensionsNode), pixel = ivec2(uv().mul(dimensions))
    let first: TslEffectNode
    if (model === 'native-line-f32-v1') {
      const x = rounded(rounded(float(dimensions.x).mul(position[0])).sub(float(pixel.x)))
      const y = rounded(rounded(float(dimensions.y).mul(position[1])).sub(float(pixel.y)))
      first = rounded(rounded(x.mul(normal[0])).add(rounded(y.mul(normal[1])))).lessThanEqual(0)
    } else {
      const size = axis === 'X' ? dimensions.x : dimensions.y
      const coordinate = axis === 'X' ? pixel.x : pixel.y
      first = model === 'legacy-cpu-axis-v1'
        ? coordinate.greaterThanEqual(size.mul(int(factor)).div(int(100)))
        : float(coordinate).greaterThanEqual(float(size).mul(Math.fround(factor / 100)))
    }
    const samples = values.map(value => {
      const texture = value.isPassNode ? value.getTextureNode() : value
      const raw = texture.isTextureNode && texture.uvNode == null && texture.sampler !== false
        && texture.levelNode == null && texture.biasNode == null && texture.offsetNode == null
      return raw ? texture.load(pixel) : value
    })
    return select(first, samples[0], samples[1])
  })()
}
