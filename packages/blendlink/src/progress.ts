import { AsyncLocalStorage } from 'node:async_hooks'

export interface CompileProgress {
  fraction: number
  label: string
  heartbeat?: boolean
  device?: 'cpu' | 'gpu'
  backend?: string
  samples?: number
}

const listeners = new AsyncLocalStorage<(progress: CompileProgress) => void>()

/** Scope child-process and compiler progress to one scene's async work. */
export function withProgressListener<T>(listener: (progress: CompileProgress) => void, work: () => T): T {
  return listeners.run(listener, work)
}

function report(progress: CompileProgress): void {
  listeners.getStore()?.(progress)
  if (progressEnabled()) console.log(`##blendlink ${JSON.stringify(progress)}`)
}

/**
 * Machine-readable progress protocol.
 *
 * When BLENDLINK_PROGRESS=1 (set by the Blender addon's website-build runner, or
 * any wrapping tool), stages print lines like
 *   ##blendlink {"fraction":0.42,"label":"baking day state"}
 * on stdout. Humans running the CLI directly never see them.
 */

export function progressEnabled(): boolean {
  return process.env.BLENDLINK_PROGRESS === '1'
}

export function emitProgress(fraction: number, label: string): void {
  const clamped = Math.min(1, Math.max(0, fraction))
  report({ fraction: clamped, label })
}

/** Incremental line splitter that re-emits ##blendlink lines from a child
 * process whose stdout is otherwise captured (see invoke.ts). */
export class ProgressEcho {
  private buffer = ''

  push(chunk: string): void {
    this.buffer += chunk
    for (let index; (index = this.buffer.indexOf('\n')) >= 0;) {
      const line = this.buffer.slice(0, index).trimEnd()
      this.buffer = this.buffer.slice(index + 1)
      if (line.startsWith('##blendlink ')) {
        let value: Partial<CompileProgress>
        try { value = JSON.parse(line.slice('##blendlink '.length)) }
        catch { continue }
        if (!value || typeof value.fraction !== 'number' || !Number.isFinite(value.fraction)
            || typeof value.label !== 'string') continue
        report({
          fraction: Math.min(1, Math.max(0, value.fraction)), label: value.label,
          ...(value.heartbeat === true ? { heartbeat: true } : {}),
          ...(value.device === 'cpu' || value.device === 'gpu' ? { device: value.device } : {}),
          ...(typeof value.backend === 'string' ? { backend: value.backend } : {}),
          ...(Number.isInteger(value.samples) && Number(value.samples) > 0 ? { samples: value.samples } : {}),
        })
      }
    }
  }
}
