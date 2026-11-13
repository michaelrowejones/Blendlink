import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { executeNodePortCommand, expandNodePortCommand, fingerprintNodePortInputs, loadNodePortManifests,
  nodePortHash, readNodePortManifest, readSqueezeNodePortEvidence, validateNodePortManifest, validateRepositoryPattern } from './node-port-contract.mjs'
import { parseNodePortArguments, runNodePort } from '../test-node-port.mjs'

const repository = resolve(import.meta.dirname, '../..')
const example = await readNodePortManifest(join(repository, 'node-ports/squeeze.json'))
const copy = value => structuredClone(value)
test('an existing evidence adapter cannot qualify another native class or context', async () => {
  for (const patch of [{nativeNode:'ShaderNodeTexGabor'},{domain:'compositor'}]) {
    const forged={...copy(example),...patch}
    assert.throws(()=>validateNodePortManifest(forged),/Squeeze evidence cannot qualify/)
    await assert.rejects(readSqueezeNodePortEvidence({manifest:forged}),/Squeeze evidence cannot qualify/)
  }
})
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'blendlink-node-port-contract-')); t.after(() => rm(root, { recursive: true, force: true })); return root }
async function put(root, path, content) { await mkdir(resolve(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content) }
async function fixture(t) {
  const root = await temporary(t), manifest = copy(example)
  manifest.inputs = { native: ['experiments/squeeze-node-differential/reference.py'], runtime: ['runtime.ts'], sdk: ['package.json'], tests: ['verify.mjs'] }
  manifest.commands.build = []
  manifest.commands.verify = { id: 'verify', argv: ['{node}', 'verify.mjs', '{evidence}'], timeoutMs: 10000 }
  manifest.profiles = [{ id: 'native-na', hostPlatforms: [process.platform], blenderVersion: '4.2.0', expectedStatus: 'not-applicable', nativeSource: { profile: null, backend: null }, runs: [{ id: 'software', adapter: 'software', env: {} }] }]
  await put(root, 'experiments/squeeze-node-differential/reference.py', '# pinned native fixture\n')
  await put(root, 'experiments/squeeze-node-differential/protocol.mjs', await readFile(join(repository,'experiments/squeeze-node-differential/protocol.mjs')))
  await put(root, 'runtime.ts', 'export const value = 1\n'); await put(root, 'package.json', '{"type":"module"}\n')
  const packet = { status: 'SOURCE_ATTESTATION_NA', version: [4,2,0], productionCases: 0, reason: 'Squeeze Value source attestation is N/A for Blender 4.2.0', fixtureSha256: nodePortHash('# pinned native fixture\n'), nativeResearchRetained: 'native_probe.py supports the actual native function independently' }
  await put(root, 'verify.mjs', `import {writeFile} from 'node:fs/promises'; import {join} from 'node:path'; const out=process.argv[2]; await writeFile(join(out,'suite-software.json'),JSON.stringify({status:'SOURCE_ATTESTATION_NA',built:true,productionCases:0})); await writeFile(join(out,'not-applicable.json'),JSON.stringify(${JSON.stringify(packet)}));`)
  await put(root, 'node-ports/squeeze.json', JSON.stringify(manifest))
  const blender = join(root, 'fake-blender')
  await put(root, 'fake-blender', '#!' + process.execPath + '\nconsole.log("Blender 4.2.0\\n build hash: test");\n')
  await chmod(blender, 0o755)
  return { root, manifest, blender, profile: manifest.profiles[0], packet }
}

test('production manifest is closed, scanner-compatible and uses argv only', () => {
  assert.equal(example.lifecycle, 'production'); assert.equal(example.nativeNode, 'ShaderNodeSqueeze')
  assert.ok(example.upstream.direct.includes('source/blender/nodes/shader/nodes/node_shader_squeeze.cc'))
  for (const mutate of [
    v => v.schemaVersion = 2, v => v.lifecycle = 'supported', v => v.domain = 'geometry', v => v.extra = true,
    v => v.commands.verify.argv = 'node suite.mjs', v => v.commands.verify.timeoutMs = 0,
    v => v.commands.verify.timeoutMs = 1_800_001, v => v.commands.verify.env = { bad: '1' },
    v => v.upstream.direct = ['../escape'], v => v.inputs.runtime = ['source/{a,b}.ts'],
    v => v.profiles.push(v.profiles[0]), v => v.profiles[0].runs[0].args = ['--reuse-native'],
    v => v.commands.verify.argv = new Array(1), v => v.evidence.productionCases = 0,
  ]) { const value = copy(example); mutate(value); assert.throws(() => validateNodePortManifest(value)) }
  for (const pattern of ['../a', '/a', 'a/../b', 'a//b', 'a/**x/b', 'a\\b', 'a/{a,b}']) assert.throws(() => validateRepositoryPattern(pattern))
  for (const pattern of ['source/a.cc', 'source/*.cc', 'source/**/*.cc']) assert.equal(validateRepositoryPattern(pattern), pattern)
})

test('research manifests may describe a gap but cannot imply an executable port', () => {
  const value = copy(example); value.lifecycle = 'research'; value.commands.verify = null; value.profiles = []; value.evidence.productionCases = 0
  assert.equal(validateNodePortManifest(value).lifecycle, 'research')
})

test('fingerprints cover content, classify native/runtime inputs and reject missing/symlink inputs', async t => {
  const {root,manifest} = await fixture(t)
  const a = await fingerprintNodePortInputs(root, manifest)
  await writeFile(join(root,'runtime.ts'), 'export const value = 2\n')
  const b = await fingerprintNodePortInputs(root, manifest)
  assert.equal(a.nativeInputDigest,b.nativeInputDigest); assert.notEqual(a.runtimeInputDigest,b.runtimeInputDigest)
  await writeFile(join(root,'experiments/squeeze-node-differential/reference.py'), '# changed\n')
  const c = await fingerprintNodePortInputs(root, manifest)
  assert.notEqual(b.nativeInputDigest,c.nativeInputDigest); assert.equal(b.runtimeInputDigest,c.runtimeInputDigest)
  const missing = copy(manifest); missing.inputs.runtime = ['missing/**/*.ts']
  await assert.rejects(fingerprintNodePortInputs(root, missing))
  await symlink(join(root,'runtime.ts'), join(root,'aliased.ts'))
  const linked = copy(manifest); linked.inputs.runtime = ['aliased.ts']
  await assert.rejects(fingerprintNodePortInputs(root,linked),/symlinks/)
  manifest.inputs.runtime = ['**/*.ts']
  await assert.rejects(fingerprintNodePortInputs(root,manifest),/symlinks/)
})

test('manifest loader rejects duplicate ids and command expansion preserves literal argv', async t => {
  const {root,manifest} = await fixture(t)
  await put(root,'node-ports/duplicate.json',JSON.stringify(manifest))
  await assert.rejects(loadNodePortManifests(root),/Duplicate/)
  const expanded = expandNodePortCommand({ id:'test',argv:['{node}','$(touch should-not-exist); hello','{blender}'],env:{REMOVE:null},timeoutMs:100 },{node:'node',blender:'/path with spaces/blender'})
  assert.deepEqual(expanded.argv,['node','$(touch should-not-exist); hello','/path with spaces/blender']); assert.equal(expanded.env.REMOVE,null)
  assert.throws(() => expandNodePortCommand({id:'test',argv:['{unknown}'],timeoutMs:100},{node:'node'}),/placeholder/)
})

test('dry run hashes declared inputs but never launches or hashes native binary or creates evidence', async t => {
  const {root,blender} = await fixture(t), evidence = join(root,'not-created')
  await writeFile(blender,'not an executable; this file is never read as a command')
  const result = await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence,dryRun:true})
  assert.equal(result.status,'planned'); assert.equal(result.exitCode,0); assert.equal(result.nativeIdentity.sha256,null)
  assert.equal(result.actualIdentity,null); assert.match(result.cachePolicy,/no numerical proof/)
  await assert.rejects(stat(evidence),{code:'ENOENT'})
})

