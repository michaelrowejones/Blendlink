import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { compositorCpuDivision } from './tslCompositorColor.js'
import { relativeBlurRadii, relativeBlurWeights, type RelativeBlurSettings } from './tslCompositorBlurSizing.js'

const { Fn, Loop, abs, clamp, convertToTexture, int, ivec2, rtt, select, sqrt, textureLoad, textureSize, uniform, uv, vec3, vec4 } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'abs' | 'clamp' | 'convertToTexture' | 'int' | 'ivec2' | 'rtt' | 'select' | 'sqrt' | 'textureLoad' | 'textureSize' | 'uniform' | 'uv' | 'vec3' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>

// Preserve the producer's physical image extent through texture-node clones and
// relative Blur cascades, before an upstream RTT has rendered its first frame.
const relativeExtents = new WeakMap<object, (renderer: TslEffectNode) => [number, number]>()

function blurImageExtent(image: TslEffectNode, renderer: TslEffectNode, size: Vector2): [number, number] {
  let source = image.isPassNode ? image.getTextureNode() : image
  while (source.referenceNode && source.referenceNode !== source) source = source.referenceNode
  const inherited = relativeExtents.get(source)
  if (inherited) return inherited(renderer)
  const pass = source.passNode
  if (!source.isTextureNode || source.isRTTNode && source.autoResize || pass) {
    renderer.getDrawingBufferSize(size)
    const scale = pass?.getResolutionScale?.() ?? 1
    return [Math.floor(size.x * scale), Math.floor(size.y * scale)]
  }
  return [source.value?.image?.width, source.value?.image?.height]
}

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
  const outputSampling = op.properties.blur_output_sampling_model
  if (outputSampling !== undefined && outputSampling !== 'native-texel-v1')
    fail('Blur requires a verified native output sampling model')
  const gamma = op.properties.blur_gamma_model
  if (gamma !== undefined && (gamma !== 'legacy-cpu-square-v1' && gamma !== 'legacy-gpu-square-v1'
    || (gamma === 'legacy-cpu-square-v1') !== (model === 'legacy-cpu-f32-v1')))
    fail('Blur requires a verified matching native gamma correction model')
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
  let relative: RelativeBlurSettings | undefined
  if (op.properties.blur_relative_model !== undefined) {
    const percent = op.properties.blur_relative_percent, aspect = op.properties.blur_relative_aspect,
      multiplier = op.properties.blur_relative_multiplier
    if (op.properties.blur_relative_model !== 'legacy-percent-f32-v1'
      || !Array.isArray(percent) || percent.length !== 2
      || percent.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
      || !['NONE', 'X', 'Y'].includes(String(aspect))
      || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 0
      || model !== 'legacy-cpu-f32-v1' && multiplier > 1 || type.value === 'Gaussian')
      fail('Relative Blur requires verified legacy percentages, aspect, Size and polynomial filter settings')
    relative = { percent: percent as [number, number], aspect: aspect as RelativeBlurSettings['aspect'],
      multiplier, legacyCpu: model === 'legacy-cpu-f32-v1' }
  }
  const transfer = (node: TslEffectNode, inverse: boolean): TslEffectNode => Fn(() => {
    // Native transfer functions read exact pixels. Default RTT sampling is
    // linear: a tiny UV rounding error mixes neighboring alpha into zero and
    // changes the reassociation branch, even when the convolution was exact.
    const color = (node.isRTTNode ? node.load(ivec2(uv().mul(textureSize(node)))) : node).toVar()
    const alpha = select(color.a.greaterThan(0), color.a, 1).toVar()
    const cpu = gamma === 'legacy-cpu-square-v1'
    const straight = (cpu ? compositorCpuDivision(color.rgb, alpha) : color.rgb.div(alpha)).toVar()
    // TSL select with a boolean vector reduces it with all(); native GLSL mix
    // selects each component independently. Retain that channel-wise behavior.
    const positive = vec3(...['r', 'g', 'b'].map(channel => cpu
      ? select(straight[channel].greaterThan(0), straight[channel], 0)
      : select(straight[channel].lessThan(0), 0, straight[channel])))
    const changed = inverse ? sqrt(positive)
      : cpu ? positive.mul(positive) : straight.mul(positive)
    return vec4(changed.mul(alpha), color.a)
  })()
  // Legacy GPU bypasses gamma for constant images and zero radii. CPU applies
  // both transfer functions even for those cases, clipping negative color.
  const fixedIdentity = relative && (relative.multiplier === 0 || relative.percent.every(percent => percent === 0))
  if (single || fixedIdentity || !relative && radii.every(radius => radius === 0)) {
    const result = gamma === 'legacy-cpu-square-v1' ? transfer(transfer(input, false), true) : input
    if (relative && result !== input) {
      const size = new Vector2()
      relativeExtents.set(result, renderer => blurImageExtent(input, renderer, size))
    }
    return result
  }
  const liveTables: { coefficients: Float32Array, table: DataTexture, count: TslEffectNode }[] = []
  const livePasses: TslEffectNode[] = []
  const zeroRadius = uniform(false, 'bool')
  const extentInput = input.isTextureNode || relativeExtents.has(input) ? input : input.isPassNode ? input.getTextureNode() : null
  let rootImage: TslEffectNode, lastWidth = 0, lastHeight = 0
  const sizeVector = new Vector2()
  const readExtent = (renderer: TslEffectNode): [number, number] => blurImageExtent(rootImage, renderer, sizeVector)
  const updateRelative = (renderer: TslEffectNode): void => {
    if (!relative) return
    const [width, height] = readExtent(renderer)
    const label = 'Relative Blur “' + op.source.node + '” '
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      fail(label + 'requires a resolved input image extent')
    if (width === lastWidth && height === lastHeight) return
    const resolved = relativeBlurRadii(relative, width, height)
    if (resolved.some(radius => !Number.isFinite(radius) || radius < 0 || radius > 128))
      fail(label + 'requires resolved radii between 0 and 128 pixels per axis at ' + width + '×' + height)
    // Compute and validate both axes before mutating any existing GPU resource.
    const next = resolved.map(radius => relativeBlurWeights(String(type.value), radius, relative!.legacyCpu))
    if (next.some(row => row.some(value => !Number.isFinite(value))))
      fail(label + 'has no finite native filter table at this image extent')
    liveTables.forEach(({ coefficients, table, count }, axis) => {
      if (count.value === next[axis]!.length && next[axis]!.every((weight, index) => Object.is(weight, coefficients[index * 4]))) return
      coefficients.fill(0)
      next[axis]!.forEach((weight, index) => { coefficients[index * 4] = weight })
      count.value = next[axis]!.length
      table.needsUpdate = true
    })
    for (const pass of livePasses) pass.setSize(width, height)
    zeroRadius.value = resolved.every(radius => radius === 0)
    lastWidth = width; lastHeight = height
  }
  const wrapRelative = (node: TslEffectNode): void => {
    if (!relative) return
    const updateBefore = node.updateBefore.bind(node)
    const viewport = new Vector4(), scissor = new Vector4()
    node.updateBefore = (frame: TslEffectNode): void => {
      const renderer = frame.renderer
      renderer.getViewport(viewport); renderer.getScissor(scissor)
      const state = RendererUtils.resetRendererState(renderer, undefined as never)
      try { updateRelative(renderer); updateBefore(frame) }
      finally {
        RendererUtils.restoreRendererState(renderer, state)
        renderer.setViewport(viewport); renderer.setScissor(scissor)
      }
    }
  }
  const resultWithExtent = (result: TslEffectNode): TslEffectNode => {
    if (relative) relativeExtents.set(result, readExtent)
    return result
  }
  let node = gamma === undefined ? input : transfer(input, false)
  for (let axis = 0; axis < 2; axis++) {
    const taps = weights[axis] as number[]
    if (!relative && taps.length === 1 && taps[0] === 1) continue
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
    if (relative) liveTables.push({ coefficients, table, count })
    const weight = (index: TslEffectNode): TslEffectNode => textureLoad(table, ivec2(index, 0)).r
    const image = convertToTexture(node, null, null, { type: FloatType, depthBuffer: false })
    if (axis === 0) rootImage = extentInput ?? image
    if (image !== node && image.isRTTNode) {
      resources.push(ownBlurRtt(image)); wrapRelative(image)
      if (relative && axis === 0 && extentInput) { livePasses.push(image); relativeExtents.set(image, readExtent) }
    }
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
    if (relative) { livePasses.push(node); relativeExtents.set(node, readExtent); wrapRelative(node) }
  }
  if (gamma !== undefined) {
    const corrected = transfer(node, true)
    return resultWithExtent(relative && gamma === 'legacy-gpu-square-v1' ? select(zeroRadius, input, corrected) : corrected)
  }
  // A pointwise consumer must read the exact filtered pixel. Linear sampling
  // at a rounded pixel-center UV can cross a Posterize bin or alpha-zero test.
  // Older serialized programs retain their prior sampling path explicitly.
  return resultWithExtent(outputSampling === 'native-texel-v1' ? node.load(ivec2(uv().mul(textureSize(node)))) : node)
}
