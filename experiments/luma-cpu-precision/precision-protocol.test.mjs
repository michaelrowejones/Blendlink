import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { hash } from '../../scripts/lib/runtime-provenance.mjs'
import { readCpuLumaQualification, verifyProductionLumaBrowser } from './precision-protocol.mjs'
import { lumaBrowserLaunchOptions, requireLumaBrowserApis } from './browser-profile.mjs'

function packet(qualified = true, experiment = false) {
  return { schemaVersion: 1, kind: 'blendlink-luma-cpu-precision-qualification-v1',
    productionAdmission: qualified ? 'PRODUCTION_QUALIFIED' : 'SOURCE_ADMISSION_NA', ordinaryCases: 47,
    precisionCases: qualified || experiment ? 32 : 0, productionExactCases: qualified ? 32 : 0,
    experimentalKernelTrial: experiment, sourceCoefficients: [.2126, .7152, .0722].map(Math.fround),
    sourceVersion: [5, 2, 0], sourceBuildHash: 'fbe6228777e7', sourceEngine: 'BLENDER_EEVEE', sourcePreserved: true,
    sourceCpuProfile: { schemaVersion: 1, mode: 'gradual-rne', underflowWord: 0x400000, denormalInputWord: 0x800000,
      tieWords: [0x3f800000, 0x3f800002], sourcePlatform: qualified ? 'darwin' : 'win32', sourceArchitecture: qualified ? 'arm64' : 'AMD64' }, files: [] }
}

async function fixture(body) {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-luma-protocol-'))
  const write = async value => {
    value.files = []
    for (let number = 0; number < value.precisionCases; number++) {
      const name = 'luma-precision-' + number, file = name + '.json', qualified = value.productionAdmission === 'PRODUCTION_QUALIFIED'
      const record = { case: name, compositorDevice: 'CPU', blenderHash: value.sourceBuildHash, width: 13, height: 7,
        requireFloat32Bits: qualified, input: Array(364).fill(0), expected: Array(364).fill(0), program: { output: { node: 'key' }, ops: [{ id: 'key', kind: 'luminance-key',
          properties: { luminance_key_model: qualified ? 'native-luminance-key-cpu-rne-v1' : 'native-luminance-key-v1',
            luminance_key_precision: qualified ? 'native-cpu-rne-v1' : 'legacy-unqualified-cpu-v1', luminance_key_cpu_profile: value.sourceCpuProfile,
            luminance_key_source_version: value.sourceVersion, luminance_key_coefficients: value.sourceCoefficients,
            evaluation_device:'CPU',single_value_device:'CPU',
            ...(value.sourceCpuProfile.sourcePlatform==='linux'?{luminance_key_source_build:value.sourceBuildHash}:{}) } }] } }
      const bytes = JSON.stringify(record); await writeFile(join(directory, file), bytes); value.files.push({ case: name, file, sha256: hash(bytes) })
    }
    await writeFile(join(directory, 'precision-qualification.json'), JSON.stringify(value))
  }
  try { await body({ directory, write }) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('qualified source packets keep all 32 actual precision files and native profile hashes', async () => {
  await fixture(async ({ directory, write }) => {
    await write(packet()); const result = await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionExactCases, 32); assert.equal(result.files.length, 32)
    assert.equal(result.packetSha256.length, 64)
  })
})

test('N/A is separate from numerical qualification; an explicit trial never promotes v1 IR', async () => {
  await fixture(async ({ directory, write }) => {
    await write(packet(false)); let result = await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionAdmission, 'SOURCE_ADMISSION_NA'); assert.equal(result.files.length, 0)
    await write(packet(false, true)); result = await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionExactCases, 0); assert.equal(result.files.length, 32)
    assert.ok(result.files.every(file => JSON.parse(file.bytes).program.ops[0].properties.luminance_key_model === 'native-luminance-key-v1'))
  })
})

