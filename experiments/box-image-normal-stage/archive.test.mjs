import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { closeStage } from './compare.mjs'

const native = process.env.BOX_NORMAL_NATIVE, browser = process.env.BOX_NORMAL_BROWSER
const skip = native && browser ? false : 'Set BOX_NORMAL_NATIVE and BOX_NORMAL_BROWSER to immutable capture directories'

test('independent archive reader retains failed stages and exact controls without support credit', { skip }, async () => {
    const closed = await closeStage(native, browser)
    assert.equal(JSON.stringify(closed, null, 2) + '\n', await readFile(join(browser, 'closed.json'), 'utf8'))
    assert.equal(closed.supportCredit, 0)
    assert.equal(closed.installedSceneCredit, 0)
    assert.equal(closed.fullArchvizCredit, 0)
    assert.equal(closed.rows.length, 300)
    assert.equal(closed.rows.reduce((s, row) => s + row.words, 0), 307200)
    for (const kind of ['mask', 'input']) assert.equal(closed.stageTotals.find(row => row.kind === kind).violations, 0)
    const normals = closed.rows.filter(row => row.kind === 'normal')
    assert.ok(normals.filter(row => row.api === 'webgl2').every(row => row.violations === 0))
    assert.ok(normals.filter(row => row.case.startsWith('plane-')).every(row => row.violations === 0))
    assert.equal(normals.reduce((s, row) => s + row.violations, 0), 53)
    assert.equal(closed.stageTotals.find(row => row.kind === 'sampler').violations, 40989)
    const evidence = JSON.parse(await readFile(new URL('./evidence.json', import.meta.url)))
    assert.equal(evidence.invalidWeightControl.status, 'FIXTURE_FAILURE_NOT_BOX_WEIGHT_EVIDENCE')
    assert.equal(evidence.nativeActualTextureFormatObserved, false)
})

test('archive reader rejects modified raw words before numeric comparison', { skip }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'box-normal-reader-tamper-'))
    try {
        const report = JSON.parse(await readFile(join(browser, 'browser.json')))
        await copyFile(join(browser, 'browser.json'), join(directory, 'browser.json'))
        const first = report.apis[0]
        await copyFile(join(browser, first.storageCalibration.file), join(directory, first.storageCalibration.file))
        const row = first.rows[0], bytes = await readFile(join(browser, row.file))
        bytes[0] ^= 1
        await writeFile(join(directory, row.file), bytes)
        await assert.rejects(closeStage(native, directory), { code: 'ERR_ASSERTION' })
    } finally { await rm(directory, { recursive: true, force: true }) }
})
