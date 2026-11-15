import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
import { compare } from '../box-image-transport-prototype/compare.mjs'

const sha = b => createHash('sha256').update(b).digest('hex')
export async function closeStage(nativeDir, browserDir) {
    const root = resolve(import.meta.dirname, '../..'), n = JSON.parse(await readFile(join(nativeDir, 'native.json'))), b = JSON.parse(await readFile(join(browserDir, 'browser.json'))), contract = JSON.parse(await readFile(join(nativeDir, 'contract.json'))), inputs = JSON.parse(await readFile(join(nativeDir, 'geometry-inputs.json')))
    assert.equal(n.status, 'CAPTURED_BOX_STORAGE_STAGE_RESEARCH')
    assert.equal(b.status, 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH')
    assert.equal(b.nativeSha256, sha(await readFile(join(nativeDir, 'native.json'))))
    assert.equal(n.contractSha256, sha(await readFile(join(nativeDir, 'contract.json')))); assert.equal(n.geometryInputsSha256, sha(await readFile(join(nativeDir, 'geometry-inputs.json'))))
    assert.equal(n.sourceSha256, sha(await readFile(n.source)))
    assert.equal(n.captureSha256, sha(await readFile(join(import.meta.dirname, 'capture.py')))); assert.equal(n.fixtureSha256, sha(await readFile(join(import.meta.dirname, 'geometry_fixture.py'))))
    assert.equal(n.oracleSha256, sha(await readFile(join(root, 'experiments/native-f32-oracle-research/framebuffer_oracle.py'))))
    for (const [path, expected] of Object.entries(n.nativeSamplerSourcePins)) assert.equal(sha(await readFile(path)), expected)
    for (const [path, expected] of Object.entries(b.pins)) assert.equal(sha(await readFile(path)), expected)
    for (const image of n.images) assert.equal(image.sha256, sha(await readFile(join(nativeDir, image.file))))
    await validateNativeArchive(JSON.parse(await readFile(join(nativeDir, 'native-archive.json'))), nativeDir, { expectedFinalSources: [], expectedScripts: [{ path: join(import.meta.dirname, 'capture.py'), invocations: 1 }], helperInputs: { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') } })
    assert.equal(n.actualEeveeRenders, inputs.cases.length * (contract.profiles.length * 5 + 1 + n.images.length * contract.frequencies.length))
    const rows = []
    for (const api of b.apis) {
        assert.equal(api.status, 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH'); assert.deepEqual(api.pageErrors, []); assert.deepEqual(api.httpErrors, []); assert.deepEqual(api.errors, [])
        const calibration = await readFile(join(browserDir, api.storageCalibration.file)); assert.equal(sha(calibration), api.storageCalibration.sha256)
        const expected = [.125, .375, .625, 1]
        for (let offset = 0; offset < calibration.length; offset += 4) assert.equal(calibration.readFloatLE(offset), expected[(offset / 4) % 4])
        for (const nr of [...n.rows, ...n.inputControls.map(row => ({ ...row, kind: 'input', profile: n.sourceSettings.normalStorage }))]) {
            if (nr.kind === 'input') { assert.equal(nr.binaryCoverage, true); assert.equal(nr.wordDifferences, 0) }
            const policies = nr.kind === 'sampler' ? contract.policies : [null]
            for (const policy of policies) {
                const br = api.rows.find(row => row.id === nr.id + (policy ? '-' + policy : '')); assert.ok(br, nr.id)
                const actual = await readFile(join(browserDir, br.file)), native = await readFile(join(nativeDir, nr.file))
                assert.equal(sha(actual), br.sha256); assert.equal(sha(native), nr.sha256)
                rows.push({ api: api.backend, id: br.id, kind: nr.kind, profile: nr.profile, case: nr.case, image: nr.image, frequency: nr.frequency, policy,
                    ...compare(actual, native, nr.kind === 'input' || nr.kind === 'mask' ? 0 : contract.gates.samplerDiagnosticMaxAbs) })
            }
        }
    }
    const lodRows=[]
    for(const api of b.apis) for(const nr of n.lodRows){
        const br=api.lodRows.find(row=>row.id===nr.id);assert.ok(br,nr.id)
        const native=await readFile(join(nativeDir,nr.file)),actual=await readFile(join(browserDir,br.file))
        assert.equal(sha(native),nr.sha256);assert.equal(sha(actual),br.sha256)
        lodRows.push({api:api.backend,...nr,...compare(actual,native,contract.gates.samplerDiagnosticMaxAbs)})
    }
    return { lodRows, status: 'BOX_GEOMETRY_STAGE_RESEARCH_ZERO_SUPPORT_CREDIT', supportCredit: 0, installedSceneCredit: 0, fullArchvizCredit: 0, nativeSha256: b.nativeSha256, browserSha256: sha(await readFile(join(browserDir, 'browser.json'))), rows,
        stageTotals: ['mask', 'input', 'normal', 'weights', 'face', 'position', 'sampler'].map(kind => { const selected = rows.filter(row => row.kind === kind); return { kind, words: selected.reduce((s, row) => s + row.words, 0), violations: selected.reduce((s, row) => s + row.violations, 0), maxAbs: Math.max(...selected.map(row => row.maxAbs)) } }) }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    const result = await closeStage(resolve(process.argv[2]), resolve(process.argv[3])); await writeFile(resolve(process.argv[4]), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result.stageTotals))
}
