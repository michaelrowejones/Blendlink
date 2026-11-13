import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, ivec2, uv, vec2 } from 'three/tsl'
import { buildCompositorLuminanceKey } from 'luma-key-under-test'

try {
  const backend = new URLSearchParams(location.search).get('backend')
  const adapter = backend === 'webgl2' ? undefined : await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (backend !== 'webgl2' && !adapter) throw new Error('WebGPU is unavailable')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: backend === 'webgl2', ...(device ? { device } : {}) })
  await renderer.init(); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const gl = (renderer.backend as any).gl, extension = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, isFallbackAdapter: adapter.info?.isFallbackAdapter }
    : { renderer: gl?.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const width = 1920, height = 1080, pixels = new Float32Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([.15, .2, .25, 1], i)
  const input = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType); input.needsUpdate = true
  const image = textureLoad(input, ivec2(uv().mul(vec2(width, height))))
  const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false })
  renderer.setSize(width, height); renderer.setRenderTarget(target)
  const rows = []
  for (const profile of ['legacy-v1', 'gradual-rne', 'ftz-daz-rne']) for (const limits of [[0, 1], [.1, .3]]) {
    const properties: Record<string, unknown> = { luminance_key_model: 'native-luminance-key-v1', luminance_key_schema: 'linear-ramp', luminance_key_limits: limits }
    if (profile !== 'legacy-v1') Object.assign(properties, { luminance_key_model: 'native-luminance-key-cpu-rne-v1', luminance_key_source_version: profile === 'ftz-daz-rne' ? [5, 3, 0] : [5, 2, 0],
      evaluation_device: 'CPU', single_value_device: 'CPU', luminance_key_coefficients: [.2126, .7152, .0722].map(Math.fround),
      luminance_key_cpu_profile: { schemaVersion: 1, mode: profile, underflowWord: profile === 'gradual-rne' ? 0x400000 : 0,
        denormalInputWord: profile === 'gradual-rne' ? 0x800000 : 0, tieWords: [0x3f800000, 0x3f800002], sourcePlatform: 'darwin', sourceArchitecture: 'arm64' } })
    const op = { properties, type: 'RGBA', source: { output: 'Image' }, inputs: { Image: { value: { type: 'RGBA' } } } }
    const material = new NodeMaterial(), quad = new QuadMesh(material)
    material.fragmentNode = buildCompositorLuminanceKey(op, image, [.2126, .7152, .0722], (message: string) => { throw new Error(message) }, 'CPU')
    quad.render(renderer); await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1)
    const samples = []
    for (let run = 0; run < 3; run++) {
      const started = performance.now()
      for (let frame = 0; frame < 10; frame++) quad.render(renderer)
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1)
      samples.push((performance.now() - started) / 10)
    }
    rows.push({ profile, limits, width, height, gpu, samples, medianCompletedFrameMs: samples.sort((a, b) => a - b)[1], measurement: '10 submitted frames plus one-pixel completion readback; wall clock, not a GPU timestamp' })
    material.dispose()
  }
  renderer.setRenderTarget(null); target.dispose(); input.dispose(); renderer.dispose()
  ;(window as any).__lumaPerformance = rows
} catch (error) { (window as any).__lumaPerformanceError = String(error) }
