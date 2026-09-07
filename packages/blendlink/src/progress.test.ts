import { describe, expect, it, vi } from 'vitest'
import { emitProgress, ProgressEcho, withProgressListener } from './progress.js'

describe('compile progress', () => {
  it('delivers split Blender records to the scoped listener without requiring console progress', async () => {
    vi.stubEnv('BLENDLINK_PROGRESS', '0')
    const received: unknown[] = []
    try {
      await withProgressListener(event => received.push(event), async () => {
        const echo = new ProgressEcho()
        echo.push('Blender output\n##blendlink {"fraction":0.2,"label":"Packing ')
        echo.push('Main","heartbeat":true,"device":"gpu","backend":"optix","samples":2}\n##blendlink invalid\n')
        echo.push('##blendlink {"fraction":"wrong","label":"bad"}\n')
        emitProgress(0.8, 'Writing scene')
      })
      expect(received).toEqual([
        { fraction: 0.2, label: 'Packing Main', heartbeat: true, device: 'gpu', backend: 'optix', samples: 2 },
        { fraction: 0.8, label: 'Writing scene' },
      ])
    } finally { vi.unstubAllEnvs() }
  })

  it('keeps concurrent scene progress separate', async () => {
    const left: string[] = []
    const right: string[] = []
    await Promise.all([
      withProgressListener(event => left.push(event.label), async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        emitProgress(0.1, 'Left')
      }),
      withProgressListener(event => right.push(event.label), async () => {
        await Promise.resolve()
        emitProgress(0.2, 'Right')
      }),
    ])
    expect(left).toEqual(['Left'])
    expect(right).toEqual(['Right'])
  })
})
