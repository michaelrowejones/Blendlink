import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, ivec2, uv, vec2, vec4 } from 'three/tsl'
import { buildCompositorCpuLuminanceKey } from 'luma-kernel-under-test'
import { buildSourceCompositor } from 'luma-compositor-under-test'

try {
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  const adapter = webgl ? undefined : await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!webgl && !adapter) throw new Error('WebGPU unavailable')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: webgl, ...(device ? { device } : {}) }); await renderer.init()
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const gl = (renderer.backend as any).gl, extension = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, isFallbackAdapter: adapter.info?.isFallbackAdapter }
    : { renderer: gl?.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const index = await (await fetch('/trial-index.json')).json(), rows = []
  for (const entry of index) {
    const test = await (await fetch('/' + entry.file)).json(), { width, height } = test
    const pixels = new Float32Array(test.input), input = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType)
    input.needsUpdate = true; renderer.setSize(width, height)
    const sample = textureLoad(input, ivec2(uv().mul(vec2(width, height))))
    const material = new NodeMaterial(), quad = new QuadMesh(material), target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false })
    const render = async (node: any) => {
      material.fragmentNode = node; material.needsUpdate = true; renderer.setRenderTarget(target); quad.render(renderer)
      return await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    }
    const control = await render(sample), stride = webgl ? width : Math.ceil(width / 16) * 16
    const calibration = (flip: boolean) => {
      let max = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++)
        max = Math.max(max, Math.abs(control[((flip ? height - 1 - y : y) * stride + x) * 4 + c] - pixels[(y * width + x) * 4 + c]))
      return max
    }
    const flip = calibration(true) < calibration(false), inputError = calibration(flip)
    if (inputError !== 0) throw new Error('Independent source carrier changed: ' + test.case)
    const keys = test.program.ops.filter((op: any) => op.kind === 'luminance-key')
    const output = test.program.output.kind === 'convert' ? test.program.output.input : test.program.output
    if (keys.length !== 1 || output.node !== keys[0].id) throw new Error('Trial requires a direct single Luma output')
    const key = keys[0]
    // Resolve the untouched upstream program with the production compositor.
    // Only the Luma arithmetic call bypasses source admission in this trial.
    const upstream = buildSourceCompositor({ ...test.program, ops: test.program.ops.filter((op: any) => op.kind !== 'luminance-key'), output: key.inputs.Image.value }, () => sample)
    const image = upstream.node
    const node = buildCompositorCpuLuminanceKey(image, key.properties.luminance_key_limits, key.source.output, entry.profile.mode)
    const actual = await render(key.source.output === 'Matte' ? vec4(node, node, node, 1) : node)
    let max = 0, bitMismatches = 0
    const expected = new Float32Array(test.expected), expectedBits = new Uint32Array(expected.buffer)
    const actualBits = new Uint32Array(actual.buffer, actual.byteOffset, actual.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
      const offset = ((flip ? height - 1 - y : y) * stride + x) * 4 + c, index = (y * width + x) * 4 + c
      if (!Number.isFinite(actual[offset])) throw new Error('Nonfinite trial result: ' + test.case)
      max = Math.max(max, Math.abs(actual[offset] - expected[index])); if (actualBits[offset] !== expectedBits[index]) bitMismatches++
    }
    renderer.setRenderTarget(null); material.dispose(); target.dispose(); input.dispose(); upstream.dispose()
    rows.push({ case: test.case, native: test.blenderVersion, sourceModel: key.properties.luminance_key_model,
      productionAdmission: entry.productionAdmission, directPrivateKernelTrial: true, productionAdmissionCases: 0,
      max, bitMismatches, calibration: inputError, gpu, remainingTextures: renderer.info.memory.textures })
  }
  renderer.dispose(); (window as any).__lumaTrialRows = rows
} catch (error) { (window as any).__lumaTrialError = String(error) }
