import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { buildTslColorNode } from '../../../packages/blendlink/src/tslNodeRecipe'
const output = document.querySelector('#results')!
try {
  const renderer = new WebGPURenderer({ forceWebGL: location.search.includes('webgl2') })
  await renderer.init()
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const fixture = await (await fetch('/normals.json')).json()
  const gltf = await new GLTFLoader().loadAsync('/normals.glb')
  const [width, height] = fixture.resolution
  renderer.setSize(width, height)
  const cases = fixture.cases.filter((c) => c.space === 'TANGENT' && !c.namedUV && !c.noUV)
  window.__gltf = gltf
  const meshes = []
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return
    const test = cases.find((c) => c.name.replaceAll('.', '') === mesh.name)
    if (!test) {
      mesh.visible = false
      return
    }
    if (location.search.includes('derivative')) mesh.geometry.deleteAttribute('tangent')
    const ir = {
      schemaVersion: 1,
      model: 'blendlink-tsl-ir-v1',
      output: {
        op: 'normal_map',
        convention: test.convention ?? 'OPENGL',
        color: { op: 'const_vec3', value: test.color.slice(0, 3) },
        strength: { op: 'const_float', value: test.strength ?? 1 },
      },
    }
    const color = buildTslColorNode(ir, {
      normalMapBasis: location.search.includes('derivative') ? 'derivative' : 'attribute',
    })
      .mul(0.5)
      .add(0.5)
    mesh.material = new NodeMaterial()
    mesh.material.side = THREE.DoubleSide
    mesh.material.fragmentNode = vec4(color, 1)
    meshes.push(mesh)
  })
  const scene = new THREE.Scene()
  scene.add(gltf.scene)
  const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType })
  renderer.setRenderTarget(target)
  renderer.render(scene, gltf.cameras[0])
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
  window.__pixels = pixels
  window.__renderer = renderer
  const reports = cases.map((c) => {
    let [x, y] = c.centerPixel
    if (renderer.backend.isWebGLBackend) y = height - 1 - y
    const stride = renderer.backend.isWebGLBackend ? width : Math.ceil(width / 16) * 16
    const index = (y * stride + x) * 4
    const actual = [...pixels.slice(index, index + 3)]
    return {
      name: c.name,
      actual,
      expected: c.referenceRGB,
      error: Math.max(...actual.map((v, i) => Math.abs(v - c.referenceRGB[i]))),
    }
  })
  output.textContent = JSON.stringify(reports, null, 2)
  window.__reports = reports
  renderer.setRenderTarget(null)
  renderer.render(scene, gltf.cameras[0])
  document.body.append(renderer.domElement)
} catch (error) {
  output.textContent = String(error) + '\n' + error.stack
  console.error(error)
}
