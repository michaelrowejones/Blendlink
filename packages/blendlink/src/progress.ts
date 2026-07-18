/**
 * Machine-readable progress protocol.
 *
 * When BLENDLINK_PROGRESS=1 (set by the Blender addon's Sync Now runner, or
 * any wrapping tool), stages print lines like
 *   ##blendlink {"fraction":0.42,"label":"baking day state"}
 * on stdout. Humans running the CLI directly never see them.
 */

export function progressEnabled(): boolean {
  return process.env.BLENDLINK_PROGRESS === '1'
}

export function emitProgress(fraction: number, label: string): void {
  if (!progressEnabled()) return
  const clamped = Math.min(1, Math.max(0, fraction))
  console.log(`##blendlink ${JSON.stringify({ fraction: clamped, label })}`)
}

/** Incremental line splitter that re-emits ##blendlink lines from a child
 * process whose stdout is otherwise captured (see invoke.ts). */
export class ProgressEcho {
  private buffer = ''

  push(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trimEnd()
      this.buffer = this.buffer.slice(index + 1)
      if (line.startsWith('##blendlink ')) console.log(line)
      index = this.buffer.indexOf('\n')
    }
  }
}
