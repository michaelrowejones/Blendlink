import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { installTslMaterials } from '@blendlink-geometry-runtime'
import { assertLegacyMaterialCarriers } from '@blendlink-legacy-runtime'
const halfUlp = (value) =>
  Math.max(2 ** (Math.floor(Math.log2(Math.abs(value) || 2 ** -14)) - 10), 2 ** -24)
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
  inverseC = C.clone().transpose()
window.runProof = async (proof) => {
  const requestedBackend=new URLSearchParams(location.search).get('backend')
  let actualAdapter,actualDevice
  if(requestedBackend==='webgpu'){
    actualAdapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})
    if(!actualAdapter)throw new Error('No actual WebGPU adapter')
    actualDevice=await actualAdapter.requestDevice({requiredFeatures:[...actualAdapter.features]})
  }
  const renderer = new WebGPURenderer({
    antialias: false,
    forceWebGL: requestedBackend === 'webgl2',
    ...(actualDevice?{device:actualDevice}:{}),
  })
  await renderer.init()
  const adapter = renderer.backend?.device?.adapterInfo, gl = renderer.backend?.gl
  const debugRenderer = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = actualAdapter ? {api:'WebGPU',vendor:actualAdapter.info?.vendor,architecture:actualAdapter.info?.architecture,description:actualAdapter.info?.description,isFallbackAdapter:actualAdapter.info?.isFallbackAdapter??actualAdapter.isFallbackAdapter} : adapter ? { api: 'WebGPU', vendor: adapter.vendor, architecture: adapter.architecture,
    device: adapter.device, description: adapter.description }
    : gl ? { api: 'WebGL2', vendor: gl.getParameter(debugRenderer?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
      renderer: gl.getParameter(debugRenderer?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) } : null
  renderer.setPixelRatio(1)
  renderer.setSize(1024, 512)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    device = renderer.backend.device,
    errors = [],
    failures = [],
    rows = [], negativeChecks=[]
  renderer.debug.onShaderError = (gl, program, vertex, fragment) =>
    errors.push(
      [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)]
        .filter(Boolean)
        .join('\n'),
    )
  let maximum = 0,
    cases = 0,
    flip
  for (const source of proof.scenes) {
    const manifest = await (await fetch(source.manifestUrl)).json(),
      gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(manifest.url)
    const camera = gltf.cameras[0],
      owners = []
    gltf.scene.traverse((object) => {
      if (object.userData.blendlink_id?.startsWith('geometry-owner-')) owners.push(object)
    })
    if (owners.length !== proof.references.ownerCount || gltf.cameras.length !== 1)
      throw new Error('Actual GLB owners/camera are missing')
    const nativeNormals = new Map(
      proof.references.normalSource.map((value) => [
        value.material + '|' + value.position.join(','),
        value.normal,
      ]),
    )
    for (const owner of owners)
      owner.traverse((mesh) => {
        if (!mesh.isMesh) return
        const position = mesh.geometry.getAttribute('position'),
          normal = mesh.geometry.getAttribute('normal')
        if (!(position.array instanceof Float32Array) || !(normal.array instanceof Float32Array))
          throw new Error('Final geometry must retain Float32 POSITION/NORMAL streams')
        for (let index = 0; index < position.count; index++) {
          const p = [position.getX(index), position.getY(index), position.getZ(index)],
            n = [normal.getX(index), normal.getY(index), normal.getZ(index)]
          const nativeP = source.basis === 'gltf-y-up' ? [p[0], -p[2], p[1]] : p,
            nativeN = source.basis === 'gltf-y-up' ? [n[0], -n[2], n[1]] : n
          const expected = nativeNormals.get(
            mesh.material.userData.blendlink_source_material + '|' + nativeP.join(','),
          )
          if (!expected || nativeN.some((value, channel) => value !== expected[channel]))
            throw new Error(
              'Final glTF changed authored split-normal components ' +
                JSON.stringify({ source: source.name, p: nativeP, n: nativeN, expected }),
            )
        }
      })
    if(proof.references.heightOnly){
      let actualMesh
      gltf.scene.traverse(mesh=>{if(!actualMesh&&mesh.isMesh&&proof.references.cases.some(test=>test.kind==='height'&&!test.slot&&test.name===mesh.material.userData.blendlink_source_material))actualMesh=mesh})
      if(!actualMesh)throw new Error('Missing actual color-only Height primitive')
      let refusal
      try{await assertLegacyMaterialCarriers({root:actualMesh,descriptor:{materialPrograms:manifest.materialPrograms}})}catch(error){refusal=String(error)}
      if(!refusal?.includes('native normal program')||!refusal.includes('WebGPURenderer'))throw new Error('Legacy renderer silently accepted actual Height color data: '+refusal)
      negativeChecks.push({kind:'actual-color-only-legacy-guard',refusal})
    }
    const callbacks=[]
    gltf.scene.traverse(mesh=>{if(mesh.isMesh){
      const previous=mesh.onBeforeRender,row={mesh,previous,calls:0,observer:null}
      row.observer=function(...args){row.calls++;previous.apply(this,args)}
      mesh.onBeforeRender=row.observer;callbacks.push(row)
    }})
    const installed = await installTslMaterials({
      root: gltf.scene,
      descriptor: { materialPrograms: manifest.materialPrograms },
    })
    if (
      installed.applied !== proof.references.cases.length * owners.length ||
      installed.skipped.length
    )
      throw new Error('Normal node install refused ' + JSON.stringify(installed.skipped))
    const materials = new Set()
    for (const owner of owners)
      owner.traverse((mesh) => {
        if (mesh.isMesh && !materials.has(mesh.material)) {
          const test = proof.references.cases.find(
            (value) => value.name === mesh.material.userData.blendlink_source_material,
          )
          const normalField =
            test?.slot === 'normal'
              ? mesh.material.normalNode
              : test?.slot === 'coat-normal'
                ? mesh.material.clearcoatNormalNode
                : null
          if (['normal', 'coat-normal'].includes(test?.slot) && !normalField)
            throw new Error(
              'Native normal program did not install its authored Normal/Coat Normal slot',
            )
          const field = normalField ? normalField.mul(0.2).add(0.5) : mesh.material.colorNode
          mesh.material.fragmentNode = vec4(field, 1)
          mesh.material.needsUpdate = true
          materials.add(mesh.material)
        }
      })
    const mixer = new THREE.AnimationMixer(gltf.scene)
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
    }
    const first = Math.min(
      ...gltf.animations.flatMap((clip) => clip.tracks.map((track) => track.times[0])),
    )
    const target = new THREE.RenderTarget(1024, 512, { type: THREE.FloatType, depthBuffer: true })
    target.texture.colorSpace = THREE.NoColorSpace
    for (const frame of proof.references.frames) {
      mixer.setTime(first + (frame - 1) / 24)
      gltf.scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      for (const owner of owners) {
        for (const other of owners) other.visible = true
        const name = owner.name.replaceAll('_', ' '),
          reference = proof.references.rows.find(
            (row) => row.source === source.source && row.frame === frame && row.owner === name,
          )
        if (!reference) throw new Error('Native owner reference missing ' + name)
        const nativeObject =
          source.basis === 'gltf-y-up'
            ? inverseC.clone().multiply(owner.matrixWorld).multiply(C)
            : owner.matrixWorld.clone()
        const nativeCamera =
          source.basis === 'gltf-y-up'
            ? inverseC.clone().multiply(camera.matrixWorld)
            : camera.matrixWorld.clone()
        const objectMatrixError = difference(
          nativeObject.elements,
          new THREE.Matrix4().set(...reference.objectMatrix.flat()).elements,
        )
        const cameraMatrixError = difference(
          nativeCamera.elements,
          new THREE.Matrix4().set(...reference.cameraMatrix.flat()).elements,
        )
        if (objectMatrixError > 2e-5 || cameraMatrixError > 2e-5)
          throw new Error(
            'Published geometry camera/owner pose differs from native ' +
              JSON.stringify({
                source: source.name,
                frame,
                owner: name,
                objectMatrixError,
                cameraMatrixError,
                first,
                tracks: gltf.animations.map((clip) => ({
                  name: clip.name,
                  times: clip.tracks.map((track) => [
                    track.name,
                    track.times[0],
                    track.times.at(-1),
                  ]),
                })),
              }),
          )
        device?.pushErrorScope('validation')
        renderer.setRenderTarget(target)
        renderer.setClearColor(new THREE.Color(1, 0, 1), 0)
        renderer.render(gltf.scene, camera)
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1024, 512)
        const sample = (point, flipped) => {
          const [x, y] = point
          return Array.from(
            pixels.slice(
              ((flipped ? 511 - y : y) * 1024 + x) * 4,
              ((flipped ? 511 - y : y) * 1024 + x) * 4 + 3,
            ),
          )
        }
        if (flip === undefined) {
          const control = reference.samples.at(-1)
          // Calibrate row orientation against the independent authored RGB
          // constant. EEVEE's EXR contains a final half conversion; native
          // control pixels are checked with their half ULP below.
          const authored = [0.3333333, 0.1234567, 1.234567]
          const direct = difference(sample(control.pixel, false), authored),
            flipped = difference(sample(control.pixel, true), authored)
          if (Math.min(direct, flipped) > 2e-6)
            throw new Error(
              'Independent RGB control failed ' +
                JSON.stringify({ direct, flipped, source: source.name }),
            )
          flip = flipped < direct
        }
        for (let index = 0; index < proof.references.cases.length; index++) {
          const expected = reference.samples[index].rgb,
            actual = sample(reference.samples[index].pixel, flip)
          const error = difference(actual, expected),
            tolerance = proof.references.rasterTolerance
          const allowance = expected.map(
            (value) => tolerance + (reference.engine === 'CYCLES' ? 0 : halfUlp(value)),
          )
          const passed = actual.every(
            (value, channel) =>
              Number.isFinite(value) && Math.abs(value - expected[channel]) <= allowance[channel],
          )
          const row = {
            source: source.name,
            frame,
            owner: name,
            output: proof.references.cases[index].output,
            actual,
            expected,
            error,
            allowance,
            objectMatrixError,
            cameraMatrixError,
            passed,
          }
          if (frame === 5 && name === 'Geometry Owner 1') {
            const previous = rows.find(
              (value) =>
                value.source === source.name &&
                value.frame === 3 &&
                value.owner === name &&
                value.output === row.output,
            )
            if (
              !previous ||
              difference(previous.expected, expected) !== 0 ||
              difference(previous.actual, actual) > 2e-7
            )
              throw new Error(
                'Changing the other owner leaked into an unchanged owner ' +
                  JSON.stringify({ previous, row }),
              )
          }
          rows.push(row)
          cases++
          maximum = Math.max(maximum, error)
          if (!passed) failures.push(row)
        }
        const validation = await device?.popErrorScope()
        if (validation) errors.push(validation.message)
      }
    }
    if (errors.length) throw new Error(errors.join('\n'))
    if(proof.references.heightOnly&&source===proof.scenes.at(-1)){
      const matrix=camera.projectionMatrix.clone(),culling=[]
      gltf.scene.traverse(object=>{if(object.isMesh){culling.push([object,object.frustumCulled]);object.frustumCulled=false}})
      camera.projectionMatrix.elements[0]*=1e6;camera.projectionMatrix.elements[5]*=1e6
      let error
      try{renderer.render(gltf.scene,camera)}catch(value){error=String(value)}
      camera.projectionMatrix.copy(matrix);culling.forEach(([object,value])=>object.frustumCulled=value)
      if(!error?.includes('Bump Height view precision is unproven')||!error.includes('Distance'))throw new Error('Actual resized view did not report its named actionable Height limitation: '+error)
      renderer.render(gltf.scene,camera)
      negativeChecks.push({kind:'actual-projection-footprint',error,recovered:true})
      installed.dispose()
      let mesh
      gltf.scene.traverse(object=>{if(!mesh&&object.isMesh&&object.geometry.hasAttribute('uv')&&proof.references.cases.some(test=>test.kind==='height'&&test.name===object.material.userData.blendlink_source_material))mesh=object})
      if(!mesh)throw new Error('Missing actual Height UV primitive')
      const coordinates=mesh.geometry.getAttribute('uv'),before=coordinates.getX(0)
      coordinates.setX(0,3);coordinates.needsUpdate=true
      const refused=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
      if(!refused.skipped.some(row=>row.reason.includes('Bump Height')&&row.reason.includes('UVs exceed')))throw new Error('Changed actual Final UVs did not refuse Height: '+JSON.stringify(refused.skipped))
      refused.dispose();coordinates.setX(0,before);coordinates.needsUpdate=true
      const recovered=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
      if(recovered.skipped.length||recovered.applied!==proof.references.cases.length*owners.length)throw new Error('Height proof did not recover after restoring actual UV bytes')
      recovered.dispose();negativeChecks.push({kind:'actual-final-uv-mutation',recovered:true})
    }
    installed.dispose()
    for(const row of callbacks){
      if(row.mesh.onBeforeRender!==row.observer||!row.calls)throw new Error('Height installer lost an owned callback or never drew the actual mesh')
      row.mesh.onBeforeRender=row.previous
    }
    if(proof.references.heightOnly)negativeChecks.push({kind:'owned-material-callback-cleanup',callbacks:callbacks.length})
    target.dispose()
    mixer.stopAllAction()
  }
  renderer.dispose()
  actualDevice?.destroy()
  return { backend, gpu, cases, maximum, rows, failures, negativeChecks }
}
