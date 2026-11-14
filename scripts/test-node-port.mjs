// One manifest-selected native -> Final -> built-runtime proof transaction.
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { executeNodePortCommand, expandNodePortCommand, fingerprintNodePortInputs, nodePortFileIdentity,
  nodePortHash, readNodePortManifest } from './lib/node-port-contract.mjs'
import {createNodePortBlenderLauncher} from './lib/node-port-python.mjs'
import { nodePortEvidenceAdapter, nativeFinalEvidenceHash } from './lib/node-port-evidence.mjs'
import { archiveNativeLauncher } from './lib/native-proof-archive.mjs'

class Refused extends Error {}
const defaultRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const message = error => ({ name: error.name, message: error.message, stack: error.stack })
function gitCommit(root) { try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
async function browserIdentity(root, env) {
  let browser
  try {
    const require = createRequire(join(root, 'package.json'))
    const { chromium } = await import(pathToFileURL(require.resolve('@playwright/test')).href)
    const channel = env.BLENDLINK_TEST_CHROMIUM_CHANNEL
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...JSON.parse(env.BLENDLINK_TEST_CHROMIUM_ARGS ?? '[]')] })
    const session = await browser.newBrowserCDPSession(), system = await session.send('SystemInfo.getInfo')
    const commandLine = system.commandLine ?? null
    // CDP supplies the actual launched variant, including headless-shell;
    // executablePath() alone would incorrectly identify that variant.
    const executable = typeof commandLine === 'string' ? commandLine.match(/^(?:"([^"]+)"|(.+?))\s+--/) : null
    let binary = null
    if (executable) { try { binary = await nodePortFileIdentity(executable[1] ?? executable[2]) } catch {} }
    return { version: browser.version(), binary, systemInfo: system, identitySource: 'actual-CDP-browser-process; numerical adapter identity is checked separately',
      identityLimit: 'The launched executable is hashed; loaded browser libraries are not exhaustively hashed. No numeric cache hit is permitted.' }
  } catch (error) { return { version: null, binary: null, systemInfo: null, unavailable: error.message } }
  finally { await browser?.close() }
}
async function executePort(options) {
  const root = await realpath(resolve(options.root ?? defaultRoot)), id = options.id
  if (!/^[a-z][a-z0-9-]*$/.test(id ?? '')) throw new Error('Use a registered port id slug')
  const manifest = await readNodePortManifest(join(root, 'node-ports', id + '.json'))
  if (manifest.id !== id) throw new Error('Manifest file/id mismatch')
  const profile = manifest.profiles.find(profile => profile.id === options.profile)
  const adapter = nodePortEvidenceAdapter(manifest.evidence.adapter)
  const inputs = await fingerprintNodePortInputs(root, manifest)
  const catalog = options.catalog ? { path: resolve(options.catalog), sha256: nodePortHash(await readFile(resolve(options.catalog))), validation: 'opaque supplied input; this runner does not assert catalog/build equivalence' } : null
  let evidence = resolve(options.evidence ?? join(root, 'artifacts/node-ports', id, Date.now() + '-' + randomUUID().slice(0, 8)))
  const report = { schemaVersion: 1, kind: 'blendlink-node-port-verification-v1', manifestId: id, nativeNode: manifest.nativeNode,
    domain: manifest.domain, lifecycle: manifest.lifecycle, profile: options.profile ?? null, status: 'running', supportPromotion: false,
    productionCredit: false, sourceCommit: gitCommit(root), catalog, inputs, inputDigest: inputs.inputDigest,
    nativeInputDigest: inputs.nativeInputDigest, runtimeInputDigest: inputs.runtimeInputDigest, steps: [], browserProbes: [],
    cachePolicy: 'record-only; no numerical proof is reused or skipped', nativeIdentity: null, nativeLauncherIdentity: null, actualIdentity: null,
    processIdentity: { nodeVersion: process.versions.node, platform: process.platform, architecture: process.arch } }
  const values = { node: process.execPath, blender: options.blender ?? '<unknown-blender>', root, evidence,
    profile: options.profile ?? '<unknown-profile>', run: '' }
  const plan = profile ? [...manifest.commands.build.map(command => expandNodePortCommand(command, values)),
    ...profile.runs.flatMap(run => manifest.commands.verify ? [expandNodePortCommand(manifest.commands.verify, { ...values, run: run.id }, run)] : [])] : []
  if (options.dryRun) {
    // In particular do not launch or hash a potentially huge Blender binary.
    let blenderStat = null
    if (options.blender) { try { const info = await stat(options.blender); blenderStat = { path: resolve(options.blender), bytes: info.size, sha256: null } } catch {} }
    return { ...report, status: 'planned', dryRun: true, nativeIdentity: blenderStat,
      unknownIdentities: ['native build/driver', 'actual browser/adapter'], runnable: !!profile && !!manifest.commands.verify && !!adapter,
      inputDigest: inputs.inputDigest, nativeInputDigest: inputs.nativeInputDigest, runtimeInputDigest: inputs.runtimeInputDigest, commands: plan, exitCode: 0 }
  }
  await mkdir(resolve(evidence, '..'), { recursive: true })
  // Fresh ownership is mandatory: a prior passing JSON cannot satisfy this run.
  await mkdir(evidence)
  evidence = await realpath(evidence); values.evidence = evidence
  const reportPath = join(evidence, 'report.json')
  report.reportPath = reportPath
  const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  const baseEnv = { BLENDER_USER_CONFIG: join(evidence, 'user-resources/config'), BLENDER_USER_SCRIPTS: join(evidence, 'user-resources/scripts'), BLENDER_USER_DATAFILES: join(evidence, 'user-resources/datafiles') }
  for (const path of Object.values(baseEnv)) await mkdir(path, { recursive: true })
  await save()
  let launcher
  try {
    if (!profile) throw new Refused('Choose a declared --profile; no unmeasured profile is inferred')
    if (!profile.hostPlatforms.includes(process.platform)) throw new Refused('The selected source profile is not declared for this host platform')
    if (!manifest.commands.verify || !adapter) throw new Refused('This entry has no implemented verification adapter; research/scaffold metadata grants no support')
    adapter.validate?.({ manifest, profile })
    if (!options.blender) throw new Refused('Specify the actual --blender executable')
    if (!['darwin', 'linux'].includes(process.platform)) throw new Refused('The native proof launcher supports macOS/Linux; other hosts require independent qualification')
    report.nativeIdentity = await nodePortFileIdentity(options.blender)
    const identityStep = await executeNodePortCommand({ argv: [report.nativeIdentity.path, '--version'], env: baseEnv,
      timeoutMs: 15000, cwd: root, logPath: join(evidence, 'identity-blender.log') })
    report.steps.push({ id: 'identity-blender', ...identityStep }); await save()
    if (identityStep.exitCode !== 0 || identityStep.timedOut || identityStep.error) throw new Error('Blender identity query failed')
    const versionText = await readFile(identityStep.logPath, 'utf8'), version = versionText.match(/Blender\s+(\d+\.\d+\.\d+)/)?.[1], build = versionText.match(/build hash:\s*([a-f0-9]+)/i)?.[1] ?? null
    report.nativeIdentity.version = version ?? null; report.nativeIdentity.buildHash = build
    if (version !== profile.blenderVersion || profile.blenderBuildHash && build !== profile.blenderBuildHash) throw new Refused('Actual Blender version/build does not match the declared source profile')
    const familyOwned = adapter.nativeOwnership === 'family'
    if (!familyOwned) {
      launcher = await createNodePortBlenderLauncher({ blender: report.nativeIdentity.path, directory: join(evidence, 'native-python-active') })
      for (const key of ['path', 'bytes', 'sha256']) assert.equal(launcher.identity.native[key], report.nativeIdentity[key])
      report.nativeLauncherIdentity = launcher.identity
      values.blender = launcher.executable
    } else {
      // These registered suites own their complete fresh guard/archive and both
      // browser profiles. Never nest another launcher or run their matrix twice.
      values.blender = report.nativeIdentity.path
      report.nativePythonOwnership = 'family'
    }
    report.inputDigest = inputs.inputDigest; report.nativeInputDigest = inputs.nativeInputDigest; report.runtimeInputDigest = inputs.runtimeInputDigest
    report.requestKey = nodePortHash(JSON.stringify({ inputs: inputs.inputDigest, manifest, profile, native: report.nativeIdentity,
      catalog, node: { version: process.versions.node, binary: launcher?.identity.node ?? await nodePortFileIdentity(process.execPath) }, launcher: launcher?.identity ?? null, actualDriver: null, browserIdentity: null }))
    const runStep = async command => {
      console.log('BLENDLINK_NODE_PORT_STEP ' + command.id)
      const result = await executeNodePortCommand({ ...command, env: { ...baseEnv, ...command.env }, cwd: root, logPath: join(evidence, 'step-' + command.id + '.log') })
      report.steps.push({ id: command.id, ...result }); await save()
      if (result.exitCode !== 0 || result.timedOut || result.error) throw new Error('Port command failed: ' + command.id)
    }
    for (const command of manifest.commands.build) await runStep(expandNodePortCommand(command, values))
    let firstNativeHash = null
    const completedRuns = []
    for (const run of profile.runs) {
      if (!familyOwned && profile.expectedStatus !== 'not-applicable') { report.browserProbes.push({ run: run.id, ...await browserIdentity(root, { ...manifest.commands.verify.env, ...run.env }) }); await save() }
      await runStep(expandNodePortCommand(manifest.commands.verify, { ...values, run: run.id }, run))
      completedRuns.push(run)
      const suite = await json(join(evidence, 'suite-' + run.id + '.json'))
      if (suite.status === 'SOURCE_ATTESTATION_NA') break
      const nativeHash = await nativeFinalEvidenceHash(adapter, evidence)
      if (firstNativeHash !== null && nativeHash !== firstNativeHash) throw new Error('Native/Final evidence changed between browser runs')
      firstNativeHash = nativeHash
    }
    const result = await adapter.read({ root, evidence, manifest, profile, completedRuns, nativeIdentity: report.nativeIdentity })
    if (familyOwned && await nativeFinalEvidenceHash(adapter, evidence) !== firstNativeHash) throw new Error('Native/Final evidence changed during independent family closure')
    Object.assign(report, result)
    const finalInputs = await fingerprintNodePortInputs(root, manifest)
    report.workspaceStable = finalInputs.inputDigest === inputs.inputDigest
    if (!report.workspaceStable) throw new Error('Declared inputs changed during qualification; rerun from a stable checkout')
    report.productionCredit = result.status === 'qualified' && manifest.lifecycle === 'production'
  } catch (error) { report.status = error instanceof Refused ? 'refused' : 'failed'; report.error = message(error); report.productionCredit = false }
  finally {
    if (launcher) {
      try {
        report.nativePythonArchiveDirectory = join(evidence, 'native-python-proof')
        report.nativePythonProof = await archiveNativeLauncher(launcher, evidence, ['qualified', 'not-applicable'].includes(report.status))
        if (report.status === 'qualified') {
          const sources = await Promise.all((await adapter.finalSources(evidence)).map(path => realpath(path)))
          assert.deepEqual([...new Set(report.nativePythonProof.finalSources)].sort(), sources.sort(), 'Every Final source must traverse the native proof launcher')
        }
      } catch (error) {
        report.status = 'failed'; report.nativePythonError = message(error); report.error ??= message(error); report.productionCredit = false
      } finally {
        try { await launcher.dispose(); await rm(join(evidence, 'native-python-active'), { recursive: true, force: true }); report.nativeLauncherDisposed = true }
        catch (error) { report.status = 'failed'; report.nativePythonCleanupError = message(error); report.error ??= message(error); report.productionCredit = false }
      }
    }
    report.evidenceKey = nodePortHash(JSON.stringify({ requestKey: report.requestKey ?? null, actualIdentity: report.actualIdentity,
      browserProbes: report.browserProbes, nativeLauncherIdentity: report.nativeLauncherIdentity, nativePythonProof: report.nativePythonProof ?? null }))
    report.exitCode = report.status === 'qualified' ? 0 : ['not-applicable', 'refused'].includes(report.status) ? 2 : 1; await save()
  }
  return report
}

