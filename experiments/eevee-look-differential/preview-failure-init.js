// Test-only hooks. Never write acknowledgements or modify the compiled scene.
window.__probe = { failShaders: true, generation: 1, acknowledgements: [], devices: [] }
const originalFetch = window.fetch
window.fetch = async function (input, init) {
  const url = String(input)
  if (url.includes('/__blendlink/preview-client')) {
    window.__probe.acknowledgements.push(JSON.parse(init.body))
    return Response.json({ ok: true })
  }
  const response = await originalFetch.call(this, input, init)
  if (!url.includes('.blendlink-preview-status.json')) return response
  const status = await response.json()
  status.generation = 'look-regression-' + window.__probe.generation
  status.phase = 'published'
  status.sequence += 100 + window.__probe.generation
  const ack = window.__probe.acknowledgements.at(-1)
  if (ack?.generation === status.generation) {
    status.phase = ack.phase
    status.failureKind = ack.failureKind
    status.error = ack.error
    status.retainedGeneration = ack.retainedGeneration
  }
  return Response.json(status)
}
if (globalThis.GPUAdapter) {
  const request = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request.apply(this, args)
    // Three deliberately ignores destroy() losses. Relabel this test-triggered
    // loss to exercise its unexpected-device-loss notification path.
    Object.defineProperty(device, 'lost', {
      value: device.lost.then((info) => ({ reason: 'unknown', message: info.message })),
    })
    window.__probe.devices.push(device)
    return device
  }
  const create = GPUDevice.prototype.createShaderModule
  GPUDevice.prototype.createShaderModule = function (descriptor) {
    return create.call(
      this,
      window.__probe.failShaders
        ? { ...descriptor, code: 'intentional invalid test shader' }
        : descriptor,
    )
  }
}
const shaderSource = WebGL2RenderingContext.prototype.shaderSource
WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
  return shaderSource.call(
    this,
    shader,
    window.__probe.failShaders ? 'intentional invalid test shader' : source,
  )
}
