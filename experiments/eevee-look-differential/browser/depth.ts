import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { pass, vec3, vec4 } from 'three/tsl'
import { buildSourceDepth } from '../../../packages/blendlink/src/tslSourcePasses'

const output = document.querySelector('#results')!
try {
  const renderer = new WebGPURenderer({ forceWebGL: location.search.includes('webgl2') })
  await renderer.init()
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial()))
  const reports = []
  for (const label of ['perspective-depth', 'ortho-depth']) {
    const fixture = await (await fetch('/passes/' + label + '.json')).json()
    const { near, far, lens, sensorWidth, orthoScale } = fixture.camera
    const { width, height } = fixture
    const aspect = width / height
    const camera = label.startsWith('ortho')
      ? new THREE.OrthographicCamera(
          -orthoScale / 2,
          orthoScale / 2,
          orthoScale / aspect / 2,
          -orthoScale / aspect / 2,
          near,
          far,
        )
      : new THREE.PerspectiveCamera(
          THREE.MathUtils.radToDeg(2 * Math.atan(sensorWidth / aspect / (2 * lens))),
          aspect,
          near,
          far,
        )
    camera.position.z = 5
    renderer.setSize(width, height)
    const scenePass = pass(scene, camera)
    const depth = buildSourceDepth(scenePass.getTextureNode('depth'), () => camera)
    const material = new NodeMaterial()
    material.fragmentNode = vec4(vec3(depth), 1)
    const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType })
    renderer.setRenderTarget(target)
    new QuadMesh(material).render(renderer)
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
    let max = 0
    for (const [x, y, name] of [
      [32, 24, 'center'],
      [42, 24, 'offAxis'],
      [0, 0, 'background'],
    ] as const) {
      const row = renderer.backend.isWebGLBackend ? y : height - 1 - y
      const stride = renderer.backend.isWebGLBackend ? width : Math.ceil(width / 16) * 16
      max = Math.max(max, Math.abs(pixels[(row * stride + x) * 4] - fixture.samples[name][0]))
    }
    reports.push({ case: label, max })
    renderer.setRenderTarget(null)
    target.dispose()
    material.dispose()
    scenePass.dispose()
  }
  output.textContent = JSON.stringify(reports)
  window.__reports = reports
  renderer.dispose()
} catch (error) {
  output.textContent = String(error)
  console.error(error)
}
