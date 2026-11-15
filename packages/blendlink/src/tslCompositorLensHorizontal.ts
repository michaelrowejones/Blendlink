/* SPDX-License-Identifier: MIT */
/** Candidate pinned CPU horizontal Lens Distortion. Capability credit requires
 * the independent native / saved Final / installed browser transaction. */
import { DataTexture, FloatType, RGBAFormat, Vector2, Vector4 } from 'three'
import { RendererUtils } from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation, SourceCompositorProgram } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { OwnedCompositorDataTexture, bindCompositorDataTextures } from './tslCompositorDataTextureOwner.js'
import { ownBlurRtt } from './tslCompositorBlur.js'
import { CompositorRendererEpoch } from './tslCompositorRttOwner.js'
import { createDisplaceCpuRgbaStages } from './tslCompositorDisplacePrecision.js'
import { updateCompositorPassProducers } from './tslCompositorProducers.js'
import { compositorCpuDivideThree } from './tslCompositorMapValue.js'

export const LENS_HORIZONTAL_MODEL = 'native-lens-horizontal-cpu-53-v1'
export const LENS_HORIZONTAL_PROFILE = 'darwin-arm64-53-lens-horizontal-cpu-v1'
export const LENS_HORIZONTAL_DISPERSION = Math.fround(.2)
export const LENS_HORIZONTAL_MAX_PIXELS = 4194304
const MAX_EXTENT = 8192
const { Fn, bitcast, clamp, int, ivec2, rtt, select, textureLoad, textureSize, uniform, uv, vec4 } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'clamp' | 'int' | 'ivec2' | 'rtt' | 'select' | 'textureLoad' | 'textureSize' | 'uniform' | 'uv' | 'vec4',
  (...args: TslEffectNode[]) => TslEffectNode>
const F = Math.fround
const closed = (value: object, names: string[]): boolean => Object.keys(value).sort().join('|') === [...names].sort().join('|')
const marker = (op: SourceCompositorOperation): boolean => op.source?.nodeType === 'CompositorNodeLensdist'
  || Object.keys(op.properties ?? {}).some(name => name.startsWith('lens_horizontal_'))

/** Native CPU `(texel+.5)/size`, then normalized shift, then bilinear texel
 * coordinates. This deliberately does not borrow Translate's reciprocal math. */
export function horizontalLensAxisMapping(size: number, pixels: number): Float32Array {
  if (!Number.isInteger(size) || size < 4 || size > MAX_EXTENT || ![-1, 0, 1].includes(pixels))
    throw Error('Horizontal Lens Distortion requires extents 4..8192 and its native one-pixel shift')
  const shifted = F(pixels / size), output = new Float32Array(size * 4)
  for (let index = 0; index < size; index++) {
    const normalized = F(F(F(index + .5) / size) + shifted)
    const coordinate = F(F(normalized * size) - .5), lower = Math.floor(coordinate)
    output.set([lower, Math.floor(F(coordinate + 1)), F(coordinate - lower), 1], index * 4)
  }
  return output
}

