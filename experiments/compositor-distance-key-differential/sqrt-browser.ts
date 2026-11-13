import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { bitcast, ivec2, sqrt, textureLoad, uint, uv, vec2, vec4 } from 'three/tsl'
import { compositorCpuSqrt } from 'blendlink-sqrt-under-test'
import { compositorCpuDistanceRatio } from 'blendlink-ratio-under-test'

try {
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  const adapter = webgl ? undefined : await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!webgl && !adapter) throw new Error('WebGPU adapter missing')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: webgl, ...(device ? { device } : {}) }); await renderer.init()
  const backend = (renderer.backend as any).isWebGLBackend ? 'webgl2' : 'webgpu'
  if (backend !== (webgl ? 'webgl2' : 'webgpu')) throw new Error('Requested browser API was substituted')
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const gl = (renderer.backend as any).gl, extension = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { ...adapter.info, vendor: adapter.info?.vendor, architecture: adapter.info?.architecture,
    isFallbackAdapter: adapter.info?.isFallbackAdapter } : { renderer: gl?.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const files = await (await fetch('/index.json')).json(), reports = [], tests = [], benchmarked = new Set<string>()
  for (const file of files) tests.push(await (await fetch('/' + file)).json())
  for (const name of ['bitControls', 'ratioBitControls']) {
    const bitsTest = tests.find(test => test[name])?.[name]
    if (bitsTest) tests.push({ ...bitsTest, native: 'Independent mathematical IEEE ' + name, width: bitsTest.inputWords.length, height: 1 })
  }
  for (const test of tests) {
    ;(window as any).__sqrtProgress = { backend, gpu, native: test.native, phase: 'rendering', completed: reports.length, rows: reports }
    const { width, height } = test
    const packed = new Float32Array(width * height * 4)
    test.inputWords.forEach((word: number, index: number) => { packed.set([word & 2047, word >>> 11 & 2047, word >>> 22, 1], index * 4) })
    const input = new THREE.DataTexture(packed, width, height, THREE.RGBAFormat, THREE.FloatType); input.needsUpdate = true
    renderer.setSize(width, height)
    const sample = textureLoad(input, ivec2(uv().mul(vec2(width, height))))
    const word = uint(sample.r).bitOr(uint(sample.g).shiftLeft(uint(11))).bitOr(uint(sample.b).shiftLeft(uint(22)))
    let divisorTexture: THREE.DataTexture | undefined, divisorSample: any, divisorWord: any
    if (test.divisorWords) {
      const data = new Float32Array(width * height * 4)
      test.divisorWords.forEach((word: number, index: number) => data.set([word & 2047, word >>> 11 & 2047, word >>> 22, 1], index * 4))
      divisorTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType); divisorTexture.needsUpdate = true
      divisorSample = textureLoad(divisorTexture, ivec2(uv().mul(vec2(width, height))))
      divisorWord = uint(divisorSample.r).bitOr(uint(divisorSample.g).shiftLeft(uint(11))).bitOr(uint(divisorSample.b).shiftLeft(uint(22)))
    }
    const evaluated = test.divisorWords ? compositorCpuDistanceRatio(bitcast(word, 'float'), bitcast(divisorWord, 'float')) : compositorCpuSqrt(bitcast(word, 'float'))
    const material = new NodeMaterial(); material.fragmentNode = vec4(evaluated, 0, 0, 1)
    const quad = new QuadMesh(material), target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false })
    const coldStart = performance.now(); renderer.setRenderTarget(target); quad.render(renderer)
    const values = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    const coldDrawMilliseconds = performance.now() - coldStart
    const bits = new Uint32Array(values.buffer, values.byteOffset, values.length), expected = new Uint32Array(new Float32Array(test.expected).buffer)
    // The independent integer lane controls are rendered separately to establish
    // orientation and ensure packed IEEE input words are unchanged by sampling.
    material.fragmentNode = vec4(sample.rgb, 1); material.needsUpdate = true; quad.render(renderer)
    const controls = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    const stride = webgl ? width : Math.ceil(width / 16) * 16
    const matches = (flip: boolean) => test.inputWords.every((word: number, index: number) => {
      const x = index % width, y = Math.floor(index / width), i = ((flip ? height - 1 - y : y) * stride + x) * 4
      return controls[i] === (word & 2047) && controls[i + 1] === (word >>> 11 & 2047) && controls[i + 2] === (word >>> 22)
    })
    const flip = !matches(false); if (!matches(flip)) throw new Error('Packed integer input controls changed')
    if (divisorTexture) {
      material.fragmentNode = vec4(divisorSample.rgb, 1); material.needsUpdate = true; quad.render(renderer)
      const controls = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
      if (!test.divisorWords.every((word: number, index: number) => {
        const x = index % width, y = Math.floor(index / width), i = ((flip ? height - 1 - y : y) * stride + x) * 4
        return controls[i] === (word & 2047) && controls[i + 1] === (word >>> 11 & 2047) && controls[i + 2] === (word >>> 22)
      })) throw new Error('Packed divisor controls changed')
    }
    let mismatches = 0, worst
    expected.forEach((word, index) => {
      const x = index % width, y = Math.floor(index / width), i = ((flip ? height - 1 - y : y) * stride + x) * 4
      if (bits[i] !== word) { mismatches++; worst = { index, inputWord: test.inputWords[index], expectedWord: word, actualWord: bits[i] } }
    })
    let benchmark
    const operation = test.divisorWords ? 'ratio' : 'sqrt'
    if (!benchmarked.has(operation)) {
      benchmarked.add(operation)
      const large = new THREE.RenderTarget(1920, 1080, { type: THREE.FloatType, depthBuffer: false })
      renderer.setSize(1920, 1080); renderer.setRenderTarget(large)
      const timings: Record<string, number[]> = {}
      const intrinsic = test.divisorWords ? bitcast(word, 'float').div(bitcast(divisorWord, 'float')) : sqrt(bitcast(word, 'float'))
      for (const [name, node] of [['integer', evaluated], ['intrinsic', intrinsic]] as const) {
        material.fragmentNode = vec4(node, 0, 0, 1); material.needsUpdate = true
        quad.render(renderer); await renderer.readRenderTargetPixelsAsync(large, 0, 0, 1, 1)
        timings[name] = []
        for (let repeat = 0; repeat < 6; repeat++) {
          const start = performance.now(); quad.render(renderer); await renderer.readRenderTargetPixelsAsync(large, 0, 0, 1, 1)
          timings[name]!.push(performance.now() - start)
        }
      }
      benchmark = { width: 1920, height: 1080, timings, measurement: 'Warm full-canvas draw plus one-pixel GPU completion readback; wall time, not isolated GPU timestamp' }
      renderer.setRenderTarget(null); large.dispose()
    }
    renderer.setRenderTarget(null); material.dispose(); target.dispose(); input.dispose(); divisorTexture?.dispose()
    reports.push({ native: test.native, hash: test.hash, count: expected.length,
      operation, evidenceKind: test.evidenceKind ?? 'native-cpu-field', mismatches, worst, gpu,
      coldDrawMilliseconds, benchmark, remainingTextures: renderer.info.memory.textures })
  }
  renderer.dispose(); (window as any).__sqrtResult = reports
} catch (error) { (window as any).__sqrtFailure = String(error) }
