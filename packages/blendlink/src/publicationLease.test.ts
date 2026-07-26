import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PUBLICATION_LEASE_SCHEMA_VERSION,
  withPublicationLease,
  type PublicationLeaseRecord,
} from './publicationLease.js'

const childSource = String.raw`
import {
  appendFileSync,
  writeFileSync,
} from 'node:fs'

const [
  moduleUrl,
  mode,
  lockPath,
  timelinePath,
  statePath,
  id,
  holdText,
  reentrantToken,
] = process.argv.slice(1)
const { withPublicationLease } = await import(moduleUrl)
const holdMs = Number(holdText)

await withPublicationLease({
  lockPath,
  intent: 'publication-lease-child-test',
  label: id,
  reentrantToken: reentrantToken || undefined,
  pollIntervalMs: 5,
  heartbeatIntervalMs: 10,
  staleAfterMs: 100,
}, async (lease) => {
  appendFileSync(timelinePath, id + ':start\n')
  if (statePath) {
    writeFileSync(statePath, JSON.stringify({
      pid: process.pid,
      token: lease.token,
      reentrant: lease.reentrant,
    }))
  }
  if (mode === 'crash') process.exit(0)
  await new Promise((resolve) => setTimeout(resolve, holdMs))
  appendFileSync(timelinePath, id + ':end\n')
})
`

interface ChildRun {
  readonly exit: Promise<void>
}