export function validateLensHorizontalProgram(program: SourceCompositorProgram, fail: (message: string) => never): SourceCompositorOperation | undefined {
  const candidates = program.ops.filter(marker)
  if (!candidates.length) return undefined
  const op = candidates[0]!, p = op.properties, image = op.inputs?.Image
  if (candidates.length !== 1 || program.ops.length !== 2 || new Set(program.ops.map(item => item.id)).size !== 2
    || program.ops.some(item => typeof item.id !== 'string' || !item.id))
    return fail('Horizontal Lens Distortion needs one terminal node and one direct Render Layers source')
  if (op.kind !== 'lens-horizontal' || op.type !== 'RGBA' || op.source.nodeType !== 'CompositorNodeLensdist'
    || op.source.output !== 'Image' || !Array.isArray(op.source.path) || !op.source.path.every(item => typeof item === 'string')
    || typeof op.source.node !== 'string' || !closed(op.source, ['path', 'node', 'nodeType', 'output']))
    return fail('Horizontal Lens Distortion needs its exact original class and Image schema')
  const properties = ['lens_horizontal_model', 'lens_horizontal_profile', 'lens_horizontal_version', 'lens_horizontal_build',
    'lens_horizontal_type', 'lens_horizontal_controls', 'lens_horizontal_dispersion', 'lens_horizontal_export_extent',
    'lens_horizontal_requested_precision', 'lens_horizontal_max_pixels', 'evaluation_device', 'single_value_device', 'native_gpu_backend']
  if (!p || !closed(p, properties) || p.lens_horizontal_model !== LENS_HORIZONTAL_MODEL || p.lens_horizontal_profile !== LENS_HORIZONTAL_PROFILE
    || JSON.stringify(p.lens_horizontal_version) !== '[5,3,0]' || p.lens_horizontal_build !== '02f0899d78e3'
    || p.evaluation_device !== 'CPU' || p.single_value_device !== 'CPU' || typeof p.native_gpu_backend !== 'string' || p.lens_horizontal_type !== 'Horizontal'
    || JSON.stringify(p.lens_horizontal_controls) !== '["Horizontal",0,1045220557,false,false]'
    || p.lens_horizontal_dispersion !== LENS_HORIZONTAL_DISPERSION || p.lens_horizontal_max_pixels !== LENS_HORIZONTAL_MAX_PIXELS
    || !['AUTO', 'FULL'].includes(String(p.lens_horizontal_requested_precision)))
    return fail('Horizontal Lens Distortion needs its pinned CPU model and original raw .2 input')
  const extent = p.lens_horizontal_export_extent
  if (!Array.isArray(extent) || extent.length !== 2 || !extent.every(n => Number.isInteger(n) && n >= 4 && n <= MAX_EXTENT)
    || extent[0]! * extent[1]! > LENS_HORIZONTAL_MAX_PIXELS)
    return fail('Horizontal Lens Distortion export extent exceeds its native domain budget')
  const v = image?.value, output = program.output
  if (!closed(op.inputs, ['Image']) || !image || !closed(image, ['name', 'socketType', 'value'])
    || image.name !== 'Image' || image.socketType !== 'RGBA' || !v || v.kind !== 'ref' || v.type !== 'RGBA'
    || !closed(v, ['kind', 'node', 'type']) || !output || !closed(output, ['kind', 'node', 'type'])
    || output.kind !== 'ref' || output.node !== op.id || output.type !== 'RGBA')
    return fail('Horizontal Lens Distortion requires its terminal native RGBA edge without casts')
  const upstream = program.ops.find(item => item.id === v.node)
  if (!upstream || upstream === op || upstream.kind !== 'render-pass' || upstream.type !== 'RGBA'
    || upstream.source.nodeType !== 'CompositorNodeRLayers' || upstream.source.output !== 'Image')
    return fail('Horizontal Lens Distortion computed/finite/transformed Image producers remain unqualified')
  return op
}

export function createLensHorizontalFrameGuard(): (renderer: TslEffectNode) => readonly [number, number] {
  const drawing = new Vector2(), viewport = new Vector4(), epoch = new CompositorRendererEpoch('Horizontal Lens Distortion')
  return renderer => {
    epoch.validate(renderer)
    renderer.getDrawingBufferSize(drawing)
    const width = drawing.x, height = drawing.y, target = renderer.getRenderTarget()
    if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 4
      || Math.max(width, height) > MAX_EXTENT || width * height > LENS_HORIZONTAL_MAX_PIXELS)
      throw Error('Horizontal Lens Distortion physical extent exceeds its 4194304 pixel budget')
    if ((renderer.getActiveMipmapLevel?.() ?? 0) !== 0 || target && (target.texture?.isCubeTexture
      || target.depth !== undefined && target.depth !== 1 || target.width !== width || target.height !== height
      || target.viewport.x !== 0 || target.viewport.y !== 0 || target.viewport.z !== width || target.viewport.w !== height || target.scissorTest))
      throw Error('Horizontal Lens Distortion requires matching full-frame zero-origin 2D mip0 targets')
    if (!target) {
      renderer.getViewport(viewport)
      const ratio = renderer.getPixelRatio()
      if (!Number.isFinite(ratio) || ratio <= 0 || viewport.x !== 0 || viewport.y !== 0
        || Math.floor(viewport.z * ratio) !== width || Math.floor(viewport.w * ratio) !== height || renderer.getScissorTest())
        throw Error('Horizontal Lens Distortion requires a full physical viewport without scissor')
    }
    return [width, height]
  }
}

