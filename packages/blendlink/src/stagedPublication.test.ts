import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createStagedPublication,
  materialProgramsImageReferences,
} from './stagedPublication.js'

/**
 * Every behaviour here was previously unreachable: it sat inside
 * exportBlend behind a Blender subprocess, and all six sync integration
 * tests mock exportBlend wholesale. The material-programs rewrite — the
 * only in-place rewrite of a published artifact in the compiler — shipped
 * broken because of it.
 */
describe('staged export publication', () => {
  let work: string
  let tempGlb: string
  let outPath: string

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'blendlink-staged-'))
    mkdirSync(join(work, 'out'), { recursive: true })
    tempGlb = join(work, 'out.glb')
    outPath = join(work, 'out', 'HeroScene.glb')
    writeFileSync(tempGlb, 'glb')
  })
  afterEach(() => rmSync(work, { recursive: true, force: true }))

  function sidecarWith(imageFile: string, extra = '') {
    // Canonical Python-writer form: sorted keys, compact separators.
    return `{"images":{"dirt":{"bytes":3,"file":"${imageFile}"${extra}}},"model":"blendlink-material-programs-v1"}`
  }

  it('moves a declared sidecar onto the published name family', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const staged = `${tempGlb}.state.lit.main.png`
    writeFileSync(staged, 'png')
    const published = publication.relocate(staged)
    expect(basename(published)).toBe('HeroScene.lit.main.png')
    expect(readFileSync(published, 'utf8')).toBe('png')
  })

  it('refuses a path outside the Blender-owned output set', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const stranger = join(work, 'not-ours.png')
    writeFileSync(stranger, 'png')
    expect(() => publication.relocate(stranger)).toThrow(/outside the owned Blender output set/)
  })

  it('refuses a declared sidecar that disappeared', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    expect(() => publication.relocate(`${tempGlb}.gone.png`))
      .toThrow(/disappeared before publication/)
  })

  it('rewrites sidecar image basenames and re-pins the document', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const stagedImage = `${tempGlb}.tex.dirt-5092c84f.png`
    writeFileSync(stagedImage, 'imagebytes')
    const stagedSidecar = `${tempGlb}.materials.json`
    writeFileSync(stagedSidecar, sidecarWith(basename(stagedImage)))

    const result = publication.publishMaterialPrograms({
      path: stagedSidecar,
      texturePaths: [stagedImage],
      bytes: 0,
      hash: 'stale',
    })

    // The image must resolve by basename BESIDE the sidecar, which is
    // exactly how the runtime resolves it.
    const published = readFileSync(result.path, 'utf8')
    const [reference] = materialProgramsImageReferences(published)
    expect(reference).toBe('HeroScene.tex.dirt-5092c84f.png')
    expect(existsSync(join(work, 'out', reference))).toBe(true)

    // Re-pinned: a stale pin is what the runtime refuses on.
    expect(result.bytes).toBe(Buffer.byteLength(published))
    expect(result.hash).toBe(
      createHash('sha256').update(Buffer.from(published)).digest('hex').slice(0, 16),
    )
    expect(result.texturePaths?.map((path) => basename(path)))
      .toEqual(['HeroScene.tex.dirt-5092c84f.png'])
  })

  it('preserves every other byte of the Python writer canonical form', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const stagedImage = `${tempGlb}.tex.dirt.png`
    writeFileSync(stagedImage, 'i')
    const stagedSidecar = `${tempGlb}.materials.json`
    // 1.0 must not become 1, and é must not become a literal.
    const body = `{"images":{"dirt":{"file":"${basename(stagedImage)}"}},"ir":{"v":1.0,"n":"caf\\u00e9"}}`
    writeFileSync(stagedSidecar, body)

    const result = publication.publishMaterialPrograms({
      path: stagedSidecar, texturePaths: [stagedImage], bytes: 0, hash: '',
    })
    const published = readFileSync(result.path, 'utf8')
    expect(published).toContain('"v":1.0')
    expect(published).toContain('caf\\u00e9')
    expect(published).toBe(body.replace(basename(stagedImage), 'HeroScene.tex.dirt.png'))
  })

  it('refuses when a staged reference is missing or duplicated', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const stagedImage = `${tempGlb}.tex.dirt.png`
    writeFileSync(stagedImage, 'i')
    const stagedSidecar = `${tempGlb}.materials.json`
    writeFileSync(stagedSidecar, '{"images":{"dirt":{"file":"unrelated.png"}}}')
    expect(() => publication.publishMaterialPrograms({
      path: stagedSidecar, texturePaths: [stagedImage], bytes: 0, hash: '',
    })).toThrow(/references .* 0 times/)
  })

  it('publishes a sidecar that carries no texture references', () => {
    const publication = createStagedPublication({ tempGlb, outPath })
    const stagedSidecar = `${tempGlb}.materials.json`
    writeFileSync(stagedSidecar, '{"materials":{}}')
    const result = publication.publishMaterialPrograms({
      path: stagedSidecar, bytes: 0, hash: '',
    })
    expect(basename(result.path)).toBe('HeroScene.materials.json')
    expect(result.bytes).toBe(16)
  })

  it('reads image references without matching embedded IR content', () => {
    // A quote inside a JSON string value is escaped, so the reader cannot
    // be fooled by IR text that happens to contain the token.
    const sidecar = '{"ir":{"src":"not a \\"file\\":\\"decoy.png\\" here"},'
      + '"images":{"a":{"file":"real.png"}}}'
    expect(materialProgramsImageReferences(sidecar)).toEqual(['real.png'])
  })
})
