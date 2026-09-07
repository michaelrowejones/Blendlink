import {
  FloatType,
  RenderTarget,
  Vector2,
  TempNode,
  QuadMesh,
  NodeMaterial,
  RendererUtils,
  NodeUpdateType,
} from 'three/webgpu'
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const {
  vec2,
  vec4,
  ivec2,
  float,
  uv,
  texture,
  textureSize,
  floor,
  fract,
  clamp,
  max,
  mix,
  passTexture,
  nodeObject,
  uniform,
  convertToTexture,
} = TSL as unknown as {
  [
    K in
      | 'vec2'
      | 'vec4'
      | 'ivec2'
      | 'float'
      | 'uv'
      | 'texture'
      | 'textureSize'
      | 'floor'
      | 'fract'
      | 'clamp'
      | 'max'
      | 'mix'
      | 'passTexture'
      | 'nodeObject'
      | 'uniform'
      | 'convertToTexture'
  ]: (...args: TslEffectNode[]) => TslEffectNode
}

/** Explicit bilinear reads keep float HDR kernels portable to WebGL2. */
function bilinear(image: TslEffectNode, coordinate: TslEffectNode): TslEffectNode {
  const size = vec2(textureSize(image))
  const pixel = coordinate.mul(size).sub(0.5),
    base = floor(pixel),
    factor = fract(pixel)
  const at = (x: number, y: number): TslEffectNode =>
    image.load(ivec2(clamp(base.add(vec2(x, y)), vec2(0), size.sub(1))))
  return mix(mix(at(0, 0), at(1, 0), factor.x), mix(at(0, 1), at(1, 1), factor.x), factor.y)
}

function downsample(image: TslEffectNode, first: boolean): TslEffectNode {
  const size = vec2(textureSize(image))
  const at = (x: number, y: number): TslEffectNode =>
    bilinear(image, uv().add(vec2(x, y).div(size))).toVar()
  const c = at(0, 0),
    a = at(-1, 1),
    b = at(1, 1),
    d = at(-1, -1),
    e = at(1, -1)
  const l = at(-2, 0),
    r = at(2, 0),
    u = at(0, 2),
    v = at(0, -2)
  const ul = at(-2, 2),
    ur = at(2, 2),
    ll = at(-2, -2),
    lr = at(2, -2)
  if (!first)
    return c
      .add(a)
      .add(b)
      .add(d)
      .add(e)
      .mul(0.125)
      .add(l.add(r).add(u).add(v).mul(0.0625))
      .add(ul.add(ur).add(ll).add(lr).mul(0.03125))
  const karis = (colors: TslEffectNode[]): TslEffectNode => {
    const weights = colors.map((color) => float(1).div(max(max(color.r, color.g), color.b).add(1)))
    return colors
      .map((color, i) => color.mul(weights[i]))
      .reduce((a, b) => a.add(b))
      .div(weights.reduce((a, b) => a.add(b)))
  }
  return karis([a, b, e, d])
    .mul(0.5)
    .add(
      karis([ul, u, c, l])
        .add(karis([u, ur, r, c]))
        .add(karis([c, r, lr, v]))
        .add(karis([l, c, v, ll]))
        .mul(0.125),
    )
}

/** Blender 5.2 Bloom's mip pyramid. Size changes resize targets and change the
 * number of draws without rebuilding shader programs. The input is already
 * thresholded; normalization happens after accumulation, before tint/strength. */
