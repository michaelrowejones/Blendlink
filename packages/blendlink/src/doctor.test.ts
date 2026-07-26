import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./discover.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./discover.js')>()
  return { ...actual, discoverBlender: vi.fn() }
})
vi.mock('./textureCompression.js', () => ({
  findKtxTool: () => null,
  KTX_SOFTWARE_URL: 'https://example.invalid/ktx',
}))
vi.mock('./config.js', () => ({
  loadConfig: async () => ({ scenes: [] }),
}))
vi.mock('./addon.js', () => ({
  bundledBlenderAddonFingerprint: () => 'e'.repeat(64),
  bundledBlenderAddonVersion: () => '0.8.0',
  inspectBlenderAddon: vi.fn(),
}))
vi.mock('./knownIssues.js', () => ({
  loadBlenderKnownIssueRegistry: vi.fn(() => []),
  matchingBlenderKnownIssues: vi.fn(() => []),
}))

import { doctor, supportedNodeVersion } from './doctor.js'
import {
  BlenderNotFoundError,
  BlenderUnsupportedVersionError,
  discoverBlender,
} from './discover.js'
import { inspectBlenderAddon } from './addon.js'

const mockedDiscoverBlender = vi.mocked(discoverBlender)
const mockedInspectBlenderAddon = vi.mocked(inspectBlenderAddon)

describe('doctor Node compatibility reporting', () => {
  it('matches the exact Node floor required by the built-in Zstandard reader', () => {
    expect(supportedNodeVersion('22.12.0')).toBe(false)
    expect(supportedNodeVersion('22.14.0')).toBe(false)
    expect(supportedNodeVersion('22.15.0')).toBe(true)
    expect(supportedNodeVersion('22.99.0')).toBe(true)
    expect(supportedNodeVersion('24.0.0')).toBe(true)
    expect(supportedNodeVersion('26.0.0')).toBe(false)
  })
})

describe('doctor Blender compatibility reporting', () => {
  beforeEach(() => {
    mockedDiscoverBlender.mockReset()
    mockedInspectBlenderAddon.mockReset()
  })

  it('fails an unsupported Blender instead of marking it OK or missing', async () => {
    mockedDiscoverBlender.mockRejectedValue(new BlenderUnsupportedVersionError([{
      executable: 'C:/Blender 4.1/blender.exe',
      version: 'Blender 4.1.1',
      semver: [4, 1, 1],
    }], [4, 2, 0]))

    const lines = await doctor('C:/unused')
    const blender = lines.find((line) => line.message.includes('requires Blender'))
    expect(blender?.level).toBe('fail')
    expect(blender?.message).toMatch(/4\.2\.0 or newer/)
    expect(blender?.message).toMatch(/Sync and publishing are blocked/)
    expect(lines.some((line) => (
      line.level === 'ok' && line.message.includes('Blender 4.1.1')
    ))).toBe(false)
  })

  it('keeps an absent Blender as a non-publishing warning', async () => {
    mockedDiscoverBlender.mockRejectedValue(new BlenderNotFoundError('no installation'))

    const lines = await doctor('C:/unused')
    expect(lines).toContainEqual({
      level: 'warn',
      message: expect.stringMatching(/Blender not found.*verify and typegen work without it/),
    })
  })

  it('fails a same-version addon whose installed runtime tree drifted', async () => {
    mockedDiscoverBlender.mockResolvedValue({
      executable: 'C:/Blender 5.2/blender.exe',
      version: 'Blender 5.2.0 LTS',
      semver: [5, 2, 0],
    })
    mockedInspectBlenderAddon.mockReturnValue({
      installed: true,
      enabled: true,
      version: '0.8.0',
      path: 'C:/Blender/extensions/blendlink',
      fingerprint: 'a'.repeat(64),
      catalogPath: 'C:/Blender/extensions/blendlink/component_schema.py',
      catalogSchemaVersion: 1,
      sceneEffectCount: 2,
      objectBehaviorCount: 8,
      error: null,
    })

    const lines = await doctor('C:/unused')
    expect(lines).toContainEqual({
      level: 'fail',
      message: expect.stringMatching(
        /files do not match.*installed a{16}.*expected e{16}.*2 scene effects \/ 8 object behaviors.*addon install/,
      ),
    })
  })

  it('reports verified catalog provenance for a matching addon tree', async () => {
    mockedDiscoverBlender.mockResolvedValue({
      executable: 'C:/Blender 5.2/blender.exe',
      version: 'Blender 5.2.0 LTS',
      semver: [5, 2, 0],
    })
    mockedInspectBlenderAddon.mockReturnValue({
      installed: true,
      enabled: true,
      version: '0.8.0',
      path: 'C:/Blender/extensions/blendlink',
      fingerprint: 'e'.repeat(64),
      catalogPath: 'C:/Blender/extensions/blendlink/component_schema.py',
      catalogSchemaVersion: 1,
      sceneEffectCount: 12,
      objectBehaviorCount: 10,
      error: null,
    })

    const lines = await doctor('C:/unused')
    expect(lines).toContainEqual({
      level: 'ok',
      message: expect.stringMatching(
        /installed and enabled.*12 scene effects \/ 10 object behaviors.*files e{16}/,
      ),
    })
  })
})
