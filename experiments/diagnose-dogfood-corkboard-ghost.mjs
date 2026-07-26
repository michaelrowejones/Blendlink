import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [siteRoot, referencePath, browserPath] = process.argv.slice(2)
if (!siteRoot || !referencePath || !browserPath) {
  throw new Error(
    'usage: node experiments/diagnose-dogfood-corkboard-ghost.mjs <site-root> <reference.png> <browser.png>',
  )
}

const siteRequire = createRequire(resolve(siteRoot, 'package.json'))
const sharp = siteRequire('sharp')

async function pixels(path, dimensions = null) {
  let pipeline = sharp(resolve(path))
  if (dimensions) pipeline = pipeline.resize(dimensions.width, dimensions.height, { fit: 'fill' })
  const result = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (result.info.channels !== 3) throw new Error(`expected RGB pixels for ${path}`)
  return result
}

function meanLuma(image, bounds) {
  const { width, height } = image.info
  const left = Math.floor(bounds[0] * width)
  const top = Math.floor(bounds[1] * height)
  const right = Math.ceil(bounds[2] * width)
  const bottom = Math.ceil(bounds[3] * height)
  let sum = 0
  let count = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 3
      sum += 0.2126 * image.data[offset]
        + 0.7152 * image.data[offset + 1]
        + 0.0722 * image.data[offset + 2]
      count++
    }
  }
  return sum / count
}

const reference = await pixels(referencePath)
const browser = await pixels(browserPath, reference.info)

// The reported dark rectangle behind the monitor. The comparison strip directly
// above it is the same Wall object and stays clear of the authored corkboard.
const ghostBounds = [0.278, 0.466, 0.416, 0.592]
const clearWallBounds = [0.278, 0.400, 0.416, 0.452]

function measure(image) {
  const ghost = meanLuma(image, ghostBounds)
  const clearWall = meanLuma(image, clearWallBounds)
  return { ghost, clearWall, ghostToClearWall: ghost / clearWall }
}

const measurements = {
  reference: measure(reference),
  browser: measure(browser),
}
measurements.localizedRatioLoss =
  measurements.reference.ghostToClearWall - measurements.browser.ghostToClearWall

console.log(JSON.stringify(measurements, null, 2))

if (measurements.localizedRatioLoss > 0.2) {
  console.error(
    `DOGFOOD_CORKBOARD_GHOST_RED: the wall patch loses ${(measurements.localizedRatioLoss * 100).toFixed(1)} `
      + 'percentage points of local luma versus the same-camera reference',
  )
  process.exitCode = 1
} else {
  console.log('DOGFOOD_CORKBOARD_GHOST_GREEN')
}
