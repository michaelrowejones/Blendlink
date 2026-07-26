import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import {
  ENVIRONMENT_FIDELITY_LIMITS,
  compressEnvironmentKtx2,
  radianceFidelityFailures,
  type EnvironmentRadianceFidelity,
} from './environmentCompression.js'
import { generateSceneModule } from './typegen.js'

const faithful: EnvironmentRadianceFidelity = {
  width: 1024,
  height: 512,
  relativeRmse: 0.008,
  meanRelativeError: 0.006,
  peakRelativeError: 0.012,
  maxErrorOverPeak: 0.016,
  logLuminanceRmseStops: 0.025,
  sourcePeak: 42,
  decodedPeak: 41.5,
  sourceMin: 0,
  negativeChannels: 0,
  invalidPixels: 0,
}

const integration = process.env.BLENDLINK_BLENDER_PATH &&
  process.env.BLENDLINK_KTX_PATH &&
  process.env.BLENDLINK_HDR_TEST_IMAGE
  ? it
  : it.skip

describe('HDR environment radiance fidelity', () => {
  it('accepts small scale-independent packed-float error', () => {
    expect(radianceFidelityFailures(faithful)).toEqual([])
  })

  it('refuses clipped highlights and signed/non-finite sources', () => {
    const failures = radianceFidelityFailures({
      ...faithful,
      peakRelativeError: ENVIRONMENT_FIDELITY_LIMITS.peakRelativeError + 0.001,
      negativeChannels: 4,
      invalidPixels: 1,
    })
    expect(failures.join('\n')).toMatch(/negative channels/)
    expect(failures.join('\n')).toMatch(/non-finite/)
    expect(failures.join('\n')).toMatch(/peak relative error/)
  })

  it('refuses a darkened environment even when its brightest texel survives', () => {
    const failures = radianceFidelityFailures({
      ...faithful,
      relativeRmse: 0.2,
      meanRelativeError: 0.2,
      logLuminanceRmseStops: 0.4,
    })
    expect(failures).toHaveLength(3)
  })

  it('keeps the source mandatory and cache-busts the optional derivative in generated code', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-environment-typegen-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      const document = new Document()
      document.createScene('Scene')
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const generated = await generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        environment: {
          url: '/studio.exr', sourceName: 'Studio', format: 'exr', bytes: 4000,
          hash: 'rawhash', source: 'packed',
          optimized: {
            url: '/studio.ktx2', format: 'ktx2', codec: 'r11g11b10-zstd',
            bytes: 1000, hash: 'gpuhash', encoder: 'KTX-Software',
            encoderVersion: 'ktx 4.4.2', minThreeRevision: 180, fidelity: faithful,
          },
        },
      })
      expect(generated.manifest.environment).toMatchObject({
        url: '/studio.exr', optimized: { url: '/studio.ktx2' },
      })
      expect(generated.manifest.stats).toMatchObject({
        environmentBytes: 4000, optimizedEnvironmentBytes: 1000,
      })
      expect(generated.module).toContain('/studio.exr?v=rawhash')
      expect(generated.module).toContain('/studio.ktx2?v=gpuhash')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  integration('round-trips a real HDR/EXR through the installed stable tools', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-environment-integration-'))
    const sourcePath = process.env.BLENDLINK_HDR_TEST_IMAGE!
    const sourceBefore = readFileSync(sourcePath)
    try {
      const outputPath = join(directory, 'environment.ktx2')
      const result = await compressEnvironmentKtx2(sourcePath, outputPath, {
        blenderExecutable: process.env.BLENDLINK_BLENDER_PATH!,
        ktxExecutable: process.env.BLENDLINK_KTX_PATH!,
      })
      expect(result.warnings).toEqual([])
      expect(result.asset).not.toBeNull()
      expect(result.asset?.fidelity).toMatchObject({
        width: expect.any(Number),
        height: expect.any(Number),
        invalidPixels: 0,
        negativeChannels: 0,
      })
      expect(existsSync(outputPath)).toBe(true)
      expect(readFileSync(outputPath).byteLength).toBe(result.asset?.bytes)
      expect(readFileSync(sourcePath)).toEqual(sourceBefore)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
