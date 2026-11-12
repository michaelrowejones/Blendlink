import * as THREE from 'three'
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'
import { texture as textureNode, textureLoad, textureSize, uv, ivec2, mrt, output, vec4 } from 'three/tsl'
import { buildSourceCompositor } from 'blendlink-compositor-under-test'

/** Keep one actual compiled compositor alive through valid and rejected resizes. */
export async function compositorResizeProof(test: any, renderer: WebGPURenderer, webgl: boolean): Promise<any> {
  const first = test.resizeFrames[0]
  const texture = new THREE.DataTexture(new Float32Array(first.input), first.width, first.height, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  const image = textureNode(texture)
  const source = textureLoad(image, ivec2(uv().mul(textureSize(image))))
  const providedSource = test.sourceAsPointwise ? vec4(source.rgb, source.a) : source
  const sourceExtent = new THREE.Vector2()
  const built = buildSourceCompositor(test.program, () => providedSource, test.sourceAsPointwise ? {
    resolvePassExtent: (_pass, activeRenderer) => {
      if (test.passExtentMode === 'input-texture') return [texture.image.width, texture.image.height]
      activeRenderer.getDrawingBufferSize(sourceExtent)
      return [sourceExtent.x, sourceExtent.y]
    },
  } : {})
  const material = new NodeMaterial(), quad = new QuadMesh(material)
  const target = new THREE.RenderTarget(first.width, first.height, { type: THREE.FloatType, count: 2 })
  target.textures[0]!.name = 'output'; target.textures[1]!.name = 'proof'
  const activeMrt = mrt({ output, proof: vec4(0) })
  const row: any = { max: 0, channels: [0, 0, 0, 0], frames: [], maxPasses: 0, maxFragmentBytes: 0 }
  let initialShaders: string[] | undefined
  let previousExtent = ''
  try {
    for (const frame of test.resizeFrames) {
      const { width, height } = frame
      renderer.setPixelRatio(frame.pixelRatio ?? 1)
      renderer.setSize(frame.logicalWidth ?? width, frame.logicalHeight ?? height)
      target.setSize(width, height)
      if (texture.image.width !== width || texture.image.height !== height) texture.dispose()
      texture.image = { data: new Float32Array(frame.input), width, height }
      texture.needsUpdate = true
      renderer.setMRT(activeMrt); renderer.autoClear = false; renderer.setClearAlpha(.37)
      const render = async (node: any) => {
        material.fragmentNode = mrt({ output: node, proof: vec4(0) }); material.needsUpdate = true
        renderer.setRenderTarget(target)
        quad.render(renderer)
        return await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
      }
      const errorFor = (actual: Float32Array, expected: number[], flip: boolean) => {
        const stride = webgl ? width : Math.ceil(width / 16) * 16
        const channels = [0, 0, 0, 0]
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
          const value = actual[(y * stride + x) * 4 + c]!
          if (!Number.isFinite(value)) throw new Error('Compositor resize produced a nonfinite pixel')
          channels[c] = Math.max(channels[c]!, Math.abs(value - expected[((flip ? height - y - 1 : y) * width + x) * 4 + c]!))
        }
        return { max: Math.max(...channels), channels }
      }
      const control = await render(source), forward = errorFor(control, frame.input, false), reverse = errorFor(control, frame.input, true)
      const flip = reverse.max < forward.max
      if ((flip ? reverse : forward).max > 1e-6) throw new Error('Compositor resize source calibration failed')
      const calls: { quad: QuadMesh, target: any, mrt: any }[] = []
      const uploads: { texture: string, version: number }[] = []
      const backend: any = renderer.backend, updateTexture = backend.updateTexture
      backend.updateTexture = function (texture: THREE.Texture, ...arguments_: any[]) {
        if ((texture as THREE.DataTexture).isDataTexture && texture.image?.width === 129 && texture.image?.height === 1)
          uploads.push({ texture: texture.uuid, version: texture.version })
        return updateTexture.call(this, texture, ...arguments_)
      }
      const renderQuad = QuadMesh.prototype.render
      QuadMesh.prototype.render = function (activeRenderer) {
        calls.push({ quad: this, target: activeRenderer.getRenderTarget(), mrt: activeRenderer.getMRT() })
        return renderQuad.call(this, activeRenderer)
      }
      let actual: Float32Array | undefined, failure: unknown
      try { actual = await render(built.node) } catch (error) { failure = error }
      finally { QuadMesh.prototype.render = renderQuad; backend.updateTexture = updateTexture }
      if (renderer.getMRT() !== activeMrt || renderer.getRenderTarget() !== target
        || renderer.autoClear !== false || renderer.getClearAlpha() !== .37)
        throw new Error('Compositor changed caller renderer state during resize/rejection')
      if (frame.expectError) {
        if (!String(failure).includes(frame.expectError)) throw new Error('Compositor failed to reject the unsupported extent: ' + String(failure))
        row.frames.push({ width, height, rejected: String(failure), restoredState: true })
        continue
      }
      if (failure) throw failure
      const extent = width + '×' + height
      if (extent === previousExtent && uploads.length) throw new Error('Compositor reuploaded unchanged coefficient tables')
      previousExtent = extent
      const error = errorFor(actual!, frame.expected, flip)
      row.max = Math.max(row.max, error.max)
      row.channels = row.channels.map((value: number, channel: number) => Math.max(value, error.channels[channel]!))
      const shaders: string[] = []
      try {
        for (const call of calls) {
          renderer.setRenderTarget(call.target); renderer.setMRT(call.mrt)
          shaders.push((await renderer.debug.getShaderAsync(call.quad, call.quad.camera, call.quad)).fragmentShader)
        }
      } finally { renderer.setRenderTarget(target); renderer.setMRT(activeMrt) }
      if (initialShaders && JSON.stringify(shaders) !== JSON.stringify(initialShaders))
        throw new Error('Compositor changed shader structure while resizing')
      initialShaders ??= shaders
      row.maxPasses = Math.max(row.maxPasses, calls.length)
      row.maxFragmentBytes = Math.max(row.maxFragmentBytes, ...shaders.map(shader => new TextEncoder().encode(shader).length))
      if (calls.length > test.assertShaderCost.maxPasses || row.maxFragmentBytes > test.assertShaderCost.maxFragmentBytes)
        throw new Error('Compositor exceeded its resize shader/pass budget')
      row.frames.push({ width, height, pixelRatio: frame.pixelRatio ?? 1, max: error.max,
        coefficientUploads: uploads.length, restoredState: true, shaderStructureUnchanged: true })
    }
  } finally {
    renderer.setPixelRatio(1)
    renderer.setMRT(null); renderer.autoClear = true; renderer.setClearAlpha(1)
    built.dispose(); texture.dispose(); material.dispose(); target.dispose()
    row.remainingTextures = renderer.info.memory.textures
    if (row.remainingTextures !== 0) throw new Error('Compositor retained GPU textures after resize/disposal')
  }
  return row
}
