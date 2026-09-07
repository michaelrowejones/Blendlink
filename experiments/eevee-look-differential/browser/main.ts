import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, uv, vec2 } from 'three/tsl'
import { buildSourceDisplay } from '../../../packages/blendlink/src/tslSourceDisplay'
const results = document.querySelector('#results')!
const renderer = new WebGPURenderer({ forceWebGL: location.search.includes('webgl2') })
document.body.append(renderer.domElement)
renderer.setSize(512, 512)
renderer.toneMapping = THREE.NoToneMapping
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
const reports = []
try {
  await renderer.init()
  for (const label of ['agx', 'filmic', 'standard']) {
    const { display } = await (await fetch('/' + label + '.presentation.json')).json()
    const { input, expected } = await (await fetch('/' + label + '-pixels.json')).json()
    const pixels = new Float32Array(64 * 64 * 4)
    for (let i = 0; i < 4096; i++) pixels.set([...input.slice(i * 3, i * 3 + 3), 0.4], i * 4)
    const texture = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat, THREE.FloatType)
    texture.needsUpdate = true
    const source = textureLoad(texture, uv().mul(64))
    const built = buildSourceDisplay(display, source, { inputAlpha: 'straight' })
    const material = new NodeMaterial()
    material.fragmentNode = built.node
    const quad = new QuadMesh(material)
    const target = new THREE.RenderTarget(64, 64, { type: THREE.FloatType })
    renderer.setRenderTarget(target)
    await quad.renderAsync(renderer)
    const actual = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64)
    const errors = []
    let alpha = 0
    const clampedErrors = []
    for (let i = 0; i < 4096; i++) {
      const sourceIndex = renderer.backend.isWebGLBackend
        ? (63 - Math.floor(i / 64)) * 64 + (i % 64)
        : i
      for (let c = 0; c < 3; c++) {
        errors.push(Math.abs(actual[i * 4 + c] - expected[sourceIndex * 3 + c]))
        clampedErrors.push(
          Math.abs(
            THREE.MathUtils.clamp(actual[i * 4 + c], 0, 1) -
              THREE.MathUtils.clamp(expected[sourceIndex * 3 + c], 0, 1),
          ),
        )
      }
      alpha = Math.max(alpha, Math.abs(actual[i * 4 + 3] - 0.4))
    }
    errors.sort((a, b) => a - b)
    const report = {
      label,
      backend: renderer.backend.constructor.name,
      max: errors.at(-1),
      p99: errors[Math.floor(errors.length * 0.99)],
      clampedMax: Math.max(...clampedErrors),
      alpha,
    }
    reports.push(report)
    results.textContent = JSON.stringify(reports, null, 2)
    renderer.setRenderTarget(null)
    quad.render(renderer)
    built.dispose()
    texture.dispose()
    target.dispose()
    material.dispose()
  }
  results.textContent += '\nDONE'
  window.__reports = reports
} catch (error) {
  results.textContent = String(error) + '\n' + error.stack
  console.error(error)
}
