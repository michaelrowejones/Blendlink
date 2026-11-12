import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, uv, vec2, ivec2, mrt, output, vec4 } from 'three/tsl'
import { buildSourceCompositor } from 'blendlink-compositor-under-test'
import { compositorResizeProof } from './relative-resize.js'

const reports: unknown[] = []
const result = document.querySelector('#results')!
let renderer: WebGPURenderer | undefined
try {
  const webgl = new URLSearchParams(location.search).get('backend') === 'webgl2'
  renderer = new WebGPURenderer({ forceWebGL: webgl })
  await renderer.init()
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  const backend = (renderer.backend as any).isWebGLBackend ? 'webgl2' : 'webgpu'
  if (backend !== (webgl ? 'webgl2' : 'webgpu')) throw new Error('Requested renderer backend was not available')
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => shaderErrors.push([
    gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment),
  ].filter(Boolean).join('\n'))
  const device = (renderer.backend as any).device as GPUDevice | undefined
  const cases: { file: string }[] = await (await fetch('/references/index.json')).json()
  let lastProgress = performance.now()
  for (const entry of cases) {
    ;(window as any).__compositorProgress = { completed: reports.length, total: cases.length, case: entry.file, phase: 'loading' }
    const test = await (await fetch('/references/' + entry.file)).json()
    if (test.resizeFrames) {
      const row: any = { case: test.case, blenderVersion: test.blenderVersion, blenderHash: test.blenderHash, backend }
      const shaderStart = shaderErrors.length
      device?.pushErrorScope('validation')
      try { Object.assign(row, await compositorResizeProof(test, renderer, webgl)) }
      catch (error) { row.error = String(error) }
      const validation = await device?.popErrorScope()
      row.shaderErrors = shaderErrors.slice(shaderStart)
      if (validation) row.shaderErrors.push(validation.message)
      if (row.shaderErrors.length) row.error = 'Shader validation failed: ' + row.shaderErrors.join('\n')
      reports.push(row)
      continue
    }
    const { width, height } = test
    renderer.setSize(width, height)
    const texture = new THREE.DataTexture(new Float32Array(test.input), width, height, THREE.RGBAFormat, THREE.FloatType)
    texture.needsUpdate = true
    const source = textureLoad(texture, ivec2(uv().mul(vec2(width, height))))
    const material = new NodeMaterial()
    const quad = new QuadMesh(material)
    const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, count: test.assertMrtState ? 2 : 1 })
    const activeMrt = test.assertMrtState ? mrt({ output, proof: vec4(0) }) : null
    if (activeMrt) {
      target.textures[0]!.name = 'output'
      target.textures[1]!.name = 'proof'
      renderer.setMRT(activeMrt)
      renderer.autoClear = false
      renderer.setClearAlpha(.37)
    }
    const row: any = { case: test.case, blenderVersion: test.blenderVersion, blenderHash: test.blenderHash,
      exactAlpha: test.exactAlpha === true, backend }
    const shaderStart = shaderErrors.length
    device?.pushErrorScope('validation')
    const render = async (node: any) => {
      material.fragmentNode = activeMrt ? mrt({ output: node, proof: vec4(0) }) : node
      material.needsUpdate = true
      renderer!.setRenderTarget(target)
      quad.render(renderer!)
      return await renderer!.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
    }
    const errorFor = (actual: Float32Array, expected: number[], flip: boolean) => {
      // Three aligns WebGPU rows to256 bytes but omits trailing padding on the
      // final row. Total array length therefore cannot determine the stride.
      const stride = webgl ? width : Math.ceil(width * 16 / 256) * 256 / 16
      if (actual.length < ((height - 1) * stride + width) * 4) throw new Error('Unexpected GPU readback layout')
      const channels = [0, 0, 0, 0]
      let worst: unknown
      const actualBits = test.requireFloat32Bits ? new Uint32Array(actual.buffer, actual.byteOffset, actual.length) : null
      const expectedBits = test.requireFloat32Bits ? new Uint32Array(new Float32Array(expected).buffer) : null
      let bitMismatches = 0, bitWorst: unknown
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
        const actualIndex = (y * stride + x) * 4 + c
        const expectedIndex = ((flip ? height - y - 1 : y) * width + x) * 4 + c
        const value = actual[actualIndex]!
        if (!Number.isFinite(value)) throw new Error('GPU produced a non-finite compositor pixel')
        const reference = expected[expectedIndex]!
        if (actualBits && expectedBits && actualBits[actualIndex] !== expectedBits[expectedIndex]) {
          bitMismatches++
          bitWorst = { x, y, channel: c, actualBits: actualBits[actualIndex], expectedBits: expectedBits[expectedIndex] }
        }
        const error = Math.abs(value - reference)
        if (error > Math.max(...channels)) worst = { x, y, channel: c, actual: value, expected: reference }
        channels[c] = Math.max(channels[c]!, error)
      }
      return { max: Math.max(...channels), channels, worst,
        ...(test.requireFloat32Bits ? { bitMismatches, bitWorst } : {}) }
    }
    try {
      ;(window as any).__compositorProgress.phase = 'calibrating'
      // Establish row orientation with unchanged HDR/alpha input, independently
      // of the color grade. Never pick a different orientation to fit a case.
      const control = await render(source)
      const forward = errorFor(control, test.input, false)
      const reverse = errorFor(control, test.input, true)
      const flip = reverse.max < forward.max
      const calibration = flip ? reverse : forward
      row.readback = { arrayType: control.constructor.name, arrayLength: control.length,
        width, height, stridePixels: webgl ? width : Math.ceil(width / 16) * 16,
        firstValues: Array.from(control.slice(0, 16)) }
      row.rowFlip = flip
      row.calibration = calibration.max
      if (calibration.max > 1e-6) throw new Error('Unmodified HDR input did not survive the browser render target')
      if (calibration.bitMismatches) throw new Error('Unmodified input float32 bits did not survive the browser render target')
      const providedSource = test.sourceAsPointwise ? vec4(source.rgb, source.a) : source
      const sourceExtent = new THREE.Vector2()
      const built = buildSourceCompositor(test.program, () => providedSource, test.sourceAsPointwise ? {
        resolvePassExtent: (_pass, activeRenderer) => {
          if (test.passExtentMode === 'input-texture') return [texture.image.width, texture.image.height]
          activeRenderer.getDrawingBufferSize(sourceExtent)
          return [sourceExtent.x, sourceExtent.y]
        },
      } : {})
      try {
        ;(window as any).__compositorProgress.phase = 'rendering'
        const calls: { quad: QuadMesh, target: any, mrt: any }[] = []
        const renderQuad = QuadMesh.prototype.render
        if (test.assertShaderCost) QuadMesh.prototype.render = function (activeRenderer) {
          calls.push({ quad: this, target: activeRenderer.getRenderTarget(), mrt: activeRenderer.getMRT() })
          return renderQuad.call(this, activeRenderer)
        }
        let actual: Float32Array
        try { actual = await render(built.node) }
        finally { QuadMesh.prototype.render = renderQuad }
        Object.assign(row, errorFor(actual, test.expected, flip))
        if (row.bitMismatches) throw new Error('GPU compositor float32 bits differ from native: ' + JSON.stringify(row.bitWorst))
        if (test.captureShader) row.fragmentShader = (await renderer.debug.getShaderAsync(quad, quad.camera, quad)).fragmentShader
        if (test.assertShaderCost) {
          const callerTarget = renderer.getRenderTarget(), callerMrt = renderer.getMRT()
          const shaderBytes: number[] = []
          try {
            for (const call of calls) {
              renderer.setRenderTarget(call.target)
              renderer.setMRT(call.mrt)
              const shader = await renderer.debug.getShaderAsync(call.quad, call.quad.camera, call.quad)
              shaderBytes.push(new TextEncoder().encode(shader.fragmentShader).length)
            }
          } finally { renderer.setRenderTarget(callerTarget); renderer.setMRT(callerMrt) }
          row.shaderCost = { passes: calls.length, fragmentBytes: shaderBytes }
          if (calls.length > test.assertShaderCost.maxPasses
            || shaderBytes.some(bytes => bytes > test.assertShaderCost.maxFragmentBytes))
            throw new Error('Compositor exceeded the proven shader/pass budget: ' + JSON.stringify(row.shaderCost))
        }
        if (activeMrt && (renderer.getMRT() !== activeMrt || renderer.getRenderTarget() !== target
          || renderer.autoClear !== false || renderer.getClearAlpha() !== .37))
          throw new Error('Compositor changed the caller renderer MRT/clear state')
      } finally { built.dispose() }
    } catch (error) { row.error = String(error) }
    finally {
      renderer.setMRT(null)
      renderer.autoClear = true
      renderer.setClearAlpha(1)
      texture.dispose(); material.dispose(); target.dispose()
      if (test.assertTextureCleanup) {
        row.remainingTextures = renderer.info.memory.textures
        if (row.remainingTextures !== 0) row.error = 'Compositor retained ' + row.remainingTextures + ' GPU textures after disposal'
      }
      const validation = await device?.popErrorScope()
      row.shaderErrors = shaderErrors.slice(shaderStart)
      if (validation) row.shaderErrors.push(validation.message)
      if (row.shaderErrors.length) row.error = 'Shader validation failed: ' + row.shaderErrors.join('\n')
      reports.push(row)
      ;(window as any).__compositorProgress = { completed: reports.length, total: cases.length, case: test.case, phase: 'complete' }
      if (performance.now() - lastProgress > 15000) {
        console.info('BLENDLINK_COMPOSITOR_PROGRESS ' + backend + ' ' + reports.length + '/' + cases.length + ' ' + test.case)
        lastProgress = performance.now()
      }
    }
  }
  result.textContent = JSON.stringify(reports, null, 2)
  ;(window as any).__compositorResults = reports
} catch (error) {
  result.textContent = String(error)
  ;(window as any).__compositorFailure = String(error)
} finally { renderer?.dispose() }
