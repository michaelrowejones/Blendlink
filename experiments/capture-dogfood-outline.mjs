import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [siteRoot, baseUrl, outputRoot] = process.argv.slice(2)
if (!siteRoot || !baseUrl || !outputRoot) {
  throw new Error(
    'usage: node experiments/capture-dogfood-outline.mjs <site-root> <base-url> <output-root>',
  )
}

const siteRequire = createRequire(resolve(siteRoot, 'package.json'))
const { chromium } = siteRequire('@playwright/test')
const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({
  executablePath,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
})

try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor,
    })
    const page = await context.newPage()
    for (const debugView of ['raw', 'final']) {
      await page.goto(
        `${baseUrl}/?workbenchRenderer=blendlink&workbenchReference=blender&workbenchDebug=${debugView}`,
      )
      const stage = page.getByTestId('workbench-stage')
      await stage.waitFor({ state: 'visible' })
      await page.waitForFunction(() => (
        document.querySelector('[data-testid="workbench-stage"]')?.getAttribute('data-workbench-status') === 'ready'
      ), null, { timeout: 60_000 })
      const canvas = stage.locator('canvas[data-workbench-renderer="blendlink"]')
      if (debugView === 'final') {
        await page.waitForFunction(() => (
          document.querySelector('canvas[data-workbench-renderer="blendlink"]')?.getAttribute('data-scene-intro') === '1.180'
        ), null, { timeout: 10_000 })
      }
      await canvas.screenshot({
        path: resolve(outputRoot, `dogfood-${debugView}-dpr${deviceScaleFactor}.png`),
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
}
