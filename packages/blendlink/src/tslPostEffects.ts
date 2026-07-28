/**
 * Blendlink-owned TSL display effects for the WebGPU post pipeline
 * (Phase 4 Track B). Each factory mirrors the math of the shipped pmndrs
 * GLSL effect in threeComponents.ts — the WGPU-NODE-001 fixture harness
 * measures every one of them against that shipped control, so changes here
 * must re-run `npm run test:wgpu-node-postprocessing`.
 *
 * This module imports from `three/tsl` and is exported ONLY through the
 * `blendlink/three/tsl-effects` subpath: importing it pulls three's node
 * system into the bundle, which WebGL-only applications must not pay for.
 */
import {
  Fn,
  If,
  Loop,
  abs,
  atan,
  clamp,
  convertToTexture,
  cos,
  float,
  floor,
  int,
  length,
  mat2,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportSize,
} from 'three/tsl'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'

/** TSL expressions are dynamically typed proxies; the public surface keeps
 * one honest alias instead of pretending three's node generics compose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TslEffectNode = any

type Knob = number | TslEffectNode

const knob = (value: Knob): TslEffectNode =>
  typeof value === 'number' ? float(value) : value

/** @types/three's mix() overload matrix rejects valid mixed-genericity TSL
 * calls; one loose alias keeps every call site honest and readable. */
const mixNodes = mix as (
  a: TslEffectNode, b: TslEffectNode, t: TslEffectNode,
) => TslEffectNode

const knobVec2 = (value: readonly [number, number] | TslEffectNode): TslEffectNode =>
  Array.isArray(value) ? vec2(value[0], value[1]) : value

const knobVec3 = (value: readonly [number, number, number] | TslEffectNode): TslEffectNode =>
  Array.isArray(value) ? vec3(value[0], value[1], value[2]) : value

export interface BlendlinkVignetteOptions {
  /** 0..1 edge darkening strength (shipped default 0.25). */
  intensity?: Knob
  /** 0.001..1 falloff width (shipped default 0.55). */
  softness?: Knob
  /** Linear RGB tint the edges converge to (shipped default black). */
  tint?: readonly [number, number, number] | TslEffectNode
}

/** Mirror of the shipped BlendlinkVignette GLSL: distance from screen
 * center normalized by sqrt(2) so corners reach exactly 1. */
export function blendlinkVignette(
  node: TslEffectNode,
  options: BlendlinkVignetteOptions = {},
): TslEffectNode {
  const intensity = knob(options.intensity ?? 0.25)
  const softness = knob(options.softness ?? 0.55)
  const tint = knobVec3(options.tint ?? [0, 0, 0])
  const input: TslEffectNode = vec4(node)
  const distanceToCenter = length(uv().sub(0.5).mul(1.41421356237))
  const edge = smoothstep(float(1).sub(softness), 1, distanceToCenter).mul(intensity)
  return vec4(mixNodes(input.rgb, tint, edge), input.a)
}

export interface BlendlinkRadialChromaticAberrationOptions {
  /** 0..0.05 shift amount in UV units (shipped default 0.0015). */
  amount?: Knob
  /** Effect center in UV space (shipped default screen center). */
  center?: readonly [number, number] | TslEffectNode
}

/** Mirror of the shipped BlendlinkRadialChromaticAberration GLSL: an
 * aspect-corrected radial direction, R shifted outward and B inward with
 * distance-scaled falloff clamped at 1.5; G stays put. */
export function blendlinkRadialChromaticAberration(
  node: TslEffectNode,
  options: BlendlinkRadialChromaticAberrationOptions = {},
): TslEffectNode {
  const amount = knob(options.amount ?? 0.0015)
  const center = knobVec2(options.center ?? [0.5, 0.5])
  const inputTexture = convertToTexture(node)
  return Fn(() => {
    const aspect = viewportSize.x.div(viewportSize.y)
    const uvNode = uv()
    const fromCenter = uvNode.sub(center).toVar()
    const roundSpace = vec2(fromCenter.x.mul(aspect), fromCenter.y).toVar()
    const distanceFromCenter = length(roundSpace).toVar()
    const direction = vec2(
      roundSpace.x.div(max(aspect, 0.000001)),
      roundSpace.y,
    ).div(max(distanceFromCenter, 0.000001)).toVar()
    const shift = direction
      .mul(amount)
      .mul(clamp(distanceFromCenter.mul(2), 0, 1.5))
      .toVar()
    const redUv = clamp(uvNode.add(shift), vec2(0), vec2(1))
    const blueUv = clamp(uvNode.sub(shift), vec2(0), vec2(1))
    const input = inputTexture.sample(uvNode)
    const red = inputTexture.sample(redUv).r
    const blue = inputTexture.sample(blueUv).b
    return vec4(red, input.g, blue, input.a)
  })()
}

