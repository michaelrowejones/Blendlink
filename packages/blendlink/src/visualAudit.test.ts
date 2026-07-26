import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runVisualReferenceAudit } from './visualAudit.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'blendlink-visual-audit-'))
  roots.push(root)
  const reference = await sharp({
    create: { width: 4, height: 2, channels: 4, background: { r: 200, g: 20, b: 10, alpha: 1 } },
  }).png().toBuffer()
  const referencePath = join(root, 'blender', 'hero.png')
  mkdirSync(join(root, 'blender'))
  await sharp(reference).toFile(referencePath)
  const manifest = {
    schemaVersion: 1,
    kind: 'blendlink-visual-reference-matrix',
    sourceBlend: 'hero.blend',
    references: [{ id: 'hero', blender: { status: 'captured', path: 'blender/hero.png', bytes: reference.length } }],
    comparisons: [{
      id: 'hero--preview', referenceId: 'hero', quality: 'preview',
      buildCommand: 'npx blendlink compile --preview',
      browser: {
        status: 'required', path: 'browser/preview/hero.png',
        viewport: { width: 4, height: 2, devicePixelRatio: 1 },
        cameraObjectId: 'camera-id', lightingState: 'default', frame: 1, timeSeconds: 0,
      },
      comparison: { status: 'pending', path: 'diff/preview/hero.png' },
    }],
  }
  const manifestPath = join(root, 'comparison-manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  return { root, reference, manifestPath }
}

describe('visual reference audit', () => {
  it('captures the real website through a callback and writes measured pixel evidence', async () => {
    const { root, reference, manifestPath } = await fixture()
    const prepareQuality = vi.fn(async () => {})
    const captureBrowser = vi.fn(async ({ comparison }) => {
      expect(comparison.browser.cameraObjectId).toBe('camera-id')
      expect(comparison.browser.viewport).toEqual({ width: 4, height: 2, devicePixelRatio: 1 })
      return reference
    })
    const report = await runVisualReferenceAudit(manifestPath, { prepareQuality, captureBrowser })
    expect(report).toMatchObject({ captured: 1, compared: 1 })
    expect(prepareQuality).toHaveBeenCalledWith('preview', 'npx blendlink compile --preview')
    expect(report.comparisons[0]!.comparison).toMatchObject({
      status: 'compared', metrics: {
        width: 4, height: 2, comparisonSpace: 'premultiplied-rgba',
        meanAbsoluteError: 0, changedPixelRatio: 0,
      },
    })
    expect(readFileSync(join(root, 'browser/preview/hero.png'))).toEqual(reference)
    expect((await sharp(join(root, 'diff/preview/hero.png')).metadata()).width).toBe(4)
    const persisted = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(persisted.comparisons[0].browser).toMatchObject({ status: 'captured', bytes: reference.length })
  })

  it('uses only explicit project acceptance and rejects unscaled browser captures loudly', async () => {
    const first = await fixture()
    const changed = await sharp({
      create: { width: 4, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer()
    const report = await runVisualReferenceAudit(first.manifestPath, {
      captureBrowser: async () => changed,
      acceptance: { maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, pixelThreshold: 0 },
    })
    expect(report).toMatchObject({ captured: 1, compared: 1, accepted: 0, rejected: 1 })
    expect(report.comparisons[0]!.comparison.status).toBe('failed')

    const second = await fixture()
    const wrongSize = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer()
    await expect(runVisualReferenceAudit(second.manifestPath, {
      captureBrowser: async ({ comparison }) => {
        comparison.browser.viewport.width = 2
        return wrongSize
      },
    })).rejects.toThrow(/unscaled 4x2 PNG/)
    const persisted = JSON.parse(readFileSync(second.manifestPath, 'utf8'))
    expect(persisted.comparisons[0].browser).toMatchObject({
      status: 'failed', error: expect.stringMatching(/unscaled 4x2 PNG/),
    })
    expect(persisted.comparisons[0].comparison).toMatchObject({ status: 'failed' })

    const third = await fixture()
    await expect(runVisualReferenceAudit(third.manifestPath, {
      captureBrowser: async () => changed,
      acceptance: { pixelThreshold: 2 / 255 },
    })).rejects.toThrow(/at least one maximum error threshold/)

    const fourth = await fixture()
    const transparent = await sharp({
      create: { width: 4, height: 2, channels: 4, background: { r: 200, g: 20, b: 10, alpha: 0 } },
    }).png().toBuffer()
    const alphaReport = await runVisualReferenceAudit(fourth.manifestPath, {
      captureBrowser: async () => transparent,
      acceptance: { maxMeanAbsoluteError: 0, maxChangedPixelRatio: 0, pixelThreshold: 0 },
    })
    expect(alphaReport).toMatchObject({ accepted: 0, rejected: 1 })
    expect(alphaReport.comparisons[0]!.comparison.metrics).toMatchObject({
      comparisonSpace: 'premultiplied-rgba', maxChannelError: 1, changedPixelRatio: 1,
    })
  })
})
