/**
 * Phase 4 Track B: the WebGPU post pipeline behind the unchanged
 * PostPipelineService interface. Where the WebGL service assembles pmndrs
 * EffectComposer passes, this one assembles a TSL node chain rendered by
 * three's RenderPipeline: one scene pass (with exactly the MRT targets the
 * registered effects need), per-effect chain wraps in the same phase order,
 * an explicit renderOutput() boundary between HDR and LDR effects, and TRAA
 * as the signed-off anti-aliasing default (suppressed by intentional
 * pixelation, exactly like the WebGL SMAA policy).
 *
 * Reporting re-spec (per the Phase 4 plan): the synthetic
 * 'scene-normals'/'tone-mapping' resolvedOrder entries do not exist here —
 * MRT targets ride the scene pass and tone mapping is the renderOutput
 * boundary, not a pass.
 *
 * This module is loaded ONLY via dynamic import from the renderer-family
 * branch (threeComponents.ts): importing it statically would pull
 * three/webgpu into WebGL-only bundles.
 */
import * as THREE from 'three'
import { RenderPipeline } from 'three/webgpu'
import {
  Fn,
  clamp as tslClamp,
  convertToTexture,
  float,
  directionToColor,
  emissive,
  max as tslMax,
  mix as tslMix,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  uv,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js'
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import {
  blendlinkAnisotropicKuwahara,
  blendlinkGeometryAwarePixelation,
  blendlinkRadialChromaticAberration,
  blendlinkTiltShift,
  blendlinkVignette,
  type TslEffectNode,
} from './tslPostEffects.js'
import type {
  PostEffectDescriptor,
  PostPipelineService,
  RuntimeComponentInstallation,
  RuntimeQuality,
} from './componentRuntime.js'
import type {
  InstallThreeComponentsOptions,
  PostEdgeAntialiasingPreset,
} from './threeComponents.js'

interface N8AOWebgpuModule {
  N8AONode: new (input: Record<string, unknown>) => {
    configuration: Record<string, unknown>
    getTextureNode(): TslEffectNode
    setQualityMode?(mode: string): void
    dispose?(): void
  }
  applyQualityMode(configuration: Record<string, unknown>, mode: string): void
}

interface ChainContext {
  scenePass: TslEffectNode
  color: TslEffectNode
  scene: THREE.Scene
  camera: THREE.Camera
}

interface WebgpuRegistration {
  id: string
  phase: PostEffectDescriptor['phase']
  build(context: ChainContext): void
  rebind?(scene: THREE.Scene, camera: THREE.Camera): void
  setQuality?(quality: RuntimeQuality): void
  dispose?(): void
  generatesHardPostEdges?: boolean
  intentionalPixelation?: boolean
  disposed: boolean
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function colorTriple(value: unknown): readonly [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [finite(value[0], 0), finite(value[1], 0), finite(value[2], 0)]
  }
  return [0, 0, 0]
}

function phaseRank(phase: PostEffectDescriptor['phase']): number {
  return phase === 'post-hdr' ? 0 : 1
}

/** The RenderPipeline-backed PostPipelineService. Created only through the
 * renderer-family branch; the constructor assumes an initialized
 * WebGPURenderer (either backend). */
export class ThreeWebgpuPostPipelineService implements PostPipelineService {
  readonly resolvedOrder: string[] = ['scene-color']

  private readonly registrations = new Map<string, WebgpuRegistration>()
  private readonly options: InstallThreeComponentsOptions
  private readonly n8aoModule: N8AOWebgpuModule | null
  private pipeline: InstanceType<typeof RenderPipeline> | null = null
  private scenePass: TslEffectNode = null
  private edgeAntialiasingPresetState: PostEdgeAntialiasingPreset = 'off'
  private edgeAntialiasingActive = false
  private finalized = false
  private activated = false
  private disposed = false

  static async create(
    options: InstallThreeComponentsOptions,
  ): Promise<ThreeWebgpuPostPipelineService> {
    const needsAO = (options.components ?? []).some((component) =>
      component.enabled && component.type === 'blendlink.ambient-occlusion')
    const n8ao = needsAO
      ? await import('n8ao-webgpu') as unknown as N8AOWebgpuModule
      : null
    return new ThreeWebgpuPostPipelineService(n8ao, options)
  }

  private constructor(
    n8aoModule: N8AOWebgpuModule | null,
    options: InstallThreeComponentsOptions,
  ) {
    this.options = { ...options }
    this.n8aoModule = n8aoModule
  }

  async addEffect(
    effect: Readonly<PostEffectDescriptor>,
  ): Promise<RuntimeComponentInstallation> {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (this.finalized) {
      throw new Error('Blendlink post effects must be registered before the pipeline is finalized.')
    }
    if (this.registrations.has(effect.id)) {
      throw new Error(`Blendlink post effect ID ${effect.id} is registered more than once.`)
    }
    const registration = this.createRegistration(effect)
    registration.generatesHardPostEdges = effect.type === 'blendlink.ambient-occlusion'
      || effect.type === 'blendlink.outline'
    registration.intentionalPixelation = effect.type === 'blendlink.pixelation'
    this.registrations.set(effect.id, registration)
    return {
      setQuality: registration.setQuality
        ? (quality) => registration.setQuality?.(quality)
        : undefined,
      dispose: () => {
        if (registration.disposed) return
        if (this.finalized) return
        this.registrations.delete(registration.id)
        registration.dispose?.()
        registration.disposed = true
      },
    }
  }

  finalize(): void {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (this.finalized) return
    const registrations = [...this.registrations.values()]
      .sort((left, right) => phaseRank(left.phase) - phaseRank(right.phase)
        || left.id.localeCompare(right.id))

    const scene = this.options.scene
    const camera = this.options.camera
    const scenePass = pass(scene, camera)
    const mrtTargets = this.plannedMrtTargets()
    if (mrtTargets) scenePass.setMRT(mrtTargets)
    this.scenePass = scenePass

    const context: ChainContext = {
      scenePass,
      color: scenePass.getTextureNode(),
      scene,
      camera,
    }

    const hasPixelation = registrations.some((entry) => entry.intentionalPixelation)
    const needsTemporalAA = !hasPixelation && registrations.length > 0
    if (needsTemporalAA) {
      // TRAA is the signed-off default and it resolves FIRST, over the raw
      // scene pass: TRAANode's updateBefore reaches through its beauty input
      // to the owning pass's render target (measured: any wrapped beauty
      // chain resolves from a never-rendered target and renders black), and
      // temporally-correct AA resolves before post effects anyway.
      // Intentional pixelation suppresses it: temporal smoothing would
      // destroy the authored grid.
      context.color = traa(
        context.color,
        scenePass.getTextureNode('depth'),
        scenePass.getTextureNode('velocity'),
        camera,
      )
      this.edgeAntialiasingActive = true
      this.applyEdgeAntialiasingQuality('balanced')
      this.resolvedOrder.push('temporal-antialiasing')
    }

    const beforeTone = registrations.filter((entry) => entry.phase !== 'post-ldr')
    const afterTone = registrations.filter((entry) => entry.phase === 'post-ldr')
    for (const registration of beforeTone) {
      registration.build(context)
      this.resolvedOrder.push(registration.id)
    }
    // The HDR→LDR boundary: renderOutput applies the renderer's authored
    // tone mapping and output color space in-shader. Unlike the WebGL
    // pipeline, no renderer property is mutated and no synthetic
    // 'tone-mapping' order entry exists — the boundary is structural.
    context.color = renderOutput(context.color)
    for (const registration of afterTone) {
      registration.build(context)
      this.resolvedOrder.push(registration.id)
    }

    if (needsTemporalAA
      && registrations.some((entry) => entry.generatesHardPostEdges)) {
      // AO and Outline create fresh hard edges AFTER the temporal resolve —
      // the coverage the WebGL pipeline's final SMAA provided. A final FXAA
      // smooths exactly those post edges without another temporal stage.
      context.color = fxaa(context.color)
      this.resolvedOrder.push('post-edge-antialiasing')
    }

    const pipeline = new RenderPipeline(
      this.options.renderer as never,
      context.color as never,
    )
    pipeline.outputColorTransform = false
    this.pipeline = pipeline
    this.finalized = true
  }

  activate(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (!this.finalized) throw new Error('The Blendlink post pipeline must be finalized before activation.')
    if (this.activated) return
    this.options.scene = scene
    this.options.camera = camera
    if (this.scenePass) {
      this.scenePass.scene = scene
      this.scenePass.camera = camera
    }
    for (const registration of this.registrations.values()) {
      registration.rebind?.(scene, camera)
    }
    // No renderer lease: RenderPipeline neither disables autoClear nor
    // moves renderer.toneMapping — renderOutput reads it at compile time.
    this.activated = true
  }

  setSize(_width: number, _height: number): void {
    // PassNode and RenderPipeline size from the renderer's drawing buffer on
    // render; there is no composer-owned framebuffer to resize here.
  }

  get multisampling(): number {
    // The node pipeline renders post into non-multisampled targets; edge
    // coverage is TRAA's job. Reported as 0 so the antialiasingSamples
    // contract stays truthful.
    return 0
  }

  get postEdgeAntialiasing(): boolean { return this.edgeAntialiasingActive }

  get postEdgeAntialiasingPreset(): PostEdgeAntialiasingPreset {
    return this.edgeAntialiasingPresetState
  }

  setQuality(quality: RuntimeQuality): void {
    this.applyEdgeAntialiasingQuality(quality)
    for (const registration of this.registrations.values()) {
      registration.setQuality?.(quality)
    }
  }

  render(_deltaSeconds?: number): void {
    if (!this.pipeline) throw new Error('The Blendlink post pipeline renders only after finalize().')
    this.pipeline.render()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    for (const registration of [...this.registrations.values()].reverse()) {
      try { registration.dispose?.() } catch (error) { errors.push(error) }
      registration.disposed = true
    }
    try { this.pipeline?.dispose() } catch (error) { errors.push(error) }
    try { this.scenePass?.dispose?.() } catch (error) { errors.push(error) }
    if (errors.length > 0) {
      throw new Error(
        `Blendlink post-pipeline disposal failed: ${errors
          .map((error) => error instanceof Error ? error.message : String(error)).join('; ')}`,
      )
    }
  }

  /** Every MRT target the registered effects need rides the single scene
   * pass — the WebGL pipeline's separate NormalPass has no counterpart. */
  private plannedMrtTargets(): ReturnType<typeof mrt> | null {
    const components = [...this.registrations.values()]
    const descriptors = (this.options.components ?? [])
      .filter((component) => component.enabled)
    const targets: Record<string, unknown> = {}
    const needsSelectiveBloom = descriptors.some((component) =>
      component.type === 'blendlink.bloom'
      && stringValue(component.values.mode, 'bright-pixels') === 'emissive-objects')
    const needsNormals = descriptors.some((component) =>
      (component.type === 'blendlink.pixelation'
        && finite(component.values.normalEdgeStrength, 0) > 0)
      || component.type === 'blendlink.ambient-occlusion')
    const needsVelocity = components.length > 0
    if (needsSelectiveBloom) targets.emissive = emissive
    if (needsNormals) targets.normal = directionToColor(normalView)
    // TRAA velocity is planned whenever any effect can trigger the AA
    // default; an unused target costs one render attachment.
    if (needsVelocity) targets.velocity = velocity
    if (Object.keys(targets).length === 0) return null
    return mrt({ output, ...targets })
  }

  private applyEdgeAntialiasingQuality(quality: RuntimeQuality): void {
    if (!this.edgeAntialiasingActive) {
      this.edgeAntialiasingPresetState = 'off'
      return
    }
    // TRAA has no preset ladder; the reported preset keeps the quality
    // contract shape while the temporal pass itself is resolution-exact.
    this.edgeAntialiasingPresetState = quality === 'low'
      ? 'low' : quality === 'high' ? 'high' : 'medium'
  }

  private createRegistration(
    descriptor: Readonly<PostEffectDescriptor>,
  ): WebgpuRegistration {
    const values = descriptor.values
    const base = { id: descriptor.id, phase: descriptor.phase, disposed: false }
    switch (descriptor.type) {
      case 'blendlink.bloom': {
        const mode = stringValue(values.mode, 'bright-pixels')
        if (mode !== 'bright-pixels' && mode !== 'emissive-objects') {
          throw new Error(`Blendlink Bloom ${descriptor.id} uses unsupported mode ${JSON.stringify(mode)}.`)
        }
        const intensity = clampNumber(finite(values.intensity, 0.5), 0, 100)
        const threshold = clampNumber(finite(values.threshold, 0.8), 0, 100)
        const radius = clampNumber(finite(values.radius, 0.4), 0, 1)
        return {
          ...base,
          build: (context) => {
            const source = mode === 'emissive-objects'
              ? context.scenePass.getTextureNode('emissive')
              : context.color
            const bloomNode = bloom(
              source, intensity, radius,
              mode === 'emissive-objects' ? 0 : threshold,
            )
            context.color = (context.color as TslEffectNode).add(bloomNode)
          },
        }
      }
      case 'blendlink.chromatic-aberration': {
        const amount = clampNumber(finite(values.amount, 0.0015), 0, 0.05)
        const mode = stringValue(values.mode, 'radial')
        if (mode === 'radial') {
          return {
            ...base,
            build: (context) => {
              context.color = blendlinkRadialChromaticAberration(context.color, {
                amount,
                center: [
                  clampNumber(finite(values.centerX, 0.5), 0, 1),
                  clampNumber(finite(values.centerY, 0.5), 0, 1),
                ],
              })
            },
          }
        }
        if (mode !== 'directional') {
          throw new Error(
            `Blendlink Chromatic Aberration ${descriptor.id} uses unsupported Pattern ${JSON.stringify(mode)}.`,
          )
        }
        const angle = THREE.MathUtils.degToRad(clampNumber(finite(values.angle, 0), -180, 180))
        return {
          ...base,
          build: (context) => {
            context.color = directionalChromaticAberration(context.color, angle, amount)
          },
        }
      }
      case 'blendlink.pixelation': {
        const cssPixelSize = clampNumber(finite(values.pixelSize, 6), 1, 256)
        const depthEdgeStrength = clampNumber(finite(values.depthEdgeStrength, 0), 0, 1)
        const normalEdgeStrength = clampNumber(finite(values.normalEdgeStrength, 0), 0, 1)
        const renderer = this.options.renderer as unknown as { getPixelRatio?: () => number }
        const pixelRatio = typeof renderer.getPixelRatio === 'function'
          ? renderer.getPixelRatio() : 1
        const devicePixelSize = cssPixelSize * (pixelRatio > 0 ? pixelRatio : 1)
        if (depthEdgeStrength === 0 && normalEdgeStrength === 0) {
          return {
            ...base,
            build: (context) => {
              // PixelationPassNode renders the scene itself; it replaces the
              // chain, so upstream HDR wraps would be discarded — the phase
              // sort places pixelation deterministically via its id.
              context.color = pixelationPass(
                context.scene, context.camera, devicePixelSize, 0.3, 0.3,
              )
            },
          }
        }
        const camera = this.options.camera as THREE.PerspectiveCamera
        return {
          ...base,
          build: (context) => {
            context.color = blendlinkGeometryAwarePixelation({
              color: context.color,
              depth: context.scenePass.getTextureNode('depth'),
              normal: normalEdgeStrength > 0
                ? context.scenePass.getTextureNode('normal')
                : null,
              camera: { near: camera.near, far: camera.far },
            }, {
              pixelSize: devicePixelSize,
              depthEdgeStrength,
              normalEdgeStrength,
            })
          },
        }
      }
      case 'blendlink.sharpen': {
        const amount = clampNumber(finite(values.amount, 0.35), 0, 1)
        return {
          ...base,
          build: (context) => {
            context.color = sharpen(context.color, amount)
          },
        }
      }
      case 'blendlink.tilt-shift': {
        return {
          ...base,
          build: (context) => {
            context.color = blendlinkTiltShift(context.color, {
              focusPosition: clampNumber(finite(values.focusPosition, 0.5), 0, 1),
              rotation: THREE.MathUtils.degToRad(
                clampNumber(finite(values.angle, 0), -180, 180),
              ),
              feather: clampNumber(finite(values.feather, 0.25), 0.001, 1),
              strength: clampNumber(finite(values.strength, 0.7), 0, 1),
            })
          },
        }
      }
      case 'blendlink.vignette': {
        return {
          ...base,
          build: (context) => {
            context.color = blendlinkVignette(context.color, {
              intensity: clampNumber(finite(values.intensity, 0.25), 0, 1),
              softness: clampNumber(finite(values.softness, 0.55), 0.001, 1),
              tint: colorTriple(values.color),
            })
          },
        }
      }
      case 'blendlink.kuwahara': {
        let sampleCount = 12
        let qualityScale = 1
        const registration: WebgpuRegistration = {
          ...base,
          build: (context) => {
            context.color = blendlinkAnisotropicKuwahara(context.color, {
              strength: clampNumber(finite(values.strength, 0.75), 0, 1),
              brushScale: clampNumber(finite(values.brushScale, 4), 1, 32),
              directionality: clampNumber(finite(values.directionality, 0.75), 0, 1),
              detail: clampNumber(finite(values.detail, 0.5), 0, 1),
              sampleCount,
              qualityScale,
            })
          },
          setQuality: (quality) => {
            sampleCount = quality === 'low' ? 8 : quality === 'balanced' ? 12 : 16
            qualityScale = quality === 'low' ? 0.75 : quality === 'balanced' ? 1 : 1.15
          },
        }
        return registration
      }
      case 'blendlink.ambient-occlusion': {
        const n8aoModule = this.n8aoModule
        if (!n8aoModule) {
          throw new Error('n8ao-webgpu was not loaded for an enabled Ambient Occlusion component.')
        }
        const radiusMode = stringValue(values.radiusMode, 'world')
        if (radiusMode !== 'world' && radiusMode !== 'screen') {
          throw new Error(
            `Blendlink Ambient Occlusion ${descriptor.id} uses unsupported Radius mode ${radiusMode}.`,
          )
        }
        let node: InstanceType<N8AOWebgpuModule['N8AONode']> | null = null
        return {
          ...base,
          build: (context) => {
            node = new n8aoModule.N8AONode({
              beautyNode: context.color,
              beautyTexture: context.scenePass.getTexture('output'),
              depthNode: context.scenePass.getTextureNode('depth'),
              depthTexture: context.scenePass.getTexture('depth'),
              normalNode: context.scenePass.getTextureNode('normal'),
              normalTexture: context.scenePass.getTexture('normal'),
              scenePassNode: context.scenePass,
              scene: context.scene,
              camera: context.camera,
            })
            const configuration = node.configuration
            configuration.gammaCorrection = false
            configuration.screenSpaceRadius = radiusMode === 'screen'
            configuration.aoRadius = radiusMode === 'screen'
              ? clampNumber(finite(values.screenRadius, 32), 1, 512)
              : clampNumber(finite(values.worldRadius, 1), 0.0001, 1_000_000)
            configuration.intensity = clampNumber(finite(values.intensity, 2), 0, 100)
            // Blendlink colors are linear; the upstream N8AO convention (and
            // this port) interprets the public color as sRGB.
            const [r, g, b] = colorTriple(values.color)
            configuration.color = new THREE.Color(r, g, b).convertLinearToSRGB()
            context.color = node.getTextureNode()
          },
          setQuality: (quality) => {
            if (!node) return
            node.configuration.halfRes = quality !== 'high'
            n8aoModule.applyQualityMode(
              node.configuration,
              quality === 'low' ? 'Performance' : quality === 'balanced' ? 'Medium' : 'High',
            )
          },
          dispose: () => { node?.dispose?.() },
        }
      }
      case 'blendlink.outline': {
        const authoredThickness = clampNumber(finite(values.thickness, 1), 0, 16)
        const edgeStrength = authoredThickness === 0
          ? 0
          : clampNumber(finite(values.strength, 3), 0, 100)
        const visible = colorTriple(values.visibleColor)
        const hidden = colorTriple(values.hiddenColor)
        let outlineNode: TslEffectNode = null
        return {
          ...base,
          build: (context) => {
            const selected: THREE.Object3D[] = []
            this.options.root.traverse((object) => {
              const renderable = object as THREE.Mesh
              if (renderable.isMesh) selected.push(object)
            })
            outlineNode = outline(context.scene, context.camera, {
              selectedObjects: selected,
              edgeThickness: float(Math.max(authoredThickness, 0.25)),
              edgeGlow: float(0),
            })
            const { visibleEdge, hiddenEdge } = outlineNode
            const edgeColor = (visibleEdge as TslEffectNode)
              .mul(vec3(...visible))
              .add((hiddenEdge as TslEffectNode).mul(vec3(...hidden)))
              .mul(edgeStrength)
            const coverage = tslClamp(
              tslMax(visibleEdge, hiddenEdge).mul(edgeStrength), 0, 1,
            )
            // ALPHA-blend analogue of the WebGL pipeline: authored dark
            // outlines stay visible instead of SCREEN's black identity.
            const input = context.color as TslEffectNode
            context.color = vec4(
              tslMix(input.rgb, edgeColor, coverage), input.a,
            )
          },
          rebind: (scene, camera) => {
            if (outlineNode) {
              outlineNode.scene = scene
              outlineNode.camera = camera
            }
          },
          dispose: () => { outlineNode?.dispose?.() },
        }
      }
      case 'blendlink.depth-of-field': {
        const camera = this.options.camera as THREE.PerspectiveCamera
        // pmndrs expresses focus in normalized [0..1] near→far units; the
        // in-tree DoF node compares view-Z distances. Convert at the seam.
        const range = () => Math.max(camera.far - camera.near, 0.0001)
        const focusDistance = camera.near
          + range() * clampNumber(finite(values.focusDistance, 0.02), 0, 1)
        const focalLength = Math.max(
          range() * clampNumber(finite(values.focalLength, 0.05), 0, 1),
          0.0001,
        )
        const bokehScale = clampNumber(finite(values.bokehScale, 2), 0, 16)
        return {
          ...base,
          build: (context) => {
            context.color = dof(
              context.color,
              context.scenePass.getViewZNode(),
              float(focusDistance),
              float(focalLength),
              float(bokehScale),
            )
          },
        }
      }
      case 'blendlink.color-grading':
        throw new Error(
          `Blendlink Color Grading (${descriptor.id}) is not implemented on the WebGPU post ` +
            'pipeline yet: the LUT asset loaders land with the Track B parameter-mapping pass. ' +
            'Use the WebGL renderer for this scene or disable the component.',
        )
      default:
        throw new Error(
          `The WebGPU post-pipeline does not implement semantic effect ${descriptor.type} (${descriptor.id}).`,
        )
    }
  }
}

/** pmndrs directional CA semantics: R and B sampled at opposite fixed
 * offsets along the authored angle, G unshifted. */
function directionalChromaticAberration(
  node: TslEffectNode,
  angle: number,
  amount: number,
): TslEffectNode {
  const offset = vec2(Math.cos(angle) * amount, Math.sin(angle) * amount)
  const inputTexture = convertToTexture(node)
  return Fn(() => {
    const uvNode = uv()
    const input = inputTexture.sample(uvNode)
    const red = inputTexture.sample(
      tslClamp(uvNode.add(offset), vec2(0), vec2(1)),
    ).r
    const blue = inputTexture.sample(
      tslClamp(uvNode.sub(offset), vec2(0), vec2(1)),
    ).b
    return vec4(red, input.g, blue, input.a)
  })()
}
