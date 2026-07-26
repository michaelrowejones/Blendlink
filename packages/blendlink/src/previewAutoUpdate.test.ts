import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from './config.js'
import {
  PreviewStudioGenerationGate,
  PreviewStudioReportLedger,
  startPreviewAutoUpdate,
  type PreviewEndpoint,
} from './preview.js'
import type { SyncOutcome } from './sync.js'
import type { WatchHandle, WatchOptions } from './watch.js'

type WatchOutcome = SyncOutcome | { scene: string; error: string }

function blendlinkEvents(calls: readonly unknown[][]): Record<string, unknown>[] {
  return calls.flatMap((call) => {
    const line = String(call[0] ?? '')
    if (!line.startsWith('##blendlink ')) return []
    return [JSON.parse(line.slice('##blendlink '.length)) as Record<string, unknown>]
  })
}

describe('live Preview status contract', () => {
  it('ignores stale and retained-generation ACKs while letting browser success recover a current failure', () => {
    const gate = new PreviewStudioGenerationGate()
    const ack = (generation: string, phase: 'ready' | 'failed') => ({
      schemaVersion: 1 as const,
      sessionId: 'session',
      generation,
      phase,
      updatedAt: new Date().toISOString(),
    })

    gate.publish('generation-a')
    gate.beginBuild()
    expect(gate.accept(ack('generation-a', 'ready'))).toBe('ignore')

    gate.publish('generation-b')
    expect(gate.accept(ack('generation-a', 'ready'))).toBe('ignore')
    expect(gate.accept(ack('generation-b', 'failed'))).toBe('failed')
    expect(gate.accept(ack('generation-b', 'failed'))).toBe('ignore')
    expect(gate.accept(ack('generation-b', 'ready'))).toBe('ready')
    expect(gate.accept(ack('generation-b', 'failed'))).toBe('ignore')
  })

  it('reports save-driven updates, preserves the endpoint on failure, and recovers', async () => {
    const root = join(tmpdir(), `blendlink-live-preview-${process.pid}`)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'Hero.blend'), 'test fixture')
    const config = resolveConfig({
      scenes: [{ file: 'Hero.blend', name: 'Hero' }],
    }, root)
    const endpoint: PreviewEndpoint = { owned: false }
    let report: ((outcome: WatchOutcome) => void) | undefined
    let receivedOptions: WatchOptions | undefined
    let closed = false
    const watch = vi.fn(async (
      _config: typeof config,
      onOutcome: (outcome: WatchOutcome) => void,
      options: WatchOptions,
    ): Promise<WatchHandle> => {
      report = onOutcome
      receivedOptions = options
      options.onStart?.('Hero')
      onOutcome({
        scene: 'Hero',
        action: 'built',
        durationMs: 125,
        warnings: ['Realtime-only Hybrid scene: atlas baking was skipped.'],
      })
      return { close: async () => { closed = true } }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const handle = await startPreviewAutoUpdate(config, endpoint, {
        only: 'Hero',
        force: true,
        allowNewerFile: true,
        authoringPreview: true,
        watch,
      })
      expect(receivedOptions).toMatchObject({
        draft: true,
        only: 'Hero',
        allowNewerFile: true,
        authoringPreview: true,
        initialBuild: 'force',
      })
      expect(receivedOptions?.onStart).toBeTypeOf('function')
      expect(warn).toHaveBeenCalledWith(
        '  ! Realtime-only Hybrid scene: atlas baking was skipped.',
      )

      endpoint.url = 'http://127.0.0.1:5173/'
      endpoint.owned = true
      receivedOptions?.onStart?.('Hero')
      report?.({ scene: 'Hero', error: 'Blender material export failed\nnode traceback' })
      report?.({
        scene: 'Hero',
        action: 'built',
        durationMs: 200,
        warnings: [],
      })

      const events = blendlinkEvents(log.mock.calls)
      expect(events.some((event) => event.previewUpdate === 'building')).toBe(true)
      expect(events).toContainEqual(expect.objectContaining({
        previewUpdate: 'failed',
        previewWatching: true,
        previewUrl: endpoint.url,
        previewOwned: true,
        error: 'Blender material export failed\nnode traceback',
      }))
      expect(events.at(-1)).toMatchObject({
        previewUpdate: 'ready',
        previewWatching: true,
        previewUrl: endpoint.url,
        previewOwned: true,
      })
      expect(error).toHaveBeenCalledWith(
        '✗ Hero: Blender material export failed\nnode traceback',
      )

      await handle.close()
      expect(closed).toBe(true)
    } finally {
      log.mockRestore()
      warn.mockRestore()
      error.mockRestore()
    }
  })

  it('keeps the last real compile report while labeling a no-op in-sync check separately', () => {
    const ledger = new PreviewStudioReportLedger()
    const stats = {
      bytes: 1_048_576,
      triangles: 12_345,
      meshes: 12,
      texturesBytes: 524_288,
    }
    expect(ledger.publish('generation-a', {
      scene: 'Hero',
      action: 'exported',
      durationMs: 24_000,
      stats,
      warnings: ['Preview quality', 'Main atlas scaled to fit'],
    })).toEqual({
      durationMs: 24_000,
      stats,
      warnings: ['Preview quality', 'Main atlas scaled to fit'],
    })

    expect(ledger.publish('generation-a', {
      scene: 'Hero',
      action: 'skipped',
      durationMs: 75,
      warnings: [],
    })).toEqual({
      durationMs: 24_000,
      checkDurationMs: 75,
      stats,
      warnings: ['Preview quality', 'Main atlas scaled to fit'],
    })

    // Check-only warnings are truthful for that check, but are not folded
    // permanently into the compile report after the condition is repaired.
    expect(ledger.publish('generation-a', {
      scene: 'Hero',
      action: 'skipped',
      durationMs: 80,
      warnings: ['Editable baked recipe needs migration'],
    }).warnings).toContain('Editable baked recipe needs migration')
    expect(ledger.publish('generation-a', {
      scene: 'Hero',
      action: 'skipped',
      durationMs: 70,
      warnings: [],
    }).warnings).not.toContain('Editable baked recipe needs migration')

    // Evidence from a different content generation is never borrowed.
    expect(ledger.publish('generation-b', {
      scene: 'Hero',
      action: 'skipped',
      durationMs: 60,
      warnings: [],
    })).toEqual({ warnings: [], checkDurationMs: 60 })
  })

  it('uses an if-needed initial build for the normal fast path', async () => {
    const config = resolveConfig({ scenes: [] }, process.cwd())
    let receivedOptions: WatchOptions | undefined
    const watch = async (
      _config: typeof config,
      _onOutcome: (outcome: WatchOutcome) => void,
      options: WatchOptions,
    ): Promise<WatchHandle> => {
      receivedOptions = options
      return { close: async () => {} }
    }

    const handle = await startPreviewAutoUpdate(config, { owned: false }, { watch })
    expect(receivedOptions?.initialBuild).toBe('if-needed')
    await handle.close()
  })
})
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
