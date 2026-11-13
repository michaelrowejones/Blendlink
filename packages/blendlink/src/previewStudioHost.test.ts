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
import { PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import * as fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PreviewStudioGenerationGate } from './preview.js'
import {
  PREVIEW_STUDIO_ACK,
  PREVIEW_STUDIO_STATUS,
  PreviewStudioStatusWriter,
  clearPreviewStudioAcknowledgement,
  ensurePreviewStudioControl,
  previewStudioMainSource,
  previewStudioViteConfigSource,
  readPreviewStudioGeneration,
  watchPreviewStudioAcknowledgements,
  type PreviewStudioClientAck,
  type PreviewStudioHostPlan,
} from './previewStudioHost.js'

const renameControl = vi.hoisted(() => ({ failures: 0 }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync(...args: Parameters<typeof actual.renameSync>) {
      if (renameControl.failures > 0) {
        renameControl.failures--
        throw Object.assign(new Error('File temporarily locked by reader'), { code: 'EPERM' })
      }
      return actual.renameSync(...args)
    },
  }
})

function tempPlan(): PreviewStudioHostPlan {
  const workspace = mkdtempSync(join(tmpdir(), 'scenetoweb-preview-host-'))
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
  it('identifies sidecar/display/material/recipe changes with unchanged GLB bytes and ignores compile telemetry', () => {
    const plan = tempPlan(), directory = join(plan.workspace, 'src', 'generated')
    mkdirSync(directory, { recursive: true })
    const manifestPath = join(directory, 'Hero.manifest.json'), modulePath = join(directory, 'Hero.gen.ts')
    const descriptor = { hash: 'same-glb', sourcePresentation: { url: '/display-a.json', hash: 'display-a' },
      materialPrograms: { url: '/materials-a.json', hash: 'materials-a' }, recipe: { camera: { behavior: 'fixed' } } }
    const publish = (value: unknown, duration = 10) => {
      const module = `export const Hero = ${JSON.stringify(value)} as const\n`
      writeFileSync(modulePath, module)
      writeFileSync(manifestPath, JSON.stringify({ hash: 'same-glb', generatedModuleHash: createHash('sha256').update(module).digest('hex').slice(0, 16), lastSyncDurationMs: duration }))
      return readPreviewStudioGeneration(plan)
    }
    try {
      const baseline = publish(descriptor)
      expect(baseline).toMatch(/^[a-f0-9]{16}$/)
      expect(publish(descriptor, 500)).toBe(baseline)
      for (const value of [
        { ...descriptor, sourcePresentation: { url: '/display-b.json', hash: 'display-b' } },
        { ...descriptor, materialPrograms: { url: '/materials-b.json', hash: 'materials-b' } },
        { ...descriptor, recipe: { camera: { behavior: 'orbit' } } },
      ]) expect(publish(value)).not.toBe(baseline)
      expect(publish(descriptor)).toBe(baseline)
      const status = new PreviewStudioStatusWriter(plan)
      status.write({ phase: 'ready', label: 'ready', generation: baseline })
      writeFileSync(modulePath, 'incomplete descriptor publication')
      expect(readPreviewStudioGeneration(plan)).toBeUndefined()
      status.write({ phase: 'failed', label: 'descriptor identity failed' })
      expect(JSON.parse(readFileSync(status.path, 'utf8'))).toMatchObject({ phase: 'failed', retainedGeneration: baseline })
    } finally { rmSync(plan.workspace, { recursive: true, force: true }) }
  })

  it('retains legacy cache identity but rejects an explicit malformed descriptor pin', () => {
    const plan = tempPlan(), directory = join(plan.workspace, 'src', 'generated')
    mkdirSync(directory, { recursive: true }); const path = join(directory, 'Hero.manifest.json')
    try {
      writeFileSync(path, JSON.stringify({ hash: 'old-carrier-generation' }))
      expect(readPreviewStudioGeneration(plan)).toBe('old-carrier-generation')
      for (const generatedModuleHash of ['', null, 'not-a-descriptor-hash']) {
        writeFileSync(path, JSON.stringify({ hash: 'old-carrier-generation', generatedModuleHash }))
        expect(readPreviewStudioGeneration(plan)).toBeUndefined()
      }
    } finally { rmSync(plan.workspace, { recursive: true, force: true }) }
  })

  it('retains the previous progress during a lock and accepts the next heartbeat', () => {
    const plan = tempPlan()
    try {
      const writer = new PreviewStudioStatusWriter(plan)
      writer.write({ phase: 'building', label: 'Starting' })
      const progress = { fraction: 0.2, label: 'Packing', startedAt: 1, stageStartedAt: 2 }
      renameControl.failures = 7
      expect(writer.writeProgress(progress)).toBe(false)
      expect(JSON.parse(readFileSync(writer.path, 'utf8')).label).toBe('Starting')
      expect(writer.writeProgress({ ...progress, heartbeat: true })).toBe(true)
      expect(JSON.parse(readFileSync(writer.path, 'utf8')).compileProgress).toMatchObject(progress)
      expect(readdirSync(join(plan.workspace, 'public')).some(name => name.endsWith('.tmp'))).toBe(false)
    } finally {
      renameControl.failures = 0
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })
  it('retries a transient status-file lock while preserving atomic snapshots', () => {
    const plan = tempPlan()
    try {
      const writer = new PreviewStudioStatusWriter(plan)
      writer.write({ phase: 'building', label: 'compiling' })
      renameControl.failures = 2
      writer.write({ phase: 'published', label: 'compiled', generation: 'current' })
      expect(JSON.parse(readFileSync(writer.path, 'utf8'))).toMatchObject({ phase: 'published', generation: 'current' })
      expect(readdirSync(join(plan.workspace, 'public')).some(name => name.endsWith('.tmp'))).toBe(false)
      renameControl.failures = 100
      expect(() => writer.write({ phase: 'building', label: 'locked permanently' })).toThrow('File temporarily locked')
      expect(JSON.parse(readFileSync(writer.path, 'utf8')).phase).toBe('published')
      expect(readdirSync(join(plan.workspace, 'public')).some(name => name.endsWith('.tmp'))).toBe(false)
    } finally {
      renameControl.failures = 0
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })
  it('accepts fresh browser validation/runtime retries, but rejects compile failures and stale evidence', async () => {
    const plan = tempPlan()
    const control = ensurePreviewStudioControl(plan)
    let handler: (request: PassThrough, response: any, next: () => void) => void
    const context: any = { ...fs, resolve: (path: string) => join(plan.workspace, path),
      process, console }
    // Run the emitted middleware, adapting only module imports/exports for
    // the VM. Real files and request streams exercise the browser/CLI boundary.
    runInNewContext(previewStudioViteConfigSource()
      .replace(/^import .* from 'node:[^']+'\r?\n/gm, '')
      .replace('export default', 'globalThis.config ='), context)
    context.config.plugins[0].configureServer({ middlewares: {
      use(_path: string, callback: typeof handler) { handler = callback },
    } })
    const send = (generation: string, token = control.token) => new Promise<number>(resolve => {
      const request = Object.assign(new PassThrough(), { method: 'POST' })
      const response = { statusCode: 200, end() { resolve(this.statusCode) } }
      handler(request, response, () => { throw new Error('unexpected next') })
      request.end(JSON.stringify({ token, sessionId: plan.sessionId, generation, phase: 'ready' }))
    })
    try {
      const writer = new PreviewStudioStatusWriter(plan)
      writer.write({ phase: 'failed', label: 'loading failed', generation: 'current', failureKind: 'validation' })
      expect(await send('current')).toBe(204)
      expect(await send('stale')).toBe(409)
      expect(await send('current', 'wrong-token')).toBe(403)
      writer.write({ phase: 'failed', label: 'compile failed' })
      expect(await send('current')).toBe(409)
      writer.write({ phase: 'failed', label: 'runtime failed', generation: 'current', failureKind: 'runtime' })
      expect(await send('current')).toBe(204)
      expect(await send('stale')).toBe(409)
      writer.write({ phase: 'published', label: 'saved again', generation: 'current' })
      expect(await send('current')).toBe(204)
    } finally {
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })

  it('carries runtime failures through the file watcher so they revoke Ready', async () => {
    const plan = tempPlan()
    const gate = new PreviewStudioGenerationGate()
    gate.publish('current')
    const dispositions: string[] = []
    const received: PreviewStudioClientAck[] = []
    mkdirSync(join(plan.workspace, 'public'), { recursive: true })
    const watcher = watchPreviewStudioAcknowledgements(plan, ack => {
      received.push(ack)
      dispositions.push(gate.accept(ack))
    }, 5)
    try {
      const ack = { schemaVersion: 1 as const, sessionId: plan.sessionId,
        generation: 'current', updatedAt: new Date().toISOString() }
      writeFileSync(join(plan.workspace, 'public', PREVIEW_STUDIO_ACK), JSON.stringify({ ...ack, phase: 'ready' }))
      await eventually(() => received.length === 1)
      writeFileSync(join(plan.workspace, 'public', PREVIEW_STUDIO_ACK), JSON.stringify({
        ...ack, phase: 'failed', failureKind: 'runtime', error: 'WebGL context was lost',
      }))
      await eventually(() => received.length === 2)
      expect(dispositions).toEqual(['ready', 'failed'])
      expect(received[1]).toMatchObject({ failureKind: 'runtime' })
      writeFileSync(join(plan.workspace, 'public', PREVIEW_STUDIO_ACK), JSON.stringify({ ...ack, phase: 'ready' }))
      await eventually(() => received.length === 3)
      expect(dispositions[2]).toBe('ignore')
      writeFileSync(join(plan.workspace, 'public', PREVIEW_STUDIO_ACK), JSON.stringify({
        ...ack, phase: 'ready', recovery: true, updatedAt: 'after-renderer-retry',
      }))
      await eventually(() => received.length === 4)
      expect(dispositions[3]).toBe('ready')
      expect(received[3]).toMatchObject({ recovery: true })
    } finally {
      watcher.close()
      rmSync(plan.workspace, { recursive: true, force: true })
    }
  })

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
      const acknowledge = client.indexOf("await acknowledge({ generation, phase: 'ready',")
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