export interface BlendlinkTiltShiftOptions {
  /** 0..1 vertical position of the sharp band (shipped default 0.5). */
  focusPosition?: Knob
  /** Band rotation in radians (shipped control takes degrees; callers of
   * this node pass radians, matching three's conventions). */
  rotation?: Knob
  /** 0.001..1 blur ramp width outside the sharp band (default 0.25). */
  feather?: Knob
  /** 0..1 blend of the blurred result (shipped default 0.7). */
  strength?: Knob
  /** Blur kernel sigma (quality knob; shipped MEDIUM kernel ≈ 3). */
  sigma?: number
}

/** Mirror of the shipped tilt-shift configuration: a rotated sharp band at
 * focusPosition with feathered gaussian blur outside it. The shipped pmndrs
 * effect blurs at half resolution with a kernel convolution; this node uses
 * the in-tree gaussian blur with an equivalent footprint. */
export function blendlinkTiltShift(
  node: TslEffectNode,
  options: BlendlinkTiltShiftOptions = {},
): TslEffectNode {
  const focusPosition = knob(options.focusPosition ?? 0.5)
  const rotation = knob(options.rotation ?? 0)
  const feather = knob(options.feather ?? 0.25)
  const strength = knob(options.strength ?? 0.7)
  const focusArea = float(0.4)
  const sharp = convertToTexture(node)
  const blurred = gaussianBlur(node, vec2(1, 1), options.sigma ?? 3)
  return Fn(() => {
    const uvNode = uv()
    const centered = uvNode.sub(vec2(0.5, focusPosition)).toVar()
    const rotated = mat2(
      cos(rotation), sin(rotation).negate(),
      sin(rotation), cos(rotation),
    ).mul(centered).toVar()
    const band = abs(rotated.y)
    const mask = smoothstep(focusArea, focusArea.add(feather), band.mul(2))
      .mul(strength)
    const sharpSample: TslEffectNode = sharp.sample(uvNode)
    const blurredColor: TslEffectNode = vec4(blurred)
    return vec4(mixNodes(sharpSample.rgb, blurredColor.rgb, mask), sharpSample.a)
  })()
}

export interface BlendlinkKuwaharaOptions {
  /** 0..1 blend with the painted result (shipped default 0.75). */
  strength?: Knob
  /** 1..32 brush radius in texels (shipped default 4). */
  brushScale?: Knob
  /** 0..1 how strongly strokes follow image structure (default 0.75). */
  directionality?: Knob
  /** 0..1 stroke tightness (default 0.5). */
  detail?: Knob
  /** Samples per sector, max 16 (shipped quality tiers 8/12/16). */
  sampleCount?: Knob
  /** Shipped quality tiers 0.75/1/1.15. */
  qualityScale?: Knob
}

/** Mirror of the shipped BlendlinkAnisotropicKuwahara GLSL: structure-tensor
 * orientation/anisotropy, four elliptical sectors of up to 16 weighted
 * samples, inverse-variance-squared sector blending. */
