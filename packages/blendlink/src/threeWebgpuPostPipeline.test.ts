import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ThreeWebgpuPostPipelineService } from './threeWebgpuPostPipeline.js'
import type { InstallThreeComponentsOptions } from './threeComponents.js'
import type { PostEffectDescriptor } from './componentRuntime.js'

function fakeWebgpuRenderer(): THREE.WebGLRenderer {
  return {
    isWebGPURenderer: true,
    domElement: {},
    getPixelRatio: () => 1,
  } as unknown as THREE.WebGLRenderer
}

function options(
  components: Array<{ type: string; values?: Record<string, unknown> }> = [],
): InstallThreeComponentsOptions {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)
  return {
    renderer: fakeWebgpuRenderer(),
    scene,
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 50),
    root,
    bindings: { byId: {}, byName: {} },
    components: components.map((component, index) => ({
      id: `component-${index}`,
      type: component.type,
      enabled: true,
      values: component.values ?? {},
    })),
  } as unknown as InstallThreeComponentsOptions
}

function descriptor(
  id: string,
  type: string,
  values: Record<string, unknown> = {},
  phase: 'post-hdr' | 'post-ldr' = 'post-hdr',
): Readonly<PostEffectDescriptor> {
  return { id, type, phase, values } as unknown as Readonly<PostEffectDescriptor>
}

describe('ThreeWebgpuPostPipelineService', () => {
  it('orders effects by phase, reports the re-specified resolvedOrder, and defaults to TRAA', async () => {
    const service = await ThreeWebgpuPostPipelineService.create(options())
    await service.addEffect(descriptor('vignette-1', 'blendlink.vignette', {}, 'post-ldr'))
    await service.addEffect(descriptor('bloom-1', 'blendlink.bloom'))
    await service.addEffect(descriptor('sharpen-1', 'blendlink.sharpen'))
    service.finalize()

    // TRAA resolves FIRST over the raw scene pass (TRAANode's beauty input
    // must be the pass texture — a wrapped chain renders black); the final
    // FXAA entry appears only when AO/Outline add hard post edges.
    expect(service.resolvedOrder).toEqual([
      'scene-color', 'temporal-antialiasing', 'bloom-1', 'sharpen-1', 'vignette-1',
    ])
    // The WebGL pipeline's synthetic entries never appear here: MRT rides
    // the scene pass and tone mapping is the renderOutput boundary.
    expect(service.resolvedOrder).not.toContain('scene-normals')
    expect(service.resolvedOrder).not.toContain('tone-mapping')
    expect(service.postEdgeAntialiasing).toBe(true)
    expect(service.postEdgeAntialiasingPreset).toBe('medium')
    expect(service.multisampling).toBe(0)
    service.setQuality('high')
    expect(service.postEdgeAntialiasingPreset).toBe('high')
    service.dispose()
  })

  it('suppresses the AA default under intentional pixelation', async () => {
    const service = await ThreeWebgpuPostPipelineService.create(options())
    await service.addEffect(descriptor('pixelation-1', 'blendlink.pixelation'))
    service.finalize()

    expect(service.resolvedOrder).not.toContain('post-edge-antialiasing')
    expect(service.postEdgeAntialiasing).toBe(false)
    expect(service.postEdgeAntialiasingPreset).toBe('off')
    service.dispose()
  })

  it('rejects duplicate ids, post-finalize registration, and pre-finalize render', async () => {
    const service = await ThreeWebgpuPostPipelineService.create(options())
    await service.addEffect(descriptor('bloom-1', 'blendlink.bloom'))
    await expect(service.addEffect(descriptor('bloom-1', 'blendlink.bloom')))
      .rejects.toThrow(/registered more than once/)
    expect(() => service.render()).toThrow(/finalize/)
    service.finalize()
    await expect(service.addEffect(descriptor('late', 'blendlink.vignette')))
      .rejects.toThrow(/before the pipeline is finalized/)
    service.dispose()
  })

  it('registers color grading through the application LUT resolver', async () => {
    const size = 4
    const data = new Uint8Array(size * size * size * 4).fill(255)
    const lut = new THREE.Data3DTexture(data, size, size, size)
    const baseOptions = options()
    ;(baseOptions as { loadLut?: (url: string) => Promise<THREE.Data3DTexture> })
      .loadLut = async () => lut
    const service = await ThreeWebgpuPostPipelineService.create(baseOptions)
    await service.addEffect(descriptor('grade-1', 'blendlink.color-grading', {
      lutUrl: 'https://example.test/neutral.cube', intensity: 0.8,
    }, 'post-ldr'))
    service.finalize()
    expect(service.resolvedOrder).toContain('grade-1')
    service.dispose()
  })

  it('rejects LUT URLs with unsupported protocols', async () => {
    const service = await ThreeWebgpuPostPipelineService.create(options())
    await expect(service.addEffect(descriptor('grade-1', 'blendlink.color-grading', {
      lutUrl: 'file:///C:/luts/grade.cube',
    }))).rejects.toThrow(/unsupported protocol file/)
    service.dispose()
  })

  it('activates by rebinding the scene pass to the committed scene and camera', async () => {
    const service = await ThreeWebgpuPostPipelineService.create(options())
    await service.addEffect(descriptor('vignette-1', 'blendlink.vignette'))
    service.finalize()
    const committedScene = new THREE.Scene()
    const committedCamera = new THREE.PerspectiveCamera()
    service.activate(committedScene, committedCamera)
    const scenePass = (service as unknown as {
      scenePass: { scene: THREE.Scene; camera: THREE.Camera }
    }).scenePass
    expect(scenePass.scene).toBe(committedScene)
    expect(scenePass.camera).toBe(committedCamera)
    service.dispose()
  })
})
