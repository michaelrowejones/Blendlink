import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(readFileSync(
  join(root, 'packages', 'blendlink', 'package.json'), 'utf8',
)).version
const cli = join(root, 'packages', 'blendlink', 'dist', 'cli.js')
const testsDir = join(root, 'packages', 'blender-addon', 'tests')
const addonTest = join(testsDir, 'run_headless.py')
const legacyCurveSidecarTest = join(
  root, 'experiments', 'legacy-curve-sidecar-differential', 'run.py',
)

// Human labels for discovered modules. A missing label degrades the console
// line to a derived one; it can never make a suite silently not run, which
// is the whole point of discovering instead of enumerating.
const SUITE_LABELS = new Map([
  ['ui_state_check.py', 'pure UI-state contract'],
  ['probe_authoring_test.py', 'pure reflection-source contract'],
  ['weblights_test.py', 'pure web-light policy contract'],
  ['probe_authoring_check.py', 'real reflection render and authoring transaction'],
  ['bake_save_check.py', 'real supersampled atlas save contract'],
  ['material_compiler_check.py', 'portable material compiler contract'],
  ['evaluated_material_bindings_check.py',
   'evaluated render-used material binding differential'],
  ['plan_material_diagnostics_check.py', 'plan-only material diagnostics contract'],
  ['channel_routing_check.py', 'per-channel coordinate-space routing contract'],
  ['material_channel_bake_check.py', 'isolated channel-bake primitives contract'],
  ['material_bake_check.py', 'per-channel Material bake contract'],
  ['material_tsl_ir_check.py', 'per-channel TSL IR evidence contract'],
  ['evaluated_geometry_check.py', 'budgeted evaluated-geometry realization contract'],
  ['external_dependency_check.py', 'external dependency reachability contract'],
  ['pip_refusal_check.py', 'Pip animated-material refusal contract'],
  ['component_batch2_check.py', 'Batch 2 component authoring contract'],
  ['scoped_uv_edit_check.py', 'scoped UV editing seam contract'],
  ['scene_state_transaction_check.py', 'scene-state transaction contract'],
  ['uvgeometry_check.py', 'pure UV/atlas geometry contract'],
  ['tsl_ir_ops_check.py', 'TSL IR op vocabulary conformance'],
  ['bake_ladder_check.py', 'bake atlas resolution ladder contract'],
  ['component_schema_check.py', 'component schema contract'],
  ['presentation_check.py', 'responsive framing and reference capture contract'],
  ['vocab_test.py', 'pure vocabulary contract'],
  ['ownership_known_issues_test.py', 'ownership known-issues contract'],
  ['sync_status_check.py', 'sync status contract'],
  ['overlay_gpu_check.py', 'overlay GPU draw contract'],
  ['run_headless.py', 'registered addon suite'],
])

function derivedLabel(file) {
  return file.replace(/\.py$/, '').replace(/_/g, ' ')
}

/** A module declares itself a suite by printing a BLENDLINK_* sentinel, or
 * opts out with `# blendlink-headless-suite: manual <reason>`. Anything
 * else is reported: silent unreachability is what let seven conforming
 * modules rot into documentation. */
function discoverSuites() {
  const suites = []
  const unregistered = []
  for (const file of readdirSync(testsDir).filter((name) => name.endsWith('.py')).sort()) {
    const source = readFileSync(join(testsDir, file), 'utf8')
    const manual = source.match(/^#\s*blendlink-headless-suite:\s*manual\s*(.*)$/m)
    if (manual) continue
    // The sentinel need not be the whole literal: several modules append
    // measured counts after it (`print("BLENDLINK_X_PASSED " f"n={n}")`).
    const sentinel = [...source.matchAll(/print\(\s*f?["'](BLENDLINK_[A-Z0-9_]+)/g)]
      .map((match) => match[1]).at(-1)
    if (!sentinel) {
      unregistered.push(file)
      continue
    }
    suites.push({
      file,
      path: join(testsDir, file),
      sentinel,
      label: SUITE_LABELS.get(file) ?? derivedLabel(file),
    })
  }
  if (unregistered.length) {
    throw new Error(
      `These headless test modules print no BLENDLINK_* success sentinel, so ` +
        `nothing can prove they ran: ${unregistered.join(', ')}. Print a ` +
        'sentinel on success, or declare the module manual with a ' +
        '`# blendlink-headless-suite: manual <reason>` comment.',
    )
  }
  // run_headless.py last: it is by far the longest, so every focused
  // contract reports before the omnibus one starts.
  return suites.sort((left, right) =>
    Number(left.file === 'run_headless.py') - Number(right.file === 'run_headless.py'))
}

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

const suites = discoverSuites()
const only = process.env.BLENDLINK_HEADLESS_ONLY
const selected = only
  ? suites.filter((suite) =>
      only.split(',').some((needle) => suite.file.includes(needle.trim())))
  : suites
if (only && !selected.length) {
  throw new Error(
    `BLENDLINK_HEADLESS_ONLY=${only} matched no discovered suite. ` +
      `Available: ${suites.map((suite) => suite.file).join(', ')}`,
  )
}
if (only) {
  console.log(
    `BLENDLINK_FULL_TEST addon: BLENDLINK_HEADLESS_ONLY is set - running ` +
      `${selected.length}/${suites.length} suites. This is a focused rerun, ` +
      'not the gate.',
  )
} else {
  console.log(`BLENDLINK_FULL_TEST addon: ${suites.length} discovered suites`)
}
runHeadlessSuite(
  'linked legacy Curve sidecar diagnostic differential', legacyCurveSidecarTest,
  'BLENDLINK_LEGACY_CURVE_SIDECAR_DIFFERENTIAL_PASSED',
)
for (const suite of selected) {
  runHeadlessSuite(suite.label, suite.path, suite.sentinel)
}
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
