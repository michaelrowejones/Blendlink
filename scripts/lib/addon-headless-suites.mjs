import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const pinned53 = Object.freeze({ version: Object.freeze([5, 3, 0]), buildHash: '02f0899d78e3' })
const pinnedMetal53 = Object.freeze({ ...pinned53, platform: 'darwin', machine: 'arm64', gpuBackend: 'METAL' })

// These source-policy suites deliberately assert narrow native admissions.
// Their Python sources are proof-pinned: keep their bytes and original
// sentinels unchanged. Inapplicability is not a successful execution.
export const HEADLESS_SUITE_PROFILES = Object.freeze({
  'compositor_blackbody_policy.py': Object.freeze({
    sentinel: 'SCENETOWEB_COMPOSITOR_BLACKBODY_POLICY_PASSED', profile: pinnedMetal53,
  }),
  'repeat_static_check.py': Object.freeze({
    sentinel: 'SCENETOWEB_REPEAT_STATIC_POLICY_PASSED', profile: pinnedMetal53,
  }),
  'shader_vector2_check.py': Object.freeze({
    sentinel: 'SCENETOWEB_SHADER_VECTOR2_POLICY_PASSED', profile: pinned53,
  }),
  'vertex_color_alpha_check.py': Object.freeze({
    sentinel: 'VERTEX_ALPHA_NO_RENDER_POLICY_PASSED', profile: pinnedMetal53,
  }),
  'shadow_branch_check.py': Object.freeze({
    sentinel: 'SCENETOWEB_SHADOW_BRANCH_SOURCE_CHECK_PASSED', profile: pinnedMetal53,
  }),
})

const derivedLabel = file => file.replace(/\.py$/, '').replace(/_/g, ' ')

export function discoverHeadlessSuites(testsDir, labels = new Map(), profiles = HEADLESS_SUITE_PROFILES) {
  const files = readdirSync(testsDir).filter(name => name.endsWith('.py')).sort()
  for (const file of Object.keys(profiles)) {
    if (!files.includes(file)) throw new Error(`Registered headless source-policy suite is missing: ${file}`)
  }
  const suites = [], unregistered = []
  for (const file of files) {
    const source = readFileSync(join(testsDir, file), 'utf8')
    const registered = profiles[file]
    if (/^#\s*blendlink-headless-suite:\s*manual\s*\S.*$/m.test(source)) {
      if (registered) throw new Error(`Registered source-policy suite cannot become manual: ${file}`)
      continue
    }
    const accepted = sentinel => /^(?:BLENDLINK|SCENETOWEB)_[A-Z0-9_]+$/.test(sentinel)
      || sentinel === registered?.sentinel
    const printed = [...source.matchAll(/(?:print|oracle\.finish)\(\s*f?["']([A-Z][A-Z0-9_]+)/g)]
      .map(match => match[1]).filter(accepted)
    const declared = source.match(/^#\s*blendlink-headless-sentinel:\s*([A-Z][A-Z0-9_]+)\s*$/m)?.[1]
    if (declared && (!accepted(declared) || !printed.includes(declared))) {
      throw new Error(`${file} declares a default success sentinel that it never prints or is not registered`)
    }
    if (registered && (!printed.includes(registered.sentinel) || (declared && declared !== registered.sentinel))) {
      throw new Error(`${file} does not print its registered source-policy sentinel`)
    }
    const sentinel = registered?.sentinel ?? declared ?? printed.at(-1)
    if (!sentinel) { unregistered.push(file); continue }
    suites.push({ file, path: join(testsDir, file), sentinel, label: labels.get(file) ?? derivedLabel(file),
      ...(registered ? { profile: registered.profile } : {}) })
  }
  if (unregistered.length) throw new Error(
    `These headless test modules print no BLENDLINK_* or SCENETOWEB_* success sentinel: ${unregistered.join(', ')}. ` +
    'Print a success sentinel, register an existing proof-pinned sentinel, or declare a genuinely manual module with a reason.',
  )
  return suites.sort((a, b) => Number(a.file === 'run_headless.py') - Number(b.file === 'run_headless.py'))
}

export const HEADLESS_CONTEXT_SENTINEL = 'SCENETOWEB_HEADLESS_CONTEXT '
export const HEADLESS_CONTEXT_PROBE = "import bpy,json,platform,sys; print('SCENETOWEB_HEADLESS_CONTEXT '+json.dumps({'version':list(bpy.app.version),'buildHash':bpy.app.build_hash.decode(),'platform':sys.platform,'machine':platform.machine(),'gpuBackend':getattr(bpy.context.preferences.system,'gpu_backend',None)}))"

function validateContext(context) {
  if (!context || !Array.isArray(context.version) || context.version.length !== 3
    || !context.version.every(n => Number.isSafeInteger(n) && n >= 0)
    || !['buildHash', 'platform', 'machine'].every(key => typeof context[key] === 'string' && context[key].length > 0)
    || !(context.gpuBackend === null || typeof context.gpuBackend === 'string')) {
    throw new Error('Invalid native Blender headless context')
  }
  return context
}

export function parseHeadlessContext(output) {
  const rows = output.split(/\r?\n/).filter(line => line.startsWith(HEADLESS_CONTEXT_SENTINEL))
  if (rows.length !== 1) throw new Error('Blender must publish exactly one native headless context')
  return validateContext(JSON.parse(rows[0].slice(HEADLESS_CONTEXT_SENTINEL.length)))
}

export function planHeadlessSuites(suites, context) {
  validateContext(context)
  const applicable = [], notApplicable = []
  for (const suite of suites) {
    const reasons = Object.entries(suite.profile ?? {}).flatMap(([key, expected]) =>
      JSON.stringify(context[key]) === JSON.stringify(expected) ? []
        : [`${key}: requires ${JSON.stringify(expected)}, observed ${JSON.stringify(context[key])}`])
    if (reasons.length) notApplicable.push({ ...suite, status: 'not-applicable', coverageCredit: 0, reasons })
    else applicable.push(suite)
  }
  return { context, applicable, notApplicable }
}
