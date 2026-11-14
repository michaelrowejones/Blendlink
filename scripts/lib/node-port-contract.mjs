import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const NODE_PORT_SCHEMA_VERSION = 1
export const nodePortHash = value => createHash('sha256').update(value).digest('hex')
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const slug = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value)
const strings = value => Array.isArray(value) && Array.from(value).every(item => typeof item === 'string')
const plain = value => JSON.parse(JSON.stringify(value))
const checkKeys = (value, keys, label) => { assert.ok(record(value), label + ' must be an object'); for (const key of Object.keys(value)) assert.ok(keys.includes(key), label + ' has unknown field ' + key) }
function assertEvidenceAdapterScope(manifest) {
  const closedFamilies = { 'compositor-wave-axis-v1': ['compositor-wave-axis', 'ShaderNodeTexWave'], 'compositor-white-noise-fixed-v1': ['compositor-white-noise', 'ShaderNodeTexWhiteNoise'], 'compositor-white-noise-default-field-v1': ['compositor-white-noise-default-field', 'ShaderNodeTexWhiteNoise'], 'mono-switch-view-v1': ['mono-switch-view', 'CompositorNodeSwitchView'] }
  const closedFamily = Object.hasOwn(closedFamilies, manifest.evidence?.adapter) ? closedFamilies[manifest.evidence.adapter] : null
  if (closedFamily) {
    assert.equal(manifest.id, closedFamily[0]); assert.equal(manifest.nativeNode, closedFamily[1], 'Closed family evidence cannot qualify another native node')
    assert.equal(manifest.domain, 'compositor', 'Closed family evidence cannot qualify another tree context')
  }
  if (manifest.evidence?.adapter === 'float-to-int-literal-v1') {
    assert.equal(manifest.nativeNode, 'FunctionNodeFloatToInt', 'Float to Integer evidence cannot qualify another native node')
    assert.equal(manifest.domain, 'compositor', 'Float to Integer evidence cannot qualify another tree context')
  }
  if (manifest.evidence?.adapter === 'squeeze-v1') {
    assert.equal(manifest.nativeNode, 'ShaderNodeSqueeze', 'Squeeze evidence cannot qualify another native node')
    assert.equal(manifest.domain, 'shader', 'Squeeze evidence cannot qualify another tree context')
  }
}
export function validateRepositoryPattern(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.includes('\\') && /^[\w./*-]+$/.test(value), 'Use a repository-relative exact path or controlled * / ** glob')
  assert.ok(!value.split('/').some(part => !part || part === '.' || part === '..'), 'Repository patterns cannot escape or name an empty component')
  assert.ok(value.split('/').every(part => !part.includes('**') || part === '**'), '** must occupy a complete path component')
  return value
}
function command(value, label) {
  checkKeys(value, ['id', 'argv', 'env', 'timeoutMs'], label)
  assert.ok(slug(value.id), label + ' needs an id')
  assert.ok(strings(value.argv) && value.argv.length > 0 && value.argv.every(arg => arg.length > 0 && !arg.includes('\0')), label + ' needs nonempty argv, never shell text')
  assert.ok(Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= 1_800_000, label + ' timeout must be bounded')
  environment(value.env ?? {}, label)
}
function environment(value, label) {
  assert.ok(record(value), label + ' env must be an object')
  for (const [name, item] of Object.entries(value)) assert.ok(/^[A-Z_][A-Z0-9_]*$/.test(name) && (item === null || typeof item === 'string' && !item.includes('\0')), label + ' has invalid env')
}
export function validateNodePortManifest(value) {
  checkKeys(value, ['schemaVersion', 'id', 'nativeNode', 'domain', 'lifecycle', 'scope', 'upstream', 'inputs', 'commands', 'profiles', 'evidence'], 'manifest')
  assert.equal(value.schemaVersion, 1); assert.ok(slug(value.id)); assert.match(value.nativeNode, /^[A-Za-z_][A-Za-z0-9_]+$/)
  assert.ok(['shader', 'compositor'].includes(value.domain)); assert.ok(['production', 'research'].includes(value.lifecycle))
  assert.ok(typeof value.scope === 'string' && value.scope.length > 0)
  checkKeys(value.upstream, ['direct', 'shared'], 'upstream')
  for (const name of ['direct', 'shared']) { assert.ok(strings(value.upstream[name])); value.upstream[name].forEach(validateRepositoryPattern) }
  if (value.lifecycle === 'production') assert.ok(value.upstream.direct.length > 0, 'Production ports need direct upstream dependencies')
  checkKeys(value.inputs, ['native', 'runtime', 'sdk', 'tests'], 'inputs')
  for (const name of ['native', 'runtime', 'sdk', 'tests']) { assert.ok(strings(value.inputs[name])); value.inputs[name].forEach(validateRepositoryPattern); if (value.lifecycle === 'production') assert.ok(value.inputs[name].length > 0) }
  checkKeys(value.commands, ['build', 'verify'], 'commands'); assert.ok(Array.isArray(value.commands.build))
  value.commands.build.forEach((step, index) => command(step, 'build[' + index + ']'))
  assert.equal(new Set(value.commands.build.map(step => step.id)).size, value.commands.build.length)
  if (value.commands.verify !== null) command(value.commands.verify, 'verify')
  assert.ok(Array.isArray(value.profiles)); assert.equal(new Set(value.profiles.map(profile => profile.id)).size, value.profiles.length)
  for (const profile of value.profiles) {
    checkKeys(profile, ['id', 'hostPlatforms', 'blenderVersion', 'blenderBuildHash', 'nativeSource', 'runs', 'expectedStatus'], 'profile')
    assert.ok(slug(profile.id)); assert.ok(strings(profile.hostPlatforms) && profile.hostPlatforms.length > 0 && profile.hostPlatforms.every(name => ['darwin', 'linux', 'win32'].includes(name)))
    assert.match(profile.blenderVersion, /^\d+\.\d+\.\d+$/)
    if (profile.blenderBuildHash !== undefined) assert.match(profile.blenderBuildHash, /^[a-f0-9]{7,40}$/)
    assert.ok(profile.expectedStatus === undefined || profile.expectedStatus === 'not-applicable')
    checkKeys(profile.nativeSource, ['profile', 'backend', 'renderer', 'evaluator'], 'nativeSource')
    assert.ok(profile.nativeSource.profile === null || typeof profile.nativeSource.profile === 'string' && profile.nativeSource.profile.length > 0)
    assert.ok(profile.nativeSource.backend === null || ['METAL', 'OPENGL'].includes(profile.nativeSource.backend))
    if (profile.nativeSource.renderer !== undefined) assert.ok(typeof profile.nativeSource.renderer === 'string' && profile.nativeSource.renderer.length > 0)
    if (profile.nativeSource.evaluator !== undefined) assert.ok(['CPU-MF','CPU-compositor'].includes(profile.nativeSource.evaluator), 'Unknown source evaluator')
    if (profile.expectedStatus !== 'not-applicable') assert.ok(profile.nativeSource.profile && (profile.nativeSource.backend || ['CPU-MF','CPU-compositor'].includes(profile.nativeSource.evaluator)), 'Numeric profiles need a declared native source model/backend or explicit CPU evaluator')
    if (['CPU-MF','CPU-compositor'].includes(profile.nativeSource.evaluator)) assert.equal(profile.nativeSource.backend, null, profile.nativeSource.evaluator + ' numerical evidence must not assert a GPU backend')
    assert.ok(Array.isArray(profile.runs) && profile.runs.length > 0); assert.equal(new Set(profile.runs.map(run => run.id)).size, profile.runs.length)
    for (const [index, run] of profile.runs.entries()) {
      checkKeys(run, ['id', 'adapter', 'env', 'args'], 'browser run'); assert.ok(slug(run.id)); assert.ok(['metal', 'software','matrix'].includes(run.adapter)); environment(run.env, 'browser run')
      if(run.adapter==='matrix') assert.ok(['compositor-wave-axis-v1','compositor-white-noise-fixed-v1','compositor-white-noise-default-field-v1','mono-switch-view-v1'].includes(value.evidence?.adapter),'Matrix scheduling requires a trusted closed family adapter')
      assert.ok(run.args === undefined || strings(run.args)); if (index === 0) assert.ok(!run.args?.includes('--reuse-native'), 'First verification must generate fresh native evidence')
    }
  }
  checkKeys(value.evidence, ['adapter', 'productionCases', 'calibrationCases', 'refusedNativeCases'], 'evidence')
  assert.ok(typeof value.evidence.adapter === 'string' && value.evidence.adapter.length > 0)
  for (const name of ['productionCases', 'calibrationCases', 'refusedNativeCases']) assert.ok(Number.isInteger(value.evidence[name]) && value.evidence[name] >= 0)
  assertEvidenceAdapterScope(value)
  if (value.lifecycle === 'production') { assert.ok(value.commands.verify && value.profiles.length > 0 && value.evidence.productionCases > 0) }
  return plain(value)
}
export async function readNodePortManifest(path) { return validateNodePortManifest(JSON.parse(await readFile(path, 'utf8'))) }
export async function loadNodePortManifests(root) {
  const directory = join(root, 'node-ports'), files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort()
  const manifests = await Promise.all(files.map(file => readNodePortManifest(join(directory, file))))
  assert.equal(new Set(manifests.map(port => port.id)).size, manifests.length, 'Duplicate port id')
  return manifests
}
function globExpression(pattern) {
  let output = '^'
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') { i++; if (pattern[i + 1] === '/') { output += '(?:.*/)?'; i++ } else output += '.*' }
    else if (pattern[i] === '*') output += '[^/]*'
    else output += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(output + '$')
}
export async function fingerprintNodePortInputs(root, manifest) {
  root = await realpath(root)
  const groups = {}, contentByPath = new Map()
  for (const [group, patterns] of Object.entries(manifest.inputs)) {
    const names = new Set()
    for (const pattern of patterns) {
      validateRepositoryPattern(pattern)
      const first = pattern.indexOf('*'), start = first < 0 ? pattern : pattern.slice(0, first).replace(/[^/]*$/, '').replace(/\/$/, '')
      const matcher = globExpression(pattern), matched = []
      const visit = async path => {
        const info = await lstat(path)
        assert.ok(!info.isSymbolicLink(), 'Port input symlinks need an explicit supported contract: ' + path)
        if (info.isDirectory()) { for (const child of (await readdir(path)).sort()) if (!['.git', 'node_modules', '__pycache__'].includes(child)) await visit(join(path, child)) }
        else if (info.isFile()) { const name = relative(root, path).split(sep).join('/'); if (matcher.test(name)) matched.push(name) }
      }
      await visit(join(root, start))
      assert.ok(matched.length > 0, 'Port input matches no files: ' + pattern)
      matched.forEach(name => names.add(name))
    }
    groups[group] = []
    for (const path of [...names].sort()) {
      let digest = contentByPath.get(path)
      if (!digest) { digest = nodePortHash(await readFile(join(root, path))); contentByPath.set(path, digest) }
      groups[group].push({ path, sha256: digest })
    }
  }
  const nativeInputDigest = nodePortHash(JSON.stringify(groups.native)), runtimeInputDigest = nodePortHash(JSON.stringify({ runtime: groups.runtime, sdk: groups.sdk, tests: groups.tests }))
  return { groups, nativeInputDigest, runtimeInputDigest, inputDigest: nodePortHash(JSON.stringify({ manifest, groups })) }
}
export function expandNodePortCommand(command, values, run = null) {
  const expand = value => value.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => { assert.ok(typeof values[name] === 'string', 'Unknown command placeholder ' + name); return values[name] })
  const env = {}
  for (const [key, value] of Object.entries({ ...command.env, ...run?.env })) env[key] = value === null ? null : expand(value)
  return { id: run ? command.id + '-' + run.id : command.id, argv: [...command.argv, ...(run?.args ?? [])].map(expand), env, timeoutMs: command.timeoutMs }
}
export async function nodePortFileIdentity(path, { hash = true } = {}) {
  const resolved = await realpath(path), info = await stat(resolved)
  let sha256 = null
  if (hash) { const digest = createHash('sha256'); for await (const chunk of createReadStream(resolved)) digest.update(chunk); sha256 = digest.digest('hex') }
  return { path: resolved, bytes: info.size, sha256 }
}

