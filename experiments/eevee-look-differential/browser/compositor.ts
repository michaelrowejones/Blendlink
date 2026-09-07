import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, uv, vec4, vec3 } from 'three/tsl'
import { buildSourceCompositor } from '../../../packages/blendlink/src/tslSourceCompositor'
const results = document.querySelector('#results')!
const reports = []
try {
  const renderer = new WebGPURenderer({ forceWebGL: location.search.includes('webgl2') })
  await renderer.init()
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  const base = location.search.includes('kernels') ? '/kernel-cases/' : '/compositor-cases/'
  const cases = await (await fetch(base + 'index.json')).json()
  for (const entry of cases) {
    try {
      const test = await (await fetch(base + entry.case + '.json')).json()
      const width = test.width ?? 8,
        height = test.height ?? 8
      renderer.setSize(width, height)
      const texture = new THREE.DataTexture(
        new Float32Array(test.input),
        width,
        height,
        THREE.RGBAFormat,
        THREE.FloatType,
      )
      texture.needsUpdate = true
      const source = textureLoad(texture, uv().mul(vec3(width, height, 0).xy))
      const built = buildSourceCompositor(test.program, () => source)
      let node = built.node
      if (test.program.output.type === 'VALUE') node = vec4(vec3(node), 1)
      const material = new NodeMaterial()
      material.fragmentNode = node
      const quad = new QuadMesh(material)
      const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType })
      renderer.setRenderTarget(target)
      quad.render(renderer)
      const actual = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
      const stride = renderer.backend.isWebGLBackend ? width : Math.ceil(width / 16) * 16
      let max = 0
      const channels = [0, 0, 0, 0]
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let c = 0; c < 4; c++) {
            const row = renderer.backend.isWebGLBackend ? height - 1 - y : y
            const error = Math.abs(
              actual[(y * stride + x) * 4 + c] - test.expected[(row * width + x) * 4 + c],
            )
            max = Math.max(max, error)
            channels[c] = Math.max(channels[c], error)
          }
      reports.push({ case: entry.case, max, channels })
      built.dispose()
      texture.dispose()
      material.dispose()
      target.dispose()
    } catch (error) {
      reports.push({ case: entry.case, error: String(error) })
    }
  }
  results.textContent = JSON.stringify(reports, null, 2)
  window.__reports = reports
} catch (error) {
  results.textContent = String(error) + '\n' + error.stack
  console.error(error)
}
