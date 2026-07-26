import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_STUDIO_ACK,
  PREVIEW_STUDIO_STATUS,
  PreviewStudioStatusWriter,
  clearPreviewStudioAcknowledgement,
  ensurePreviewStudioControl,
  previewStudioMainSource,
  previewStudioViteConfigSource,
  watchPreviewStudioAcknowledgements,
  type PreviewStudioClientAck,
  type PreviewStudioHostPlan,
} from './previewStudioHost.js'

function tempPlan(): PreviewStudioHostPlan {
  const workspace = mkdtempSync(join(tmpdir(), 'blendlink-preview-host-'))
  return {
    workspace,
    sessionId: 'test-session',
    sceneName: 'Hero',
    blendPath: join(workspace, 'Hero.blend'),
  }
}

async function eventually(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Preview Studio state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('Preview Studio host protocol', () => {
  it('publishes parseable status snapshots and retains the last ready generation across restarts', () => {
    const plan = tempPlan()
    try {
      const writer = new PreviewStudioStatusWriter(plan)
      writer.write({ phase: 'ready', label: 'ready', generation: 'generation-a' })
      const building = writer.write({ phase: 'building', label: 'building' })
      expect(building).toMatchObject({
        sequence: 2,
        retainedGeneration: 'generation-a',
      })

      const restarted = new PreviewStudioStatusWriter(plan)
      const failed = restarted.write({
        phase: 'failed',
        label: 'invalid saved revision',
        error: 'material export failed',
      })
      expect(failed).toMatchObject({
        sequence: 3,
        retainedGeneration: 'generation-a',
      })
      restarted.write({ phase: 'ready', label: 'ready again', generation: 'generation-b' })
      const runtimeFailed = restarted.write({
        phase: 'failed',
        label: 'runtime failed',
        generation: 'generation-b',
        failureKind: 'runtime',
        error: 'update threw',
      })
      expect(runtimeFailed).not.toHaveProperty('retainedGeneration')
      expect(restarted.write({ phase: 'building', label: 'retrying' }))
        .not.toHaveProperty('retainedGeneration')
      expect(JSON.parse(readFileSync(join(plan.workspace, 'public', PREVIEW_STUDIO_STATUS), 'utf8')))
        .toMatchObject({ phase: 'building', label: 'retrying' })
      expect(readdirSync(join(plan.workspace, 'public')).some((name) => name.endsWith('.tmp')))
        .toBe(false)
    } finally {
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })

  it('keeps one control identity and retries a partial acknowledgement on the next poll', async () => {
    const plan = tempPlan()
    try {
      const firstControl = ensurePreviewStudioControl(plan)
      expect(ensurePreviewStudioControl(plan)).toEqual(firstControl)

      const publicRoot = join(plan.workspace, 'public')
      mkdirSync(publicRoot, { recursive: true })
      const ackPath = join(publicRoot, PREVIEW_STUDIO_ACK)
      const received: PreviewStudioClientAck[] = []
      const watcher = watchPreviewStudioAcknowledgements(plan, (ack) => received.push(ack), 5)
      try {
        writeFileSync(ackPath, '{')
        await new Promise((resolve) => setTimeout(resolve, 15))
        expect(received).toHaveLength(0)

        const ack: PreviewStudioClientAck = {
          schemaVersion: 1,
          sessionId: plan.sessionId,
          generation: 'generation-a',
          phase: 'ready',
          updatedAt: new Date().toISOString(),
        }
        writeFileSync(ackPath, JSON.stringify(ack))
        await eventually(() => received.length === 1)
        expect(received).toEqual([ack])
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })

  it('clears a prior-run acknowledgement before accepting browser evidence for a new run', async () => {
    const plan = tempPlan()
    try {
      const publicRoot = join(plan.workspace, 'public')
      mkdirSync(publicRoot, { recursive: true })
      const ackPath = join(publicRoot, PREVIEW_STUDIO_ACK)
      writeFileSync(ackPath, JSON.stringify({
        schemaVersion: 1,
        sessionId: plan.sessionId,
        generation: 'unchanged-generation',
        phase: 'ready',
        updatedAt: new Date().toISOString(),
      } satisfies PreviewStudioClientAck))

      const writer = new PreviewStudioStatusWriter(plan)
      writer.write({ phase: 'preparing', label: 'preparing this run' })
      clearPreviewStudioAcknowledgement(plan)
      expect(() => readFileSync(ackPath, 'utf8')).toThrow()

      const received: PreviewStudioClientAck[] = []
      const watcher = watchPreviewStudioAcknowledgements(plan, (ack) => received.push(ack), 5)
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(received).toHaveLength(0)

        const currentAck: PreviewStudioClientAck = {
          schemaVersion: 1,
          sessionId: plan.sessionId,
          generation: 'unchanged-generation',
          phase: 'ready',
          updatedAt: new Date().toISOString(),
        }
        writeFileSync(ackPath, JSON.stringify(currentAck))
        await eventually(() => received.length === 1)
        expect(received).toEqual([currentAck])
      } finally {
        watcher.close()
      }
    } finally {
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })

  it('validates the current generation before an atomic ACK and swaps only after browser verification', () => {
    const plan = tempPlan()
    try {
      const server = previewStudioViteConfigSource()
      expect(server).toContain("status.generation !== generation")
      expect(server).toContain("status.phase !== 'published'")
      expect(server).toContain('renameSync(temporaryPath, ackPath)')
      expect(server).toContain("payload.failureKind !== 'runtime'")

      const client = previewStudioMainSource(plan)
      const acknowledge = client.indexOf("await acknowledge({ generation, phase: 'ready' })")
      const promoteCanvas = client.indexOf("candidate.canvas.classList.add('active')")
      expect(acknowledge).toBeGreaterThan(0)
      expect(promoteCanvas).toBeGreaterThan(acknowledge)
      expect(client).toContain('desiredGeneration !== generation')
      expect(client).toContain('if (!retainedAfterFailure && !await acknowledge')
      expect(client).toContain('active.installed.cameraController.reset()')
      expect(client).toContain("querySelectorAll<HTMLButtonElement>('button[data-viewport]')")
      expect(client).not.toContain("querySelectorAll<HTMLButtonElement>('[data-viewport]')")
      expect(client).toContain("presentation.descriptor.defaultState || stateNames[0]")
      expect(client).toContain("'Runtime range ' + range.toFixed(2)")
      expect(client).toContain('99.9% of covered texels preserved')
      expect(client).toContain("presentation.installed.setLightGroup(name, { strength: 1 })")
      expect(client).toContain("if (!changed) {")
      expect(client).toContain("button.setAttribute('aria-label', 'Background: ' + next)")
      expect(client).toContain('function reportRuntimeFailure(')
      expect(client).toContain("failureKind: 'runtime'")
      expect(client).toContain("canvas.addEventListener('webglcontextlost'")
      expect(client).toContain("window.addEventListener('unhandledrejection'")
      expect(client).toContain("setPhase('failed', 'Preview connection lost · retrying')")
      expect(client).toContain('statusPollFailures >= 3')
    } finally {
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })
})
