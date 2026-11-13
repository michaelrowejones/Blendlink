import { FloatType, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { resampleCompositorField, type CompositorSampling } from './tslCompositorResampling.js'
import { resampleCompositorAffine } from './tslCompositorAffine.js'
import { invertCompositorAffine, multiplyCompositorAffine, type CompositorAffineMatrix } from './tslCompositorAffineMath.js'
import { realizeStaticCompositorWindow } from './tslCompositorStaticImageDomain.js'
import type { StaticCompositorWindow } from './tslCompositorStaticImage.js'
import { realizeCroppedCompositorWindow, type CroppedCompositorWindow } from './tslCompositorCropDomain.js'

const { Fn, clamp, ivec2, rtt, select, textureSize, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'ivec2' | 'rtt' | 'select' | 'textureSize' | 'uv' | 'vec4',
  (...arguments_: TslEffectNode[]) => TslEffectNode>

/** A real finite pixel window with a deferred origin, not an already clipped field. */
export interface CompositorImageOrigin {
  croppedWindow?: CroppedCompositorWindow
  staticWindow?: StaticCompositorWindow
  x: number
  y: number
  sampling?: CompositorSampling
  affineMatrix?: CompositorAffineMatrix
  roots: { node: TslEffectNode, extent?: (renderer: TslEffectNode) => readonly [number, number] }[]
}

export function mergeImageOrigins(origins: (CompositorImageOrigin | null)[], fail: (message: string) => never): CompositorImageOrigin | null {
  const fields = origins.filter((value): value is CompositorImageOrigin => value !== null)
  if (!fields.length) return null
  const first = fields[0]!
  if (fields.some(value => value.croppedWindow !== first.croppedWindow))
    fail('Inputs with different resized Crop windows require native cross-domain realization')
  if (fields.some(value => JSON.stringify(value.staticWindow) !== JSON.stringify(first.staticWindow)))
    fail('Static Image inputs with different canvas sizes/models require native cross-domain realization')
  if (fields.some(value => value.x !== first.x || value.y !== first.y))
    fail('Inputs with different image origins require native cross-domain realization')
  return { ...first, roots: [...new Set(fields.flatMap(value => value.roots))] }
}

export function translatedImageOrigin(op: SourceCompositorOperation, input: CompositorImageOrigin | null,
  fail: (message: string) => never): CompositorImageOrigin | null {
  const delta = op.properties.image_translation
  const model = op.properties.image_domain_model
  if (model === 'deferred-integer-origin-v1') {
    if (op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
      || !Array.isArray(delta) || delta.length !== 2
      || delta.some(value => !Number.isInteger(value) || Math.abs(value) > 8192))
      fail('Translate requires its bounded deferred integer-origin model')
  } else if (model !== 'native-translation-v2' || op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
    || !Array.isArray(delta) || delta.length !== 2
    || delta.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8192)
    || !['Nearest', 'Bilinear'].includes(String(op.properties.image_interpolation))
    || !['modern-cpu-v1', 'modern-metal-v1', 'legacy-cpu-v1', 'legacy-metal-v1'].includes(String(op.properties.image_sampling_model)))
    fail('Translate requires a verified bounded native sampling model')
  if (input === null) return null
  if (input.affineMatrix) {
    if (model !== 'native-translation-v2') return fail('Affine transform chains require freshly exported native translation metadata')
    return affineImageOrigin({ ...op, properties: { ...op.properties, image_domain_model: 'deferred-affine-f32-v1',
      image_affine_matrix: [1, 0, Math.fround(delta[0]), 0, 1, Math.fround(delta[1]), 0, 0, 1] } }, input, fail)
  }
  if (model === 'native-translation-v2' && op.properties.image_sampling_model === 'legacy-cpu-v1'
    && op.properties.image_interpolation === 'Bilinear'
    && (input.x !== 0 || input.y !== 0 || op.source.nodeType === 'CompositorNodeTransform' && delta.some(value => value !== 0)))
    fail('Legacy CPU Bilinear sampling of shifted/intermediate Transform canvases requires native area-of-interest/data-window transport')
  const legacyCpu = model === 'native-translation-v2' && op.properties.image_sampling_model === 'legacy-cpu-v1'
  const offset = (axis: number): number => legacyCpu ? Math.trunc(delta[axis]) : delta[axis]
  const sum = (a: number, b: number): number => model === 'deferred-integer-origin-v1' ? a + b : Math.fround(a + b)
  const x = sum(input.x, offset(0)), y = sum(input.y, offset(1))
  if (Math.abs(x) > 8192 || Math.abs(y) > 8192)
    fail('Composed Translate offsets must remain between -8192 and 8192 pixels')
  const sampling = model === 'deferred-integer-origin-v1' ? undefined : {
    model: op.properties.image_sampling_model, interpolation: legacyCpu ? 'Nearest' : op.properties.image_interpolation,
  } as CompositorSampling
  return { x, y, roots: input.roots, ...(sampling ? { sampling } : {}) }
}

export function affineImageOrigin(op: SourceCompositorOperation, input: CompositorImageOrigin | null,
  fail: (message: string) => never): CompositorImageOrigin | null {
  const matrix = op.properties.image_affine_matrix
  if (op.properties.image_domain_model !== 'deferred-affine-f32-v1' || op.type !== 'RGBA' || op.inputs.Image?.value.type !== 'RGBA'
    || !Array.isArray(matrix) || matrix.length !== 9 || matrix.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.fround(value) !== value)
    || matrix[6] !== 0 || matrix[7] !== 0 || matrix[8] !== 1
    || !['modern-cpu-v1', 'modern-metal-v1'].includes(String(op.properties.image_sampling_model))
    || !['Nearest', 'Bilinear'].includes(String(op.properties.image_interpolation)))
    return fail('Affine transforms require their bounded modern native matrix/sampling model')
  const determinant = Math.fround(Math.fround(matrix[0] * matrix[4]) - Math.fround(matrix[1] * matrix[3]))
  if (!(determinant > 0)) return fail('Affine transforms require the verified nonsingular positive-scale matrix domain')
  if (Math.abs(matrix[2]) > 8192 || Math.abs(matrix[5]) > 8192 || [0, 1, 3, 4].some(index => Math.abs(matrix[index]) > 64))
    return fail('Affine transforms exceed the bounded native matrix domain')
  if (!input) return null
  const combined = multiplyCompositorAffine(matrix as unknown as CompositorAffineMatrix,
    input.affineMatrix ?? [1, 0, input.x, 0, 1, input.y, 0, 0, 1])
  let inverse: CompositorAffineMatrix
  try { inverse = invertCompositorAffine(combined) } catch (error) { return fail((error as Error).message) }
  if (Math.abs(combined[2]) > 8192 || Math.abs(combined[5]) > 8192
    || [0, 1, 3, 4].some(index => Math.abs(combined[index]!) > 64 || Math.abs(inverse[index]!) > 64))
    return fail('Composed affine transforms exceed the bounded native matrix domain')
  const pureTranslation = combined[0] === 1 && combined[1] === 0 && combined[3] === 0 && combined[4] === 1
  return { x: combined[2], y: combined[5], roots: input.roots,
    sampling: { model: op.properties.image_sampling_model, interpolation: op.properties.image_interpolation } as CompositorSampling,
    ...(!pureTranslation ? { affineMatrix: combined } : {}) }
}

