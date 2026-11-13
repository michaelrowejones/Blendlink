// SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { texture, uv, vec2, vec3, vec4 } from 'three/tsl'
import { privateRadialTrial } from '@radial-trial-kernel'

let renderer, target, mesh, material, source, coordinate, initialized, errors = []
window.initializeTrial = async ({ backend, input, size }) => {
  const webgl = backend === 'webgl2'
  const adapter = webgl ? undefined : await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!webgl && !adapter) throw new Error('Radial trial requires an actual WebGPU adapter; fallback is not coverage')
  const suppliedDevice = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  renderer = new WebGPURenderer({ forceWebGL: webgl, antialias: false, ...(suppliedDevice ? { device: suppliedDevice } : {}) })
  await renderer.init()
  const actual = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  if (actual !== backend) throw new Error(`Actual ${actual} is not requested ${backend}`)
  renderer.setSize(size, size); renderer.setPixelRatio(1); renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
  const authored = new Float32Array(await (await fetch(input)).arrayBuffer())
  const rgba = new Float32Array(size * size * 4)
  for (let i = 0; i < size * size; i++) { rgba.set(authored.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 1 }
  source = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat, THREE.FloatType)
  source.minFilter = source.magFilter = THREE.NearestFilter; source.generateMipmaps = false; source.flipY = false; source.colorSpace = THREE.NoColorSpace; source.needsUpdate = true
  coordinate = texture(source, uv()).xy
  target = new THREE.RenderTarget(size, size, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false })
  material = new NodeMaterial(); mesh = new QuadMesh(material)
  const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info'), info = adapter?.info ?? renderer.backend.device?.adapterInfo
  initialized = { backend: actual, gpu: info ? { api: 'WebGPU', vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: adapter?.isFallbackAdapter } : { api: 'WebGL2', vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }, size }
  return initialized
}

function bytesBase64(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
  let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}

window.runTrial = async ({ sides = 5, normalize = false, variant = 'intrinsic-v1', output, literal = null, mode = 'kernel', captureShader = false }) => {
  const coord = literal ? vec2(...literal) : coordinate
  const values = privateRadialTrial(coord, sides, normalize, variant)
  const scalar = mode === 'input' ? coord[output] : values[output]
  material.fragmentNode = vec4(scalar, scalar, scalar, 1); material.needsUpdate = true
  const start = performance.now(); renderer.setRenderTarget(target); mesh.render(renderer); renderer.setRenderTarget(null)
  const actual = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height)
  const elapsedMs = performance.now() - start
  let shader
  if (captureShader) { renderer.setRenderTarget(target); shader = await renderer.debug.getShaderAsync(mesh, mesh.camera, mesh); renderer.setRenderTarget(null) }
  return { backend: initialized.backend, elapsedMs, pixels: bytesBase64(actual), components: 4, errors: [...errors], memory: renderer.info.memory, shader }
}

window.benchmarkTrial = async ({ variant }) => {
  const width = 1920, height = 1080, data = new Float32Array(32 * 32 * 4)
  const points = [[1, .25], [.25, 1], [-1, .25], [-.5, -1]]
  for (let i = 0; i < 32 * 32; i++) data.set([...points[i % 4], 0, 1], i * 4)
  const input = new THREE.DataTexture(data, 32, 32, THREE.RGBAFormat, THREE.FloatType)
  input.minFilter = input.magFilter = THREE.NearestFilter; input.generateMipmaps = false; input.flipY = false; input.colorSpace = THREE.NoColorSpace; input.needsUpdate = true
  const coord = texture(input, uv()).xy
  const rtt = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false, stencilBuffer: false })
  const rows = [], memoryBefore = { ...renderer.info.memory }
  try {
    for (const mode of ['input-control', 'coordinates', 'normalized-coordinates', 'coordinate-width-id']) {
      const surface = new NodeMaterial(), quad = new QuadMesh(surface)
      if (mode === 'input-control') surface.fragmentNode = vec4(vec3(coord, 0), 1)
      else {
        const values = privateRadialTrial(coord, 5, mode === 'normalized-coordinates', variant)
        surface.fragmentNode = vec4(mode === 'coordinate-width-id' ? vec3(values.x, values.width, values.id) : vec3(values.x, values.y, 0), 1)
      }
      try {
        renderer.setRenderTarget(rtt)
        const first = performance.now(); quad.render(renderer)
        const pixel = await renderer.readRenderTargetPixelsAsync(rtt, 0, 0, 1, 1)
        const firstCompletedMs = performance.now() - first
        if (!Array.from(pixel).every(Number.isFinite)) throw new Error('Timing source is outside finite domain')
        const samples = []
        for (let run = 0; run < 3; run++) {
          const started = performance.now()
          for (let frame = 0; frame < 10; frame++) quad.render(renderer)
          await renderer.readRenderTargetPixelsAsync(rtt, 0, 0, 1, 1)
          samples.push((performance.now() - started) / 10)
        }
        const shader = await renderer.debug.getShaderAsync(quad, quad.camera, quad)
        rows.push({ mode, width, height, sides: 5, variant, sourcePoints: points, firstCompletedMs, completedFrameSamplesMs: samples, medianCompletedFrameMs: [...samples].sort((a, b) => a - b)[1], measurement: '10 submitted full-Float32 RTT draws plus one-pixel completion readback; wall clock, not GPU timestamps or full-scene frame rate', shader })
      } finally { surface.dispose() }
    }
    return { backend: initialized.backend, gpu: initialized.gpu, rows, memoryBefore, errors: [...errors] }
  } finally { renderer.setRenderTarget(null); rtt.dispose(); input.dispose() }
}

window.closeTrial = () => { target?.dispose(); material?.dispose(); source?.dispose(); renderer?.dispose() }
