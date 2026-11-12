import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { installTslMaterials } from '@sign-runtime'
const halfUlp = (value) =>
  Math.max(2 ** (Math.floor(Math.log2(Math.abs(value) || 2 ** -14)) - 10), 2 ** -24)
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
  inverseC = C.clone().transpose()
window.runProof = async (proof, backend) => {
  let adapter, device
  if (backend === 'webgpu') {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No actual WebGPU adapter')
    device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] })
  }
  const renderer = new WebGPURenderer({
    antialias: false,
    forceWebGL: backend === 'webgl2',
    ...(device ? { device } : {}),
  })
  await renderer.init()
  renderer.setSize(1024, 512)
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const gl = renderer.backend.gl,
    debug = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter
    ? {
        vendor: adapter.info?.vendor,
        architecture: adapter.info?.architecture,
        description: adapter.info?.description,
        isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter,
      }
    : {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      }
  window.rendererSignGpu = gpu
  const errors = []
  renderer.debug.onShaderError = (gl, p, v, f) =>
    errors.push(
      [gl.getProgramInfoLog(p), gl.getShaderInfoLog(v), gl.getShaderInfoLog(f)].join('\n'),
    )
  const target = new THREE.RenderTarget(1024, 512, { type: THREE.FloatType, depthBuffer: true })
  target.texture.colorSpace = THREE.NoColorSpace
  const results = [],
    resourceChecks = []
  let total = 0,
    maximum = 0,
    callbackCalls = 0,
    pipelineChecks = 0
  const memory = () => ({
    programs: renderer.info.memory.programs,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    attributes: renderer.info.memory.attributes,
    pipelines: renderer._pipelines.caches.size,
  })
  for (const source of proof.scenes) {
    const manifest = await (await fetch(source.manifestUrl)).json()
    const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url)
    const owners = [],
      meshes = []
    loaded.scene.traverse((object) => {
      if (object.userData.blendlink_id?.startsWith('renderer-sign-owner-')) owners.push(object)
      if (object.isMesh) meshes.push(object)
    })
    if (owners.length !== 2 || loaded.cameras.length !== 1)
      throw new Error('Actual Final owners/camera missing')
    const camera = loaded.cameras[0],
      originalMaterials = new Map(meshes.map((mesh) => [mesh, mesh.material]))
    const latestUserDraw = new WeakMap(),
      userCallbacks = new Map()
    let iteration = 0
    for (const mesh of meshes) {
      const user = function (renderer, scene, camera, geometry, material, group) {
        if (this !== mesh || geometry !== mesh.geometry || !material)
          throw new Error('User callback receiver/arguments changed')
        callbackCalls++
        latestUserDraw.set(mesh, iteration)
      }
      mesh.onBeforeRender = user
      userCallbacks.set(mesh, user)
    }
    const scaleTracks = loaded.animations
      .flatMap((clip) => clip.tracks)
      .filter((track) => track.name.endsWith('.scale'))
    if (
      !scaleTracks.length ||
      scaleTracks.some((track) => track.getInterpolation() !== THREE.InterpolateDiscrete)
    )
      throw new Error('Authored sign transitions must publish as actual STEP scale tracks')
    const mixer = new THREE.AnimationMixer(loaded.scene),
      actions = loaded.animations.map((clip) => mixer.clipAction(clip))
    const first = Math.min(
      ...loaded.animations.flatMap((clip) => clip.tracks.map((track) => track.times[0])),
    )
    const setFrame = (frame) => {
      for (const action of actions) {
        action.reset()
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
      }
      mixer.setTime(first + (frame - 1) / proof.reference.fps)
      loaded.scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
    }
    for (let application = 0; application < 2; application++) {
      setFrame(1)
      const installed = await installTslMaterials({
        root: loaded.scene,
        descriptor: { materialPrograms: manifest.materialPrograms },
      })
      if (
        installed.applied !== proof.reference.cases.length * owners.length ||
        installed.skipped.length
      )
        throw new Error('Actual Final installation refused ' + JSON.stringify(installed.skipped))
      if (proof.withoutOrientationHook)
        for (const mesh of meshes) mesh.onBeforeRender = userCallbacks.get(mesh)
      const active = new Set(meshes.map((mesh) => mesh.material))
      for (const material of active) {
        material.fragmentNode = vec4(material.colorNode, 1)
        material.needsUpdate = true
      }
      const originalCacheKey = renderer.backend.getRenderCacheKey
      renderer.backend.getRenderCacheKey = function (renderObject) {
        if (active.has(renderObject.material)) {
          if (latestUserDraw.get(renderObject.object) !== iteration)
            throw new Error('Pipeline selection preceded user/draw callbacks')
          pipelineChecks++
        }
        return originalCacheKey.call(this, renderObject)
      }
      const signs = new WeakMap(),
        sequence = [1, 2, 3, 4, 5, 4, 3, 2, 1]
      let warm
      try {
        for (let round = 0; round < 8; round++)
          for (const frame of sequence) {
            iteration++
            setFrame(frame)
            const increments = new Map([...active].map((material) => [material, 0])),
              before = new Map([...active].map((material) => [material, material.version]))
            for (const mesh of meshes) {
              const sign = mesh.matrixWorld.determinant() < 0 ? -1 : 1,
                previous = signs.get(mesh)
              if (
                previous !== undefined &&
                previous !== sign &&
                backend === 'webgpu' &&
                !proof.withoutOrientationHook
              )
                increments.set(mesh.material, increments.get(mesh.material) + 1)
              signs.set(mesh, sign)
            }
            for (const owner of owners) {
              const name = owner.name.replaceAll('_', ' '),
                reference = proof.reference.rows.find(
                  (row) =>
                    row.source === source.source && row.frame === frame && row.owner === name,
                )
              if (!reference) throw new Error('Native pose reference missing')
              const actual =
                source.basis === 'gltf-y-up'
                  ? inverseC.clone().multiply(owner.matrixWorld).multiply(C)
                  : owner.matrixWorld
              if (
                difference(
                  actual.elements,
                  new THREE.Matrix4().set(...reference.objectMatrix.flat()).elements,
                ) > 2e-5
              )
                throw new Error('Actual Final STEP owner pose differs from native')
            }
            renderer.setRenderTarget(target)
            renderer.setClearColor(new THREE.Color(1, 0, 1), 0)
            renderer.render(loaded.scene, camera)
            const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1024, 512)
            for (const material of active)
              if (material.version !== before.get(material) + increments.get(material))
                throw new Error('Material invalidated beyond actual sign transitions')
            const sample = (point, flip) => {
              const [x, y] = point
              return Array.from(
                pixels.slice(
                  ((flip ? 511 - y : y) * 1024 + x) * 4,
                  ((flip ? 511 - y : y) * 1024 + x) * 4 + 3,
                ),
              )
            }
            for (const owner of owners) {
              const name = owner.name.replaceAll('_', ' '),
                reference = proof.reference.rows.find(
                  (row) =>
                    row.source === source.source && row.frame === frame && row.owner === name,
                )
              const control = reference.samples.at(-1),
                authored = [0.3333333, 0.1234567, 1.234567]
              const upright = difference(sample(control.pixel, false), authored),
                inverted = difference(sample(control.pixel, true), authored)
              if (upright <= 2e-6 && inverted <= 2e-6)
                throw new Error('Independent RGB control has ambiguous row orientation')
              const flip = inverted < upright
              if (difference(sample(control.pixel, flip), authored) > 2e-6)
                throw new Error('Independent authored RGB control failed')
              for (let index = 0; index < proof.reference.cases.length; index++) {
                const expected = reference.samples[index].rgb,
                  actual = sample(reference.samples[index].pixel, flip),
                  error = difference(actual, expected)
                if (
                  actual.some(
                    (value, c) =>
                      !Number.isFinite(value) ||
                      Math.abs(value - expected[c]) >
                        proof.reference.rasterTolerance + halfUlp(expected[c]),
                  )
                )
                  throw new Error(
                    'Actual Final sign transition failed ' +
                      JSON.stringify({
                        source: source.name,
                        frame,
                        round,
                        owner: name,
                        index,
                        actual,
                        expected,
                        error,
                        flip,
                        pixel: reference.samples[index].pixel,
                        camera: camera.matrixWorld.elements,
                        nativeCamera: reference.cameraMatrix,
                        meshes: meshes.map((mesh) => ({
                          name: mesh.name,
                          material: mesh.material.userData.blendlink_source_material,
                          center: new THREE.Box3()
                            .setFromObject(mesh)
                            .getCenter(new THREE.Vector3())
                            .project(camera)
                            .toArray(),
                        })),
                      }),
                  )
                total++
                maximum = Math.max(maximum, error)
              }
            }
            if (round === 1 && frame === sequence.at(-1)) warm = memory()
          }
        const end = memory()
        for (const key of Object.keys(warm))
          if (end[key] !== warm[key])
            throw new Error(
              'Repeated sign transitions grew resources ' + JSON.stringify({ warm, end }),
            )
        resourceChecks.push({ source: source.name, application, warm, end })
      } finally {
        renderer.backend.getRenderCacheKey = originalCacheKey
      }
      installed.dispose()
      installed.dispose()
      for (const mesh of meshes)
        if (
          mesh.material !== originalMaterials.get(mesh) ||
          mesh.onBeforeRender !== userCallbacks.get(mesh)
        )
          throw new Error('Dispose/reapply failed to restore materials and original callbacks')
    }
    results.push({
      source: source.name,
      meshes: meshes.length,
      sharedMaterials: new Set(originalMaterials.values()).size,
    })
    for (const mesh of meshes) mesh.geometry.dispose()
    for (const material of new Set(originalMaterials.values())) material.dispose()
  }
  if (errors.length) throw new Error(errors.join('\n'))
  target.dispose()
  renderer.dispose()
  device?.destroy()
  return {
    backend,
    gpu,
    cases: total,
    maximum,
    callbackCalls,
    pipelineChecks,
    resourceChecks,
    results,
  }
}
