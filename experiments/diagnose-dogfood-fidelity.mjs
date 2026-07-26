import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [siteRoot, referencePath, browserPath] = process.argv.slice(2)
if (!siteRoot || !referencePath || !browserPath) {
  throw new Error(
    'usage: node experiments/diagnose-dogfood-fidelity.mjs <site-root> <reference.png> <browser.png>',
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

function region(image, bounds) {
  const { width, height } = image.info
  const left = Math.floor(bounds[0] * width)
  const top = Math.floor(bounds[1] * height)
  const right = Math.ceil(bounds[2] * width)
  const bottom = Math.ceil(bounds[3] * height)
  let edge = 0
  let edgeCount = 0
  let nearWhite = 0
  let count = 0
  let lumaSum = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 3
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      lumaSum += luma
      if (red >= 245 && green >= 245 && blue >= 235) nearWhite++
      if (x > left) {
        const previous = offset - 3
        const previousLuma = 0.2126 * image.data[previous]
          + 0.7152 * image.data[previous + 1]
          + 0.0722 * image.data[previous + 2]
        edge += Math.abs(luma - previousLuma)
        edgeCount++
      }
      if (y > top) {
        const previous = offset - width * 3
        const previousLuma = 0.2126 * image.data[previous]
          + 0.7152 * image.data[previous + 1]
          + 0.0722 * image.data[previous + 2]
        edge += Math.abs(luma - previousLuma)
        edgeCount++
      }
      count++
    }
  }
  return {
    edgeEnergy: edge / edgeCount,
    nearWhitePercent: nearWhite / count * 100,
    meanLuma: lumaSum / count,
  }
}

const reference = await pixels(referencePath)
const browser = await pixels(browserPath, reference.info)
if (reference.info.width !== browser.info.width || reference.info.height !== browser.info.height) {
  throw new Error('reference and browser captures must have identical dimensions')
}

// Empty upper-right wall: enough distance from the corkboard, monitor, and window edge
// to measure whether the baked procedural surface survives atlas sampling.
const detailBounds = [0.51, 0.055, 0.78, 0.32]
// Right window reveal/wall: this is midtone in the authored render but clips almost
// uniformly white in the current browser artifact.
const rightWallBounds = [0.835, 0.02, 0.875, 0.83]
const referenceDetail = region(reference, detailBounds)
const browserDetail = region(browser, detailBounds)
const referenceRightWall = region(reference, rightWallBounds)
const browserRightWall = region(browser, rightWallBounds)
const measurements = {
  detail: {
    reference: referenceDetail,
    browser: browserDetail,
    retainedEdgeRatio: browserDetail.edgeEnergy / referenceDetail.edgeEnergy,
  },
  rightWall: {
    reference: referenceRightWall,
    browser: browserRightWall,
    lumaExcess: browserRightWall.meanLuma - referenceRightWall.meanLuma,
    nearWhiteExcess: browserRightWall.nearWhitePercent - referenceRightWall.nearWhitePercent,
  },
}
console.log(JSON.stringify(measurements, null, 2))

const failures = []
if (measurements.detail.retainedEdgeRatio < 0.65) {
  failures.push(`wall retains only ${(measurements.detail.retainedEdgeRatio * 100).toFixed(1)}% of reference detail`)
}
if (measurements.rightWall.nearWhiteExcess > 20) {
  failures.push(
    `right wall clips: +${measurements.rightWall.nearWhiteExcess.toFixed(1)}% near-white`,
  )
}
if (measurements.rightWall.lumaExcess > 45) {
  console.warn(
    `DOGFOOD_LIGHTING_DIFFERENTIAL: browser is +${measurements.rightWall.lumaExcess.toFixed(1)} ` +
    'luma in the right-wall ROI; the comparison is Cycles bake versus Eevee reference, so this ' +
    'is recorded but is not a clipping failure.',
  )
}
if (failures.length > 0) {
  console.error(`DOGFOOD_FIDELITY_RED: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log('DOGFOOD_FIDELITY_GREEN')
}
