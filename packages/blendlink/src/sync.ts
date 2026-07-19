import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { exportBlend } from './invoke.js'
import { emitProgress } from './progress.js'
import { generateSceneModule, parseManifest, type SceneManifest } from './typegen.js'
import type { ResolvedConfig, ResolvedScene } from './config.js'

/** What the addon's Sync Now runs; also shown to humans in the panel. */
const DEFAULT_SYNC_HINT = 'npx blendlink sync'

export interface SyncOutcome {
  scene: string
  action: 'exported' | 'built' | 'skipped'
  durationMs: number
  stats?: SceneManifest['stats']
  /** Human summary of what the vocabulary parser found ("3 colliders, 1 socket"). */
  vocabulary?: string
  warnings: string[]
}

function vocabularySummary(manifest: SceneManifest | null): string | undefined {
  const vocabulary = manifest?.vocabulary
  if (!vocabulary) return undefined
  const parts = (
    [
      ['collider', vocabulary.colliders?.length],
      ['LOD chain', vocabulary.lods?.length],
      ['socket', vocabulary.sockets?.length],
      ['hotspot', vocabulary.hotspots?.length],
      ['audio anchor', vocabulary.audio?.length],
      ['rigid body', vocabulary.physics?.length],
    ] as const
  )
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function blendBytesHashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

/** Combined hash of an external scene's declared extra inputs (e.g. its
 * pipeline config) — so config edits gate rebuilds like blend edits do. */
function inputsHashOf(scene: ResolvedScene): string | null {
  if (!scene.inputs || scene.inputs.length === 0) return null
  const digest = createHash('sha256')
  for (const input of scene.inputs) {
    if (existsSync(input)) digest.update(readFileSync(input))
  }
  return digest.digest('hex').slice(0, 16)
}

/** sync --draft: quarter resolution, an eighth of the samples — a seconds-
 * scale look preview. The manifest is stamped draft so verify refuses it. */
function draftSettings(scene: ResolvedScene): ResolvedScene['settings'] {
  if (scene.settings.mode !== 'baked') return scene.settings
  const bake = scene.settings.bake ?? {}
  return {
    ...scene.settings,
    bake: {
      ...bake,
      size: Math.max(256, Math.floor((bake.size ?? 2048) / 4)),
      samples: Math.max(8, Math.floor((bake.samples ?? 128) / 8)),
      supersample: 1,
    },
  }
}

/** External scenes: artifacts owned by another pipeline; run its declared
 * build command when the .blend drifted, skip when everything matches. */
function syncExternalScene(scene: ResolvedScene, options: { force?: boolean }): SyncOutcome {
  const started = Date.now()
  const blendHash = existsSync(scene.blendPath) ? blendBytesHashOf(scene.blendPath) : null
  const inputsHash = inputsHashOf(scene)
  const manifest = readManifest(scene.manifestPath)
  const inSync =
    blendHash !== null &&
    manifest?.blendBytesHash === blendHash &&
    (inputsHash === null || manifest?.inputsHash === inputsHash) &&
    existsSync(scene.glbPath) &&
    existsSync(scene.modulePath)
  if (inSync && !options.force) {
    // Stamp the build command even when skipping, so the Blender addon can
    // show "run this" the moment the artist's next save causes drift.
    if (scene.build && manifest && manifest.syncHint !== scene.build) {
      manifest.syncHint = scene.build
      writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    }
    return { scene: scene.name, action: 'skipped', durationMs: Date.now() - started, warnings: [] }
  }
  if (!scene.build) {
    return {
      scene: scene.name,
      action: 'skipped',
      durationMs: Date.now() - started,
      warnings: [
        'external scene is out of date but has no `build` command — run your pipeline, then `blendlink typegen <glb> --blend <file>` (or add `build` to the scene config so sync can do it)',
      ],
    }
  }
  emitProgress(0.03, `running build for ${scene.name}`)
  const result = spawnSync(scene.build, { shell: true, cwd: scene.root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`build command failed for "${scene.name}" (exit ${result.status}): ${scene.build}`)
  }
  const warnings: string[] = []
  emitProgress(0.95, 'stamping manifest')
  const rebuilt = readManifest(scene.manifestPath)
  const freshBlendHash = existsSync(scene.blendPath) ? blendBytesHashOf(scene.blendPath) : null
  if (!rebuilt || rebuilt.blendBytesHash !== freshBlendHash) {
    warnings.push(
      'build command finished but the manifest is not stamped with the current .blend — make sure it ends with `blendlink typegen <glb> --blend <file>`',
    )
  } else {
    // Stamp the build command (for the addon's "run this"), the duration
    // (for plan-time estimates), and the inputs hash (drift gate).
    rebuilt.syncHint = scene.build
    rebuilt.lastSyncDurationMs = Date.now() - started
    const freshInputsHash = inputsHashOf(scene)
    if (freshInputsHash) rebuilt.inputsHash = freshInputsHash
    writeFileSync(scene.manifestPath, JSON.stringify(rebuilt, null, 2) + '\n')
  }
  emitProgress(1, `${scene.name} up to date`)
  return {
    scene: scene.name,
    action: 'built',
    durationMs: Date.now() - started,
    ...(rebuilt?.stats ? { stats: rebuilt.stats } : {}),
    ...(vocabularySummary(rebuilt) ? { vocabulary: vocabularySummary(rebuilt) } : {}),
    warnings,
  }
}

/** Input-hash cache key: blend bytes + effective settings + Blender version. */
function sourceHash(
  scene: ResolvedScene,
  settings: ResolvedScene['settings'],
  blenderVersion: string,
): string {
  return createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .update(JSON.stringify(settings))
    .update(blenderVersion)
    .digest('hex')
    .slice(0, 16)
}

function readManifest(path: string): SceneManifest | null {
  try {
    return parseManifest(readFileSync(path, 'utf8'))
  } catch (error) {
    // A schemaVersion mismatch is LOUD but self-healing: warn, treat the
    // scene as needing a sync, and the resync rewrites at the current
    // version. Silence here once meant blind-cast misreads.
    if (error instanceof Error && error.message.includes('schemaVersion')) {
      console.warn(`! ${path}: ${error.message}`)
      return null
    }
    return null
  }
}

export async function syncScene(
  scene: ResolvedScene,
  blender: BlenderInstall,
  options: { force?: boolean; draft?: boolean; allowNewerFile?: boolean } = {},
): Promise<SyncOutcome> {
  const started = Date.now()
  if (scene.external) {
    return syncExternalScene(scene, options)
  }
  const settings = options.draft ? draftSettings(scene) : scene.settings
  const hash = sourceHash(scene, settings, blender.version)
  const existing = readManifest(scene.manifestPath)
  if (
    !options.force &&
    existing?.sourceHash === hash &&
    existsSync(scene.glbPath) &&
    existsSync(scene.modulePath)
  ) {
    if (existing && !existing.syncHint) {
      existing.syncHint = DEFAULT_SYNC_HINT
      writeFileSync(scene.manifestPath, JSON.stringify(existing, null, 2) + '\n')
    }
    return { scene: scene.name, action: 'skipped', durationMs: Date.now() - started, warnings: [] }
  }

  emitProgress(0.05, `exporting ${scene.name} with Blender`)
  const exported = await exportBlend({
    blendPath: scene.blendPath,
    outPath: scene.glbPath,
    settings,
    blender,
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  })

  const toUrl = (path: string) => scene.url.replace(/[^/]+$/, path.split(/[\\/]/).pop()!)
  // Single-atlas scenes keep the flat {url} shape; multi-atlas scenes carry
  // an additive `atlases` map (group → url). The first state is baked into
  // the GLB's materials — marked so a runtime never infers from key order.
  const states: NonNullable<SceneManifest['states']> = {}
  for (const [index, [state, byGroup]] of Object.entries(exported.bakedStates).entries()) {
    const groups = Object.keys(byGroup)
    const flat = groups.length === 1 && groups[0] === 'main'
    states[state] = {
      ...(flat
        ? { url: toUrl(byGroup['main']!) }
        : {
            atlases: Object.fromEntries(
              groups.map((group) => [group, toUrl(byGroup[group]!)]),
            ),
          }),
      ...(index === 0 ? { default: true as const } : {}),
    }
  }
  const lightGroups: NonNullable<SceneManifest['lightGroups']> = {}
  for (const [light, byGroup] of Object.entries(exported.bakedLightGroups)) {
    const groups = Object.keys(byGroup)
    const flat = groups.length === 1 && groups[0] === 'main'
    lightGroups[light] = flat
      ? { url: toUrl(byGroup['main']!.path), maxValue: byGroup['main']!.maxValue }
      : {
          atlases: Object.fromEntries(
            groups.map((group) => [
              group,
              { url: toUrl(byGroup[group]!.path), maxValue: byGroup[group]!.maxValue },
            ]),
          ),
        }
  }
  emitProgress(0.85, `generating types for ${scene.name}`)
  const { manifest, module } = await generateSceneModule({
    glbPath: scene.glbPath,
    url: scene.url,
    exportName: scene.name,
    sourceBlend: scene.blendPath,
    sourceHash: hash,
    sidecar: exported.sidecar,
    excluded: exported.excluded,
    ...(Object.keys(states).length > 0 ? { states } : {}),
    ...(Object.keys(lightGroups).length > 0 ? { lightGroups } : {}),
  })
  manifest.blendBytesHash = createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .digest('hex')
    .slice(0, 16)
  manifest.syncHint = DEFAULT_SYNC_HINT
  manifest.lastSyncDurationMs = Date.now() - started
  if (options.draft && scene.settings.mode === 'baked') manifest.draft = true
  if (exported.plan) manifest.bakePlan = exported.plan
  mkdirSync(dirname(scene.manifestPath), { recursive: true })
  writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(scene.modulePath, module)
  if (scene.settings.mode === 'baked') {
    // The composition recipe is written ONCE and then owned by the user
    // (shadcn model): it carries the shader-injection code the manifest
    // contract alone cannot hand a median three.js user.
    const recipePath = scene.modulePath.replace(/\.gen\.ts$/, '.baked.ts')
    if (!existsSync(recipePath)) {
      const { renderBakedRecipe } = await import('./bakedRecipe.js')
      writeFileSync(recipePath, renderBakedRecipe(scene.name))
    }
  }
  emitProgress(1, `${scene.name} up to date`)

  const warnings = [...exported.warnings, ...manifest.vocabulary.warnings]
  if (exported.excluded.length > 0) {
    warnings.push(`excluded by -noimp: ${exported.excluded.join(', ')}`)
  }
  if (manifest.draft) {
    warnings.push('draft bake (quarter resolution) — run `blendlink sync` before committing')
  }
  return {
    scene: scene.name,
    action: 'exported',
    durationMs: Date.now() - started,
    stats: manifest.stats,
    ...(vocabularySummary(manifest) ? { vocabulary: vocabularySummary(manifest) } : {}),
    warnings,
  }
}

export async function syncAll(
  config: ResolvedConfig,
  options: { force?: boolean; only?: string; draft?: boolean; allowNewerFile?: boolean } = {},
): Promise<SyncOutcome[]> {
  const scenes = options.only
    ? config.scenes.filter((scene) => scene.name === options.only)
    : config.scenes
  if (options.only && scenes.length === 0) {
    throw new Error(`No scene named "${options.only}" in blendlink.config.`)
  }
  const needsBlender = scenes.some((scene) => !scene.external)
  const blender = needsBlender
    ? await discoverBlender(config.blenderPath)
    : ({ version: 'none', executable: '' } as BlenderInstall)
  const outcomes: SyncOutcome[] = []
  for (const scene of scenes) {
    outcomes.push(await syncScene(scene, blender, options))
  }
  return outcomes
}

export interface VerifyIssue {
  scene: string
  problem: string
  fix: string
}

/** Blender-free drift check for CI: sources vs committed artifacts. */
export async function verifyAll(config: ResolvedConfig): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = []
  for (const scene of config.scenes) {
    const manifest = readManifest(scene.manifestPath)
    if (!manifest) {
      issues.push({
        scene: scene.name,
        problem: `missing generated manifest (${scene.manifestPath})`,
        fix: 'Run `blendlink sync` and commit the generated files.',
      })
      continue
    }
    if (!existsSync(scene.modulePath)) {
      // A deleted gen.ts previously passed verify and failed later as an
      // unrelated-looking TS error in the app build.
      issues.push({
        scene: scene.name,
        problem: `missing generated module (${scene.modulePath})`,
        fix: 'Run `blendlink sync` and commit the generated files.',
      })
      continue
    }
    if (manifest.draft) {
      issues.push({
        scene: scene.name,
        problem: 'draft artifacts (quarter-resolution preview) are committed',
        fix: 'Run `blendlink sync` (full quality) and commit the regenerated files.',
      })
      continue
    }
    if (scene.external) {
      const currentInputsHash = inputsHashOf(scene)
      if (currentInputsHash && manifest.inputsHash && manifest.inputsHash !== currentInputsHash) {
        issues.push({
          scene: scene.name,
          problem: 'a declared input file (e.g. the pipeline config) changed after the last sync',
          fix: scene.build
            ? `Run \`${scene.build}\` (or \`blendlink sync\`) and commit.`
            : 'Re-run your export pipeline and commit.',
        })
        continue
      }
    }
    if (!existsSync(scene.glbPath)) {
      issues.push({
        scene: scene.name,
        problem: `GLB missing from ${scene.glbPath} but listed in the manifest`,
        fix: 'This file should be committed — check .gitignore for *.glb, or run `blendlink sync`.',
      })
      continue
    }
    const glbHash = createHash('sha256')
      .update(readFileSync(scene.glbPath))
      .digest('hex')
      .slice(0, 16)
    if (glbHash !== manifest.hash) {
      issues.push({
        scene: scene.name,
        problem: 'GLB on disk does not match the manifest hash',
        fix: 'Run `blendlink sync` and commit source + artifacts together.',
      })
    }
    // Blend-byte drift check: works Blender-free for synced AND external
    // scenes, as long as the manifest was stamped with blendBytesHash
    // (sync does this automatically; external pipelines via typegen --blend).
    if (manifest.blendBytesHash && existsSync(scene.blendPath)) {
      const blendBytesHash = createHash('sha256')
        .update(readFileSync(scene.blendPath))
        .digest('hex')
        .slice(0, 16)
      if (manifest.blendBytesHash !== blendBytesHash) {
        issues.push({
          scene: scene.name,
          problem: `${scene.blendPath} changed after the last sync`,
          fix: scene.external
            ? 'Re-run your export pipeline, then `blendlink typegen <glb> --blend <file>`, and commit.'
            : 'Run `blendlink sync` (requires Blender) and commit the regenerated artifacts.',
        })
      }
    }
  }
  return issues
}