test('forged admission, future metadata, missing rows, unsafe paths and changed native pixels refuse', async () => {
  for (const mutate of [
    value => { value.productionAdmission = 'future' }, value => { value.future = true },
    value => { value.sourceVersion = [5, 3, 0] }, value => { value.sourceCpuProfile.underflowWord = 0 }, value => { value.sourceCpuProfile.sourcePlatform = 'win32' },
    value => { value.productionExactCases = 0 }, value => { value.files.pop() },
    value => { value.files[0].file = '../native.json' }, value => { value.files[0].sha256 = '0'.repeat(64) },
    value => { value.files[1] = value.files[0] },
  ]) await fixture(async ({ directory, write }) => {
    const value = packet(); await write(value); mutate(value)
    await writeFile(join(directory, 'precision-qualification.json'), JSON.stringify(value))
    await assert.rejects(readCpuLumaQualification(directory))
  })
})

test('an experimental native v1 program cannot masquerade as a production exact program', async () => {
  await fixture(async ({ directory, write }) => {
    const value = packet(false, true); await write(value)
    const file = value.files[0], record = JSON.parse(await readFile(join(directory, file.file)))
    record.program.ops[0].properties.luminance_key_model = 'native-luminance-key-cpu-rne-v1'
    const bytes = JSON.stringify(record); await writeFile(join(directory, file.file), bytes); file.sha256 = hash(bytes)
    await writeFile(join(directory, 'precision-qualification.json'), JSON.stringify(value))
    await assert.rejects(readCpuLumaQualification(directory))
  })
})