export async function runNodePort(options) {
  const root = resolve(options.root ?? defaultRoot)
  const safeId = /^[a-z][a-z0-9-]*$/.test(options.id ?? '') ? options.id : 'invalid'
  const evidence = resolve(options.evidence ?? join(root, 'artifacts/node-ports', safeId, Date.now() + '-' + randomUUID().slice(0, 8)))
  try { return await executePort({ ...options, root, evidence }) }
  catch (error) {
    // Parse/input failures happen before commands exist. Retain those too,
    // while never overwriting a directory owned by an earlier transaction.
    const report = { schemaVersion: 1, kind: 'blendlink-node-port-verification-v1', manifestId: options.id ?? null,
      status: 'failed', supportPromotion: false, productionCredit: false, inputValidationFailed: true,
      error: message(error), steps: [], exitCode: 1 }
    if (options.dryRun) return { ...report, dryRun: true }
    try {
      await mkdir(resolve(evidence, '..'), { recursive: true }); await mkdir(evidence)
      report.reportPath = join(evidence, 'report.json')
      await writeFile(report.reportPath, JSON.stringify(report, null, 2) + '\n')
    } catch (retentionError) { report.retentionError = message(retentionError) }
    return report
  }
}

export function parseNodePortArguments(args) {
  const options = { id: args[0] }
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--dry-run') { if (options.dryRun) throw new Error('Duplicate --dry-run'); options.dryRun = true; continue }
    const key = { '--root': 'root', '--profile': 'profile', '--blender': 'blender', '--evidence': 'evidence', '--catalog': 'catalog' }[flag]
    if (!key || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown, missing or duplicated node-port argument: ' + flag)
    options[key] = args[++i]
  }
  if (!options.id) throw new Error('usage: test-node-port.mjs <id> --profile <id> --blender <path> [--dry-run] [--evidence <fresh directory>]')
  return options
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runNodePort(parseNodePortArguments(process.argv.slice(2)))
    const summary = Object.fromEntries(['manifestId', 'profile', 'status', 'exitCode', 'supportPromotion', 'productionCredit', 'reportPath',
      'productionCases', 'calibrationCases', 'nativeGraphs', 'savedFinalScenes', 'caseRuns', 'productionCaseRuns', 'primaryFloat32Words', 'productionFloat32Words', 'wordMismatches', 'rgbComparisons', 'maximumOutsideNativeInterval', 'workspaceStable', 'inputDigest', 'requestKey', 'evidenceKey', 'error',
      ...(result.dryRun ? ['dryRun', 'runnable', 'unknownIdentities', 'nativeIdentity', 'commands'] : [])].filter(key => result[key] !== undefined).map(key => [key, result[key]]))
    console.log('BLENDLINK_NODE_PORT_RESULT ' + JSON.stringify(summary)); process.exitCode = result.exitCode
  }
  catch (error) { console.error(error.stack); process.exitCode = 1 }
}