function spawnLeaseChild(options: {
  moduleUrl: string
  mode: 'hold' | 'crash' | 'reenter'
  lockPath: string
  timelinePath: string
  statePath?: string
  id: string
  holdMs?: number
  reentrantToken?: string
}): ChildRun {
  const child = spawn(process.execPath, [
    '--experimental-strip-types',
    '--input-type=module',
    '--eval',
    childSource,
    options.moduleUrl,
    options.mode,
    options.lockPath,
    options.timelinePath,
    options.statePath ?? '',
    options.id,
    String(options.holdMs ?? 0),
    options.reentrantToken ?? '',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const exit = new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(
        `Publication lease child failed (code ${String(code)}, signal ${String(signal)}).`
        + `\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ))
    })
  })
  return { exit }
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
}

function lines(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split(/\r?\n/u).filter(Boolean)
}

function readRecord(path: string): PublicationLeaseRecord {
  return JSON.parse(readFileSync(path, 'utf8')) as PublicationLeaseRecord
}

describe('publication lease', () => {
  const temporaryDirectories: string[] = []
  const temporaryDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-publication-lease-'))
    temporaryDirectories.push(directory)
    return directory
  }
  const moduleUrl = new URL('./publicationLease.ts', import.meta.url).href

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('serializes independent child processes around one publication namespace', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    const timelinePath = join(root, 'timeline.txt')
    const firstState = join(root, 'first.json')
    const first = spawnLeaseChild({
      moduleUrl,
      mode: 'hold',
      lockPath,
      timelinePath,
      statePath: firstState,
      id: 'first',
      holdMs: 180,
    })
    await waitUntil(
      () => existsSync(firstState),
      'The first child did not acquire the publication lease.',
    )

    const second = spawnLeaseChild({
      moduleUrl,
      mode: 'hold',
      lockPath,
      timelinePath,
      id: 'second',
      holdMs: 10,
    })
    await Promise.all([first.exit, second.exit])

    expect(lines(timelinePath)).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
    expect(existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('does not steal an old-looking lease while its recorded owner is alive', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    let contenderEntered = false

    await withPublicationLease({
      lockPath,
      intent: 'living-owner',
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20,
      pollIntervalMs: 2,
    }, async (owner) => {
      const old = new Date(Date.now() - 5_000)
      utimesSync(lockPath, old, old)

      await expect(withPublicationLease({
        lockPath,
        intent: 'contender',
        heartbeatIntervalMs: 10,
        staleAfterMs: 20,
        pollIntervalMs: 2,
        signal: AbortSignal.timeout(60),
      }, () => {
        contenderEntered = true
      })).rejects.toMatchObject({ name: 'AbortError' })

      expect(contenderEntered).toBe(false)
      expect(readRecord(lockPath).token).toBe(owner.token)
    })
  })

  it('fails loudly on stale malformed ownership instead of waiting forever or stealing', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    writeFileSync(lockPath, '{"schemaVersion":')
    const old = new Date(Date.now() - 5_000)
    utimesSync(lockPath, old, old)

    await expect(withPublicationLease({
      lockPath,
      intent: 'malformed-owner-contender',
      heartbeatIntervalMs: 10,
      staleAfterMs: 20,
      pollIntervalMs: 2,
      signal: AbortSignal.timeout(200),
    }, () => {
      throw new Error('malformed lease contender must not enter')
    })).rejects.toMatchObject({
      code: 'RECOVERY_FAILED',
      message: expect.stringMatching(/metadata.*not valid JSON.*refused to steal/i),
    })
    expect(readFileSync(lockPath, 'utf8')).toBe('{"schemaVersion":')
  })

  it('recovers a stale lease only after its same-host child owner has died', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    const timelinePath = join(root, 'timeline.txt')
    const deadStatePath = join(root, 'dead-owner.json')
    const crashed = spawnLeaseChild({
      moduleUrl,
      mode: 'crash',
      lockPath,
      timelinePath,
      statePath: deadStatePath,
      id: 'dead',
    })
    await crashed.exit
    const deadState = JSON.parse(readFileSync(deadStatePath, 'utf8')) as {
      pid: number
      token: string
    }
    expect(readRecord(lockPath).token).toBe(deadState.token)
    const old = new Date(Date.now() - 5_000)
    utimesSync(lockPath, old, old)

    let replacementToken = ''
    await withPublicationLease({
      lockPath,
      intent: 'recovery',
      heartbeatIntervalMs: 10,
      staleAfterMs: 20,
      pollIntervalMs: 2,
    }, (lease) => {
      replacementToken = lease.token
      expect(lease.token).not.toBe(deadState.token)
      expect(readRecord(lockPath).token).toBe(lease.token)
    })

    expect(replacementToken).not.toBe('')
    expect(existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('makes a contended wait abortable without disturbing the owner', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    const controller = new AbortController()
    let waits = 0
    let contenderEntered = false

    await withPublicationLease({
      lockPath,
      intent: 'owner',
    }, async (owner) => {
      const contender = withPublicationLease({
        lockPath,
        intent: 'abortable-contender',
        signal: controller.signal,
        pollIntervalMs: 2,
        onWait() {
          waits += 1
          controller.abort('test cancellation')
        },
      }, () => {
        contenderEntered = true
      })

      await expect(contender).rejects.toMatchObject({
        name: 'AbortError',
        code: 'ABORTED',
      })
      expect(waits).toBeGreaterThan(0)
      expect(contenderEntered).toBe(false)
      expect(readRecord(lockPath).token).toBe(owner.token)
    })
  })

  it('never removes a successor when cleanup no longer owns the pathname token', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    let successor!: PublicationLeaseRecord

    await expect(withPublicationLease({
      lockPath,
      intent: 'owner-that-loses-pathname',
      heartbeatIntervalMs: 10_000,
    }, (lease) => {
      successor = {
        ...lease.record,
        token: 'successor-token-owned-elsewhere',
        pid: process.pid,
        intent: 'successor',
        acquiredAt: new Date().toISOString(),
      }
      unlinkSync(lockPath)
      writeFileSync(lockPath, `${JSON.stringify(successor)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
    })).rejects.toMatchObject({
      code: 'OWNERSHIP_LOST',
    })

    expect(readRecord(lockPath)).toEqual(successor)
  })

  it('lets an explicitly delegated child re-enter without gaining cleanup authority', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')
    const timelinePath = join(root, 'timeline.txt')
    const childStatePath = join(root, 'delegated.json')

    await withPublicationLease({
      lockPath,
      intent: 'outer-publish',
      heartbeatIntervalMs: 10,
      staleAfterMs: 100,
    }, async (outer) => {
      const delegated = spawnLeaseChild({
        moduleUrl,
        mode: 'reenter',
        lockPath,
        timelinePath,
        statePath: childStatePath,
        id: 'delegated',
        holdMs: 30,
        reentrantToken: outer.token,
      })
      await delegated.exit

      const childState = JSON.parse(readFileSync(childStatePath, 'utf8')) as {
        token: string
        reentrant: boolean
      }
      expect(childState).toMatchObject({
        token: outer.token,
        reentrant: true,
      })
      expect(readRecord(lockPath).token).toBe(outer.token)
    })

    expect(lines(timelinePath)).toEqual(['delegated:start', 'delegated:end'])
    expect(existsSync(lockPath)).toBe(false)
  }, 10_000)

  it('rejects a reentrant token that does not identify the current lease', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')

    await withPublicationLease({
      lockPath,
      intent: 'outer-publish',
    }, async () => {
      await expect(withPublicationLease({
        lockPath,
        intent: 'untrusted-inner',
        reentrantToken: 'not-the-owner-token',
      }, () => undefined)).rejects.toMatchObject({
        code: 'REENTRY_DENIED',
      })
    })
  })

  it('rejects relative lock paths so independent processes cannot disagree on cwd', async () => {
    await expect(withPublicationLease({
      lockPath: 'relative/publication.lock',
      intent: 'invalid',
    }, () => undefined)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PATH',
    })
  })

  it.runIf(process.platform === 'win32')(
    'rejects UNC paths because wx is not a truthful network-filesystem lease',
    async () => {
      await expect(withPublicationLease({
        lockPath: String.raw`\\server\share\hero.publication.lock`,
        intent: 'invalid-network-lock',
      }, () => undefined)).rejects.toMatchObject({
        code: 'UNSUPPORTED_PATH',
      })
    },
  )

  it('writes an inspectable, versioned owner record', async () => {
    const root = temporaryDirectory()
    const lockPath = join(root, 'hero.publication.lock')

    await withPublicationLease({
      lockPath,
      intent: 'preview',
      label: 'hero / Draft',
    }, (lease) => {
      expect(readRecord(lockPath)).toEqual(lease.record)
      expect(lease.record).toMatchObject({
        schemaVersion: PUBLICATION_LEASE_SCHEMA_VERSION,
        token: lease.token,
        hostname: expect.any(String),
        pid: process.pid,
        intent: 'preview',
        label: 'hero / Draft',
        acquiredAt: expect.any(String),
      })
    })
  })
})