/** One shared finite input RTT, three owned mapping tables, eight CPU-staged
 * corner loads plus one direct green load. No duplicate scene render is owned. */
export function buildLensHorizontal(input: TslEffectNode, resources: { dispose(): void }[],
  validateInput: (renderer: TslEffectNode, width: number, height: number) => void): TslEffectNode {
  const guard = createLensHorizontalFrameGuard(), image = rtt(input, 1, 1, { type: FloatType, depthBuffer: false })
  resources.push(ownBlurRtt(image))
  const tables = Array.from({ length: 3 }, () => {
    const data = new Float32Array(MAX_EXTENT * 4), texture = new DataTexture(data, 256, MAX_EXTENT / 256, RGBAFormat, FloatType)
    texture.needsUpdate = true
    const owner = new OwnedCompositorDataTexture(texture)
    resources.push(owner)
    return { data, texture, owner }
  })
  bindCompositorDataTextures(image, tables.map(table => table.owner))
  let lastWidth = 0, lastHeight = 0
  const updateBefore = image.updateBefore.bind(image), viewport = new Vector4(), scissor = new Vector4()
  image.updateBefore = (frame: TslEffectNode): void => {
    const renderer = frame.renderer, [width, height] = guard(renderer)
    validateInput(renderer, width, height)
    updateCompositorPassProducers([input], frame)
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      if (width !== lastWidth || height !== lastHeight) {
        const mappings = [horizontalLensAxisMapping(width, 1), horizontalLensAxisMapping(width, -1), horizontalLensAxisMapping(height, 0)]
        mappings.forEach((mapping, axis) => { tables[axis]!.data.set(mapping); tables[axis]!.texture.needsUpdate = true })
        image.setSize(width, height); lastWidth = width; lastHeight = height
      }
      updateBefore(frame)
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport); renderer.setScissor(scissor)
    }
  }
  const interpolate = createDisplaceCpuRgbaStages(), zero = uniform(0, 'uint')
  const rounded = (value: TslEffectNode): TslEffectNode => bitcast(bitcast(value, 'uint').bitOr(zero), 'float')
  return Fn(() => {
    const dimensions = ivec2(textureSize(image)), coordinate = ivec2(uv().mul(dimensions))
    const mapping = (table: number, index: TslEffectNode): TslEffectNode => textureLoad(tables[table]!.texture,
      ivec2(index.mod(int(256)), index.div(int(256))))
    const redX = mapping(0, coordinate.x).toVar(), blueX = mapping(1, coordinate.x).toVar(), y = mapping(2, coordinate.y).toVar()
    const load = (x: TslEffectNode, y: TslEffectNode): TslEffectNode => {
      const index = ivec2(int(x), int(y)), valid = index.x.greaterThanEqual(0).and(index.y.greaterThanEqual(0))
        .and(index.x.lessThan(dimensions.x)).and(index.y.lessThan(dimensions.y))
      return select(valid, image.load(clamp(index, ivec2(0), dimensions.sub(1))), vec4(0))
    }
    const sample = (x: TslEffectNode): TslEffectNode => interpolate(load(x.x, y.x), load(x.y, y.x), load(x.x, y.y), load(x.y, y.y), x.z, y.z)
    const red = sample(redX).toVar(), green = image.load(coordinate).toVar(), blue = sample(blueX).toVar()
    const alpha = compositorCpuDivideThree(rounded(rounded(red.a.add(green.a)).add(blue.a)))
    return vec4(red.r, green.g, blue.b, alpha)
  })().toVar().onRenderUpdate((frame: TslEffectNode) => {
    guard(frame.renderer)
    if (zero.value !== 0) throw Error('Horizontal Lens Distortion requires its unchanged private alpha-rounding uniform')
  })
}
