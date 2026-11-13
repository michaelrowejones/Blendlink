import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { ivec2, textureLoad, uv, vec2, vec4 } from 'three/tsl'
import { compositorCpuDifferenceMeanV2 } from 'blendlink-mean-under-test'

const rows: unknown[] = []; (window as any).__meanProgress = rows
try {
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  const adapter = webgl ? undefined : await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!webgl && !adapter) throw new Error('WebGPU adapter unavailable')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: webgl, ...(device ? { device } : {}) }); await renderer.init()
  if (!!(renderer.backend as any).isWebGLBackend !== webgl) throw new Error('Requested API was substituted')
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const gl = (renderer.backend as any).gl, extension = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, isFallbackAdapter: adapter.info?.isFallbackAdapter }
    : { renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const files = await (await fetch('/index.json')).json()
  for (const file of files) {
    const test = await (await fetch('/' + file)).json(), { width, height } = test
    const input = new THREE.DataTexture(new Float32Array(test.input), width, height, THREE.RGBAFormat, THREE.FloatType); input.needsUpdate = true
    renderer.setSize(width, height)
    const source = textureLoad(input, ivec2(uv().mul(vec2(width, height))))
    const material = new NodeMaterial(), quad = new QuadMesh(material), target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false })
    renderer.setRenderTarget(target); material.fragmentNode = source; quad.render(renderer)
    const control = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    const stride = webgl ? width : Math.ceil(width / 16) * 16
    const controlBits = new Uint32Array(control.buffer, control.byteOffset, control.length), inputBits = new Uint32Array(new Float32Array(test.input).buffer)
    const same = (flip: boolean) => test.input.every((_v: number, index: number) => {
      const pixel = Math.floor(index / 4), x = pixel % width, y = Math.floor(pixel / width)
      return controlBits[((flip ? height - 1 - y : y) * stride + x) * 4 + index % 4] === inputBits[index]
    })
    const flip = !same(false); if (!same(flip)) throw new Error('Independent RGB input bits changed')
    material.fragmentNode = vec4(compositorCpuDifferenceMeanV2(source.r, source.g, source.b), 0, 0, 1); material.needsUpdate = true
    quad.render(renderer)
    const output = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    const actual = new Uint32Array(output.buffer, output.byteOffset, output.length), expected = new Uint32Array(new Float32Array(test.expected).buffer)
    let mismatches = 0, worst
    expected.forEach((word, index) => {
      const x = index % width, y = Math.floor(index / width), got = actual[((flip ? height - 1 - y : y) * stride + x) * 4]
      if (got !== word) { mismatches++; worst = { index, actual: got, expected: word } }
    })
    renderer.setRenderTarget(null); material.dispose(); target.dispose(); input.dispose()
    rows.push({ native: test.native, hash: test.hash, count: expected.length, mismatches, worst, gpu, remainingTextures: renderer.info.memory.textures })
  }
  renderer.dispose(); (window as any).__meanResult = rows
} catch (error) { (window as any).__meanFailure = String(error) }
