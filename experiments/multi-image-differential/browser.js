import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { installTslMaterials } from '@blendlink-program-runtime'

window.runProof = async ({ manifest, reference }) => {
  const renderer = new WebGPURenderer({ antialias: false,
    forceWebGL: new URLSearchParams(location.search).get('backend') === 'webgl2' })
  const count=Object.keys(reference.expected).length,width=128*count,height=128
  renderer.setPixelRatio(1); renderer.setSize(width, height); renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  await renderer.init()
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  const shaderErrors = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => shaderErrors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'))
  const device = renderer.backend.device
  device?.pushErrorScope('validation')
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url)
  const originalFetch = window.fetch
  let textureFetches = 0
  window.fetch = (...args) => {
    if (String(args[0]).includes('.tex.')) textureFetches++
    return originalFetch(...args)
  }
  const installed = await installTslMaterials({ root: gltf.scene, descriptor: { materialPrograms: manifest.materialPrograms } })
  window.fetch = originalFetch
  const meshes = []
  gltf.scene.traverse(object => {
    if (!object.isMesh) return
    const material = object.material
    const name = material.userData.blendlink_source_material
    const expected = reference.expected[name]
    if (!expected) throw new Error('Actual GLB material binding has no native reference: ' + name)
    if(expected.coordinateKind.endsWith('uv')){
      const uv=object.geometry.getAttribute('uv')
      if(!uv||Math.abs(uv.getX(0)-expected.coordinates[0])>2e-6||Math.abs(uv.getY(0)-(1-expected.coordinates[1]))>2e-6)
        throw new Error('Actual published UV attribute must retain the stock glTF V convention for '+name)
    }
    const node = expected.channel === 'Emission' ? material.emissiveNode : material.colorNode
    if (!node) throw new Error('Production installer did not bind the expected live channel for ' + name)
    // Read the installed production channel directly on the actual GLB mesh.
    // This is a channel-function proof, independent of a browser light rig.
    material.fragmentNode = vec4(node, 1); material.needsUpdate = true
    meshes.push({ object, name, expected })
  })
  meshes.sort((a, b) => a.object.position.x - b.object.position.x)
  const scene = new THREE.Scene(); scene.add(gltf.scene)
  const camera = new THREE.OrthographicCamera(-1.5*count, 1.5*count, 1.5, -1.5, .1, 100)
  const center=(count-1)*1.5
  camera.position.set(center, 8, 0); camera.up.set(0, 0, 1); camera.lookAt(center, 0, 0)
  camera.updateMatrixWorld(); scene.updateMatrixWorld(true)
  const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType, depthBuffer: true })
  target.texture.colorSpace = THREE.NoColorSpace
  renderer.setRenderTarget(target); renderer.setClearColor(new THREE.Color(1, 0, 1), 1)
  renderer.render(scene, camera)
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
  const stride = width
  let maximum = 0
  const samples = meshes.map(mesh => {
    const projected = new THREE.Box3().setFromObject(mesh.object).getCenter(new THREE.Vector3()).project(camera)
    const x = Math.floor((projected.x + 1) * .5 * width), y = Math.floor((projected.y + 1) * .5 * height)
    const actual = Array.from(pixels.slice((y * stride + x) * 4, (y * stride + x) * 4 + 3))
    const error = Math.max(...actual.map((value, channel) => Math.abs(value - mesh.expected.rgb[channel])))
    if (!actual.every(Number.isFinite)) throw new Error('Nonfinite multi-image channel pixels')
    maximum = Math.max(maximum, error)
    return { material: mesh.name, channel: mesh.expected.channel, pixel: [x, y], actual, expected: mesh.expected.rgb, error }
  })
  const validation = await device?.popErrorScope()
  if (validation) shaderErrors.push(validation.message)
  if (shaderErrors.length) throw new Error(shaderErrors.join('\n'))
  const result = { backend, applied: installed.applied, skipped: installed.skipped, textureFetches, maximum, samples }
  installed.dispose(); target.dispose(); renderer.dispose()
  return result
}
