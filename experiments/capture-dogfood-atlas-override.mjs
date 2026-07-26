import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [siteRoot, baseUrl, atlasPath, outputPath] = process.argv.slice(2)
if (!siteRoot || !baseUrl || !atlasPath || !outputPath) {
  throw new Error(
    'usage: node experiments/capture-dogfood-atlas-override.mjs <site-root> <base-url> <atlas.png> <output.png>',
  )
}

const siteRequire = createRequire(resolve(siteRoot, 'package.json'))
const { chromium } = siteRequire('@playwright/test')
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const atlas = await readFile(resolve(atlasPath))
  await page.route(/workbench-dogfood\.default-[^/.]+\.(?:png|webp)(?:[?#]|$)/i, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: atlas })
  })
  await page.goto(`${baseUrl}/?workbenchRenderer=blendlink&workbenchReference=blender`)
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="workbench-stage"]')?.getAttribute('data-workbench-status') === 'ready'
  ), null, { timeout: 60_000 })
  await page.waitForFunction(() => (
    document.querySelector('canvas[data-workbench-renderer="blendlink"]')?.getAttribute('data-scene-intro') === '1.180'
  ), null, { timeout: 10_000 })
  await page.locator('canvas[data-workbench-renderer="blendlink"]').screenshot({ path: resolve(outputPath) })
} finally {
  await browser.close()
}
