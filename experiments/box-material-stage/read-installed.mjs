// Independent saved-Final/public-package reader. Every pixel and lifecycle row
// is required; no source admission or original-material/scene credit is implied.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import sharp from 'sharp'
import { validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
import { captureRuntimeProvenance } from '../../scripts/lib/runtime-provenance.mjs'
import { validateCompilerTrace } from '../../scripts/lib/runtime-compiler-trace.mjs'
import { compare } from '../box-image-transport-prototype/compare.mjs'
import { lowerLeftRows } from '../box-image-storage-stage/orientation-check.mjs'
import { assertCandidateSdk } from './candidate-sdk.mjs'

const root = resolve(import.meta.dirname, '../..'), sha = b => createHash('sha256').update(b).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const ids = ['plane-1', 'source-Plane.021', 'source-Walls']
const helperInputs = { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') }
const flatten = v => !v || typeof v !== 'object' ? [] : [...('op' in v ? [v] : []), ...Object.values(v).flatMap(flatten)]
const checked = async (path, expected) => { const b = await readFile(path); assert.equal(sha(b), expected, 'Changed evidence: ' + path); return b }

export async function closeInstalled(finalDir, nativeDir, browserDir) {
 const finalBytes = await readFile(join(finalDir, 'final.json')), final = JSON.parse(finalBytes), fixtures = await json(join(finalDir, 'fixtures.json'))
 const nativeBytes = await readFile(join(nativeDir, 'reference.json')), native = JSON.parse(nativeBytes), reportBytes = await readFile(join(browserDir, 'report.json')), report = JSON.parse(reportBytes)
 assert.equal(final.status, 'EXPORTED_OWNED_ORIGINAL_BOX_COLOR_FINALS_NOT_SCENE_ACCEPTANCE')
 assert.equal(final.fixtureSha256, sha(await readFile(join(finalDir, 'fixtures.json'))))
 assert.deepEqual(fixtures.cases.map(c => c.id), ids); assert.deepEqual(final.rows.map(c => c.id), ids)
 await checked(fixtures.sourceOriginal, fixtures.sourceOriginalSha256); assert.equal(fixtures.sourceOriginalSha256, '9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e')
 assert.deepEqual(fixtures.calls, { gpu: 0, render: 0 })
 for (const p of final.provenance) { await checked(p.source, p.sha256); await checked(p.artifact, p.sha256) }
 await validateNativeArchive(await json(join(finalDir, 'export-native-proof.json')), join(finalDir, 'export-archive'), { expectedScripts: [{ path: join(import.meta.dirname, 'audit-colors.py'), invocations: 1 }], expectedFinalSources: fixtures.cases.map(c => c.sourceFile), helperInputs })
 const policy = await json(join(finalDir, 'source-policy.json')); assert.equal(policy.status, 'PASSED_SAVED_COLOR_SOURCE_POLICY_NO_GPU'); assert.deepEqual(policy.calls, { gpu: 0, render: 0 }); assert.equal(policy.scriptSha256, sha(await readFile(join(import.meta.dirname, 'audit-colors.py')))); assert.deepEqual(policy.rows.map(c => c.id), ids)
 for (const p of policy.rows) for (const key of ['privateCarrierNeutralizedOnlyOwnedCopy', 'sourceBindingsRestoredAfterFailure', 'fractionalAlphaRefused', 'unsupportedBlendRefused']) assert.equal(p[key], true)
 let mipBytes = 0
 for (const row of final.rows) {
  const fixture = fixtures.cases.find(c => c.id === row.id); assert.equal(row.sourceFile, fixture.sourceFile); assert.equal(row.sourceSha256, fixture.sourceSha256)
  for (const role of ['source', 'manifest', 'glb', 'module', 'material', 'mip', 'presentation']) { const path = row[role + (role === 'source' ? 'File' : 'Path')]; if (path) await checked(path, row[role + 'Sha256']) }
  const programs = await json(row.materialPath); assert.deepEqual(programs, row.materialPrograms); assert.equal(Object.keys(programs.materials).length, 1)
  const program = Object.values(programs.materials)[0]; assert.deepEqual(program.skipped ?? [], [])
  for (const channel of ['Base Color', 'Metallic', 'Roughness', 'Emission', 'Alpha']) assert.ok(program.channels[channel]?.tslIr)
  assert.deepEqual(program.channels.Alpha.tslIr.output, { op: 'const_float', value: 1 })
  assert.ok(flatten(program.channels['Base Color']).some(n => n.op === 'texture_box_ref' && n.model === 'eevee-metal-box-color-mips-v1'))
  for (const [name, channel] of Object.entries(program.channels)) if (name !== 'Base Color') assert.ok(!flatten(channel).some(n => n.op === 'texture_box_ref'))
  const b = await readFile(row.glbPath); assert.equal(b.readUInt32LE(0), 0x46546c67); assert.equal(b.readUInt32LE(16), 0x4e4f534a)
  const glb = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12))); assert.equal(glb.meshes.length, 1); const mesh = glb.meshes[0]; assert.equal(mesh.primitives.length, 1)
  assert.ok(mesh.extras.blendlink_tsl_runtime.requiresNodeRenderer.programs.some(p => p.op === 'texture_box_ref' && p.model === 'eevee-metal-box-color-mips-v1'))
  for (const name of ['POSITION', 'NORMAL']) assert.equal(glb.accessors[mesh.primitives[0].attributes[name]].componentType, 5126)
  assert.equal(glb.materials.length, 1); const carrier = glb.materials[mesh.primitives[0].material]; assert.ok(!carrier.pbrMetallicRoughness?.baseColorTexture); assert.deepEqual(carrier.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1], [1, 1, 1, 1]); assert.equal(carrier.alphaMode ?? 'OPAQUE', 'OPAQUE'); assert.deepEqual(glb.images ?? [], [])
  const images = Object.values(programs.images); assert.equal(images.length, 1); const image = images[0], m = image.boxMipmaps
  assert.equal(m.model, 'eevee-metal-box-color-mips-v1'); assert.equal(m.nativeBuild, '02f0899d78e3'); assert.equal(m.nativeBackend, 'METAL'); assert.equal(m.nativeVersion, '5.3.0'); assert.equal(m.uncompressedBytes, 1398100); assert.equal(m.levels.length, 10)
  const png = await checked(join(dirname(row.materialPath), image.file), m.sourceSha256); assert.equal(png.length, image.bytes); assert.equal(sha(png).slice(0, 16), image.hash)
  const decoded = await sharp(png).flip().ensureAlpha().raw().toBuffer(); assert.equal(decoded.length, 4194304); assert.equal(sha(decoded), m.decodedRgbaSha256)
  const compressed = await checked(row.mipPath, m.sha256); assert.equal(compressed.length, m.bytes); assert.equal(row.mipPath, join(dirname(row.materialPath), m.file))
  const raw = inflateSync(compressed, { maxOutputLength: 1398100 }); assert.equal(raw.length, 1398100); let offset = 0
  for (let i = 0; i < 10; i++) { const level = m.levels[i], size = 512 >> i; assert.equal(level.level, i + 1); assert.equal(level.width, size); assert.equal(level.height, size); const bytes = raw.subarray(offset, offset + size * size * 4); assert.equal(sha(bytes), level.sha256); for (let j = 3; j < bytes.length; j += 4) assert.equal(bytes[j], 255); offset += bytes.length }
  assert.equal(offset, raw.length); mipBytes += compressed.length
 }
 assert.equal(native.status, 'CAPTURED_SAVED_ORIGINAL_COLOR_OBSERVATIONS'); assert.equal(native.sourcePreserved, true); assert.equal(native.fixtureSha256, final.fixtureSha256); assert.equal(native.scriptSha256, sha(await readFile(join(import.meta.dirname, 'reference-colors.py')))); assert.equal(native.gate.rgbMaxAbs, 2 ** -10); assert.equal(native.gate.alphaExact, true); assert.equal(native.gpu.backend, 'METAL'); assert.equal(native.rows.length, 18)
 await validateNativeArchive(await json(join(nativeDir, 'native-archive.json')), nativeDir, { expectedScripts: [{ path: join(import.meta.dirname, 'reference-colors.py'), invocations: 1 }], expectedFinalSources: [], helperInputs })
 const nativeRows = new Map()
 for (const id of ids) for (const [width, height] of [[64, 4], [128, 8]]) for (const kind of ['mask', 'mapping', 'color']) {
  const matches = native.rows.filter(r => r.case === id && r.kind === kind && r.width === width && r.height === height); assert.equal(matches.length, 1); const row = matches[0], bytes = await checked(join(nativeDir, row.file), row.sha256); assert.equal(bytes.length, width * height * 16); assert.equal(row.words, width * height * 4); nativeRows.set(id + '/' + kind + '/' + width, bytes)
 }
 assert.equal(report.status, 'PUBLIC_INSTALLED_BOX_COLOR_MATRIX_CAPTURED_NOT_SCENE_ACCEPTANCE'); assert.equal(report.finalSha256, sha(finalBytes)); assert.equal(report.producerSha256, sha(await readFile(join(import.meta.dirname, 'installed.mjs')))); assert.equal(report.fixtureSha256, sha(await readFile(join(import.meta.dirname, 'installed-browser.js')))); assert.equal(report.fixtureSha256, sha(await readFile(join(browserDir, 'fixture.js'))))
 await checked(report.package.file, report.package.sha256); assert.equal(report.package.integrity, 'sha512-' + createHash('sha512').update(await readFile(report.package.file)).digest('base64'))
 validateCompilerTrace(report.provenance.compilerAttestation)
 const { provenance } = await captureRuntimeProvenance({ root, built: true, compilerInputs: true })
 assert.equal(report.provenance.mode, 'built'); assert.equal(report.provenance.typescript, provenance.typescript); assert.equal(report.provenance.copyAssetsSha256, provenance.copyAssetsSha256); assert.equal(report.provenance.modules.length, provenance.modules.length)
 for (const module of provenance.modules) { const saved = report.provenance.modules.find(m => m.name === module.name); assert.ok(saved); for (const key of ['sourceSha256', 'emitterSha256', 'expectedEmitterSha256', 'emitterMatchesSource', 'postEmitTransform']) assert.deepEqual(saved[key], module[key]); const path = join(report.package.directory, 'dist', module.name + '.js'); assert.ok(report.pins[path]); assert.deepEqual(await checked(path, report.pins[path]), await readFile(join(root, 'packages/blendlink/dist', module.name + '.js'))) }
 for (const [path, hash] of Object.entries(report.pins)) await checked(path, hash)
 assert.equal(report.apis.length, 4); const tuples = new Set(), comparisons = [], lifecycle = []
 for (const api of report.apis) {
  const tuple = api.profile + '/' + api.backend; assert.ok(['metal/webgpu', 'metal/webgl2', 'swiftshader/webgpu', 'swiftshader/webgl2'].includes(tuple)); assert.ok(!tuples.has(tuple)); tuples.add(tuple)
  assert.equal(api.status, 'PASSED_PUBLIC_INSTALLED_BOX_COLOR_NOT_FULL_SCENE'); assert.equal(api.webgpuAvailableAtStart, api.backend === 'webgpu'); assert.ok(api.maximumAnisotropy >= 2)
  assert.match(JSON.stringify(api.gpu), api.profile === 'metal' ? /apple|metal/i : /swiftshader/i); if (api.profile === 'metal') assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i)
  for (const key of ['errors', 'pageErrors', 'unexpectedConsole', 'httpErrors']) assert.deepEqual(api[key], []); assert.deepEqual(api.deviceLosses, []); assert.equal(api.expectedResponses.length, 1); assert.equal(api.expectedResponses[0].status, 404); assert.equal(api.expectedFailures.length, 1); assert.match(api.expectedFailures[0].failure, /ERR_ABORTED/)
  assert.equal(api.bitmap.opened, api.bitmap.closed); assert.ok(api.bitmap.opened > 0); assert.equal(api.callerBitmaps.opened, api.callerBitmaps.closed); assert.equal(api.resources.length, 3); assert.equal(api.rows.length, 51); assert.equal(api.controls.length, 10)
  const cache = new Map(), keys = new Set()
  for (const row of api.rows) { assert.ok(ids.includes(row.id)); assert.ok(row.width === 64 && row.height === 4 || row.width === 128 && row.height === 8); const key = row.id + '/' + row.kind + '/' + row.width; assert.ok(!keys.has(key)); keys.add(key); const bytes = await checked(join(browserDir, row.file), row.sha256); assert.equal(bytes.length, row.width * row.height * 16); assert.equal(row.words, row.width * row.height * 4); cache.set(key, bytes) }
  for (const id of ids) {
   const take = (kind, width = 128) => { const value = cache.get(id + '/' + kind + '/' + width); assert.ok(value, 'Missing row ' + tuple + '/' + id + '/' + kind + '/' + width); return value }
   for (const [width, height] of [[64, 4], [128, 8]]) for (const kind of ['mask', 'mapping', 'color', 'alpha']) {
    const expected = nativeRows.get(id + '/' + (kind === 'alpha' ? 'mask' : kind) + '/' + width), bound = ['mask', 'alpha'].includes(kind) ? 0 : 2 ** -10
    const result = compare(lowerLeftRows(take(kind, width), api.backend, width, height), expected, bound); assert.equal(result.violations, 0, 'Native field gate failed: ' + tuple + '/' + id + '/' + kind + '/' + width); if (bound === 0) assert.equal(result.differences, 0, 'Exact mask/Alpha words differ'); comparisons.push({ tuple, id, kind, width, height, bound, ...result })
   }
   const actual = take('actual'), stock = take('stock'); assert.notDeepEqual(actual, stock)
   for (const kind of ['repeat', 'poison', 'unowned-no-color', 'remount', ...(id === ids[0] ? ['recovery-missing', 'recovery-corrupt', 'recovery-abort'] : [])]) assert.deepEqual(take(kind), actual, 'Lifecycle changed pixels: ' + tuple + '/' + id + '/' + kind)
   assert.notDeepEqual(take('unowned-color-negative'), actual); assert.deepEqual(take('disposed-stock'), stock)
   const controls = api.controls.filter(c => c.id === id), kinds = ['preparation', 'remount-installation', ...(id === ids[0] ? ['missing', 'corrupt', 'abort', 'legacy-refusal'] : [])]; assert.equal(controls.length, kinds.length); assert.deepEqual(controls.map(c => c.kind).sort(), kinds.sort())
   for (const control of controls) { if (['preparation', 'remount-installation'].includes(control.kind)) { assert.equal(control.applied, 1); assert.equal(control.skipped, 0) } else if (control.kind === 'legacy-refusal') assert.match(control.refusal, /Legacy WebGLRenderer.*BOX Image Texture/); else { assert.equal(control.materialPreserved, true); assert.match(control.refusal, control.kind === 'missing' ? /fetch failed/ : control.kind === 'corrupt' ? /mip bytes changed/ : /AbortError/) } }
   const resource = api.resources.find(r => r.id === id); assert.ok(resource); for (const key of ['textures', 'geometries','attributes','indexAttributes','storageAttributes','indirectStorageAttributes','readbackBuffers']) assert.equal(resource.memory[key], resource.baseline[key]); assert.equal(resource.bitmap.opened, resource.bitmap.closed)
   lifecycle.push({ tuple, id, pixelControlsExact: true, noSkips: true, lastGoodPreserved: true, scopedResourcesBalanced: true })
  }
 }
 assert.equal(comparisons.length, 96); assert.equal(comparisons.reduce((n, r) => n + r.words, 0), 245760)
 return { status: 'SAVED_FINAL_INSTALLED_BOX_COLOR_GATES_PASSED_NOT_ORIGINAL_MATERIAL_OR_SCENE', supportCredit: 0, materialCredit: 0, sceneCredit: 0, sourceCommit: report.sourceCommit, finalSha256: sha(finalBytes), nativeSha256: sha(nativeBytes), browserSha256: sha(reportBytes), packageSha256: report.package.sha256, runtimeFingerprint: sha(JSON.stringify(provenance.modules.map(m => [m.name, m.sourceSha256, m.emitterSha256]))), tuples: [...tuples].sort(), rawRows: 204, numericRows: comparisons.length, numericWords: 245760, violations: 0, savedFinals: 3, nativeObservations: 18, mipBytesAcrossFinals: mipBytes, lifecycle, comparisons }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
 await assertCandidateSdk({checkOnly:process.argv[2]==='--check-sdk'}); if(process.argv[2]==='--check-sdk')process.exit(0)
 const [finalDir, nativeDir, browserDir, out] = process.argv.slice(2); const result = await closeInstalled(resolve(finalDir), resolve(nativeDir), resolve(browserDir)); await writeFile(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: result.status, numericWords: result.numericWords, violations: result.violations, runtimeFingerprint: result.runtimeFingerprint }))
}