test('hosted trials retain all three source profiles and verify cached native archives unconditionally', async () => {
  // Git's Windows checkout can use CRLF; checksum placement is independent
  // of that text representation. Keep the structural assertions unchanged.
  const source = await readFile(new URL('../../.github/workflows/luma-cpu-precision.yml', import.meta.url), 'utf8')
  const workflow = source.replace(/\r\n/g, '\n')
  for (const profile of ['linux-5.2', 'windows-4.2', 'windows-5.2']) assert.ok(workflow.includes('profile: ' + profile))
  assert.ok(workflow.includes('actions/cache@caa296126883cff596d87d8935842f9db880ef25'))
  assert.match(workflow, /fi\n\s+# Always verify[^\n]*\n\s+echo[^\n]*sha256sum --check --strict/)
  assert.match(workflow, /}\n\s+# Always verify[^\n]*\n\s+\$actual = \(Get-FileHash/)
  assert.ok(workflow.includes('BLENDLINK_LUMA_CPU_ORACLE_ENGINE: CYCLES'))
  assert.match(workflow,/profile: linux-5\.2\n\s+expected_admission: PRODUCTION_QUALIFIED/)
  for(const version of ['4.2','5.2'])assert.ok(workflow.includes('profile: windows-'+version+'\n            expected_admission: SOURCE_ADMISSION_NA'))
  assert.ok(workflow.includes('BLENDLINK_LUMA_EXPECTED_SOURCE_ADMISSION: ${{ matrix.expected_admission }}'))
  const driver=await readFile(new URL('./qualify-host.mjs',import.meta.url),'utf8')
  assert.ok(driver.includes('assert.equal(base.packet.productionAdmission,expectedAdmission'))
  assert.ok(driver.indexOf("await run('ordinary-browser'")<driver.indexOf('report.productionAdmissionCases=verifyProductionLumaBrowser('))
  assert.ok(driver.indexOf("await native('ratio-native'") < driver.indexOf("await run('browser-profile'"))
  assert.ok(driver.indexOf("await run('browser-profile'") < driver.indexOf("await run('ordinary-browser'"))
  assert.match(workflow, /BLENDLINK_TEST_CHROMIUM_CHANNEL: chromium\n\s+BLENDLINK_TEST_CHROMIUM_ARGS: '\["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"\]'\n\s+DEBUG: pw:browser/)

  assert.equal(workflow.match(/node experiments\/luma-cpu-precision\/qualify-host.mjs/g)?.length, 2)
  assert.ok(workflow.includes('if: always()')); assert.ok(workflow.includes('artifacts/verification-luma-cpu-host'))
  assert.ok(!workflow.includes('continue-on-error')); assert.ok(!workflow.includes('disable-gpu-watchdog'))
})

test('browser availability uses the real requested APIs and cannot turn missing WebGPU into a pass', () => {
  const args = ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader']
  assert.deepEqual(lumaBrowserLaunchOptions({ BLENDLINK_TEST_CHROMIUM_CHANNEL: 'chromium',
    BLENDLINK_TEST_CHROMIUM_ARGS: JSON.stringify(args) }), {
    headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', ...args],
  })
  for (const env of [{ BLENDLINK_TEST_CHROMIUM_CHANNEL: 'chrome' }, { BLENDLINK_TEST_CHROMIUM_ARGS: '[false]' },
    { BLENDLINK_TEST_CHROMIUM_ARGS: '{}' }]) assert.throws(() => lumaBrowserLaunchOptions(env))
  const profile = { webgl2: { available: true }, webgpu: { adapterAvailable: true, deviceAvailable: true } }
  requireLumaBrowserApis(profile)
  for (const candidate of [{ ...profile, webgl2: { available: false } }, { ...profile, webgpu: { adapterAvailable: false } },
    { ...profile, webgpu: { adapterAvailable: true, deviceAvailable: false } }]) assert.throws(() => requireLumaBrowserApis(candidate))
})

test('coverage separates measured CPU precision from legacy compatibility and private kernel exports', async () => {
  const capabilities = JSON.parse(await readFile(new URL('../../docs/node-capabilities.json', import.meta.url)))
  const entry = capabilities.entries['compositor:CompositorNodeLumaMatte']
  assert.ok(entry, 'Luma capability must remain explicit')
  assert.equal(entry.category, 'partial'); assert.equal(entry.verification.nativeScenes, 358)
  assert.equal(entry.verification.physicalAndSoftwareReadbacks, 1432)
  assert.equal(entry.verification.experimentalKernelProductionAdmissionCases, 0)
  assert.ok(entry.limits.includes('legacy-unqualified-cpu-v1')); assert.ok(entry.limits.includes('SOURCE_ADMISSION_NA'))
  assert.ok(entry.limits.includes('qualification remains pending')); assert.ok(entry.limits.includes('darwin/arm64'))
  const candidate=entry.verification.linux52ProductionCandidate
  assert.equal(candidate.status,'pending-fresh-production-receipt')
  assert.equal(candidate.sourcePlatform,'linux');assert.equal(candidate.sourceArchitecture,'x86_64')
  assert.deepEqual(candidate.sourceVersion,[5,2,0]);assert.equal(candidate.sourceBuildHash,'fbe6228777e7')
  assert.equal(candidate.basisReceipt.productionAdmission,'SOURCE_ADMISSION_NA');assert.equal(candidate.basisReceipt.productionExactCases,0)

  const manifest = JSON.parse(await readFile(new URL('../../packages/blendlink/package.json', import.meta.url)))
  assert.ok(Object.values(manifest.exports).every(entry => !/tslCompositorCpuLuminance|tslCompositorLumaGradual/.test(entry.default)))
})

function linuxPacket(qualified=true,experiment=false){
  const value=packet(qualified,experiment)
  Object.assign(value.sourceCpuProfile,{sourcePlatform:'linux',sourceArchitecture:'x86_64'})
  return value
}

test('only the exact Linux52 production candidate is admitted, separately from retained N/A trial receipts',async()=>{
  await fixture(async({directory,write})=>{
    await write(linuxPacket());let result=await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionExactCases,32)
    await write(linuxPacket(false));result=await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionAdmission,'SOURCE_ADMISSION_NA');assert.equal(result.files.length,0)
    await write(linuxPacket(false,true));result=await readCpuLumaQualification(directory)
    assert.equal(result.packet.productionExactCases,0);assert.equal(result.files.length,32)
  })
  for(const mutate of [
    value=>{value.sourceBuildHash='000000000000'},
    value=>{value.sourceVersion=[4,2,0];value.ordinaryCases=21},
    value=>{value.sourceVersion=[5,3,0];Object.assign(value.sourceCpuProfile,{mode:'ftz-daz-rne',underflowWord:0,denormalInputWord:0})},
    value=>{value.sourceCpuProfile.sourceArchitecture='aarch64'},
    value=>{value.sourceCpuProfile.sourceArchitecture='AMD64'},
    value=>{Object.assign(value.sourceCpuProfile,{mode:'ftz-daz-rne',underflowWord:0,denormalInputWord:0})},
  ])await fixture(async({directory,write})=>{
    const value=linuxPacket();mutate(value);await write(value);await assert.rejects(readCpuLumaQualification(directory))
  })
})

