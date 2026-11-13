import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function lumaBrowserLaunchOptions(env = process.env) {
  const channel = env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null
  assert.ok(channel === null || channel === 'chromium', 'Only the bundled Chromium channel is allowed')
  const extra = JSON.parse(env.BLENDLINK_TEST_CHROMIUM_ARGS || '[]')
  assert.ok(Array.isArray(extra) && extra.every(arg => typeof arg === 'string'),
    'Chromium arguments must be an array of strings')
  return { headless: true, ...(channel ? { channel } : {}),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...extra] }
}

export function requireLumaBrowserApis(profile) {
  assert.equal(profile.webgl2?.available, true, 'The actual WebGL2 context is unavailable')
  assert.equal(profile.webgpu?.adapterAvailable, true, 'The actual WebGPU adapter is unavailable')
  assert.equal(profile.webgpu?.deviceAvailable, true, 'The actual WebGPU device is unavailable')
}

/** This is an API-availability receipt, never a native arithmetic qualification. */
export async function captureLumaBrowserProfile(destination, env = process.env) {
  const { chromium } = await import('@playwright/test')
  const launch = lumaBrowserLaunchOptions(env)
  const profile = { schemaVersion: 1, kind: 'blendlink-luma-browser-profile-v1',
    proofRole: 'browser-api-availability-only', productionAdmissionCases: 0,
    hostPlatform: process.platform, hostArchitecture: process.arch, launch, status: 'running' }
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Luma browser API profile</title>')
  })
  let browser
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    browser = await chromium.launch(launch)
    profile.browserVersion = browser.version()
    const cdp = await browser.newBrowserCDPSession()
    profile.systemInfo = await cdp.send('SystemInfo.getInfo')
    try { profile.browserCommandLine = await cdp.send('Browser.getBrowserCommandLine') }
    catch (error) { profile.browserCommandLineUnavailable = String(error) }
    const page = await browser.newPage()
    profile.pageErrors = []
    page.on('pageerror', error => profile.pageErrors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port)
    Object.assign(profile, await page.evaluate(async () => {
      const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2')
      let webgl2 = { available: false }
      if (gl) {
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        webgl2 = { available: true, vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
          renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), version: gl.getParameter(gl.VERSION) }
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
      const webgpu = { apiAvailable: !!navigator.gpu, adapterAvailable: false, deviceAvailable: false }
      try {
        // Match the real compositor harness request, including all required features.
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
        if (adapter) {
          webgpu.adapterAvailable = true
          webgpu.info = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']
            .map(name => [name, adapter.info?.[name] ?? adapter[name] ?? null]))
          webgpu.features = [...adapter.features]
          const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] })
          webgpu.deviceAvailable = true
          device.destroy()
        }
      } catch (error) { webgpu.error = String(error) }
      return { secureContext: isSecureContext, webgl2, webgpu }
    }))
    profile.systemInfoAfterApiRequests = await cdp.send('SystemInfo.getInfo')
    await cdp.detach()
    await page.close()
    requireLumaBrowserApis(profile)
    assert.deepEqual(profile.pageErrors, [])
    profile.status = 'available'
    return profile
  } catch (error) {
    profile.status = 'unavailable'; profile.error = String(error)
    throw error
  } finally {
    try { await browser?.close() }
    catch (error) { profile.browserCloseError = String(error) }
    await new Promise(resolve => server.close(resolve))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, JSON.stringify(profile, null, 2))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], 'A browser-profile receipt destination is required')
  await captureLumaBrowserProfile(resolve(process.argv[2]))
  console.log('BLENDLINK_LUMA_BROWSER_APIS_AVAILABLE productionAdmissionCases=0')
}