export function blendlinkAnisotropicKuwahara(
  node: TslEffectNode,
  options: BlendlinkKuwaharaOptions = {},
): TslEffectNode {
  const strength = knob(options.strength ?? 0.75)
  const brushScale = knob(options.brushScale ?? 4)
  const directionality = knob(options.directionality ?? 0.75)
  const detail = knob(options.detail ?? 0.5)
  const sampleCount = knob(options.sampleCount ?? 12)
  const qualityScale = knob(options.qualityScale ?? 1)
  const inputTexture = convertToTexture(node)

  const luma = (color: TslEffectNode): TslEffectNode =>
    color.dot(vec3(0.2126, 0.7152, 0.0722))

  return Fn(() => {
    const texelSize = vec2(1, 1).div(viewportSize).toVar()
    const uvNode = uv()
    const tap = (offset: TslEffectNode): TslEffectNode =>
      luma(inputTexture.sample(clamp(uvNode.add(offset), vec2(0), vec2(1))).rgb)
    const left = tap(vec2(texelSize.x.negate(), 0))
    const right = tap(vec2(texelSize.x, 0))
    const down = tap(vec2(0, texelSize.y.negate()))
    const up = tap(vec2(0, texelSize.y))
    const gx = right.sub(left).toVar()
    const gy = up.sub(down).toVar()
    const jxx = gx.mul(gx).toVar()
    const jyy = gy.mul(gy).toVar()
    const jxy = gx.mul(gy).toVar()
    const orientation = atan(jxy.mul(2), jxx.sub(jyy)).mul(0.5).toVar()
    const anisotropy = clamp(
      sqrt(
        jxx.sub(jyy).mul(jxx.sub(jyy)).add(jxy.mul(jxy).mul(4)),
      ).div(jxx.add(jyy).add(0.0001)),
      0,
      1,
    ).toVar()

    const minorAxis = mix(float(1), float(0.35), directionality.mul(anisotropy)).toVar()
    const radius = knob(brushScale).mul(qualityScale)
      .mul(mix(float(1.15), float(0.65), detail.mul(anisotropy))).toVar()
    const rotation = mat2(
      cos(orientation), sin(orientation).negate(),
      sin(orientation), cos(orientation),
    ).toVar()

    const means: TslEffectNode[] = []
    const weights: TslEffectNode[] = []
    for (const sectorAngle of [0, 1.57079632679, 3.14159265359, 4.71238898038]) {
      const sum = vec3(0).toVar()
      const sumSquared = vec3(0).toVar()
      const totalWeight = float(0).toVar()
      Loop({ start: int(0), end: int(16), type: 'int' }, ({ i }: { i: TslEffectNode }) => {
        If(float(i).lessThan(sampleCount), () => {
          const fi = float(i)
          const ring = floor(fi.div(4)).add(1).div(4)
          const fan = fi.mod(4).sub(1.5).mul(0.36)
          const angle = fan.add(sectorAngle)
          const disk = vec2(cos(angle), sin(angle)).mul(ring).toVar()
          const radial = max(float(0), float(1).sub(disk.dot(disk)))
          const angular = max(float(0), cos(fan))
          const weight = max(
            float(0.0001),
            radial.mul(radial).mul(angular).mul(angular),
          ).toVar()
          const ellipse = rotation.mul(vec2(disk.x, disk.y.mul(minorAxis)))
          const sampleUv = clamp(
            uvNode.add(ellipse.mul(radius).mul(texelSize)), vec2(0), vec2(1),
          )
          const sampleColor = inputTexture.sample(sampleUv).rgb.toVar()
          sum.addAssign(sampleColor.mul(weight))
          sumSquared.addAssign(sampleColor.mul(sampleColor).mul(weight))
          totalWeight.addAssign(weight)
        })
      })
      const mean = sum.div(max(totalWeight, 0.0001)).toVar()
      const channelVariance = max(
        sumSquared.div(max(totalWeight, 0.0001)).sub(mean.mul(mean)),
        vec3(0),
      )
      const variance = channelVariance.dot(vec3(0.299, 0.587, 0.114))
      means.push(mean)
      weights.push(float(1).div(variance.add(0.0001).mul(variance.add(0.0001))).toVar())
    }
    const filtered = means[0]!.mul(weights[0]!)
      .add(means[1]!.mul(weights[1]!))
      .add(means[2]!.mul(weights[2]!))
      .add(means[3]!.mul(weights[3]!))
      .div(max(weights[0]!.add(weights[1]!).add(weights[2]!).add(weights[3]!), 0.0001))
    const input = inputTexture.sample(uvNode)
    return vec4(mixNodes(input.rgb, filtered, strength), input.a)
  })()
}

