import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(readFileSync(
  join(root, 'packages', 'blendlink', 'package.json'), 'utf8',
)).version
const cli = join(root, 'packages', 'blendlink', 'dist', 'cli.js')
const addonTest = join(root, 'packages', 'blender-addon', 'tests', 'run_headless.py')
const uiStateTest = join(root, 'packages', 'blender-addon', 'tests', 'ui_state_check.py')
const probePureTest = join(root, 'packages', 'blender-addon', 'tests', 'probe_authoring_test.py')
const webLightsPureTest = join(root, 'packages', 'blender-addon', 'tests', 'weblights_test.py')
const probeHeadlessTest = join(root, 'packages', 'blender-addon', 'tests', 'probe_authoring_check.py')
const bakeSaveTest = join(root, 'packages', 'blender-addon', 'tests', 'bake_save_check.py')
const materialCompilerTest = join(
  root, 'packages', 'blender-addon', 'tests', 'material_compiler_check.py',
)
const evaluatedMaterialBindingsTest = join(
  root, 'packages', 'blender-addon', 'tests', 'evaluated_material_bindings_check.py',
)
const planMaterialDiagnosticsTest = join(
  root, 'packages', 'blender-addon', 'tests', 'plan_material_diagnostics_check.py',
)
const channelRoutingTest = join(
  root, 'packages', 'blender-addon', 'tests', 'channel_routing_check.py',
)
const materialChannelBakeTest = join(
  root, 'packages', 'blender-addon', 'tests', 'material_channel_bake_check.py',
)
const externalDependencyTest = join(
  root, 'packages', 'blender-addon', 'tests', 'external_dependency_check.py',
)
const pipRefusalTest = join(
  root, 'packages', 'blender-addon', 'tests', 'pip_refusal_check.py',
)
const componentBatch2Test = join(
  root, 'packages', 'blender-addon', 'tests', 'component_batch2_check.py',
)
const legacyCurveSidecarTest = join(
  root, 'experiments', 'legacy-curve-sidecar-differential', 'run.py',
)

