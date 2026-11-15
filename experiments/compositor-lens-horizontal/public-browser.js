/* SPDX-License-Identifier: MIT */
/** Saved Final/public installer research using the qualified same-frame transport. */
import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { textureLoad, ivec2, uv, vec2 } from 'three/tsl'
import { startThreeCompiledScenePreparation } from '@runtime'
import { ThreeWebgpuPostPipelineService } from '@pipeline'
import { sampleInstalledFrame } from '../compositor-displace-single/same-frame.mjs'
import { exactMetric, displayMetric } from '../compositor-displace-single/browser-contract.mjs'
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
const pinned = async (url, sha256) => {
  const response = await fetch(url); if (!response.ok) throw Error('Missing saved Final asset ' + url)
  const bytes = await response.arrayBuffer(); if (await hash(bytes) !== sha256) throw Error('Changed saved Final asset ' + url)
  return bytes
}
window.runLensPublicPilot = async ({ backend: wanted, profile, phase, entries, references, assetBaseUrl }) => {
  const adapter = wanted === 'webgpu' ? await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }) : null
  if (wanted === 'webgpu' && !adapter) throw Error('An actual WebGPU adapter is required')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: wanted === 'webgl2', antialias: false, ...(device ? { device } : {}) })
  await renderer.init(); renderer.info.autoReset = false
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  if (backend !== wanted) throw Error('Actual public API fell back')
  const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { api: 'WebGPU', ...Object.fromEntries(['vendor', 'architecture', 'description', 'device'].map(k => [k, adapter.info[k]])) }
    : { api: 'WebGL2', renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const output = new THREE.RenderTarget(13, 9, { type: THREE.FloatType, depthBuffer: false })
  output.texture.colorSpace = THREE.NoColorSpace
  const rows = [], controls = [], errors = [], actualCreate = ThreeWebgpuPostPipelineService.create
  let pipeline
  ThreeWebgpuPostPipelineService.create = async function (...args) { const result = await actualCreate.apply(this, args); pipeline = result; return result }
  renderer.debug.onShaderError = (context, program) => errors.push(context.getProgramInfoLog(program))
  device?.addEventListener('uncapturederror', event => errors.push(String(event.error)))
  const frame = draw => new Promise((done, reject) => renderer.setAnimationLoop(() => {
    renderer.setAnimationLoop(null)
    try { const before = renderer.info.render.drawCalls; draw(); done({ draws: renderer.info.render.drawCalls - before, frame: renderer._nodes.nodeFrame.frameId }) }
    catch (error) { reject(error) }
  }).catch(reject))
  const material = node => { const m = new NodeMaterial(); m.fragmentNode = node; m.blending = THREE.NoBlending; m.toneMapped = false; return m }
  const draw = async node => { const m = material(node); try { await frame(() => new QuadMesh(m).render(renderer)) } finally { m.dispose() } }
  const probe = node => { const m = material(node); try { const before = renderer.info.render.drawCalls; new QuadMesh(m).render(renderer); return renderer.info.render.drawCalls - before } finally { m.dispose() } }
  let rowFlip = false
  const read = async (w, h) => {
    const pixels = await renderer.readRenderTargetPixelsAsync(output, 0, 0, w, h), padded = Math.ceil(w * 16 / 256) * 256 / 16
    const stride = pixels.length === w * h * 4 ? w : backend === 'webgpu' && [4 * (padded * (h - 1) + w), 4 * padded * h].includes(pixels.length) ? padded : 0
    if (!(pixels instanceof Float32Array) || !stride) throw Error('Missing exact public Float32 readback')
    const source = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length), result = new Uint32Array(w * h * 4)
    for (let y = 0; y < h; y++) result.set(source.subarray(y * stride * 4, (y * stride + w) * 4), (rowFlip ? h - 1 - y : y) * w * 4)
    return result
  }
  try {
    // Independently calibrate row order with a nonuniform direct data copy.
    const data = new Float32Array(13 * 9 * 4); for (let i = 0; i < data.length; i++) data[i] = i / 1024
    const texture = new THREE.DataTexture(data, 13, 9, THREE.RGBAFormat, THREE.FloatType); texture.needsUpdate = true
    renderer.setSize(13, 9); renderer.setRenderTarget(output)
    await draw(textureLoad(texture, ivec2(uv().mul(vec2(13, 9)))))
    if (exactMetric(await read(13, 9), new Uint32Array(data.buffer)).wordDifferences) rowFlip = true
    if (exactMetric(await read(13, 9), new Uint32Array(data.buffer)).wordDifferences) throw Error('Public row calibration failed')
    texture.dispose()
    for (const entry of entries) for (let cycle = 0; cycle < (phase === 'baseline' ? 1 : 3); cycle++) {
      const { width: w, height: h } = entry, id = [profile, backend, entry.moduleExport, w + 'x' + h].join('--')
      renderer.setPixelRatio(1); renderer.setSize(w, h); output.setSize(w, h); renderer.setRenderTarget(output)
      const scene = new THREE.Scene(), sentinel = new THREE.Group(); scene.add(sentinel)
      const original = { children: [...scene.children], background: scene.background, environment: scene.environment }
      const descriptor = (await import(/* @vite-ignore */entry.moduleUrl))[entry.moduleExport]
      const presentation = JSON.parse(new TextDecoder().decode(await pinned(entry.presentationUrl, entry.presentationSha256)))
      pipeline = null
      const task = startThreeCompiledScenePreparation({ renderer, scene, descriptor, assetBaseUrl, prewarm: true, resizeRenderer: true,
        onWarning: message => { throw Error('Public Lens fallback: ' + message) } })
      const prepared = await task.promise
      if (!scene.children.every((child, i) => child === original.children[i]) || scene.children.length !== original.children.length)
        throw Error('Detached preparation changed caller')
      const installed = prepared.commit()
      try {
        if (!pipeline?.sourceCompositor || !pipeline.scenePass || JSON.stringify(pipeline.options.sourcePresentation.compositor) !== JSON.stringify(presentation.compositor))
          throw Error('Public installer omitted or replaced the actual exported Lens program')
        if (pipeline.scenePass.renderTarget.texture.type !== THREE.HalfFloatType || pipeline.scenePass.renderTarget.samples !== 0)
          throw Error('Actual public source-pass precision changed')
        const sourceNode = pipeline.scenePass.getTextureNode(), load = () => textureLoad(sourceNode, ivec2(uv().mul(vec2(w, h))))
        await draw(load()); const input = await read(w, h)
        await draw(load()); const repeated = await read(w, h)
        if (exactMetric(input, repeated).wordDifferences) throw Error('Actual installed input is not stable')
        if (phase === 'baseline') {
          rows.push({ id, moduleExport: entry.moduleExport, width: w, height: h, cycle, baselinePixels: Array.from(input), baselineWords: input.length,
            scenePassType: 'HalfFloatType', scenePassSamples: 0, actualExportedProgram: true })
        } else {
          const reference = references.find(row => row.id === id)
          if (!reference) throw Error('Missing actual installed native reference ' + id)
          const expectedInput = new Uint32Array(await pinned(reference.baselineUrl, reference.baselineSha256))
          if (exactMetric(input, expectedInput).wordDifferences) throw Error('Fresh installed input drift ' + id)
          const expectedLinear = new Uint32Array(await pinned(reference.linearUrl, reference.linearSha256)), expectedDisplay = new Uint32Array(await pinned(reference.displayUrl, reference.displaySha256))
          const sampled = await sampleInstalledFrame({ frame, render: () => installed.render(), read: () => read(w, h),
            probe: () => probe(pipeline.sourceCompositor.node), frameId: () => renderer._nodes.nodeFrame.frameId, drawCalls: () => renderer.info.render.drawCalls })
          const linear = exactMetric(sampled.linear, expectedLinear), display = displayMetric(sampled.display, expectedDisplay)
          rows.push({ id, moduleExport: entry.moduleExport, width: w, height: h, cycle, ...linear, display,
            installedDraws: sampled.installedDraw.draws, probeDraws: sampled.probeDraws,
            sameFrame: sampled.installedDraw.frame === sampled.probeFrame, linearPixels: Array.from(sampled.linear), displayPixels: Array.from(sampled.display),
            actualExportedProgram: true })
          if (linear.wordDifferences || !display.projectionAccepted || sampled.installedDraw.frame !== sampled.probeFrame)
            throw Error('Actual public-installed/native mismatch ' + id)
        }
      } finally {
        installed.dispose(); prepared.dispose(); installed.dispose()
        if (scene.children.length !== original.children.length || !scene.children.every((child, i) => child === original.children[i])
          || scene.background !== original.background || scene.environment !== original.environment) throw Error('Public disposal changed caller')
      }
    }
    if (phase === 'compare') {
      const entry = entries[1], scene = new THREE.Scene(), sentinel = new THREE.Group(); scene.add(sentinel)
      renderer.setPixelRatio(1); renderer.setSize(entry.width, entry.height); output.setSize(entry.width, entry.height); renderer.setRenderTarget(output)
      const descriptor = (await import(/* @vite-ignore */entry.moduleUrl))[entry.moduleExport]
      const before = { background: scene.background, environment: scene.environment }
      const restored = () => scene.children.length === 1 && scene.children[0] === sentinel && scene.background === before.background && scene.environment === before.environment
      const detached = await startThreeCompiledScenePreparation({ renderer, scene, descriptor, assetBaseUrl, prewarm: true, resizeRenderer: true }).promise
      if (!restored()) throw Error('Detached Lens preparation changed caller')
      detached.dispose(); detached.dispose()
      if (!restored()) throw Error('Detached Lens disposal changed caller')
      controls.push({ case: 'detached-dispose', callerRestored: true, numericalCredit: 0 })
      const cancelled = startThreeCompiledScenePreparation({ renderer, scene, descriptor, assetBaseUrl, prewarm: true, resizeRenderer: true })
      cancelled.cancel(); cancelled.cancel(); let error
      try { await cancelled.promise } catch (reason) { error = reason }
      if (error?.name !== 'AbortError' || !restored()) throw Error('Lens cancellation committed a scene or failed restoration')
      controls.push({ case: 'cancel-before-ready', callerRestored: true, errorName: error.name, numericalCredit: 0 })
    }
    if (errors.length) throw Error(errors.join('; '))
    return { status: phase === 'baseline' ? 'LENS_PUBLIC_BASELINE_PASSED_ZERO_CREDIT' : 'LENS_PUBLIC_COMPARE_PASSED_ZERO_CREDIT', backend, gpu, rows,
      callerRestored: true, controls, supportCredit: 0, productionCredit: false, errors }
  } catch (error) { return { status: 'LENS_PUBLIC_FAILED_ZERO_CREDIT', backend, gpu, rows, error: String(error), stack: error.stack, errors, supportCredit: 0 } }
  finally { ThreeWebgpuPostPipelineService.create = actualCreate; output.dispose(); renderer.dispose() }
}