/** A bounded owned process group, with streamed logs retained on every exit. */
export async function executeNodePortCommand({ argv, env = {}, timeoutMs, cwd, logPath }) {
  await mkdir(dirname(logPath), { recursive: true })
  const log = createWriteStream(logPath), started = Date.now(), childEnv = { ...process.env }
  for (const [name, value] of Object.entries(env)) if (value === null) delete childEnv[name]; else childEnv[name] = value
  return await new Promise(resolveResult => {
    let expired = false, failure, child, killTimer, closed
    const finish = (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); log.end(() => resolveResult({ argv, exitCode: code, signal, timedOut: expired, error: failure, elapsedMs: Date.now() - started, logPath })) }
    const terminate = signal => {
      if (!child?.pid) return
      try {
        if (process.platform === 'win32') execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { timeout: 5000, stdio: 'ignore' })
        else process.kill(-child.pid, signal)
      } catch { try { child.kill(signal) } catch {} }
    }
    const timer = setTimeout(() => {
      expired = true
      // A parent may exit on TERM while an owned grandchild ignores it. Keep
      // the group cleanup alive even after the parent's close event.
      killTimer = setTimeout(() => { terminate('SIGKILL'); killTimer = null; if (closed) finish(...closed) }, 1000)
      terminate('SIGTERM')
    }, timeoutMs)
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env: childEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
      child.once('error', error => { failure = error.message })
      child.once('close', (...result) => { closed = result; if (!expired || !killTimer) finish(...result) })
    } catch (error) { failure = error.message; finish(null, null) }
  })
}

