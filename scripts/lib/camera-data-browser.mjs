// Camera presentation only. Never mutate the parent environment or other suites.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CAMERA_LINUX_BROWSER_PROFILE = 'software-camera-headed-x11-graphite'
export const CAMERA_LINUX_BROWSER_ARGS = Object.freeze([
  '--ozone-platform=x11', '--enable-gpu', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-skia-graphite', '--skia-graphite-dawn-backend=swiftshader',
  '--use-webgpu-adapter=swiftshader',
])
export function cameraDataBrowserEnvironment(platform = process.platform) {
  return platform === 'linux' ? {
    BLENDLINK_TEST_PROFILE: CAMERA_LINUX_BROWSER_PROFILE,
    BLENDLINK_TEST_CHROMIUM_HEADLESS: '0',
    BLENDLINK_TEST_CHROMIUM_CHANNEL: 'chromium',
    BLENDLINK_TEST_CHROMIUM_ARGS: JSON.stringify(CAMERA_LINUX_BROWSER_ARGS),
  } : {}
}

export function validateCameraLinuxBrowserIdentity(report) {
  assert.equal(report.requestedHeadless, false, 'Camera requires an actual X11 browser window')
  assert.equal(report.browserVersion, '158.0.8127.18', 'Requalify the Camera presentation profile for a new browser')
  assert.match(report.systemInfo?.gpu?.featureStatus?.skia_graphite ?? '', /^enabled/)
  assert.equal(report.systemInfo?.gpu?.auxAttributes?.skiaBackendType, 'GraphiteDawnVulkan')
  const commandLine = report.systemInfo?.commandLine
  assert.equal(typeof commandLine, 'string', 'Actual CDP browser command line is required')
  assert.match(commandLine, /(?:^|\s)--ozone-platform=x11(?:\s|$)/)
  assert.doesNotMatch(commandLine, /(?:^|\s)--headless(?:=|\s|$)/)
  assert.doesNotMatch(commandLine, /--ozone-platform=headless|--gpu-launcher=|--disable-gpu-sandbox/)
  for (const flag of CAMERA_LINUX_BROWSER_ARGS) assert.ok(commandLine.split(/\s+/).includes(flag), flag)
  assert.match(report.systemInfo.gpu.auxAttributes.glRenderer ?? '', /SwiftShader/i)
}

export function validateCameraLinuxCanvas(report) {
  validateCameraLinuxBrowserIdentity(report)
  assert.equal(report.kind, 'public-WebGPU-canvas-control-no-Three-no-Camera-Data')
  assert.equal(report.complete, true); assert.deepEqual(report.errors, [])
  assert.equal(report.result?.complete, true); assert.deepEqual(report.result.rgba, [255, 0, 0, 255])
  assert.equal(report.result.adapter?.architecture, 'swiftshader')
  assert.deepEqual(report.result.uncapturedErrors, [])
  assert.deepEqual(report.result.deviceLosses.filter(event => event.phase?.name !== 'dispose'), [])
}

export function validateCameraLinuxBrowserReport(report, kind = 'browser') {
  assert.ok(['browser', 'ownership'].includes(kind))
  validateCameraLinuxBrowserIdentity(report)
  assert.equal(report.built, true); assert.equal(report.complete, true)
  assert.equal(report.completedAllBackends, true); assert.equal(report.diagnosticDeviceLoss, false)
  assert.deepEqual(report.failures, [])
  assert.equal(report.provenance?.mode, 'built')
  assert.ok(report.provenance.modules.length > 0)
  assert.ok(report.provenance.modules.every(module => module.emitterMatchesSource))
  assert.deepEqual(report.rows.map(row => row.backend), ['webgpu', 'webgl2'])
  assert.deepEqual(report.backendRuns.map(run => run.backend), ['webgpu', 'webgl2'])
  for (const run of report.backendRuns) {
    assert.equal(run.status, 'completed'); assert.deepEqual(run.errors, [])
  }
  for (const row of report.rows) {
    assert.equal(row.cases, kind === 'ownership' ? 8 : 240)
    assert.deepEqual(row.failures, [])
    assert.match(JSON.stringify(row.gpu), /swiftshader/i)
    assert.deepEqual(row.uncapturedErrors ?? [], []); assert.deepEqual(row.contextEvents ?? [], [])
    assert.deepEqual((row.deviceLosses ?? []).filter(event => event.phase?.name !== 'renderer-dispose'), [])
  }
}

export function readCameraLinuxBrowserProof(directory, { profiles = ['ordinary'], canvasOnly = false,
  profile = CAMERA_LINUX_BROWSER_PROFILE } = {}) {
  assert.ok(profiles.length > 0 && new Set(profiles).size === profiles.length)
  assert.ok(profiles.every(value => ['ordinary', 'translated', 'wide', 'close', 'angular-edge'].includes(value)))
  const json = path => JSON.parse(readFileSync(path, 'utf8'))
  const canvas = json(join(directory, 'ordinary', `canvas-control-${profile}.json`))
  validateCameraLinuxCanvas(canvas)
  const result = { status: 'verified-camera-linux-presentation', profile,
    browserVersion: canvas.browserVersion, requestedHeadless: false, ozone: 'x11',
    skiaBackend: 'GraphiteDawnVulkan', canvasRgba: canvas.result.rgba, profiles: [], ownershipCasesPerApi: 0 }
  if (!canvasOnly) {
    for (const name of profiles) {
      const report = json(join(directory, name, `browser-report-${profile}.json`))
      validateCameraLinuxBrowserReport(report)
      result.profiles.push({ name, casesPerApi: 240, maximum: report.rows.map(row => ({ backend: row.backend, maximum: row.maximum })) })
    }
    validateCameraLinuxBrowserReport(json(join(directory, 'ordinary', `ownership-report-${profile}.json`)), 'ownership')
    result.ownershipCasesPerApi = 8
  }
  return result
}
