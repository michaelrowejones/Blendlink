import * as TSL from 'three/tsl'
import { FloatType } from 'three'
import type {
  CompositorValue,
  SourceCompositorOperation,
  SourceCompositorProgram,
} from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'
import { blenderRgbToHsv, blenderHsvToRgb, buildTslMathOperation } from './tslNodeRecipe.js'
import { buildBlenderBloom } from './tslBlenderBloom.js'

const {
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  pow,
  select,
  vec2,
  vec3,
  vec4,
  ivec2,
  textureSize,
  uv,
  rtt,
  convertToTexture,
} = TSL as unknown as {
  [
    K in
      | 'abs'
      | 'clamp'
      | 'dot'
      | 'float'
      | 'floor'
      | 'fract'
      | 'max'
      | 'min'
      | 'mix'
      | 'pow'
      | 'select'
      | 'vec2'
      | 'vec3'
      | 'vec4'
      | 'ivec2'
      | 'textureSize'
      | 'uv'
      | 'rtt'
      | 'convertToTexture'
  ]: (...args: TslEffectNode[]) => TslEffectNode
}

export class SourceCompositorUnsupported extends Error {}

export interface BuiltSourceCompositor {
  node: TslEffectNode
  dispose(): void
}

/** Blender's separable Gaussian includes the fractional radius's final tap. */
export function blenderGaussianWeights(radius: number): number[] {
  if (!Number.isFinite(radius) || radius < 0 || radius > 128) {
    throw new SourceCompositorUnsupported(
      'Gaussian Blur requires a constant radius between 0 and 128 pixels per axis',
    )
  }
  if (radius === 0) return [1]
  const weights = Array.from({ length: Math.ceil(radius) + 1 }, (_, i) =>
    Math.exp(-4.5 * (i / radius) ** 2),
  )
  const total = weights[0]! + 2 * weights.slice(1).reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

function hueBasis(hue: TslEffectNode): TslEffectNode {
  const phase = hue.mul(6)
  return vec3(clamp(abs(phase.sub(3)).sub(1), 0, 1),
    clamp(float(2).sub(abs(phase.sub(2))), 0, 1),
    clamp(float(2).sub(abs(phase.sub(4))), 0, 1))
}

function compositorRgbToHsl(color: TslEffectNode, device: unknown): TslEffectNode {
  const high = max(color.r, max(color.g, color.b))
  const low = min(color.r, min(color.g, color.b))
  const delta = high.sub(low)
  const gray = high.equal(low)
  const safeDelta = select(gray, 1, delta)
  const lightness = min(high.add(low).mul(0.5), 1)
  // Blender's GPU compiler groups the extrema sum; this matters near the
  // saturation singularity even though the two formulas are algebraically equal.
  const upperDivisor = device === 'GPU' ? float(2).sub(high.add(low)) : float(2).sub(high).sub(low)
  const divisor = select(lightness.greaterThan(0.5), upperDivisor, high.add(low))
  const saturation = select(gray, 0, delta.div(select(gray, 1, divisor)))
  const hue = select(high.equal(color.r),
    color.g.sub(color.b).div(safeDelta).add(select(color.g.lessThan(color.b), 6, 0)),
    select(high.equal(color.g), color.b.sub(color.r).div(safeDelta).add(2),
      color.r.sub(color.g).div(safeDelta).add(4))).div(6)
  return vec3(select(gray, 0, hue), saturation, lightness)
}

function compositorHsvToRgb(color: TslEffectNode, device: unknown): TslEffectNode {
  if (device === 'CPU') return hueBasis(color.x).sub(1).mul(color.y).add(1).mul(color.z)
  if (device !== 'GPU') throw new SourceCompositorUnsupported('HSV combination has no verified compositor device')
  // Blender's GPU sextant default also handles negative Hue. The shared
  // shader helper's ordinary0..1 hue path remains the same.
  const ordinary = blenderHsvToRgb(color) as TslEffectNode
  const p = color.z.mul(float(1).sub(color.y))
  const q = color.z.mul(float(1).sub(color.y.mul(fract(color.x.mul(6)))))
  return select(color.x.lessThan(0), vec3(color.z, p, q), ordinary)
}

/** A complete graph builds or refuses; a partial branch never replaces Combined. */
export function buildSourceCompositor(
  program: SourceCompositorProgram,
  resolvePass: (pass: NonNullable<SourceCompositorOperation['pass']>) => TslEffectNode | null,
): BuiltSourceCompositor {
  const resources: { dispose(): void }[] = []
  const dispose = (): void => {
    for (const resource of resources.splice(0).reverse()) resource.dispose()
  }
  try {
    if (
      program.version !== 1 ||
      program.status !== 'extracted' ||
      !program.output ||
      program.ops.length > 2048
    ) {
      throw new SourceCompositorUnsupported(
        program.diagnostics
          .map((d) => `${d.path.join(' / ')} / ${d.node}: ${d.message}`)
          .join('; ') || 'Unsupported compositor graph',
      )
    }
    const nodes = new Map<string, TslEffectNode>()
    const singleValues = new Set<string>()
    const isSingleValue = (v: CompositorValue): boolean =>
      v.kind === 'constant' ||
      (v.kind === 'ref' && !!v.node && singleValues.has(v.node)) ||
      (v.kind === 'convert' && !!v.input && isSingleValue(v.input))
    function value(v: CompositorValue): TslEffectNode {
      if (v.kind === 'ref') {
        if (!v.node || !nodes.has(v.node))
          throw new SourceCompositorUnsupported('Compositor reference is missing or cyclic')
        return nodes.get(v.node)
      }
      if (v.kind === 'convert' && v.input) {
        const input = value(v.input)
        if (v.type === v.fromType) return input
        if (v.fromType === 'VALUE' && v.type === 'RGBA') return vec4(vec3(input), 1)
        if (v.fromType === 'RGBA' && v.type === 'VALUE')
          return dot(input.rgb, vec3(...(program.luminance ?? [0.2126, 0.7152, 0.0722])))
        // Other conversions require Blender's compositor-specific semantics.
        throw new SourceCompositorUnsupported(
          `Compositor conversion ${v.fromType} to ${v.type} is unsupported`,
        )
      }
      if (v.kind === 'constant') {
        if (v.type === 'VALUE' && typeof v.value === 'number' && Number.isFinite(v.value))
          return float(v.value)
        if (
          v.type === 'RGBA' &&
          Array.isArray(v.value) &&
          v.value.length === 4 &&
          v.value.every((n) => typeof n === 'number' && Number.isFinite(n))
        )
          return vec4(...v.value)
      }
      throw new SourceCompositorUnsupported(`Unsupported compositor value type ${v.type}`)
    }
    for (const op of program.ops) {
      const input = (name: string): TslEffectNode => {
        if (!op.inputs[name]) throw new SourceCompositorUnsupported(`Missing input ${name}`)
        return value(op.inputs[name]!.value)
      }
      const constant = (name: string): unknown => {
        const v = op.inputs[name]?.value
        if (v?.kind !== 'constant')
          throw new SourceCompositorUnsupported(`${name} requires a constant setting`)
        return v.value
      }
      let node: TslEffectNode
      try {
        switch (op.kind) {
          case 'blur': {
            if (
              constant('Type') !== 'Gaussian' ||
              constant('Extend Bounds') ||
              !constant('Separable')
            ) {
              throw new SourceCompositorUnsupported(
                'Blur supports separable Gaussian with Extend Bounds disabled',
              )
            }
            const size = constant('Size')
            if (
              !Array.isArray(size) ||
              size.length !== 2 ||
              !size.every((n) => typeof n === 'number')
            ) {
              throw new SourceCompositorUnsupported('Blur Size requires two constant pixel radii')
            }
            const weights = size.map(blenderGaussianWeights)
            node = input('Image')
            for (let axis = 0; axis < 2; axis++) {
              const taps = weights[axis]!
              if (taps.length === 1) continue
              const image = convertToTexture(node, null, null, {
                type: FloatType,
                depthBuffer: false,
              })
              if (image !== node) resources.push(image)
              const dimensions = textureSize(image)
              const center = ivec2(uv().mul(dimensions))
              const sample = (offset: number): TslEffectNode =>
                image.load(
                  clamp(
                    center.add(ivec2(axis === 0 ? offset : 0, axis === 1 ? offset : 0)),
                    ivec2(0),
                    ivec2(dimensions).sub(1),
                  ),
                )
              let sum = sample(0).mul(taps[0])
              for (let offset = 1; offset < taps.length; offset++)
                sum = sum.add(sample(-offset).add(sample(offset)).mul(taps[offset]))
              node = rtt(sum, null, null, { type: FloatType, depthBuffer: false })
              resources.push(node)
            }
            break
          }
          case 'glare': {
            const image = input('Image')
            // Blender skips the filter for a single-value image socket. A
            // spatially uniform texture is still an image and must be filtered.
            const imageValue = op.inputs.Image!.value
            if (isSingleValue(imageValue)) {
              node = op.source.output === 'Image' ? image : vec4(0)
              break
            }
            const smoothMin = (
              a: TslEffectNode,
              b: TslEffectNode,
              smoothing: TslEffectNode,
            ): TslEffectNode => {
              const safe = max(smoothing, 1e-20)
              const h = max(smoothing.sub(abs(a.sub(b))), 0).div(safe)
              return min(a, b).sub(h.mul(h).mul(smoothing).mul(0.25))
            }
            const threshold = max(input('Highlights Threshold'), 0)
            const upper = constant('Clamp Highlights')
              ? threshold.add(max(input('Maximum Highlights'), 0))
              : float(3.4028234663852886e38)
            const softness = max(input('Highlights Smoothness'), 0)
            const lowerSmoothness = min(min(softness, threshold), upper.sub(threshold))
            const upperSmoothness = min(min(softness, upper), upper.sub(threshold))
            const highlight = (color: TslEffectNode): TslEffectNode => {
              const hsv = blenderRgbToHsv(color.rgb) as TslEffectNode
              const value = smoothMin(
                upper,
                smoothMin(threshold.negate(), hsv.z.negate(), lowerSmoothness).negate(),
                upperSmoothness,
              ).sub(threshold)
              return vec4(blenderHsvToRgb(vec3(hsv.xy, value)), 1)
            }
            const highlightsOnly = op.source.output === 'Highlights'
            if (!highlightsOnly && constant('Type') !== 'Bloom')
              throw new SourceCompositorUnsupported(
                'Glare supports Bloom and the Highlights output; this mode needs a different spatial kernel',
              )
            const quality = constant('Quality')
            const qualityFactor =
              quality === 'High' ? 1 : quality === 'Medium' ? 2 : quality === 'Low' ? 4 : 0
            if (!qualityFactor)
              throw new SourceCompositorUnsupported(`Unknown Glare quality ${String(quality)}`)
            const size = constant('Size')
            if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > 1) {
              throw new SourceCompositorUnsupported(
                'Glare Size requires a constant between 0 and 1',
              )
            }
            const bloom = buildBlenderBloom(image, highlight, size, qualityFactor, highlightsOnly)
            resources.push(bloom)
            if (highlightsOnly) {
              node = bloom.node
              break
            }
            const bloomHsv = blenderRgbToHsv(bloom.node.rgb) as TslEffectNode
            const saturated = blenderHsvToRgb(
              vec3(
                bloomHsv.x,
                clamp(bloomHsv.y.mul(max(input('Saturation'), 0)), 0, 1),
                bloomHsv.z,
              ),
            )
            const adjusted = saturated.mul(input('Tint').rgb).mul(max(input('Strength'), 0))
            if (op.source.output === 'Glare') node = vec4(adjusted, 1)
            else if (op.source.output === 'Image')
              node = vec4(max(image.rgb, 0).add(adjusted), max(image.a, 0))
            else throw new SourceCompositorUnsupported(`Unknown Glare output ${op.source.output}`)
            break
          }
          case 'render-pass': {
            if (!op.pass) throw new SourceCompositorUnsupported('Missing render pass identity')
            node = resolvePass(op.pass)
            if (!node)
              throw new SourceCompositorUnsupported(
                `Render pass ${op.pass.viewLayer} / ${op.pass.name} needs a runtime pass provider`,
              )
            break
          }
          case 'rgb':
          case 'value':
            node = value({ kind: 'constant', type: op.type, value: op.value })
            break
          case 'exposure': {
            const color = input('Image')
            node = vec4(color.rgb.mul(pow(2, input('Exposure'))), color.a)
            break
          }
          case 'gamma': {
            const color = input('Color')
            node = vec4(
              vec3(
                ...['r', 'g', 'b'].map((c) =>
                  select(color[c].greaterThan(0), pow(max(color[c], 0), input('Gamma')), color[c]),
                ),
              ),
              color.a,
            )
            break
          }
          case 'brightness-contrast': {
            const color = input('Image'),
              brightness = input('Bright').div(100),
              contrast = input('Contrast').div(200)
            const positive = float(1).div(max(float(1).sub(contrast.mul(2)), 1.1920928955078125e-7))
            const negative = max(float(1).add(contrast.mul(2)), 0)
            const slope = select(contrast.greaterThan(0), positive, negative)
            const offset = select(
              contrast.greaterThan(0),
              slope.mul(brightness.sub(contrast)),
              slope.mul(brightness).sub(contrast),
            )
            node = vec4(color.rgb.mul(slope).add(offset), color.a)
            break
          }
          case 'separate-color': {
            const color = input('Image')
            if (!['RGB', 'HSV', 'HSL'].includes(String(op.properties.mode)))
              throw new SourceCompositorUnsupported('Separate Color supports RGB, HSV and HSL; YUV/YCC need verified color-model mappings')
            const channel = ({ Red: 'x', Green: 'y', Blue: 'z', Alpha: 'w',
              R: 'x', G: 'y', B: 'z', A: 'w' } as Record<string, string>)[op.source.output]
            if (!channel) throw new SourceCompositorUnsupported('Separate Color has an unknown output channel')
            if (channel === 'w') { node = color.a; break }
            if (op.properties.mode === 'RGB') node = color[channel]
            else if (op.properties.mode === 'HSV') node = (blenderRgbToHsv(color.rgb) as TslEffectNode)[channel]
            else if (op.properties.mode === 'HSL') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSL separation has no verified compositor device')
              node = compositorRgbToHsl(color.rgb, isSingleValue(op.inputs.Image!.value)
                ? 'CPU' : op.properties.color_conversion_device)[channel]
            }
            else throw new SourceCompositorUnsupported('Separate Color supports RGB, HSV and HSL; YUV/YCC need verified color-model mappings')
            break
          }
          case 'combine-color': {
            const channels = vec3(input('Red'), input('Green'), input('Blue'))
            let color: TslEffectNode
            if (op.properties.mode === 'RGB') color = channels
            else if (op.properties.mode === 'HSV') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSV combination has no verified compositor device')
              const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
              color = compositorHsvToRgb(channels, single ? 'CPU' : op.properties.color_conversion_device)
              if (typeof op.properties.legacy_hsv_clamp !== 'boolean')
                throw new SourceCompositorUnsupported('HSV combination has no verified clamp model')
              if (op.properties.legacy_hsv_clamp) color = max(color, 0)
            } else if (op.properties.mode === 'HSL') {
              if (!['CPU', 'GPU'].includes(String(op.properties.color_conversion_device)))
                throw new SourceCompositorUnsupported('HSL combination has no verified compositor device')
              if (typeof op.properties.legacy_hsl_clamp !== 'boolean')
                throw new SourceCompositorUnsupported('HSL combination has no verified clamp model')
              const chroma = float(1).sub(abs(channels.z.mul(2).sub(1))).mul(channels.y)
              color = hueBasis(channels.x).sub(0.5).mul(chroma).add(channels.z)
              const single = Object.values(op.inputs).every(input => isSingleValue(input.value))
              if (op.properties.legacy_hsl_clamp || (!single && op.properties.color_conversion_device === 'GPU'))
                color = max(color, 0)
            } else throw new SourceCompositorUnsupported('Combine Color supports RGB, HSV and HSL; YUV/YCC need verified color-model mappings')
            node = vec4(color, input('Alpha'))
            break
          }
          case 'color-balance': {
            const model = op.properties.color_balance_model
            if (model !== 'linear' && model !== 'legacy-srgb')
              throw new SourceCompositorUnsupported('Color Balance has no verified color model')
            const color = input('Image')
            const mode = constant('Type')
            const product = (name: string): TslEffectNode => input('Color ' + name).rgb.mul(input('Base ' + name))
            const offset = (name: string): TslEffectNode => input('Color ' + name).rgb.add(input('Base ' + name))
            let balanced: TslEffectNode
            if (mode === 'Lift/Gamma/Gain') {
              // TSL select is scalar control flow, so transfer-function branch
              // decisions must be made independently for each color channel.
              const toSrgb = (linear: TslEffectNode): TslEffectNode => vec3(...['r', 'g', 'b'].map(c => select(
                linear[c].lessThan(0.0031308), max(linear[c], 0).mul(12.92),
                pow(max(linear[c], 0), 1 / 2.4).mul(1.055).sub(0.055),
              )))
              const toLinear = (srgb: TslEffectNode): TslEffectNode => vec3(...['r', 'g', 'b'].map(c => select(
                srgb[c].lessThan(0.04045), max(srgb[c], 0).div(12.92),
                pow(max(srgb[c].add(0.055).div(1.055), 0), 2.4),
              )))
              const source = model === 'legacy-srgb' ? toSrgb(color.rgb) : color.rgb
              const lifted = source.sub(1).mul(vec3(2).sub(offset('Lift'))).add(1)
              const gained = max(lifted.mul(product('Gain')), 0)
              const gamma = product('Gamma')
              const safeGamma = model === 'legacy-srgb'
                ? vec3(...['r', 'g', 'b'].map(c => select(gamma[c].equal(0), 1e-6, gamma[c])))
                : max(gamma, 1e-6)
              balanced = pow(model === 'legacy-srgb' ? toLinear(gained) : gained, vec3(1).div(safeGamma))
            } else if (mode === 'Offset/Power/Slope (ASC-CDL)') {
              balanced = pow(max(color.rgb.mul(product('Slope')).add(offset('Offset')), 0), product('Power'))
            } else {
              throw new SourceCompositorUnsupported('Color Balance supports Lift/Gamma/Gain and ASC-CDL; White Point needs a verified chromatic-adaptation mapping')
            }
            // Blender caps only the upper factor bound and preserves input alpha.
            node = vec4(mix(color.rgb, balanced, min(input('Fac'), 1)), color.a)
            break
          }
          case 'hue-saturation-value': {
            const color = input('Image'),
              hsv = blenderRgbToHsv(color.rgb) as TslEffectNode
            const changed = blenderHsvToRgb(
              vec3(
                fract(hsv.x.add(input('Hue')).sub(0.5)),
                hsv.y.mul(input('Saturation')),
                hsv.z.mul(input('Value')),
              ),
            )
            node = vec4(mix(color.rgb, max(changed, 0), input('Fac')), color.a)
            break
          }
          case 'mix-rgb':
          case 'mix': {
            const modern = op.kind === 'mix'
            if (modern && op.properties.data_type !== 'RGBA' && op.properties.data_type !== 'FLOAT')
              throw new SourceCompositorUnsupported('Mix supports Float and Color inputs')
            const scalar = modern && op.properties.data_type === 'FLOAT'
            let factor = input(modern ? 'Factor_Float' : 'Fac')
            if (!modern || op.properties.clamp_factor) factor = clamp(factor, 0, 1)
            const a = input(modern ? (scalar ? 'A_Float' : 'A_Color') : 'Color1')
            const b = input(modern ? (scalar ? 'B_Float' : 'B_Color') : 'Color2')
            const operation = scalar ? 'MIX' : String(op.properties.blend_type)
            if (operation === 'MIX') node = mix(a, b, factor)
            else {
              let rgb: TslEffectNode
              switch (operation) {
                case 'ADD':
                  rgb = a.rgb.add(b.rgb.mul(factor))
                  break
                case 'SUBTRACT':
                  rgb = a.rgb.sub(b.rgb.mul(factor))
                  break
                case 'MULTIPLY':
                  rgb = mix(a.rgb, a.rgb.mul(b.rgb), factor)
                  break
                case 'SCREEN':
                  rgb = vec3(1).sub(
                    vec3(1)
                      .sub(a.rgb)
                      .mul(vec3(1).sub(b.rgb.mul(factor))),
                  )
                  break
                case 'DIFFERENCE':
                  rgb = mix(a.rgb, abs(a.rgb.sub(b.rgb)), factor)
                  break
                default:
                  throw new SourceCompositorUnsupported(`Mix mode ${operation} is unsupported`)
              }
              node = vec4(rgb, a.a)
            }
            if (op.properties.use_clamp || op.properties.clamp_result) node = clamp(node, 0, 1)
            break
          }
          case 'invert': {
            const color = input('Color'),
              factor = input('Fac')
            const rgb = constant('Invert Color')
              ? mix(color.rgb, vec3(1).sub(color.rgb), factor)
              : color.rgb
            const alpha = constant('Invert Alpha')
              ? mix(color.a, float(1).sub(color.a), factor)
              : color.a
            node = vec4(rgb, alpha)
            break
          }
          case 'math': {
            if (op.properties.operation === 'POWER') {
              const first = op.inputs.Value?.value, second = op.inputs.Value_001?.value
              if (first?.kind === 'constant' && first.value === 0 && second?.kind === 'constant'
                  && typeof second.value === 'number' && second.value < 0) {
                throw new SourceCompositorUnsupported('Zero raised to a negative power produces non-finite compositor pixels in Blender')
              }
            }
            if (op.source.nodeType === 'CompositorNodeMath' && op.properties.operation === 'LOGARITHM') {
              const base = constant('Value_001')
              if (typeof base !== 'number' || !Number.isFinite(base) || base === 1) {
                throw new SourceCompositorUnsupported('Legacy compositor Logarithm requires a fixed base other than 1; Blender can produce non-finite pixels')
              }
            }
            try {
              node = buildTslMathOperation(
                String(op.properties.operation), input('Value'),
                () => input('Value_001'), () => input('Value_002'),
              )
            } catch (error) {
              throw new SourceCompositorUnsupported(error instanceof Error ? error.message : String(error))
            }
            const legacyMath = op.source.nodeType === 'CompositorNodeMath'
            if (op.properties.operation === 'ROUND') {
              const a = input('Value')
              // Legacy compositor roundf uses half-away; modern shared Math
              // uses floor(x + .5). Preserve the authored Blender model.
              const magnitude = floor(abs(a).add(.5))
              node = legacyMath ? select(a.lessThan(0), magnitude.negate(), magnitude) : floor(a.add(.5))
            } else if (legacyMath && ['ARCSINE', 'ARCCOSINE'].includes(String(op.properties.operation))) {
              node = select(abs(input('Value')).greaterThan(1), 0, node)
            }
            if (op.properties.use_clamp) node = clamp(node, 0, 1)
            break
          }
          case 'alpha-over': {
            if (constant('Type') !== 'Over')
              throw new SourceCompositorUnsupported('Only standard Alpha Over is supported')
            const back = input('Background'),
              front = input('Foreground'),
              factor = input('Fac')
            const foreground = constant('Straight Alpha')
              ? vec4(front.rgb.mul(front.a), front.a)
              : front
            node = mix(back, foreground.add(back.mul(float(1).sub(clamp(front.a, 0, 1)))), factor)
            break
          }
          default:
            throw new SourceCompositorUnsupported(
              `Compositor ${op.kind} is not supported by this runtime`,
            )
        }
      } catch (error) {
        if (error instanceof SourceCompositorUnsupported)
          throw new SourceCompositorUnsupported(
            `${op.source.path.join(' / ')} / ${op.source.node} [${op.source.output}]: ${error.message}`,
          )
        throw error
      }
      nodes.set(op.id, node)
      if (
        op.kind !== 'render-pass' &&
        Object.values(op.inputs).every((input) => isSingleValue(input.value))
      )
        singleValues.add(op.id)
    }
    return { node: value(program.output), dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
