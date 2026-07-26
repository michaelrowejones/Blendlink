import { describe, expect, it, vi } from 'vitest'
import {
  BlenderNotFoundError,
  BlenderUnsupportedVersionError,
  discoverBlenderFromCandidates,
  type BlenderInstall,
} from './discover.js'
import {
  isSupportedBlenderVersion,
  minimumSupportedBlenderVersion,
} from './blenderCompatibility.js'

const install = (
  executable: string,
  semver: [number, number, number],
): BlenderInstall => ({
  executable,
  semver,
  version: `Blender ${semver.join('.')}`,
})

describe('Blender compatibility discovery', () => {
  it('uses the addon manifest as the shared minimum-version contract', () => {
    expect(minimumSupportedBlenderVersion()).toEqual([4, 2, 0])
    expect(isSupportedBlenderVersion([4, 1, 9])).toBe(false)
    expect(isSupportedBlenderVersion([4, 2, 0])).toBe(true)
    expect(isSupportedBlenderVersion([5, 2, 0])).toBe(true)
  })

  it('rejects an old candidate and continues to a supported installation', async () => {
    const installs = new Map([
      ['old-blender', install('old-blender', [4, 1, 1])],
      ['current-blender', install('current-blender', [4, 2, 0])],
    ])
    const probe = vi.fn(async (candidate: string) => installs.get(candidate) ?? null)

    await expect(discoverBlenderFromCandidates(
      [
        { executable: 'old-blender', source: 'automatic' },
        { executable: 'current-blender', source: 'automatic' },
      ],
      probe,
    )).resolves.toEqual(installs.get('current-blender'))
    expect(probe.mock.calls.map(([candidate]) => candidate)).toEqual([
      'old-blender',
      'current-blender',
    ])
  })

  it.each(['blenderPath', 'BLENDLINK_BLENDER'] as const)(
    'does not ignore an unsupported %s selection',
    async (source) => {
      const old = install('artist-selected', [4, 1, 1])
      const current = install('auto-current', [5, 2, 0])
      const probe = vi.fn(async (candidate: string) => (
        candidate === 'artist-selected' ? old : current
      ))

      await expect(discoverBlenderFromCandidates([
        { executable: 'artist-selected', source },
        { executable: 'auto-current', source: 'automatic' },
      ], probe)).rejects.toBeInstanceOf(BlenderUnsupportedVersionError)
      expect(probe).toHaveBeenCalledTimes(1)
    },
  )

  it('reports found-but-unsupported Blender separately from not found', async () => {
    const old = install('C:/Blender 4.1/blender.exe', [4, 1, 1])
    const probeOld = vi.fn(async () => old)
    const error = await discoverBlenderFromCandidates([
      { executable: 'old', source: 'automatic' },
    ], probeOld).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BlenderUnsupportedVersionError)
    expect((error as Error).message).toMatch(
      /requires Blender 4\.2\.0 or newer.*4\.1\.1.*Install Blender 4\.2\+/,
    )

    await expect(discoverBlenderFromCandidates(
      [{ executable: 'missing', source: 'automatic' }],
      async () => null,
    )).rejects.toBeInstanceOf(BlenderNotFoundError)
  })
})