export function validateCompositorExtent(origin: CompositorImageOrigin, renderer: TslEffectNode,
  width: number, height: number, fail: (message: string) => never): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    fail('Translate requires a finite nonempty compositing image extent')
  for (const root of origin.roots) {
    let rootWidth: number, rootHeight: number
    if (root.extent) [rootWidth, rootHeight] = root.extent(renderer)
    else {
      let source = root.node
      if (source.isPassNode) source = source.getTextureNode()
      while (source.referenceNode && source.referenceNode !== source) source = source.referenceNode
      const pass = source.passNode
      if (source.isRTTNode && source.autoResize || pass) {
        const scale = pass?.getResolutionScale?.() ?? 1
        rootWidth = Math.floor(width * scale); rootHeight = Math.floor(height * scale)
      } else { rootWidth = source.value?.image?.width; rootHeight = source.value?.image?.height }
    }
    if (rootWidth !== width || rootHeight !== height)
      fail('Translate requires matching source/render image extents; arbitrary data/display windows need native domain realization')
  }
}

export function realizeCompositorOrigin(input: TslEffectNode, from: CompositorImageOrigin,
  to: readonly [number, number], resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  if (from.croppedWindow) {
    if (from.x !== 0 || from.y !== 0 || from.affineMatrix || to.some(value => value !== 0))
      return fail('Resized Crop transform consumers require native finite-window processing')
    return realizeCroppedCompositorWindow(input, from.croppedWindow, resources, fail)
  }
  if (from.staticWindow) {
    if (from.x !== 0 || from.y !== 0 || from.affineMatrix || to.some(value => value !== 0))
      return fail('Static Image transform consumers require native finite-window processing')
    return realizeStaticCompositorWindow(input, from.staticWindow, resources, fail)
  }
  if (from.affineMatrix) {
    if (!from.sampling) return fail('Affine realization requires native sampling metadata')
    const target = [1, 0, to[0], 0, 1, to[1], 0, 0, 1]
    // Native RealizeOnDomain skips equal domains with its 1e-5 matrix epsilon.
    // Keep the authored residual while composing chains; apply this test only
    // at the actual realization boundary (e.g. Float32 sin(2*pi) is not zero).
    if (from.affineMatrix.every((value, index) => Math.abs(value - target[index]!) <= 1e-5))
      return realizeIntegerImageOrigin(input, { ...from, x: 0, y: 0 }, resources, fail)
    return resampleCompositorAffine(input, from.affineMatrix, to, from.sampling, resources,
      (renderer, width, height) => validateCompositorExtent(from, renderer, width, height, fail), fail)
  }
  const dx = from.x - to[0], dy = from.y - to[1]
  if ((!from.sampling || from.sampling.interpolation === 'Nearest') && Number.isInteger(dx) && Number.isInteger(dy)
    || dx === 0 && dy === 0)
    return realizeIntegerImageOrigin(input, { ...from, x: dx, y: dy }, resources, fail)
  if (!from.sampling) return fail('Fractional image realization requires a native sampling model')
  return resampleCompositorField(input, [from.x, from.y], to, from.sampling, resources,
    (renderer, width, height) => validateCompositorExtent(from, renderer, width, height, fail), fail)
}