test('argv commands retain failure output and do not invoke a shell', async t => {
  const root = await temporary(t), literal = '$(touch unsafe-file); literal'
  const result = await executeNodePortCommand({argv:[process.execPath,'-e','console.log(process.argv[1]); process.exit(7)',literal],cwd:root,timeoutMs:1000,logPath:join(root,'command.log')})
  assert.equal(result.exitCode,7); assert.equal(result.timedOut,false); assert.match(await readFile(result.logPath,'utf8'),/literal/)
  await assert.rejects(stat(join(root,'unsafe-file')),{code:'ENOENT'})
})

test('timeout kills an owned grandchild even when its immediate parent exits on TERM', {skip:process.platform==='win32'}, async t => {
  const root = await temporary(t), pidfile = join(root,'pid')
  const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000)`
  const result = await executeNodePortCommand({argv:[process.execPath,'-e',parent],cwd:root,timeoutMs:500,logPath:join(root,'timeout.log')})
  assert.equal(result.timedOut,true); assert.ok(result.elapsedMs<4000)
  const pid = Number(await readFile(pidfile,'utf8'))
  // SIGKILL delivery/reaping is asynchronous after kill(2) returns.
  for(let count=0;count<100;count++) {
    try { process.kill(pid,0) } catch { break }
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.throws(() => process.kill(pid,0),{code:'ESRCH'})
})

test('source N/A retains a zero-credit receipt and exits 2 rather than a numerical pass', {skip:process.platform==='win32'}, async t => {
  const {root,blender} = await fixture(t), evidence = join(root,'proof')
  const result = await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence})
  assert.equal(result.status,'not-applicable'); assert.equal(result.exitCode,2); assert.equal(result.caseRuns,0)
  assert.equal(result.productionCredit,false); assert.equal(result.supportPromotion,false); assert.equal(result.workspaceStable,true)
  assert.equal(result.nativeIdentity.sha256,nodePortHash(await readFile(blender)))
  assert.equal(result.browserProbes.length,0); assert.ok(result.requestKey); assert.ok(result.evidenceKey)
  assert.equal(JSON.parse(await readFile(result.reportPath,'utf8')).status,'not-applicable')
  const retained = await readFile(result.reportPath)
  const second = await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence})
  assert.equal(second.status,'failed'); assert.equal(second.retentionError.name,'Error'); assert.deepEqual(await readFile(result.reportPath),retained)
})

test('N/A cannot smuggle numerical output, an unrecognized reason or a mismatched fixture pin', async t => {
  const {root,manifest,profile,packet} = await fixture(t), evidence = join(root,'na')
  await mkdir(evidence)
  await put(evidence,'suite-software.json',JSON.stringify({status:'SOURCE_ATTESTATION_NA',productionCases:0}))
  await put(evidence,'not-applicable.json',JSON.stringify(packet))
  const read = () => readSqueezeNodePortEvidence({root,evidence,manifest,profile,completedRuns:profile.runs})
  assert.equal((await read()).status,'not-applicable')
  await put(evidence,'browser-raw-software.json','{}'); await assert.rejects(read(),/N\/A/)
  await rm(join(evidence,'browser-raw-software.json'))
  for (const change of [{reason:'Looks fine'}, {fixtureSha256:'0'.repeat(64)}, {productionCases:1}]) {
    await put(evidence,'not-applicable.json',JSON.stringify({...packet,...change})); await assert.rejects(read())
  }
})

test('successful child exit with empty/missing numerical evidence cannot qualify', {skip:process.platform==='win32'}, async t => {
  const {root,blender} = await fixture(t)
  await put(root,'verify.mjs',`import {writeFile} from 'node:fs/promises'; import {join} from 'node:path'; await writeFile(join(process.argv[2],'suite-software.json'),JSON.stringify({status:'passed',built:true,productionCases:0}));`)
  const result = await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence:join(root,'proof')})
  assert.equal(result.exitCode,1); assert.equal(result.status,'failed'); assert.equal(result.productionCredit,false)
  assert.ok(result.steps.some(step=>step.id==='verify-software'&&step.exitCode===0)); assert.ok(result.reportPath)
})

test('changed declared source during a zero-credit transaction is rejected and recorded', {skip:process.platform==='win32'}, async t => {
  const {root,blender} = await fixture(t)
  await writeFile(join(root,'verify.mjs'),await readFile(join(root,'verify.mjs'),'utf8')+`await writeFile(${JSON.stringify(join(root,'runtime.ts'))},'changed during proof');`)
  const result = await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence:join(root,'proof')})
  assert.equal(result.status,'failed'); assert.equal(result.workspaceStable,false); assert.match(result.error.message,/inputs changed/)
})

test('unmeasured profile and malformed manifest failures are retained before commands', async t => {
  const {root} = await fixture(t)
  const result = await runNodePort({id:'squeeze',root,profile:'not-known',evidence:join(root,'refused')})
  assert.equal(result.status,'refused'); assert.equal(result.exitCode,2); assert.equal(result.steps.length,0); assert.ok(result.inputDigest)
  await put(root,'node-ports/squeeze.json','{"schemaVersion":99}')
  const failed = await runNodePort({id:'squeeze',root,evidence:join(root,'invalid')})
  assert.equal(failed.status,'failed'); assert.equal(failed.inputValidationFailed,true); assert.ok(failed.reportPath)
  assert.equal(JSON.parse(await readFile(failed.reportPath,'utf8')).productionCredit,false)
})

test('a wrong native build/version is a retained refusal, not a usable identity', {skip:process.platform==='win32'}, async t => {
  const {root,blender,manifest} = await fixture(t)
  manifest.profiles[0].blenderVersion='5.2.0'; manifest.profiles[0].blenderBuildHash='fbe6228777e7'
  await put(root,'node-ports/squeeze.json',JSON.stringify(manifest))
  const result=await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence:join(root,'wrong-native')})
  assert.equal(result.status,'refused'); assert.equal(result.exitCode,2)
  assert.equal(result.steps.length,1); assert.equal(result.steps[0].id,'identity-blender')
  assert.match(await readFile(result.steps[0].logPath,'utf8'),/Blender 4.2.0/)
  assert.equal(JSON.parse(await readFile(result.reportPath,'utf8')).exitCode,2)
})

test('a failing verification command records its exit and log before reporting failure', {skip:process.platform==='win32'}, async t => {
  const {root,blender}=await fixture(t)
  await put(root,'verify.mjs',"console.error('deliberate native failure'); process.exit(9)")
  const result=await runNodePort({id:'squeeze',root,profile:'native-na',blender,evidence:join(root,'command-failed')})
  assert.equal(result.status,'failed'); assert.equal(result.exitCode,1); assert.equal(result.productionCredit,false)
  assert.equal(result.steps.at(-1).exitCode,9)
  assert.match(await readFile(result.steps.at(-1).logPath,'utf8'),/deliberate native failure/)
  assert.equal(JSON.parse(await readFile(result.reportPath,'utf8')).status,'failed')
})

test('CLI rejects unknown, repeated and missing arguments',()=>{
  assert.deepEqual(parseNodePortArguments(['squeeze','--profile','mac-52','--dry-run']),{id:'squeeze',profile:'mac-52',dryRun:true})
  for(const args of [[],['squeeze','--bad'],['squeeze','--blender'],['squeeze','--profile','one','--profile','two'],['squeeze','--dry-run','--dry-run']]) assert.throws(()=>parseNodePortArguments(args))
})
