import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { screenCoordinate, uniform, vec3 } from 'three/tsl'
import { boxSample, weightsColor } from './candidate.mjs'

window.captureBoxPrototype = async ({ backend, contract, images, assetBase }) => {
  const renderer = new WebGPURenderer({ forceWebGL: backend === 'webgl2', antialias: false })
  const result = { backend, status: 'running', rows: [], errors: [], supportCredit: 0 }
  window.boxFailure = result
  const maps = [], materials = [], bitmaps = []
  const target = new THREE.RenderTarget(64, 1, { type: THREE.FloatType, depthBuffer: false })
  target.texture.colorSpace = THREE.NoColorSpace
  try {
    await renderer.init()
    const webgpu = renderer.backend.isWebGPUBackend === true
    if ((webgpu ? 'webgpu' : 'webgl2') !== backend) throw Error('Actual backend fallback')
    const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info'), info = renderer.backend.device?.adapterInfo
    result.gpu = webgpu ? { vendor: info?.vendor, description: info?.description, architecture: info?.architecture }
      : { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
    renderer.debug.onShaderError = (g, p, v, f) => result.errors.push([g.getProgramInfoLog(p), g.getShaderInfoLog(v), g.getShaderInfoLog(f)].filter(Boolean).join('\n'))
    renderer.backend.device?.addEventListener('uncapturederror', e => result.errors.push(String(e.error)))
    renderer.setSize(64, 1); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
    const normal = uniform(new THREE.Vector4()), coordinate = uniform(new THREE.Vector4())
    function material(node) {
      const m = new NodeMaterial(); m.fragmentNode = node; m.blending = THREE.NoBlending; m.depthTest = false; m.depthWrite = false; materials.push(m); return m
    }
    let height = 1
    const quad = new QuadMesh(), weights = material(weightsColor(normal.xyz, normal.w))
    async function draw(id, m) {
      quad.material = m; renderer.setRenderTarget(target)
      const started = performance.now(); quad.render(renderer)
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, height)
      const words = Array.from(new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length))
      result.rows.push({ id, width: 64, height, words, drawAndReadbackMs: performance.now() - started })
      return words
    }
    const control = uniform(new THREE.Vector4()), controlMaterial = material(control)
    for (const values of [[.1234567, .8765432, 1.5678912, 1], [-.2345679, -2016.125, 2049, 1], [2 ** -32, -(2 ** -32), 2 ** -126, 1]]) {
      control.value.fromArray(values)
      const actual = await draw('calibration-' + result.rows.length, controlMaterial), expected = new Uint32Array(new Float32Array(values).buffer)
      if (!actual.every((value, i) => value === expected[i % 4])) throw Error('Independent RGBA32F calibration failed')
    }
    result.calibration = result.rows.splice(0)
    for (const row of contract.weightCases) {
      normal.value.fromArray([...row.normal, row.blend]); await draw(row.id, weights)
    }
    height = 4; target.setSize(64, height); renderer.setSize(64, height)
    const variants = new Map()
    for (const entry of images) {
      // Same public image decode/Texture interface as the current material
      // transport. Mip/no-mip is experimental; production remains unchanged.
      const response = await fetch(new URL(entry.file, assetBase)); if (!response.ok) throw Error('Image fetch failed')
      const blob = await response.blob(), bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); bitmaps.push(bitmap)
      for (const mode of ['nomip', 'mip']) {
        const map = new THREE.Texture(bitmap); maps.push(map); map.flipY = false; map.colorSpace = entry.colorSpace === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
        map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter; map.minFilter = mode === 'mip' ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; map.generateMipmaps = mode === 'mip'; map.anisotropy = 1; map.needsUpdate = true
        const p = vec3(screenCoordinate.x.div(64).mul(coordinate.x).add(coordinate.y), coordinate.z, coordinate.w)
        variants.set(entry.name + '|' + mode, material(boxSample(map, p, normal.xyz, normal.w)))
      }
    }
    for (const row of contract.samplerCases) {
      normal.value.fromArray([...row.normal, row.blend]); coordinate.value.fromArray(row.coordinate)
      await draw(row.id, variants.get(row.image + '|' + row.mode))
    }
    result.status = 'CAPTURED_EXPERIMENTAL_BOX_RESEARCH'
    result.observed = { imageInstances: maps.length, materialPrograms: materials.length, renderTargetInstances: 1 }
    return result
  } finally {
    renderer.setRenderTarget(null); target.dispose(); for (const m of materials) m.dispose(); for (const map of maps) map.dispose(); for (const bitmap of bitmaps) bitmap.close(); renderer.dispose()
  }
}
