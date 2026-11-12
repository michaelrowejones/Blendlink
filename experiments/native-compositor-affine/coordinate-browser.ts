import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, textureSize, uv, ivec2, uniform, vec4 } from 'three/tsl'
import { buildCoordinateFma } from 'affine-fma-under-test'

const reports: unknown[] = []
let renderer: WebGPURenderer | undefined
try {
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  renderer = new WebGPURenderer({ forceWebGL: webgl })
  await renderer.init()
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  const backend = (renderer.backend as any).isWebGLBackend ? 'webgl2' : 'webgpu'
  if (backend !== (webgl ? 'webgl2' : 'webgpu')) throw new Error('Requested coordinate backend unavailable')
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => shaderErrors.push([
    gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment),
  ].filter(Boolean).join('\n'))
  const device = (renderer.backend as any).device as GPUDevice | undefined
  const tests = await (await fetch('/coordinates.json')).json()
  const source = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)
  source.needsUpdate = true
  const image = textureLoad(source, ivec2(uv().mul(textureSize(textureLoad(source, ivec2(0))))))
  const coefficients = Array.from({ length: 6 }, () => uniform(0))
  const position = [0, 1].map(axis => buildCoordinateFma(coefficients[axis * 3]!, image.x,
    buildCoordinateFma(coefficients[axis * 3 + 1]!, image.y, coefficients[axis * 3 + 2]!)))
  const material = new NodeMaterial(), control = new NodeMaterial()
  material.fragmentNode = vec4(position[0], position[1], 0, 1)
  control.fragmentNode = image
  const quad = new QuadMesh(material), calibrationQuad = new QuadMesh(control)
  const target = new THREE.RenderTarget(1, 1, { type: THREE.FloatType })
  try {
    for (const test of tests.rows) {
      ;(window as any).__affineProgress = { completed: reports.length, total: tests.rows.length, case: test.case }
      const { width, height } = test
      renderer.setSize(width, height); target.setSize(width, height)
      const pixels = new Float32Array(width * height * 4)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([x, y, 0, 1], (y * width + x) * 4)
      if (source.image.width !== width || source.image.height !== height) source.dispose()
      source.image = { data: pixels, width, height }; source.needsUpdate = true
      const row: any = { case: test.case, backend, width, height }
      const start = shaderErrors.length
      device?.pushErrorScope('validation')
      try {
        const render = async (mesh: QuadMesh): Promise<Float32Array> => {
          renderer!.setRenderTarget(target); mesh.render(renderer!)
          return await renderer!.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
        }
        const stride = webgl ? width : Math.ceil(width / 16) * 16
        const calibration = await render(calibrationQuad)
        const error = (values: Float32Array, expected: ArrayLike<number>, flip: boolean): number => {
          let maximum = 0
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++)
            maximum = Math.max(maximum, Math.abs(values[(y * stride + x) * 4 + c]! - expected[(((flip ? height - 1 - y : y) * width + x) * 4 + c)]!))
          return maximum
        }
        const forward = error(calibration, pixels, false), reverse = error(calibration, pixels, true), flip = reverse < forward
        if (Math.min(forward, reverse) !== 0) throw new Error('Coordinate input calibration failed')
        test.matrix.slice(0, 6).forEach((value: number, index: number) => { coefficients[index]!.value = value })
        const actual = await render(quad), words = new Uint32Array(actual.buffer, actual.byteOffset, actual.length)
        let max = 0, bad = 0, zeroSigns = 0, worst
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (const axis of [0, 1]) {
          const ai = (y * stride + x) * 4 + axis, ei = (((flip ? height - 1 - y : y) * width + x) * 4 + axis)
          const value = actual[ai]!, expected = test.expected[ei]
          if (!Number.isFinite(value)) throw new Error('Non-finite coordinate')
          if (words[ai] !== test.words[ei]) {
            if (value === 0 && expected === 0) zeroSigns++
            else { bad++; worst = { x, y, axis, value, expected, actualBits: words[ai], expectedBits: test.words[ei] } }
          }
          max = Math.max(max, Math.abs(value - expected))
        }
        const shader = await renderer.debug.getShaderAsync(quad, quad.camera, quad)
        Object.assign(row, { max, bad, zeroSigns, worst, fragmentBytes: new TextEncoder().encode(shader.fragmentShader).length })
      } catch (error) { row.error = String(error) }
      const validation = await device?.popErrorScope()
      row.shaderErrors = shaderErrors.slice(start)
      if (validation) row.shaderErrors.push(validation.message)
      if (row.shaderErrors.length) row.error = row.shaderErrors.join('\n')
      reports.push(row)
    }
  } finally {
    renderer.setRenderTarget(null)
    source.dispose(); target.dispose(); material.dispose(); control.dispose()
    if (renderer.info.memory.textures !== 0) throw new Error('Coordinate proof retained textures')
  }
  ;(window as any).__affineResults = reports
  document.querySelector('#results')!.textContent = JSON.stringify(reports, null, 2)
} catch (error) {
  ;(window as any).__affineFailure = String(error)
  document.querySelector('#results')!.textContent = String(error)
} finally { renderer?.dispose() }