export function buildBlenderBloom(
  input: TslEffectNode,
  highlight: (color: TslEffectNode) => TslEffectNode,
  size: number,
  qualityFactor = 1,
  highlightsOnly = false,
): { node: TslEffectNode; dispose(): void } {
  const owner = new TempNode('vec4') as TslEffectNode
  owner.updateBeforeType = NodeUpdateType.FRAME
  const target = (): RenderTarget => new RenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const down = [target()],
    up = [target()]
  const source = texture(down[0]!.texture),
    low = texture(down[0]!.texture)
  const countUniform = uniform(1),
    inverseOutputSize = uniform(new Vector2(1, 1))
  const output = passTexture(owner, (highlightsOnly ? down[0]! : up[0]!).texture)
  const inputTexture = convertToTexture(input, null, null, { type: FloatType, depthBuffer: false })
  const highlightSize = uniform(new Vector2(1, 1))
  const quad = new QuadMesh()
  const materials: NodeMaterial[] = []
  const dimension = new Vector2()
  let initialized = false,
    disposed = false
  owner.setup = (builder: TslEffectNode): TslEffectNode => {
    if (!initialized) {
      const material = (name: string, node: TslEffectNode): NodeMaterial => {
        const result = new NodeMaterial()
        result.name = name
        result.fragmentNode = node.context(builder.getSharedContext())
        materials.push(result)
        return result
      }
      let averaged = vec4(0)
      const base = floor(uv().mul(highlightSize)).mul(qualityFactor)
      const maximum = ivec2(textureSize(inputTexture)).sub(1)
      for (let y = 0; y < qualityFactor; y++)
        for (let x = 0; x < qualityFactor; x++) {
          averaged = averaged.add(
            inputTexture.load(clamp(ivec2(base.add(vec2(x, y))), ivec2(0), maximum)),
          )
        }
      material('Blender Bloom highlights', highlight(averaged.div(qualityFactor * qualityFactor)))
      material('Blender Bloom Karis downsample', downsample(source, true))
      material('Blender Bloom downsample', downsample(source, false))
      let tent = vec4(0)
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++) {
          const weight = ((x === 0 ? 2 : 1) * (y === 0 ? 2 : 1)) / 16
          tent = tent.add(bilinear(low, uv().add(vec2(x, y).mul(inverseOutputSize))).mul(weight))
        }
      material('Blender Bloom upsample', vec4(source.rgb.add(tent.rgb), 1))
      material('Blender Bloom copy', source)
      initialized = true
    }
    return bilinear(output, uv())
  }
  owner.updateBefore = ({ renderer }: TslEffectNode): void => {
    if (disposed) return
    const state = RendererUtils.resetRendererState(renderer, undefined as never)
    try {
      renderer.getDrawingBufferSize(dimension)
      dimension.set(Math.ceil(dimension.x / qualityFactor), Math.ceil(dimension.y / qualityFactor))
      highlightSize.value.copy(dimension)
      const count = highlightsOnly
        ? 1
        : Math.max(1, Math.floor(Math.log2(Math.max(1, Math.min(dimension.x, dimension.y) * size))))
      countUniform.value = count
      while (down.length < count) {
        down.push(target())
        up.push(target())
      }
      let width = dimension.x,
        height = dimension.y
      for (let i = 0; i < count; i++) {
        down[i]!.setSize(width, height)
        up[i]!.setSize(width, height)
        width = Math.max(1, Math.floor(width / 2))
        height = Math.max(1, Math.floor(height / 2))
      }
      const draw = (destination: RenderTarget, index: number): void => {
        renderer.setRenderTarget(destination)
        quad.material = materials[index]!
        quad.render(renderer)
      }
      draw(down[0]!, 0)
      if (highlightsOnly) return
      for (let i = 1; i < count; i++) {
        source.value = down[i - 1]!.texture
        draw(down[i]!, i === 1 ? 1 : 2)
      }
      if (count === 1) {
        source.value = down[0]!.texture
        draw(up[0]!, 4)
      }
      for (let i = count - 2; i >= 0; i--) {
        source.value = down[i]!.texture
        low.value = (i === count - 2 ? down[i + 1]! : up[i + 1]!).texture
        inverseOutputSize.value.set(1 / up[i]!.width, 1 / up[i]!.height)
        draw(up[i]!, 3)
      }
    } finally {
      RendererUtils.restoreRendererState(renderer, state)
    }
  }
  return {
    node: vec4(nodeObject(owner).rgb.div(countUniform), 1),
    dispose() {
      if (disposed) return
      disposed = true
      for (const resource of [...down, ...up, ...materials]) resource.dispose()
      if (inputTexture !== input) inputTexture.dispose()
    },
  }
}
