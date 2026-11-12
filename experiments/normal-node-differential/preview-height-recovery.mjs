// Real Preview Studio UI; no acknowledgement/scene/error injection.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
const url = process.argv[2]
if (!url) throw new Error('Pass a running Preview Studio URL for the --height native fixture')
const output = resolve(process.argv[3] ?? 'artifacts/verification-height-preview/recovery.json')
const channel = process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL || null
assert.ok(channel === null || channel === 'chromium')
const browser = await chromium.launch({
  ...(channel ? { channel } : {}),
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
const status = await (await fetch(new URL('/.blendlink-preview-status.json', url))).json()
const source = resolve(status.blendPath),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  sourceSha256 = hash(await readFile(source))
const rows = []
try {
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
      errors = [],
      programs = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (/\.materials\.json(?:\?|$)/.test(response.url())) programs.push(response.json())
    })
    await page.addInitScript(() => {
      window.heightDevices = []
      if (!globalThis.GPUAdapter) return
      const request = GPUAdapter.prototype.requestDevice
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await request.apply(this, args)
        const row = {
          vendor: this.info?.vendor,
          architecture: this.info?.architecture,
          description: this.info?.description,
          isFallbackAdapter: this.info?.isFallbackAdapter ?? this.isFallbackAdapter,
          destroyed: false,
        }
        window.heightDevices.push(row)
        const destroy = device.destroy.bind(device)
        device.destroy = () => {
          row.destroyed = true
          return destroy()
        }
        return device
      }
    })
    const target = new URL(url)
    if (backend === 'webgl2') target.searchParams.set('backend', 'webgl2')
    await page.goto(target.href)
    await page.waitForTimeout(1200)
    if (await page.locator('#retry-preview').isVisible())
      await page.locator('#retry-preview').click()
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector('#status-chip')?.dataset.phase === 'ready',
        null,
        { timeout: 60000 },
      )
    await ready()
    assert.ok(
      (await Promise.all(programs)).some((value) =>
        JSON.stringify(value).includes('"op":"bump_height_native"'),
      ),
      'Actual Preview did not fetch the fresh Height programs',
    )
    const canvas = await page.locator('canvas.active').elementHandle()
    const gpu =
      backend === 'webgpu'
        ? await page.evaluate(() => window.heightDevices.map(({ destroyed, ...gpu }) => gpu))
        : await canvas.evaluate((element) => {
            const gl = element.getContext('webgl2'),
              debug = gl.getExtension('WEBGL_debug_renderer_info')
            return {
              vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
              renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
            }
          })
    await page.setViewportSize({ width: 4000, height: 1400 })
    await page.waitForTimeout(300)
    assert.equal(
      await page.locator('#status-chip').getAttribute('data-phase'),
      'ready',
      'Qualified resize must remain usable',
    )
    await page.locator('#pause').click()
    await page.locator('#inspect').click()
    const bounds = await page.locator('canvas.active').boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    for (let index = 0; index < 8; index++) {
      await page.mouse.wheel(0, -1800)
      await page.waitForTimeout(150)
      if ((await page.locator('#status-chip').getAttribute('data-phase')) === 'failed') break
    }
    await page.waitForFunction(
      () => document.querySelector('#status-chip')?.dataset.phase === 'failed',
    )
    await page.locator('#details').click()
    assert.equal(await page.locator('#error-detail').isVisible(), true)
    const detail = await page.locator('#error-detail').textContent()
    await page.locator('#close-details').click()
    assert.match(detail, /Bump Height view precision is unproven/)
    assert.match(detail, /reduce Height amplitude or Distance/)
    assert.equal(
      await canvas.evaluate((element) => element === document.querySelector('canvas.active')),
      true,
    )
    await page.locator('#retry-preview').click()
    await ready()
    await page.waitForTimeout(1200)
    assert.equal(await page.locator('#status-chip').getAttribute('data-phase'), 'ready')
    assert.equal(await page.locator('#inspect').getAttribute('aria-pressed'), 'false')
    assert.equal(await page.locator('canvas.active').count(), 1)
    assert.equal(await canvas.evaluate((element) => element.isConnected), false)
    const disposed = await page.evaluate(() => window.heightDevices)
    if (backend === 'webgpu')
      assert.ok(
        disposed.slice(0, -1).every((device) => device.destroyed),
        'Previous owned GPU device was not released',
      )
    assert.deepEqual(errors, [])
    rows.push({
      backend,
      gpu,
      detail,
      retainedUntilRecovery: true,
      recoveredToAuthoredCamera: true,
      resizedViewport: { width: 4000, height: 1400 },
      activeCanvases: 1,
      priorCanvasDetached: true,
      priorOwnedDevicesReleased: backend === 'webgpu',
      errors,
    })
    await page.close()
  }
  assert.equal(
    hash(await readFile(source)),
    sourceSha256,
    'Preview changed the authored .blend bytes',
  )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    output,
    JSON.stringify(
      {
        browserVersion: browser.version(),
        browserChannel: channel,
        source,
        sourceSha256,
        sourceUnchanged: true,
        rows,
      },
      null,
      2,
    ),
  )
  console.log('BLENDLINK_HEIGHT_PREVIEW_RECOVERY_PASSED ' + JSON.stringify(rows))
} finally {
  await browser.close()
}
