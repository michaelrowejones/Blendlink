import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { readCameraLinuxBrowserProof } from './lib/camera-data-browser.mjs'
const [directory, ...args] = process.argv.slice(2)
if (!directory || args.some(value => value !== '--canvas-only' && value !== '--all-profiles'))
  throw new Error('usage: check-camera-data-browser.mjs <Camera suite directory> [--canvas-only|--all-profiles]')
const canvasOnly = args.includes('--canvas-only')
if (canvasOnly && args.includes('--all-profiles')) throw new Error('Choose canvas-only or the complete suite')
const result = readCameraLinuxBrowserProof(resolve(directory), {
  canvasOnly,
  ...(args.includes('--all-profiles') ? { profiles: ['ordinary', 'translated', 'wide', 'close', 'angular-edge'] } : {}),
})
writeFileSync(resolve(directory, canvasOnly ? 'browser-environment-canvas.json' : 'browser-environment.json'), JSON.stringify(result, null, 2) + '\n')
console.log('BLENDLINK_CAMERA_LINUX_PRESENTATION_PASSED ' + JSON.stringify(result))