test('a Linux qualification packet cannot relabel old or differently built per-file production IR',async()=>{
  for(const mutate of [
    record=>{delete record.program.ops[0].properties.luminance_key_source_build},
    record=>{record.program.ops[0].properties.luminance_key_source_build='000000000000'},
    record=>{record.program.ops[0].properties.luminance_key_source_version=[5,3,0]},
    record=>{record.program.ops[0].properties.luminance_key_coefficients=[.3,.6,.1]},
    record=>{record.program.ops[0].properties.luminance_key_model='native-luminance-key-v1'},
    record=>{record.requireFloat32Bits=false},
    record=>{record.program.ops[0].properties.evaluation_device='GPU'},
  ])await fixture(async({directory,write})=>{
    const value=linuxPacket();await write(value)
    const file=value.files[0],record=JSON.parse(await readFile(join(directory,file.file)))
    mutate(record);const bytes=JSON.stringify(record);await writeFile(join(directory,file.file),bytes);file.sha256=hash(bytes)
    await writeFile(join(directory,'precision-qualification.json'),JSON.stringify(value))
    await assert.rejects(readCpuLumaQualification(directory))
  })
})

function productionResults(value){
  return ['webgpu','webgl2'].map(backend=>({backend,pageErrors:[],consoleErrors:[],rows:[
    ...Array.from({length:value.ordinaryCases},(_,index)=>({case:'ordinary-'+index,max:0,calibration:0,shaderErrors:[]})),
    ...value.files.map(file=>({case:file.case,max:0,calibration:0,bitMismatches:0,shaderErrors:[]})),
  ]}))
}

test('production qualification requires both real production browser rows and bit-exact precision outputs',async()=>{
  await fixture(async({directory,write})=>{
    await write(linuxPacket());const {packet:value}=await readCpuLumaQualification(directory)
    assert.equal(verifyProductionLumaBrowser(productionResults(value),value),32)
    for(const mutate of [
      rows=>{rows.pop()},rows=>{rows[1].backend='webgpu'},
      rows=>{rows[0].rows.pop()},rows=>{rows[0].rows.at(-1).max=1e-30},
      rows=>{delete rows[0].rows.at(-1).bitMismatches},rows=>{rows[0].rows.at(-1).bitMismatches=1},
      rows=>{rows[0].rows.at(-1).case='missing-source-case'},rows=>{rows[0].rows[0].calibration=1e-30},
      rows=>{rows[0].pageErrors=['bad pipeline']},
    ]){const rows=productionResults(value);mutate(rows);assert.throws(()=>verifyProductionLumaBrowser(rows,value))}
    assert.throws(()=>verifyProductionLumaBrowser(productionResults(value),{...value,productionAdmission:'SOURCE_ADMISSION_NA'}))
  })
})
