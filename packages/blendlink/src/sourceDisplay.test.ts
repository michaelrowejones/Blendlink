import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { loadSourcePresentation } from './sourceDisplay.js'

afterEach(() => vi.unstubAllGlobals())

describe('source presentation publication', () => {
  const document = { schemaVersion: 1, model: 'blendlink-source-presentation-v1', warnings: [] }
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const pointer = {
    url: '/scene.presentation.json?v=123',
    bytes: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  }
  it('accepts the exact declared bytes and requests their addressed URL', async () => {
    const fetch = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    expect(await loadSourcePresentation(pointer)).toEqual(document)
    expect(fetch).toHaveBeenCalledWith(pointer.url)
  })
  it('cancels obsolete loads before they can install a source look', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => {
      controller.abort()
      return new Response(bytes)
    })
    vi.stubGlobal('fetch', fetch)
    await expect(loadSourcePresentation(pointer, controller.signal)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(pointer.url, { signal: controller.signal })
    fetch.mockClear()
    await expect(loadSourcePresentation(pointer, controller.signal)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['truncated', 'substituted', 'version'] as const)(
    'rejects %s presentation data before installation',
    async (mode) => {
      const payload =
        mode === 'truncated'
          ? bytes.slice(0, -1)
          : mode === 'substituted'
            ? new TextEncoder().encode(JSON.stringify({ ...document, schemaVersion: 2 }))
            : new TextEncoder().encode('{}')
      vi.stubGlobal('fetch', async () => new Response(payload))
      const asset =
        mode === 'version'
          ? {
              ...pointer,
              bytes: payload.length,
              hash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
            }
          : pointer
      await expect(loadSourcePresentation(asset)).rejects.toThrow(
        mode === 'truncated' ? /byte count/ : mode === 'substituted' ? /hash/ : /version/,
      )
    },
  )
})
