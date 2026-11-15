import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { discoverHeadlessSuites, HEADLESS_CONTEXT_SENTINEL, HEADLESS_SUITE_PROFILES,
  parseHeadlessContext, planHeadlessSuites } from './addon-headless-suites.mjs'

function fixture(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'scenetoweb-headless-discovery-'))
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
    return run(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const context = { version: [5, 3, 0], buildHash: '02f0899d78e3', platform: 'darwin', machine: 'arm64', gpuBackend: 'METAL' }
const actualDir = new URL('../../packages/blender-addon/tests/', import.meta.url)
const actual = () => discoverHeadlessSuites(fileURLToPath(actualDir))

test('discovers both product prefixes, explicit defaults and oracle counts; omnibus runs last', () => {
  fixture({
    'a.py': 'print("BLENDLINK_OLD_PASSED " f"n={2}")',
    'b.py': '# blendlink-headless-sentinel: SCENETOWEB_NEW_PASSED\nprint("SCENETOWEB_NEW_PASSED")\nprint("BLENDLINK_DIAGNOSTIC")',
    'c.py': 'oracle.finish("SCENETOWEB_ORACLE_PASSED", 7)',
    'run_headless.py': 'print("BLENDLINK_ADDON_PASSED")',
    'z.py': 'print(f"SCENETOWEB_Z_PASSED {3}")',
    'manual.py': '# blendlink-headless-suite: manual requires a visible window',
  }, dir => {
    const suites = discoverHeadlessSuites(dir, new Map(), {})
    assert.deepEqual(suites.map(s => s.sentinel), ['BLENDLINK_OLD_PASSED', 'SCENETOWEB_NEW_PASSED',
      'SCENETOWEB_ORACLE_PASSED', 'SCENETOWEB_Z_PASSED', 'BLENDLINK_ADDON_PASSED'])
  })
})

test('an unprinted declaration, absent suite, empty manual reason and unregistered sentinel fail', () => {
  for (const source of ['# blendlink-headless-sentinel: SCENETOWEB_NEVER_PASSED\nprint("BLENDLINK_OTHER_PASSED")',
    '# blendlink-headless-suite: manual\n', 'print("VERTEX_ALPHA_NO_RENDER_POLICY_PASSED")']) {
    fixture({ 'broken.py': source }, dir => assert.throws(() => discoverHeadlessSuites(dir, new Map(), {})))
  }
  fixture({}, dir => assert.throws(() => discoverHeadlessSuites(dir), /Registered.*missing/))
})

test('proof-pinned historical sentinel is explicit and cannot be hidden or replaced', () => {
  const name = 'vertex_color_alpha_check.py'
  const profiles = { [name]: HEADLESS_SUITE_PROFILES[name] }
  fixture({ [name]: 'print("VERTEX_ALPHA_NO_RENDER_POLICY_PASSED")' }, dir =>
    assert.equal(discoverHeadlessSuites(dir, new Map(), profiles)[0].sentinel, 'VERTEX_ALPHA_NO_RENDER_POLICY_PASSED'))
  for (const source of ['# blendlink-headless-suite: manual old version\nprint("VERTEX_ALPHA_NO_RENDER_POLICY_PASSED")',
    'print("SCENETOWEB_REPLACEMENT_PASSED")']) {
    fixture({ [name]: source }, dir => assert.throws(() => discoverHeadlessSuites(dir, new Map(), profiles)))
  }
})

test('actual repository discovery retains all four narrow policy suites with their exact printed sentinels', () => {
  const suites = actual()
  for (const [file, rule] of Object.entries(HEADLESS_SUITE_PROFILES)) {
    const discovered = suites.filter(suite => suite.file === file)
    assert.equal(discovered.length, 1)
    assert.equal(discovered[0].sentinel, rule.sentinel)
    assert.ok(readFileSync(new URL(file, actualDir), 'utf8').includes(rule.sentinel))
  }
  assert.equal(suites.at(-1).file, 'run_headless.py')
})

test('actual applicable5.3 profile includes four policies; legacy versions explicitly get zero credit', () => {
  const suites = actual()
  const selected = suites.filter(suite => suite.profile)
  assert.equal(selected.length, 4)
  const matched = planHeadlessSuites(suites, context)
  assert.equal(matched.notApplicable.length, 0)
  assert.equal(matched.applicable.length, suites.length)
  for (const version of [[4, 2, 0], [5, 2, 0], [5, 3, 1]]) {
    const plan = planHeadlessSuites(suites, { ...context, version })
    assert.equal(plan.applicable.length, suites.length - 4)
    assert.equal(plan.notApplicable.length, 4)
    for (const suite of plan.notApplicable) {
      assert.equal(suite.status, 'not-applicable')
      assert.equal(suite.coverageCredit, 0)
      assert.ok(suite.reasons.some(reason => reason.startsWith('version:')))
    }
  }
})

test('native build, host, architecture and backend restrictions follow actual source admission', () => {
  const suites = actual().filter(suite => suite.profile)
  assert.equal(planHeadlessSuites(suites, { ...context, buildHash: 'unqualified' }).notApplicable.length, 4)
  for (const mismatch of [{ platform: 'linux' }, { machine: 'x86_64' }, { gpuBackend: 'OPENGL' }, { gpuBackend: null }]) {
    const plan = planHeadlessSuites(suites, { ...context, ...mismatch })
    // float2 pins version/build, but its source does not claim a Metal host restriction.
    assert.deepEqual(plan.applicable.map(suite => suite.file), ['shader_vector2_check.py'])
    assert.equal(plan.notApplicable.length, 3)
  }
})

test('context parser refuses missing/duplicate/malformed native identity instead of assuming applicability', () => {
  const row = HEADLESS_CONTEXT_SENTINEL + JSON.stringify(context)
  assert.deepEqual(parseHeadlessContext('Blender startup\n' + row + '\r\nBlender quit'), context)
  for (const output of ['', row + '\n' + row, HEADLESS_CONTEXT_SENTINEL + '{bad json}',
    HEADLESS_CONTEXT_SENTINEL + JSON.stringify({ ...context, version: [5, 3] }),
    HEADLESS_CONTEXT_SENTINEL + JSON.stringify({ ...context, gpuBackend: undefined })]) {
    assert.throws(() => parseHeadlessContext(output))
  }
  assert.throws(() => planHeadlessSuites([], {}), /Invalid native/)
})