export interface BlendlinkGeometryAwarePixelationOptions {
  /** Device-pixel block size (shipped default 6 css px × pixel ratio). */
  pixelSize?: Knob
  /** 0..1 depth-discontinuity edge emphasis. */
  depthEdgeStrength?: Knob
  /** 0..1 normal-discontinuity edge emphasis; requires normalNode. */
  normalEdgeStrength?: Knob
}

export interface BlendlinkGeometryAwarePixelationInputs {
  /** Scene color (any node; converted to a sampleable texture). */
  color: TslEffectNode
  /** Raw scene depth texture node (a PassNode's 'depth' texture). */
  depth: TslEffectNode
  /** Scene normal texture node encoded 0..1, or null when normal edges
   * are disabled. */
  normal?: TslEffectNode | null
  /** The scene camera; near/far snapshot into the viewZ reconstruction. */
  camera: { near: number; far: number }
}

/** Mirror of the shipped BlendlinkGeometryAwarePixelation GLSL: block-snapped
 * sampling with relative-viewZ and normal-difference edges darkening block
 * borders by the shipped 0.82 factor. */
export function blendlinkGeometryAwarePixelation(
  inputs: BlendlinkGeometryAwarePixelationInputs,
  options: BlendlinkGeometryAwarePixelationOptions = {},
): TslEffectNode {
  const pixelSize = knob(options.pixelSize ?? 6)
  const depthEdgeStrength = knob(options.depthEdgeStrength ?? 0)
  const normalEdgeStrength = knob(options.normalEdgeStrength ?? 0)
  const colorTexture = convertToTexture(inputs.color)
  const depthTexture = inputs.depth
  const normalTexture = inputs.normal ?? null
  const cameraNear = uniform(inputs.camera.near)
  const cameraFar = uniform(inputs.camera.far)

  return Fn(() => {
    const safeResolution = max(viewportSize, vec2(1)).toVar()
    const block = vec2(max(pixelSize, 1)).toVar()
    const uvNode = uv()
    const cell = floor(uvNode.mul(safeResolution).div(block)).mul(block)
      .add(block.mul(0.5))
    const sampleUv = clamp(cell.div(safeResolution), vec2(0), vec2(1)).toVar()
    const stepUv = block.div(safeResolution).toVar()
    const rightUv = sampleUv.add(vec2(stepUv.x, 0)).toVar()
    const upUv = sampleUv.add(vec2(0, stepUv.y)).toVar()

    const viewZ = (at: TslEffectNode): TslEffectNode => perspectiveDepthToViewZ(
      depthTexture.sample(clamp(at, vec2(0), vec2(1))).r,
      cameraNear,
      cameraFar,
    )
    const relativeDepthDifference = (a: TslEffectNode, b: TslEffectNode): TslEffectNode => {
      const viewA = viewZ(a).toVar()
      const viewB = viewZ(b).toVar()
      return abs(viewA.sub(viewB)).div(max(min(abs(viewA), abs(viewB)), 0.0001))
    }
    const depthEdge = max(
      relativeDepthDifference(sampleUv, rightUv),
      relativeDepthDifference(sampleUv, upUv),
    ).toVar()

    let normalEdge: TslEffectNode = float(0)
    if (normalTexture) {
      const decodedNormal = (at: TslEffectNode): TslEffectNode => normalize(
        normalTexture.sample(clamp(at, vec2(0), vec2(1))).xyz.mul(2).sub(1),
      )
      const normalDifference = (a: TslEffectNode, b: TslEffectNode): TslEffectNode =>
        float(1).sub(clamp(decodedNormal(a).dot(decodedNormal(b)), 0, 1))
      normalEdge = max(
        normalDifference(sampleUv, rightUv),
        normalDifference(sampleUv, upUv),
      )
    }

    const edge = clamp(
      max(
        depthEdge.mul(depthEdgeStrength),
        normalEdge.mul(normalEdgeStrength),
      ).mul(4),
      0,
      1,
    )
    const pixelColor = colorTexture.sample(sampleUv)
    return vec4(pixelColor.rgb.mul(float(1).sub(edge.mul(0.82))), pixelColor.a)
  })()
}
