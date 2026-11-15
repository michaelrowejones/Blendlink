/* SPDX-License-Identifier: MIT */
import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { texture, textureLoad, ivec2, uv, vec2 } from 'three/tsl'
import { buildSourceCompositor } from '@compositor'
import { exactMetric } from '../compositor-displace-single/browser-contract.mjs'

window.runLensHorizontalPilot = async ({ cases, backend: wanted }) => {
  const adapter = wanted === 'webgpu' ? await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }) : null
  if (wanted === 'webgpu' && !adapter) throw Error('Horizontal lens pilot requires actual WebGPU')
  const device = await adapter?.requestDevice({ requiredFeatures: [...adapter.features] })
  const renderer = new WebGPURenderer({ forceWebGL: wanted === 'webgl2', antialias: false, ...(device ? { device } : {}) })
  await renderer.init(); renderer.info.autoReset = false
  const savedOriginalDispose = renderer.dispose.bind(renderer)
  const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  if (backend !== wanted) throw Error('API fallback is not an actual tuple')
  const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = adapter ? { api: 'WebGPU', ...Object.fromEntries(['vendor', 'architecture', 'description', 'device'].map(k => [k, adapter.info[k]])) }
    : { api: 'WebGL2', renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
  const output = new THREE.RenderTarget(13, 9, { type: THREE.FloatType, depthBuffer: false })
  output.texture.colorSpace = THREE.NoColorSpace
  const live = new Set(), allocations = [], destroy = renderer.backend.destroyTexture.bind(renderer.backend), create = renderer.backend.createTexture.bind(renderer.backend)
  renderer.backend.createTexture = (value, ...args) => { const result = create(value, ...args); live.add(value); allocations.push({ texture: value, width: value.image?.width, height: value.image?.height }); return result }
  renderer.backend.destroyTexture = (value, ...args) => { const result = destroy(value, ...args); live.delete(value); return result }
  const rows = [], controls = [], errors = []; let rowFlip = false, owner, borrowed, rendererDisposed = false, wrongExtent = false
  renderer.debug.onShaderError = (context, program) => errors.push(context.getProgramInfoLog(program))
  device?.addEventListener('uncapturederror', event => errors.push(String(event.error)))
  const frame = draw => new Promise((done, reject) => renderer.setAnimationLoop(() => {
    renderer.setAnimationLoop(null)
    try { draw(); done() } catch (error) { reject(error) }
  }).catch(reject))
  const draw = async node => {
    const material = new NodeMaterial(); material.fragmentNode = node; material.blending = THREE.NoBlending; material.toneMapped = false
    try { await frame(() => new QuadMesh(material).render(renderer)) } finally { material.dispose() }
  }
  const read = async (w, h) => {
    const pixels = await renderer.readRenderTargetPixelsAsync(output, 0, 0, w, h), padded = Math.ceil(w * 16 / 256) * 256 / 16
    const stride = pixels.length === w * h * 4 ? w : backend === 'webgpu' && [4 * (padded * (h - 1) + w), 4 * padded * h].includes(pixels.length) ? padded : 0
    if (!(pixels instanceof Float32Array) || !stride) throw Error('Missing exact Float32 readback')
    const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length), result = new Uint32Array(w * h * 4)
    for (let y = 0; y < h; y++) result.set(words.subarray(y * stride * 4, (y * stride + w) * 4), (rowFlip ? h - 1 - y : y) * w * 4)
    return result
  }
  const makeData = c => {
    const data = new THREE.DataTexture(new Float32Array(c.input), c.width, c.height, THREE.RGBAFormat, THREE.FloatType)
    data.colorSpace = THREE.NoColorSpace; data.needsUpdate = true; return data
  }
  const ratio = c => c.width === 26 ? 2 : c.width === 13 ? 1.25 : 1
  const resize = c => { const dpr = ratio(c); renderer.setPixelRatio(dpr); renderer.setSize(c.width / dpr, c.height / dpr); output.setSize(c.width, c.height); renderer.setRenderTarget(output) }
  try {
    // A direct input copy establishes row orientation separately from the node.
    const control = cases.find(c => c.width === 13); borrowed = makeData(control); resize(control)
    await draw(textureLoad(texture(borrowed), ivec2(uv().mul(vec2(control.width, control.height)))))
    const original = new Uint32Array(new Float32Array(control.input).buffer)
    if (exactMetric(await read(control.width, control.height), original).wordDifferences) rowFlip = true
    if (exactMetric(await read(control.width, control.height), original).wordDifferences) throw Error('Independent input copy/orientation failed')
    borrowed.dispose(); borrowed = null
    const source = texture(makeData(control)); borrowed = source.value
    const before = JSON.stringify(control.program)
    owner = buildSourceCompositor(control.program, () => source, {
      resolvePassExtent: () => [source.value.image.width - (wrongExtent ? 1 : 0), source.value.image.height],
    })
    for (let cycle = 0; cycle < 3; cycle++) for (const c of cases) {
      const old = borrowed; borrowed = makeData(c); source.value = borrowed; old.dispose(); resize(c)
      const expected = new Uint32Array(new Float32Array(c.expected).buffer)
      await draw(owner.node); const actual = await read(c.width, c.height), metric = exactMetric(actual, expected)
      rows.push({ cycle, width: c.width, height: c.height, pixelRatio: ratio(c), ...metric, actual: Array.from(actual) })
      if (metric.wordDifferences) throw Error('Exact native horizontal lens comparison failed')
    }
    if (JSON.stringify(control.program) !== before) throw Error('Candidate source program mutated')
    let active = [...live].filter(t => t !== borrowed && !output.textures.includes(t))
    if (active.length !== 4) throw Error('Expected one RTT and three mapping tables, observed ' + active.length)
    const c = cases[cases.length - 1]
    let refusal
    for (const kind of ['pixel-budget-before-rtt', 'mismatched-target', 'offset-target', 'scissor-target', 'source-extent']) {
      resize(c); const createdAt = allocations.length
      if (kind === 'pixel-budget-before-rtt') { renderer.setPixelRatio(1); renderer.setSize(2049, 2048) }
      else if (kind === 'mismatched-target') output.setSize(c.width - 1, c.height)
      else if (kind === 'offset-target') output.viewport.x = 1
      else if (kind === 'scissor-target') output.scissorTest = true
      else wrongExtent = true
      let error
      try { await draw(owner.node) } catch (reason) { error = String(reason) }
      const grew = allocations.slice(createdAt).some(row => row.width * row.height > 4194304)
      if (!error || !/Lens Distortion/.test(error) || grew) throw Error('Missing bounded Lens guard ' + JSON.stringify({ kind, error, grew }))
      if (kind === 'offset-target') refusal = error
      wrongExtent = false; resize(c); output.viewport.set(0, 0, c.width, c.height); output.scissorTest = false
      await draw(owner.node)
      if (exactMetric(await read(c.width, c.height), new Uint32Array(new Float32Array(c.expected).buffer)).wordDifferences)
        throw Error('Recovery changed native output: ' + kind)
      controls.push({ case: kind, error, recovered: true, allocationPastPixelBudget: false, numericalCredit: 0 })
    }
    // Ordinary disposal must retire the observed backend-owned objects. Use a
    // separate fresh owner for saved renderer.dispose: after its manager reset,
    // owners correctly retire retained native handles without backend callbacks.
    owner.dispose(); owner.dispose(); owner = null
    if (active.some(t => live.has(t))) throw Error('Owned horizontal lens textures remained after ordinary disposal')
    owner = buildSourceCompositor(control.program, () => source, {
      resolvePassExtent: () => [source.value.image.width, source.value.image.height],
    })
    await draw(owner.node)
    active = [...live].filter(t => t !== borrowed && !output.textures.includes(t))
    if (active.length !== 4) throw Error('Saved-dispose owner must allocate exactly four private textures')
    const counts = active.map(() => 0), handles = active.map(t => { const record = renderer.backend.get(t); return backend === 'webgpu' ? record.texture : record.textureGPU })
    if (handles.some(handle => !handle) || new Set(handles).size !== 4) throw Error('Missing actual physical Lens handles')
    if (backend === 'webgpu') handles.forEach((handle, index) => { const original = handle.destroy.bind(handle); handle.destroy = () => { counts[index]++; live.delete(active[index]); original() } })
    else { const original = gl.deleteTexture.bind(gl); gl.deleteTexture = handle => { const index = handles.indexOf(handle); if (index >= 0) { counts[index]++; live.delete(active[index]) } original(handle) } }
    borrowed.dispose(); borrowed = null; renderer.setRenderTarget(null); output.dispose(); rendererDisposed = true; savedOriginalDispose()
    let savedDisposeError
    try { owner.node.update({ renderer }) } catch (error) { savedDisposeError = String(error) }
    owner.dispose(); owner.dispose(); owner = null
    if (!/Horizontal Lens Distortion.*(?:available renderer|allocation epoch changed)/.test(savedDisposeError ?? '') || counts.some(count => count !== 1))
      throw Error('Saved original renderer disposal lost Lens ownership: ' + JSON.stringify({ savedDisposeError, counts }))
    controls.push({ case: 'saved-original-dispose', error: savedDisposeError, ownedTextures: 4, physicalDestroys: counts, numericalCredit: 0 })
    if (active.some(t => live.has(t))) throw Error('Owned horizontal lens textures remained after disposal')
    if (errors.length) throw Error(errors.join('; '))
    return { status: 'LENS_HORIZONTAL_BROWSER_PILOT_PASSED_ZERO_CREDIT', backend, gpu, rows, resizeFrames: rows.length,
      invalidTargetRefusal: refusal, recovery: true, remainingOwnedTextures: 0, ownedTextures: active.length,
      controls, supportCredit: 0, savedFinalCredit: 0, errors }
  } catch (error) {
    return { status: 'LENS_HORIZONTAL_BROWSER_PILOT_FAILED_ZERO_CREDIT', backend, gpu, rows, error: String(error), stack: error.stack,
      supportCredit: 0, savedFinalCredit: 0, errors }
  } finally { owner?.dispose(); borrowed?.dispose(); output.dispose(); if (!rendererDisposed) renderer.dispose() }
}