function containedPath(root, path) {
  const file = resolve(root, path), inside = relative(resolve(root), file)
  assert.ok(inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside), 'Evidence path escapes its owned directory')
  return file
}
export async function readSqueezeNodePortEvidence({ root, evidence, manifest, profile, completedRuns }) {
  assertEvidenceAdapterScope(manifest)
  const json = async path => JSON.parse(await readFile(path, 'utf8'))
  const fileHash = async path => nodePortHash(await readFile(path))
  const files = {}, readEvidence = async name => { const path = containedPath(evidence, name); files[name] = await fileHash(path); return json(path) }
  const firstSuite = await readEvidence('suite-' + completedRuns[0].id + '.json')
  if (firstSuite.status === 'SOURCE_ATTESTATION_NA') {
    const packet = await readEvidence('not-applicable.json')
    const { assertSqueezeSourceNA } = await import(pathToFileURL(join(root, 'experiments/squeeze-node-differential/protocol.mjs')).href)
    assertSqueezeSourceNA(packet, await fileHash(join(root, 'experiments/squeeze-node-differential/reference.py')))
    assert.equal(firstSuite.productionCases, 0)
    assert.equal(packet.version.join('.'), profile.blenderVersion)
    assert.ok(!(await readdir(evidence)).some(name => name === 'references.json' || name === 'final-proof.json' || /^browser-(raw|final)-/.test(name)), 'N/A cannot carry numerical qualification rows')
    return { status: packet.reason.startsWith('Squeeze Value source attestation is N/A') ? 'not-applicable' : 'refused', productionCases: 0, caseRuns: 0, reason: packet.reason, files, actualIdentity: { nativeVersion: packet.version, nativeSource: null, browsers: [] } }
  }
  assert.equal(firstSuite.status, 'passed')
  assert.equal(firstSuite.built, true)
  assert.equal(firstSuite.productionCases, manifest.evidence.productionCases)
  assert.ok(firstSuite.productionCases > 0, 'Zero numerical cases are not qualification')
  if (profile.expectedStatus === 'not-applicable') return { status: 'refused', productionCases: 0, caseRuns: 0, reason: 'A source-N/A profile unexpectedly produced numerical output; review the profile before granting credit', files }
  assert.deepEqual(completedRuns.map(run => run.id), profile.runs.map(run => run.id), 'Every declared browser run must complete')
  const references = await readEvidence('references.json'), referenceHash = files['references.json'], final = await readEvidence('final-proof.json')
  assert.equal(references.version.join('.'), profile.blenderVersion)
  if (profile.blenderBuildHash) assert.equal(references.build, profile.blenderBuildHash)
  assert.equal(references.backend.backend, profile.nativeSource.backend)
  if (profile.nativeSource.renderer) assert.equal(references.backend.renderer, profile.nativeSource.renderer)
  assert.equal(references.sourcePreserved, true); assert.equal(final.sourcePreserved, true); assert.equal(final.exporter, 'built')
  assert.equal(references.fixtureSha256, await fileHash(join(root, 'experiments/squeeze-node-differential/reference.py')))
  assert.equal(references.interval, 2 ** -24); assert.equal(references.kernelBudget, 2e-5)
  assert.equal(references.width, 32); assert.equal(references.height, 32)
  assert.equal(final.nativeReferenceSha256, referenceHash)
  const nativeSources = ['squeeze_ir.py', 'tsl_ir.py', 'shader_domains.py', 'engine_fallback.py'].map(name => 'packages/blender-addon/' + name)
  assert.deepEqual(Object.keys(references.pythonHashes).sort(), [...nativeSources].sort())
  assert.deepEqual(final.pythonProvenance.map(source => source.source).sort(), [...nativeSources,
    'packages/blender-addon/material_compiler.py', 'packages/blendlink/blender/export_scene.py'].sort())
  for (const [name, hash] of Object.entries(references.pythonHashes)) assert.equal(await fileHash(containedPath(root, name)), hash)
  for (const source of final.pythonProvenance) {
    assert.equal(await fileHash(containedPath(root, source.source)), source.sha256)
    assert.equal(source.artifact, 'packages/blendlink/dist/blender/' + basename(source.source))
    assert.equal(await fileHash(containedPath(root, source.artifact)), source.sha256)
  }
  const ids = references.cases.map(item => item.id).sort()
  assert.equal(new Set(ids).size, ids.length); assert.equal(ids.filter(id => id === 'calibration').length, manifest.evidence.calibrationCases)
  assert.equal(ids.length, manifest.evidence.productionCases + manifest.evidence.calibrationCases)
  assert.ok(manifest.evidence.productionCases > 0, 'Zero numerical cases are not qualification')
  assert.equal(references.refusedNativeCases.length, manifest.evidence.refusedNativeCases)
  assert.deepEqual(final.cases.map(item => item.id).sort(), ids)
  const visitSqueeze = (value, output = []) => {
    if (!value || typeof value !== 'object') return output
    if (value.op === 'squeeze_native') output.push(value)
    for (const [key, child] of Object.entries(value)) if (key !== 'pixels') visitSqueeze(child, output)
    return output
  }
  for (const item of references.cases) {
    assert.equal(await fileHash(containedPath(evidence, item.file)), item.sourceSha256)
    const ir = await readFile(containedPath(evidence, item.ir)); assert.equal(nodePortHash(ir), item.irSha256)
    const expressions = visitSqueeze(JSON.parse(ir))
    if (item.id !== 'calibration') assert.ok(expressions.length > 0)
    for (const expression of expressions) {
      assert.equal(expression.sourceProfile, profile.nativeSource.profile)
      assert.equal(expression.nativeGpuBackend, profile.nativeSource.backend)
      assert.equal(expression.nativeVersion.join('.'), profile.blenderVersion)
      if (profile.nativeSource.renderer) { assert.equal(expression.nativeGpuRenderer, profile.nativeSource.renderer); assert.equal(expression.sourceBuildHash, profile.blenderBuildHash) }
    }
    for (const native of item.native) { const bytes = await readFile(containedPath(evidence, native.file)); assert.equal(nodePortHash(bytes), native.sha256); assert.equal(bytes.length, references.width * references.height * 16) }
  }
  for (const item of references.refusedNativeCases) {
    assert.equal(item.sourcePreserved, true)
    assert.equal(await fileHash(containedPath(evidence, item.file)), item.sourceSha256)
    assert.ok(typeof item.reason === 'string' && item.reason.length > 0)
    for (const native of item.native) {
      const bytes = await readFile(containedPath(evidence, native.file))
      assert.equal(nodePortHash(bytes), native.sha256); assert.equal(bytes.length, references.width * references.height * 16)
    }
  }
  for (const item of final.cases) {
    assert.equal(item.sourceSha256, references.cases.find(source => source.id === item.id).sourceSha256)
    const manifestPath = containedPath(evidence, item.manifestUrl.replace(/^\/@fs/, ''))
    const manifestBytes = await readFile(manifestPath); assert.equal(nodePortHash(manifestBytes), item.manifestSha256)
    const published = JSON.parse(manifestBytes), base = join(evidence, 'compiled/public')
    const glb = await readFile(containedPath(base, published.url.replace(/^\//, '')))
    const program = await readFile(containedPath(base, published.materialPrograms.url.replace(/^\//, '')))
    assert.equal(nodePortHash(glb), item.glbSha256); assert.equal(nodePortHash(program), item.programSha256)
    assert.equal(published.hash, item.glbSha256.slice(0, 16)); assert.equal(published.stats.bytes, glb.length)
    assert.equal(published.materialPrograms.bytes, program.length); assert.equal(published.materialPrograms.hash, item.programSha256.slice(0, 16))
  }
  const { captureRuntimeProvenance, normalizeEmit } = await import(pathToFileURL(join(root, 'scripts/lib/runtime-provenance.mjs')).href)
  const { provenance } = await captureRuntimeProvenance({ root, built: true, label: 'node-port adapter' })
  const currentModules = new Map(provenance.modules.map(module => [module.name, module]))
  const browsers = []; let caseRuns = 0, maximum = 0
  for (const run of completedRuns) {
    const suite = await readEvidence('suite-' + run.id + '.json')
    assert.equal(suite.status, 'passed'); assert.equal(suite.built, true); assert.equal(suite.productionCases, manifest.evidence.productionCases)
    for (const mode of ['raw', 'final']) {
      const report = await readEvidence('browser-' + mode + '-' + run.id + '.json')
      assert.equal(report.status, 'passed'); assert.equal(report.built, true); assert.equal(report.final, mode === 'final')
      assert.equal(report.provenance.nativeReferenceSha256, referenceHash)
      assert.equal(report.provenance.browserFixtureSha256, await fileHash(join(root, 'experiments/squeeze-node-differential/browser.js')))
      assert.equal(report.provenance.missingWebGpuAdapterControl.rejected, true)
      assert.match(report.provenance.missingWebGpuAdapterControl.error, /requires an actual WebGPU adapter/)
      assert.equal(report.provenance.modules.length, currentModules.size)
      assert.deepEqual(report.provenance.modules.map(module => module.name).sort(), [...currentModules.keys()].sort())
      assert.equal(report.provenance.typescript, provenance.typescript)
      assert.equal(report.provenance.copyAssetsSha256, provenance.copyAssetsSha256)
      for (const module of report.provenance.modules) {
        const current = currentModules.get(module.name); assert.ok(current); assert.equal(module.emitterMatchesSource, true)
        for (const name of ['sourceSha256', 'expectedEmitterSha256', 'emitterSha256']) assert.equal(module[name], current[name])
        const bytes = await readFile(containedPath(evidence, join(basename(report.provenance.snapshot.directory), module.name + '.js')))
        assert.equal(nodePortHash(bytes), module.testedSnapshotSha256); assert.equal(nodePortHash(normalizeEmit(bytes.toString('utf8'))), current.emitterSha256)
      }
      assert.deepEqual(report.rows.map(row => row.backend).sort(), ['webgl2', 'webgpu'])
      for (const row of report.rows) {
        assert.equal(row.gpu.api, row.backend === 'webgpu' ? 'WebGPU' : 'WebGL2')
        assert.match(JSON.stringify(row.gpu), run.adapter === 'software' ? /swiftshader/i : /apple|metal/i)
        if (run.adapter === 'metal') assert.doesNotMatch(JSON.stringify(row.gpu), /swiftshader/i)
        assert.deepEqual(row.failures, []); assert.deepEqual(row.errors, []); assert.deepEqual(row.pageErrors, [])
        assert.deepEqual(row.rows.map(item => item.id).sort(), ids)
        const expectedNegatives = mode === 'raw' ? [] : ids.flatMap(id => [id + ':actual-published-program-pin',
          ...(id !== 'calibration' ? [id + ':actual-legacy-squeeze-refusal'] : []),
          ...(id === 'image-all' ? [id + ':overflow-product', id + ':changed-image-pixels'] : [])]).sort()
        assert.deepEqual(row.negativeChecks.map(item => item.id + ':' + item.kind).sort(), expectedNegatives)
        for (const negative of row.negativeChecks) {
          assert.ok(typeof negative.error === 'string' && negative.error.length > 0)
          if (['overflow-product', 'changed-image-pixels'].includes(negative.kind)) assert.equal(negative.allocatedTextures, 0)
        }
        const calibration = row.rows.find(item => item.id === 'calibration')
        assert.equal(calibration.raw, 0); assert.equal(calibration.max, 0)
        for (const item of row.rows) { assert.equal(item.remainingTextures, 0); assert.ok(Number.isFinite(item.max) && item.max >= 0 && item.max <= references.kernelBudget); maximum = Math.max(maximum, item.max) }
        caseRuns += row.rows.length; browsers.push({ run: run.id, mode, backend: row.backend, gpu: row.gpu })
      }
    }
  }
  return { status: 'qualified', productionCases: manifest.evidence.productionCases, caseRuns, rgbComparisons: caseRuns * references.width * references.height * 3, maximumOutsideNativeInterval: maximum,
    files, actualIdentity: { nativeVersion: references.version, nativeBuild: references.build, nativeSource: references.backend, browsers } }
}