export function translatedCompositorField(op: SourceCompositorOperation, input: TslEffectNode,
  domain: CompositorImageOrigin | null, resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  translatedImageOrigin(op, domain, fail)
  if (!domain || op.properties.image_domain_model !== 'native-translation-v2'
    || op.properties.image_sampling_model !== 'legacy-cpu-v1') return input
  const delta = op.properties.image_translation as number[]
  if (!delta.some(value => !Number.isInteger(value))) return input
  return resampleCompositorField(input, [0, 0], [0, 0], { model: 'legacy-cpu-v1', interpolation: op.properties.image_interpolation as 'Nearest' | 'Bilinear' }, resources,
    (renderer, width, height) => validateCompositorExtent(domain, renderer, width, height, fail), fail, [delta[0]!, delta[1]!])
}

/** Realize once, after neighborhood/pointwise processing, preserving off-canvas
 * pixels until this boundary. The first model has equal-sized render windows;
 * unequal extents refuse rather than silently stretching or discarding origins. */
export function realizeIntegerImageOrigin(input: TslEffectNode, origin: CompositorImageOrigin,
  resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const updateBefore = image.updateBefore.bind(image), size = new Vector2(), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(size)
      const width = size.x, height = size.y
      validateCompositorExtent(origin, renderer, width, height, fail)
      if (image.renderTarget.width !== width || image.renderTarget.height !== height) image.setSize(width, height)
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  return Fn(() => {
    const dimensions = ivec2(textureSize(image))
    const coordinate = ivec2(uv().mul(dimensions)).sub(ivec2(origin.x, origin.y))
    const inside = coordinate.x.greaterThanEqual(0).and(coordinate.y.greaterThanEqual(0))
      .and(coordinate.x.lessThan(dimensions.x)).and(coordinate.y.lessThan(dimensions.y))
    // Clamp the inactive texture fetch too: out-of-bounds GLSL texelFetch is
    // undefined, even when a later select discards its value.
    return select(inside, image.load(clamp(coordinate, ivec2(0), dimensions.sub(1))), vec4(0))
  })()
}
