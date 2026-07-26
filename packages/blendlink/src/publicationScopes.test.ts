import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withPublicationLease } from './publicationLease.js'
import {
  PUBLICATION_SCOPE_DELEGATION_ENV,
  PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION,
  PUBLICATION_SCOPE_REGISTRY_ENV,
  canonicalizePublicationRoot,
  publicationRootsForScene,
  publicationScopeDelegationEnvironment,
  publicationScopeRegistryDirectory,
  readPublicationScopeDelegation,
  resolvePublicationScopes,
  withPublicationScopes,
  type ScenePublicationRoots,
} from './publicationScopes.js'

function platformCanonical(path: string): string {
  return process.platform === 'win32'
    ? path.toLocaleLowerCase('en-US')
    : path
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('publication scope coordination', () => {
  const temporaryDirectories: string[] = []
  const temporaryDirectory = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-publication-scopes-'))
    temporaryDirectories.push(directory)
    return directory
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('canonicalizes a missing root through its nearest real parent and folds Windows case', () => {
    const root = temporaryDirectory()
    const physical = join(root, 'PhysicalOutput')
    const alias = join(root, 'OutputAlias')
    mkdirSync(physical)
    symlinkSync(
      physical,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const canonical = canonicalizePublicationRoot(
      join(alias, 'MissingScene', 'Nested'),
    )
    const expected = platformCanonical(
      join(realpathSync.native(physical), 'MissingScene', 'Nested'),
    )

    expect(canonical).toBe(expected)
  })

  it.runIf(process.platform === 'win32')(
    'rejects UNC output roots and delegated locks instead of claiming cross-host coordination',
    () => {
      const uncRoot = String.raw`\\server\share\public\models`
      expect(() => canonicalizePublicationRoot(uncRoot)).toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_ROOT' }),
      )
      expect(() => publicationScopeDelegationEnvironment([{
        lockPath: String.raw`\\server\share\locks\hero.lease`,
        token: 'delegated-token',
      }])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_ROOT' }))
    },
  )

  it('deduplicates canonical roots and assigns a full SHA-256 lock in stable order', () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const alpha = join(root, 'alpha')
    const beta = join(root, 'beta')
    const forward = resolvePublicationScopes(
      [beta, alpha, beta, alpha],
      { registryDirectory },
    )
    const reversed = resolvePublicationScopes(
      [alpha, beta],
      { registryDirectory },
    )

    expect(forward).toEqual(reversed)
    expect(forward.map((scope) => scope.root)).toEqual([
      canonicalizePublicationRoot(alpha),
      canonicalizePublicationRoot(beta),
    ])
    expect(forward).toHaveLength(2)
    for (const scope of forward) {
      expect(dirname(scope.lockPath)).toBe(
        canonicalizePublicationRoot(registryDirectory),
      )
      expect(basename(scope.lockPath)).toMatch(/^[a-f0-9]{64}\.lease$/u)
      expect(scope.rootHash).toHaveLength(64)
    }
    expect(Object.isFrozen(forward)).toBe(true)
    expect(Object.isFrozen(forward[0])).toBe(true)
  })

  it('uses an absolute environment registry override and rejects a relative one', () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'ci-publication-registry')
    const environment = {
      [PUBLICATION_SCOPE_REGISTRY_ENV]: registryDirectory,
    }

    expect(publicationScopeRegistryDirectory({ environment })).toBe(
      canonicalizePublicationRoot(registryDirectory),
    )
    expect(() => publicationScopeRegistryDirectory({
      environment: {
        [PUBLICATION_SCOPE_REGISTRY_ENV]: 'relative-publication-registry',
      },
    })).toThrow(
      new RegExp(`${PUBLICATION_SCOPE_REGISTRY_ENV}.*absolute`, 'isu'),
    )
  })

  it('derives scene asset and generated roots without conflating configs that share only one', () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const sharedAssets = join(root, 'shared-assets')
    const sharedGenerated = join(root, 'shared-generated')
    const first = publicationRootsForScene({
      glbPath: join(sharedAssets, 'first.glb'),
      manifestPath: join(sharedGenerated, 'first.manifest.json'),
      modulePath: join(sharedGenerated, 'first.gen.ts'),
    })
    const assetPeer = publicationRootsForScene({
      glbPath: join(sharedAssets, 'second.glb'),
      manifestPath: join(root, 'second-generated', 'second.manifest.json'),
      modulePath: join(root, 'second-generated', 'second.gen.ts'),
    })
    const generatedPeer = publicationRootsForScene({
      glbPath: join(root, 'third-assets', 'third.glb'),
      manifestPath: join(sharedGenerated, 'third.manifest.json'),
      modulePath: join(sharedGenerated, 'third.gen.ts'),
    })

    expect(first.assetRoot).toBe(assetPeer.assetRoot)
    expect(first.generatedRoot).not.toBe(assetPeer.generatedRoot)
    expect(first.generatedRoot).toBe(generatedPeer.generatedRoot)
    expect(first.assetRoot).not.toBe(generatedPeer.assetRoot)

    const locksFor = (roots: ScenePublicationRoots): Set<string> => new Set(
      resolvePublicationScopes(
        [roots.assetRoot, roots.generatedRoot],
        { registryDirectory },
      ).map((scope) => scope.lockPath),
    )
    const firstLocks = locksFor(first)
    const sharedWith = (peer: ScenePublicationRoots): string[] => [
      ...locksFor(peer),
    ].filter((lockPath) => firstLocks.has(lockPath))
    expect(sharedWith(assetPeer)).toHaveLength(1)
    expect(sharedWith(generatedPeer)).toHaveLength(1)
  })

  it('acquires reversed root lists in one global order and serializes overlapping work', async () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const alpha = join(root, 'alpha')
    const beta = join(root, 'beta')
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const events: string[] = []

    const first = withPublicationScopes({
      roots: [beta, alpha],
      registryDirectory,
      intent: 'first',
      signal: AbortSignal.timeout(2_000),
      pollIntervalMs: 2,
    }, async () => {
      events.push('first:start')
      firstEntered.resolve()
      await releaseFirst.promise
      events.push('first:end')
    })
    await firstEntered.promise

    const second = withPublicationScopes({
      roots: [alpha, beta],
      registryDirectory,
      intent: 'second',
      signal: AbortSignal.timeout(2_000),
      pollIntervalMs: 2,
    }, () => {
      events.push('second:start')
      events.push('second:end')
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    expect(events).toEqual(['first:start'])
    releaseFirst.resolve()
    await Promise.all([first, second])

    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
  })

  it('reuses held scopes through AsyncLocal nesting without reacquiring them', async () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const alpha = join(root, 'alpha')
    const beta = join(root, 'beta')

    await withPublicationScopes({
      roots: [beta, alpha],
      registryDirectory,
      intent: 'outer-publish',
    }, async (outer) => {
      expect(outer.scopes.every((scope) => scope.source === 'owned')).toBe(true)

      await withPublicationScopes({
        roots: [alpha, beta, alpha],
        registryDirectory,
        intent: 'inner-typegen',
        signal: AbortSignal.timeout(200),
      }, (inner) => {
        expect(inner.scopes.map((scope) => ({
          root: scope.root,
          token: scope.token,
          source: scope.source,
        }))).toEqual(outer.scopes.map((scope) => ({
          root: scope.root,
          token: scope.token,
          source: 'in-process',
        })))
        for (const scope of outer.scopes) {
          expect(existsSync(scope.lockPath)).toBe(true)
        }
      })
    })
  })

  it('rejects nested expansion below a held root instead of permitting lock-order inversion', async () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const alpha = join(root, 'alpha')
    const omega = join(root, 'omega')

    await withPublicationScopes({
      roots: [omega],
      registryDirectory,
      intent: 'outer',
    }, async () => {
      await expect(withPublicationScopes({
        roots: [alpha],
        registryDirectory,
        intent: 'inverted-inner',
      }, () => undefined)).rejects.toMatchObject({
        code: 'SCOPE_ORDER_VIOLATION',
      })
    })
  })

  it('round-trips a versioned lockPath-to-token environment map for delegated reentry', async () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const sceneRoot = join(root, 'scene-assets')
    const [scope] = resolvePublicationScopes(
      [sceneRoot],
      { registryDirectory },
    )

    await withPublicationLease({
      lockPath: scope!.lockPath,
      intent: 'external-parent',
    }, async (outer) => {
      const environment = publicationScopeDelegationEnvironment([{
        lockPath: scope!.lockPath,
        token: outer.token,
      }])
      const decoded = readPublicationScopeDelegation(environment)
      expect(decoded).toEqual({
        schemaVersion: PUBLICATION_SCOPE_DELEGATION_SCHEMA_VERSION,
        leases: {
          [scope!.lockPath]: outer.token,
        },
      })
      expect(environment[PUBLICATION_SCOPE_DELEGATION_ENV]).toBe(
        JSON.stringify(decoded),
      )

      await withPublicationScopes({
        roots: [sceneRoot],
        registryDirectory,
        intent: 'delegated-child-typegen',
        environment,
        signal: AbortSignal.timeout(200),
      }, (delegated) => {
        expect(delegated.scopes).toMatchObject([{
          lockPath: scope!.lockPath,
          token: outer.token,
          source: 'delegated',
        }])
        expect(existsSync(scope!.lockPath)).toBe(true)
      })
      expect(existsSync(scope!.lockPath)).toBe(true)
    })
  })

  it('fails loudly on an unsupported delegated environment schema', () => {
    expect(() => readPublicationScopeDelegation({
      [PUBLICATION_SCOPE_DELEGATION_ENV]: JSON.stringify({
        schemaVersion: 99,
        leases: {},
      }),
    })).toThrow(/delegation.*schemaVersion.*99/is)
  })

  it('emits throttled wait facts with owner intent but never its lease token', async () => {
    const root = temporaryDirectory()
    const registryDirectory = join(root, 'registry')
    const sceneRoot = join(root, 'scene-assets')
    const ownerEntered = deferred()
    const releaseOwner = deferred()
    const facts: Array<{ message: string; owner: unknown }> = []

    const owner = withPublicationScopes({
      roots: [sceneRoot],
      registryDirectory,
      intent: 'final',
      label: 'Hero / Final',
    }, async () => {
      ownerEntered.resolve()
      await releaseOwner.promise
    })
    await ownerEntered.promise

    await expect(withPublicationScopes({
      roots: [sceneRoot],
      registryDirectory,
      intent: 'contender',
      signal: AbortSignal.timeout(45),
      pollIntervalMs: 2,
      waitReportIntervalMs: 10_000,
      onWait(fact) {
        facts.push(fact)
      },
    }, () => undefined)).rejects.toMatchObject({ name: 'AbortError' })

    expect(facts).toHaveLength(1)
    expect(facts[0]!.message).toMatch(/Hero \/ Final.*scene-assets/is)
    expect(JSON.stringify(facts)).not.toMatch(/"token"/u)
    releaseOwner.resolve()
    await owner
  })
})
