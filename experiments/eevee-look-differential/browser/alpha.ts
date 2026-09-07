import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, uv } from 'three/tsl'
import { buildSourceDisplay } from '../../../packages/blendlink/src/tslSourceDisplay'
const renderer = new WebGPURenderer({ forceWebGL: location.search.includes('webgl2') })
await renderer.init()
renderer.toneMapping = THREE.NoToneMapping
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
renderer.setSize(8, 8)
const reports = []
for (const view of ['AgX', 'Filmic', 'Standard']) {
  try {
    const test = await (await fetch('/alpha/' + view + '.json')).json(),
      presentation = await (await fetch('/alpha/' + view + '.presentation.json')).json()
    const texture = new THREE.DataTexture(
      new Float32Array(test.input),
      8,
      8,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    texture.needsUpdate = true
    const built = buildSourceDisplay(presentation.display, textureLoad(texture, uv().mul(8)))
    const material = new NodeMaterial()
    material.fragmentNode = built.node
    const quad = new QuadMesh(material)
    const target = new THREE.RenderTarget(8, 8, { type: THREE.FloatType })
    renderer.setRenderTarget(target)
    quad.render(renderer)
    const actual = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 8, 8)
    let max = 0
    const stride = renderer.backend.isWebGLBackend ? 8 : 16
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        for (let c = 0; c < 4; c++) {
          const row = renderer.backend.isWebGLBackend ? 7 - y : y
          max = Math.max(
            max,
            Math.abs(
              actual[(y * stride + x) * 4 + c] -
                test.expectedDisplayPremultipliedCpu[(row * 8 + x) * 4 + c],
            ),
          )
        }
    reports.push({ view, max })
    built.dispose()
    texture.dispose()
    material.dispose()
    target.dispose()
  } catch (error) {
    reports.push({ view, error: String(error) })
  }
}
window.__reports = reports
document.querySelector('#results').textContent = JSON.stringify(reports, null, 2)
renderer.dispose()
