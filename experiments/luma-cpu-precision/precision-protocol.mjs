import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { hash } from '../../scripts/lib/runtime-provenance.mjs'

const packetKeys = ['schemaVersion', 'kind', 'productionAdmission', 'ordinaryCases', 'precisionCases', 'productionExactCases',
  'experimentalKernelTrial', 'sourceCpuProfile', 'sourceCoefficients', 'sourceVersion', 'sourceBuildHash', 'sourceEngine', 'sourcePreserved', 'files']
const profileKeys = ['schemaVersion', 'mode', 'underflowWord', 'denormalInputWord', 'tieWords', 'sourcePlatform', 'sourceArchitecture']
const closed = (object, keys) => {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object))
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort())
}

/** Read-only numerical-trial protocol. A successful trial never promotes an
 * unqualified source profile or rewrites the retained native source program. */
export async function readCpuLumaQualification(directory) {
  const bytes = await readFile(join(directory, 'precision-qualification.json')), packet = JSON.parse(bytes)
  closed(packet, packetKeys)
  assert.equal(packet.schemaVersion, 1); assert.equal(packet.kind, 'blendlink-luma-cpu-precision-qualification-v1')
  assert.ok(['PRODUCTION_QUALIFIED', 'SOURCE_ADMISSION_NA'].includes(packet.productionAdmission))
  assert.ok([[4, 2, 0], [5, 2, 0], [5, 3, 0]].some(version => JSON.stringify(version) === JSON.stringify(packet.sourceVersion)))
  assert.equal(packet.ordinaryCases, packet.sourceVersion[0] === 4 ? 21 : 47)
  assert.equal(packet.sourcePreserved, true); assert.equal(typeof packet.experimentalKernelTrial, 'boolean')
  assert.match(packet.sourceBuildHash, /^[a-f0-9]{12,40}$/)
  assert.ok(['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'].includes(packet.sourceEngine))
  assert.deepEqual(packet.sourceCoefficients, [.2126, .7152, .0722].map(Math.fround))
  const profile = packet.sourceCpuProfile
  closed(profile, profileKeys); assert.equal(profile.schemaVersion, 1)
  assert.deepEqual(profile.tieWords, [0x3f800000, 0x3f800002])
  assert.ok(profile.mode === 'gradual-rne' && profile.underflowWord === 0x400000 && profile.denormalInputWord === 0x800000
    || profile.mode === 'ftz-daz-rne' && profile.underflowWord === 0 && profile.denormalInputWord === 0)
  for (const name of ['sourcePlatform', 'sourceArchitecture']) assert.match(profile[name], /^[a-zA-Z0-9_.-]{1,64}$/)
  if (packet.productionAdmission === 'PRODUCTION_QUALIFIED') {
    assert.equal(profile.sourcePlatform, 'darwin'); assert.equal(profile.sourceArchitecture, 'arm64')
    assert.equal(profile.mode, packet.sourceVersion[0] === 5 && packet.sourceVersion[1] === 3 ? 'ftz-daz-rne' : 'gradual-rne')
    assert.equal(packet.precisionCases, 32); assert.equal(packet.productionExactCases, 32)
  } else {
    assert.equal(packet.productionExactCases, 0)
    assert.equal(packet.precisionCases, packet.experimentalKernelTrial ? 32 : 0)
  }
  assert.equal(packet.files.length, packet.precisionCases)
  const files = [], seen = new Set()
  for (const row of packet.files) {
    closed(row, ['case', 'file', 'sha256']); assert.match(row.case, /^[a-z0-9_.-]{1,256}$/i)
    assert.equal(basename(row.file), row.file); assert.equal(row.file, row.case + '.json')
    assert.ok(!seen.has(row.case)); seen.add(row.case); assert.match(row.sha256, /^[a-f0-9]{64}$/)
    const bytes = await readFile(join(directory, row.file)); assert.equal(hash(bytes), row.sha256)
    const record = JSON.parse(bytes); assert.equal(record.case, row.case); assert.equal(record.compositorDevice, 'CPU'); assert.equal(record.blenderHash, packet.sourceBuildHash)
    assert.equal(record.width, 13); assert.equal(record.height, 7)
    for (const name of ['input', 'expected']) {
      assert.equal(record[name].length, 13 * 7 * 4); assert.ok(record[name].every(Number.isFinite))
    }
    const keys = record.program.ops.filter(op => op.kind === 'luminance-key'); assert.equal(keys.length, 1)
    const output = record.program.output.kind === 'convert' ? record.program.output.input : record.program.output
    assert.equal(output.node, keys[0].id)
    assert.equal(keys[0].properties.luminance_key_model, packet.productionAdmission === 'PRODUCTION_QUALIFIED'
      ? 'native-luminance-key-cpu-rne-v1' : 'native-luminance-key-v1')
    if (packet.productionAdmission === 'PRODUCTION_QUALIFIED') assert.deepEqual(keys[0].properties.luminance_key_cpu_profile, profile)
    else assert.equal(keys[0].properties.luminance_key_precision, 'legacy-unqualified-cpu-v1')
    files.push({ ...row, bytes })
  }
  return { packet, packetSha256: hash(bytes), files }
}