console.log('BLENDLINK_FULL_TEST addon: discovering the supported local Blender installation')
const discovery = spawnSync(process.execPath, [cli, 'discover'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
if (discovery.stdout) process.stdout.write(discovery.stdout)
if (discovery.stderr) process.stderr.write(discovery.stderr)
if (discovery.error || discovery.status !== 0) {
  throw new Error(
    `Could not discover Blender for the headless addon suite` +
      `${discovery.status === null ? '' : ` (exit ${discovery.status})`}: ` +
      `${discovery.error?.message ?? 'see discovery output above'}`,
  )
}
const blender = discovery.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
if (!blender) throw new Error('Blendlink discovery returned no Blender executable')

console.log(`BLENDLINK_FULL_TEST addon: ${blender}`)

function runHeadlessSuite(label, testPath, sentinel) {
  console.log(`BLENDLINK_FULL_TEST addon: ${label}`)
  const result = spawnSync(blender, [
    '--background',
    '--factory-startup',
    '--python-exit-code', '1',
    '--python', testPath,
  ], {
    cwd: join(root, 'packages', 'blender-addon'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!output.includes(sentinel)) {
    const tail = output.trim().split(/\r?\n/).slice(-30).join('\n')
    throw new Error(
      `${label} did not publish its success sentinel` +
        `${result.status === null ? '' : ` (exit ${result.status})`}` +
        `${result.error ? `: ${result.error.message}` : ''}` +
      `${tail ? `\n--- Blender output tail ---\n${tail}` : ''}`,
    )
  }
  const forbiddenDiagnostic = [
    'Code marked as unreachable has been executed.',
    'source\\blender\\makesrna\\intern\\rna_mesh.cc:1549',
  ].find((diagnostic) => output.includes(diagnostic))
  if (forbiddenDiagnostic) {
    throw new Error(
      `${label} emitted Blender's internal RNA diagnostic: ${forbiddenDiagnostic}. ` +
        'Do not accept the success sentinel until the invalid RNA access is removed.',
    )
  }
  if (result.status !== 0) {
    console.warn(
      `BLENDLINK_FULL_TEST addon: Blender exited ${String(result.status)} after ${label} passed; ` +
        'accepting the explicit success sentinel because Blender can fail during shutdown.',
    )
  }
}

runHeadlessSuite('pure UI-state contract', uiStateTest, 'BLENDLINK_UI_STATE_CHECK_PASSED')
runHeadlessSuite(
  'pure reflection-source contract', probePureTest,
  'BLENDLINK_PROBE_AUTHORING_PURE_PASSED',
)
runHeadlessSuite(
  'pure web-light policy contract', webLightsPureTest,
  'BLENDLINK_WEBLIGHTS_PURE_PASSED',
)
runHeadlessSuite(
  'real reflection render and authoring transaction', probeHeadlessTest,
  'BLENDLINK_PROBE_AUTHORING_CHECK_PASSED',
)
runHeadlessSuite(
  'real supersampled atlas save contract', bakeSaveTest,
  'BLENDLINK_BAKE_SAVE_CHECK_PASSED',
)
runHeadlessSuite(
  'portable material compiler contract', materialCompilerTest,
  'BLENDLINK_MATERIAL_COMPILER_CHECK_PASSED',
)
runHeadlessSuite(
  'evaluated render-used material binding differential', evaluatedMaterialBindingsTest,
  'BLENDLINK_EVALUATED_MATERIAL_BINDINGS_PASSED',
)
runHeadlessSuite(
  'plan-only material diagnostics contract', planMaterialDiagnosticsTest,
  'BLENDLINK_PLAN_MATERIAL_DIAGNOSTICS_CHECK_PASSED',
)
runHeadlessSuite(
  'per-channel coordinate-space routing contract', channelRoutingTest,
  'BLENDLINK_CHANNEL_ROUTING_CHECK_PASSED',
)
runHeadlessSuite(
  'isolated channel-bake primitives contract', materialChannelBakeTest,
  'BLENDLINK_MATERIAL_CHANNEL_BAKE_CHECK_PASSED',
)
runHeadlessSuite(
  'external dependency reachability contract', externalDependencyTest,
  'BLENDLINK_EXTERNAL_DEPENDENCY_CHECK_PASSED',
)
runHeadlessSuite(
  'Pip animated-material refusal contract', pipRefusalTest,
  'BLENDLINK_PIP_REFUSAL_CHECK_PASSED',
)
runHeadlessSuite(
  'Batch 2 component authoring contract', componentBatch2Test,
  'BLENDLINK_COMPONENT_BATCH2_CHECK_PASSED',
)
runHeadlessSuite(
  'linked legacy Curve sidecar diagnostic differential', legacyCurveSidecarTest,
  'BLENDLINK_LEGACY_CURVE_SIDECAR_DIFFERENTIAL_PASSED',
)
runHeadlessSuite('registered addon suite', addonTest, 'BLENDLINK_ADDON_TESTS_PASSED')
console.log('BLENDLINK_FULL_TEST addon: passed')

const installRoot = mkdtempSync(join(tmpdir(), 'blendlink-addon-install-'))
const resources = join(installRoot, 'resources')
const archive = join(installRoot, 'blendlink.zip')
const installEnvironment = { ...process.env, BLENDER_USER_RESOURCES: resources }
mkdirSync(resources, { recursive: true })

function runInstallStep(label, args) {
  const step = spawnSync(blender, args, {
    cwd: root,
    env: installEnvironment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const output = `${step.stdout ?? ''}\n${step.stderr ?? ''}`
  if (step.error || step.status !== 0) {
    throw new Error(
      `${label} failed${step.status === null ? '' : ` (exit ${step.status})`}: ` +
        `${step.error?.message ?? output.trim().split(/\r?\n/).slice(-30).join('\n')}`,
    )
  }
  return output
}

try {
  console.log('BLENDLINK_FULL_TEST addon: isolated archive install + enable verification')
  runInstallStep('isolated extension build', [
    '--command', 'extension', 'build',
    '--source-dir', join(root, 'packages', 'blendlink', 'dist', 'addon'),
    '--output-filepath', archive,
  ])
  if (!existsSync(archive)) throw new Error(`Blender did not create the extension archive: ${archive}`)
  runInstallStep('isolated extension install', [
    '--command', 'extension', 'install-file', '-r', 'user_default', '-e', archive,
  ])
  const probeScript = `
import bpy, importlib, json, tomllib
from pathlib import Path
module_name = "bl_ext.user_default.blendlink"
repo = next(item for item in bpy.context.preferences.extensions.repos if item.module == "user_default")
manifest = Path(repo.directory) / "blendlink" / "blender_manifest.toml"
version = tomllib.loads(manifest.read_text(encoding="utf8"))["version"]
module = importlib.import_module(module_name)
print("##blendlink-addon-install " + json.dumps({
    "enabled": module_name in bpy.context.preferences.addons,
    "operator": hasattr(bpy.ops.blendlink, "setup_website_export"),
    "package": bool(module.__file__),
    "version": version,
}, sort_keys=True))
`
  const probeOutput = runInstallStep('isolated extension verification', [
    '--background', '--python-exit-code', '1', '--python-expr', probeScript,
  ])
  const sentinel = probeOutput.split(/\r?\n/).find(
    (line) => line.startsWith('##blendlink-addon-install '),
  )
  if (!sentinel) throw new Error('Installed extension did not emit its verification sentinel')
  const status = JSON.parse(sentinel.slice('##blendlink-addon-install '.length))
  if (status.version !== packageVersion || !status.enabled || !status.operator || !status.package) {
    throw new Error(`Installed extension failed its postconditions: ${JSON.stringify(status)}`)
  }
  console.log('BLENDLINK_FULL_TEST addon: isolated install passed')
} finally {
  const owned = resolve(installRoot)
  if (resolve(tmpdir()) !== resolve(owned, '..') || !owned.includes('blendlink-addon-install-')) {
    throw new Error(`Refusing to remove unexpected addon-test directory: ${owned}`)
  }
  rmSync(owned, { recursive: true, force: true })
}
