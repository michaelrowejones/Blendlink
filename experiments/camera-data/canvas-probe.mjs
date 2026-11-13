// QA control: public WebGPU canvas presentation without Three or Camera Data.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const headlessValue = process.env.BLENDLINK_TEST_CHROMIUM_HEADLESS ?? '1'
assert.ok(['0', '1'].includes(headlessValue), 'BLENDLINK_TEST_CHROMIUM_HEADLESS must be 0 or 1')
const headless = headlessValue === '1'
const path = resolve(process.env.BLENDLINK_CAMERA_DATA_NATIVE ?? 'artifacts/camera-data/canvas-control'),
  profile = process.env.BLENDLINK_TEST_PROFILE ?? 'default',
  output = join(path, 'canvas-control-' + profile + '.json')
await mkdir(dirname(output), { recursive: true })
const report = { schemaVersion: 1, kind: 'public-WebGPU-canvas-control-no-Three-no-Camera-Data',
  profile, requestedHeadless: headless, complete: false, errors: [], fixtureSha256: createHash('sha256').update(await readFile(import.meta.filename)).digest('hex') }
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><meta charset="utf-8"><title>Plain WebGPU canvas control</title>')
})
let browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless,
    ...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL ? { channel: process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL } : {}),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
      ...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS ?? '[]')],
  })
  report.browserVersion = browser.version()
  const session = await browser.newBrowserCDPSession()
  report.systemInfo = await session.send('SystemInfo.getInfo')
  report.commandLine = await session.send('Browser.getBrowserCommandLine')
    .then(result => result.arguments).catch(error => ({ unavailable: error.message }))
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  await page.goto('http://127.0.0.1:' + server.address().port)
  report.result = await page.evaluate(async () => {
    const result = { complete: false, phases: [], deviceLosses: [], uncapturedErrors: [] }
    let phase, device
    const mark = name => { phase = { name, at: performance.now() }; result.phases.push(phase) }
    const watchdog = setTimeout(() => device?.destroy(), 30_000)
    try {
      mark('adapter')
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) throw new Error('Public WebGPU adapter unavailable')
      result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description }
      device = await adapter.requestDevice()
      device.lost.then(({ reason, message }) => result.deviceLosses.push({ reason, message, phase }))
      device.addEventListener('uncapturederror', event => result.uncapturedErrors.push({
        message: event.error.message, phase,
      }))
      const canvas = document.createElement('canvas')
      canvas.width = 16; canvas.height = 16
      document.body.append(canvas)
      mark('configure-canvas')
      const context = canvas.getContext('webgpu')
      context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
      mark('current-swapchain-texture')
      const clear = () => {
        const texture = context.getCurrentTexture()
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(),
          clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
        pass.end()
        device.queue.submit([encoder.finish()])
      }
      mark('submit-clear')
      clear()
      await device.queue.onSubmittedWorkDone()
      mark('present-and-read-canvas')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      // WebGPU expires a presented canvas texture. Draw a fresh frame for the
      // immediate public snapshot instead of reading an already-cleared one.
      clear()
      const readback = document.createElement('canvas')
      readback.width = 16; readback.height = 16
      const pixels = readback.getContext('2d')
      pixels.drawImage(canvas, 0, 0)
      result.rgba = Array.from(pixels.getImageData(8, 8, 1, 1).data)
      if (JSON.stringify(result.rgba) !== '[255,0,0,255]')
        throw new Error('Plain public canvas clear/readback differs: ' + result.rgba)
      if (result.deviceLosses.length || result.uncapturedErrors.length)
        throw new Error('Public canvas produced device or validation errors')
      result.complete = true
    } catch (error) {
      result.error = { name: error.name, message: error.message, stack: error.stack, phase }
    } finally {
      clearTimeout(watchdog)
      mark('dispose')
      device?.destroy()
    }
    return result
  })
  report.complete = true
  // Persist failed probes before assertions; this control cannot qualify a node.
  await writeFile(output, JSON.stringify(report, null, 2))
  assert.deepEqual(report.errors, [])
  assert.equal(report.result.complete, true, 'Plain public WebGPU canvas failed; see ' + output)
  console.log('BLENDLINK_CAMERA_PUBLIC_CANVAS_CONTROL_PASSED ' + output)
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack }
  await writeFile(output, JSON.stringify(report, null, 2))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
