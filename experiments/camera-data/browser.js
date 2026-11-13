import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { assertLegacyMaterialCarriers } from '@blendlink-camera-document'
import { installTslMaterials } from '@blendlink-camera-runtime'
const halfUlp = (value) =>
  Math.max(2 ** (Math.floor(Math.log2(Math.abs(value) || 2 ** -14)) - 10), 2 ** -24)
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
  inverseC = C.clone().transpose()
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
window.runProof = async (proof) => {
  const renderer = new WebGPURenderer({
    antialias: false,
    forceWebGL: new URLSearchParams(location.search).get('backend') === 'webgl2',
  })
  await renderer.init()
  const info=renderer.backend?.device?.adapterInfo, gl=renderer.backend?.gl, debug=gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu=info?{api:'WebGPU',vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:gl?{api:'WebGL2',vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}:null
  renderer.setPixelRatio(1)
  renderer.setSize(1024, 512)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    device = renderer.backend.device,
    errors = [],
    failures = [],
    rows = [], negativeChecks = []
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
    const manifestBytes=await (await fetch(source.manifestUrl)).arrayBuffer()
    if(await digest(manifestBytes)!==source.manifestSha256)throw new Error('Final manifest bytes changed')
    const manifest=JSON.parse(new TextDecoder().decode(manifestBytes))
    const glbBytes=await (await fetch(manifest.url)).arrayBuffer()
    if(await digest(glbBytes)!==source.glbSha256||source.glbSha256.slice(0,16)!==manifest.hash||glbBytes.byteLength!==manifest.stats.bytes)throw new Error('Actual Final GLB bytes differ from the publication/manifest pin')
    const programBytes=await (await fetch(manifest.materialPrograms.url)).arrayBuffer()
    if(await digest(programBytes)!==source.programSha256)throw new Error('Final material program bytes changed')
    const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glbBytes,new URL('.',new URL(manifest.url,location.href)).href)
    const camera = gltf.cameras[0],
      owners = []
    gltf.scene.traverse((object) => {
      if (object.userData.blendlink_id?.startsWith('geometry-owner-')) owners.push(object)
    })
    if (owners.length !== proof.references.ownerCount || gltf.cameras.length !== 1)
      throw new Error('Actual GLB owners/camera are missing')
    let legacyError;try{await assertLegacyMaterialCarriers({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})}catch(error){legacyError=String(error)}
    if(!legacyError?.includes('Legacy WebGLRenderer')||!legacyError.includes('Camera Data'))throw new Error('Actual live Camera Data silently used a legacy carrier: '+legacyError)
    negativeChecks.push({source:source.name,kind:'actual-legacy-refusal',error:legacyError})
    const callbacks=[]
    gltf.scene.traverse(mesh=>{if(mesh.isMesh){const previous=mesh.onBeforeRender,row={mesh,previous,calls:0,material:mesh.material};row.observer=function(...args){row.calls++;return previous.apply(this,args)};mesh.onBeforeRender=row.observer;callbacks.push(row)}})
    const installed = await installTslMaterials({
      root: gltf.scene,
      descriptor: { materialPrograms: manifest.materialPrograms },
    })
    if (installed.applied !== proof.references.cases.length * owners.length || installed.skipped.length)
      throw new Error('Geometry context install refused ' + JSON.stringify(installed.skipped))
    const materials = new Set()
    for (const owner of owners)
      owner.traverse((mesh) => {
        if (mesh.isMesh && !materials.has(mesh.material)) {
          mesh.material.fragmentNode = vec4(mesh.material.colorNode, 1)
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
          const authored = proof.references.controlRgb
          if (!Array.isArray(authored) || authored.length !== 3)
            throw new Error('Independent RGB control requires its authored values')
          for (let channel = 0; channel < 3; channel++) {
            const expected = control.rgb[channel], value = authored[channel], step = halfUlp(expected)
            if (reference.engine !== 'CYCLES' && Math.abs(expected / step - Math.round(expected / step)) > 2e-4)
              throw new Error('Native EEVEE RGB control is no longer a half-float carrier')
            if (Math.abs(expected - value) > 2e-6 + (reference.engine === 'CYCLES' ? 0 : halfUlp(value)))
              throw new Error('Native RGB control exceeds its independently measured precision')
          }
          const direct = difference(sample(control.pixel, false), authored),
            flipped = difference(sample(control.pixel, true), authored)
          if (direct <= 2e-6 && flipped <= 2e-6)
            throw new Error('Independent RGB orientation control is ambiguous; move its marker outside the mirrored footprint')
          if (Math.min(direct, flipped) > 2e-6)
            throw new Error(
              'Independent RGB control failed ' +
                JSON.stringify({ direct, flipped, source: source.name }),
            )
          flip = flipped < direct
        }
        for (let index = 0; index < proof.references.cases.length; index++) {
          const digits=reference.samples[index].rgb, definition=proof.references.cases[index]
          const actualRgb=sample(reference.samples[index].pixel,flip)
          const control=definition.output==='control'
          if (!control && digits.some(value=>value<0||value>=1||value*256!==Math.round(value*256)))
            throw new Error('Native raw digits must be exact unsigned k/256 half values: '+digits)
          const expected=control?digits:[digits[0]*256+digits[1]+digits[2]/256-definition.bias]
          const actual=control?actualRgb:[actualRgb[0]]
          if (!control && difference(actualRgb,[actualRgb[0],actualRgb[0],actualRgb[0]])>1e-7)
            throw new Error('Actual exported scalar channel is not scalar broadcast')
          const quantization=control?0:proof.references.packing.quantizationBound+(definition.bias?2**-23:0)
          const error=difference(actual,expected), allowance=expected.map(()=>control?2e-6:proof.references.rasterTolerance)
          const kernelError=Math.max(...actual.map((value,channel)=>Math.max(expected[channel]-value,value-expected[channel]-quantization,0)))
          const passed=actual.every((value,channel)=>Number.isFinite(value)&&value>=expected[channel]-allowance[channel]&&value<=expected[channel]+quantization+allowance[channel])
          const row = {
            source: source.name,
            frame,
            owner: name,
            output: proof.references.cases[index].output,
            actual,
            expected,
            error,
            kernelError, quantization,
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
    const saved=camera.position.clone(),culling=callbacks.map(row=>[row.mesh,row.mesh.frustumCulled]),owned=callbacks.map(row=>[row.mesh.material,row.mesh.onBeforeRender,row.mesh.material.version])
    callbacks.forEach(row=>row.mesh.frustumCulled=false);camera.position.x+=1000;camera.updateMatrixWorld(true)
    let error;try{renderer.render(gltf.scene,camera)}catch(value){error=String(value)}
    camera.position.copy(saved);camera.updateMatrixWorld(true);culling.forEach(([mesh,value])=>mesh.frustumCulled=value)
    if(!error?.includes('Camera Data requires camera translation'))throw new Error('Changed actual camera did not produce a named Camera Data limitation: '+error)
    renderer.render(gltf.scene,camera)
    if(callbacks.some((row,index)=>row.mesh.material!==owned[index][0]||row.mesh.onBeforeRender!==owned[index][1]||row.mesh.material.version!==owned[index][2]))throw new Error('Failed draw changed owned materials/callbacks or invalidated pipelines')
    negativeChecks.push({source:source.name,kind:'live-camera-range',error,recovered:true})
    const viewport=target.viewport.clone()
    target.viewport.set(0,0,1,1);callbacks.forEach(row=>row.mesh.frustumCulled=false)
    let resizeError;try{renderer.render(gltf.scene,camera)}catch(value){resizeError=String(value)}
    target.viewport.copy(viewport);culling.forEach(([mesh,value])=>mesh.frustumCulled=value)
    if(!resizeError?.includes('Camera Data angular footprint is unproven'))throw new Error('Actual tiny viewport did not refuse Camera Data: '+resizeError)
    renderer.render(gltf.scene,camera)
    renderer.setRenderTarget(null);renderer.setPixelRatio(2);renderer.setSize(512,256);renderer.render(gltf.scene,camera)
    const textureCount=renderer.info.memory.textures
    for(let repeat=0;repeat<3;repeat++)renderer.render(gltf.scene,camera)
    if(renderer.info.memory.textures!==textureCount)throw new Error('Repeated Camera Data draws grew texture resources')
    renderer.setPixelRatio(1);renderer.setSize(1024,512);renderer.setRenderTarget(target);renderer.render(gltf.scene,camera)
    negativeChecks.push({source:source.name,kind:'actual-viewport-dpr-recovery',error:resizeError,dpr:2,css:[512,256],drawingBuffer:[1024,512],textureCount,recovered:true})
    installed.dispose();installed.dispose()
    if(callbacks.some(row=>row.mesh.material!==row.material||row.mesh.onBeforeRender!==row.observer||!row.calls))throw new Error('Actual Camera Data material/callback ownership was not restored')
    const again=await installTslMaterials({root:gltf.scene,descriptor:{materialPrograms:manifest.materialPrograms}})
    if(again.skipped.length||again.applied!==proof.references.cases.length*owners.length)throw new Error('Actual Camera Data reinstall failed')
    again.dispose()
    callbacks.forEach(row=>{if(row.mesh.onBeforeRender!==row.observer||row.mesh.material!==row.material)throw new Error('Reinstall lost owned callback/material');row.mesh.onBeforeRender=row.previous})
    negativeChecks.push({source:source.name,kind:'material-callback-cleanup-reapply',callbacks:callbacks.length})
    target.dispose()
    mixer.stopAllAction()
  }
  renderer.dispose()
  return { backend, gpu, cases, maximum, maximumKernelError:Math.max(...rows.map(row=>row.kernelError)), rows, negativeChecks, failures }
}
