#!/usr/bin/env node
import { discoverBlender } from './discover.js'
import { loadConfig } from './config.js'
import {
  commitPublishedFiles,
  draftSettings,
  isBlockingVerifyIssue,
  publishKtx2RuntimeAssets,
  syncAll,
  verifyAll,
} from './sync.js'
import { compileProject } from './compiler.js'
import { generateSceneModule } from './typegen.js'
import {
  formatHumanWarnings,
  formatMaterialPortabilityAdvisory,
  performanceResultFails,
} from './cliWarnings.js'
import type { BakePlan } from './invoke.js'
import {
  BAKED_RECIPE_TEMPLATE_VERSION,
  bakedRecipeBackupPath,
  inspectBakedRecipeTemplate,
  renderBakedRecipe,
  updateBakedRecipeTemplateFile,
} from './bakedRecipe.js'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPublicationScopes } from './publicationScopes.js'
import { writeLocalPathProvenance } from './generatedProvenance.js'

const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const valueFlags = new Set(['--blend', '--tier', '--name', '--url', '--out', '--plan'])
const positional: string[] = []
for (let index = 0; index < rest.length; index += 1) {
  const argument = rest[index]!
  if (!argument.startsWith('--')) {
    positional.push(argument)
    continue
  }
  if (valueFlags.has(argument) && rest[index + 1] && !rest[index + 1]!.startsWith('--')) {
    index += 1
  }
}
const flagValue = (name: string) => {
  const index = rest.indexOf(name)
  return index >= 0 && rest[index + 1] && !rest[index + 1]!.startsWith('--')
    ? rest[index + 1]
    : undefined
}

/** One legible line per material: "Base Color: baked 512 tile | Metallic:
 * factor 0.0 | …" — the MTL-BAKE-001 per-channel visibility that turns a
 * wall of identical needsBake errors into individual decisions. */
function formatChannelRoutes(
  record?: {
    materialCompilation?: {
      channels?: {
        channels: Array<{
          channel: string
          route: string
          uv?: string
          resolution?: number | string
          pass?: string
          value?: number | number[] | null
          strength?: number | null
          tslIr?: unknown
        }>
      }
    }
  },
): string | null {
  const entries = record?.materialCompilation?.channels?.channels
  if (!entries || entries.length === 0) return null
  const formatValue = (value: number | number[] | null | undefined) => {
    if (typeof value === 'number') return ` ${Number(value.toFixed(3))}`
    if (Array.isArray(value)) {
      return ` (${value.slice(0, 3).map((item) => Number(item.toFixed(3))).join(', ')})`
    }
    return ''
  }
  return entries.map((entry) => {
    // Attached TSL IR is evidence beside the carrier, not a route.
    const tsl = entry.tslIr ? ' +tsl' : ''
    if (entry.route === 'factor') {
      return `${entry.channel}: factor${formatValue(entry.value)}${tsl}`
    }
    if (entry.route === 'factor-over-carrier') {
      return `${entry.channel}: factor over carrier${formatValue(entry.value)}${tsl}`
    }
    if (entry.route === 'program') {
      // Standalone TSL route: the program IS the payload, not evidence
      // beside a carrier, so the +tsl suffix would be redundant here.
      return `${entry.channel}: program`
    }
    if (entry.route === 'bake') {
      const size = typeof entry.resolution === 'number'
        ? ` ${entry.resolution}`
        : ''
      const passLabel = entry.pass === 'NORMAL' ? ' normal-pass' : ''
      return `${entry.channel}: baked${size} ${entry.uv ?? 'tile'}${passLabel}${tsl}`
    }
    if (entry.route === 'passthrough') return `${entry.channel}: passthrough${tsl}`
    return `${entry.channel}: refused${tsl}`
  }).join(' | ')
}

async function main(): Promise<number> {
  switch (command) {
    case 'recipe': {
      if (positional[0] !== 'update') {
        console.error('usage: blendlink recipe update [scene]')
        return 2
      }
      const config = await loadConfig(process.cwd())
      const requested = positional[1]
      const scenes = requested
        ? config.scenes.filter((scene) => scene.name === requested)
        : config.scenes
      if (requested && scenes.length === 0) {
        console.error(`No scene named "${requested}" in blendlink.config.`)
        return 2
      }
      for (const scene of scenes) {
        const recipePath = scene.modulePath.replace(/\.gen\.ts$/, '.baked.ts')
        if (recipePath === scene.modulePath) {
          throw new Error(`Generated scene module must end in .gen.ts: ${scene.modulePath}`)
        }
        const before = existsSync(recipePath)
          ? inspectBakedRecipeTemplate(readFileSync(recipePath, 'utf8'))
          : null
        const backupPath = before && before.kind !== 'current' && before.kind !== 'future'
          ? bakedRecipeBackupPath(recipePath, before)
          : null
        const result = updateBakedRecipeTemplateFile(recipePath, scene.name)
        const action = result.action
        console.log(
          action === 'current'
            ? `\u00b7 ${scene.name}: baked recipe template is current`
            : action === 'created'
              ? `\u2713 ${scene.name}: created ${recipePath}`
              : `\u2713 ${scene.name}: preserved the previous editable recipe at ${backupPath} and installed template v${BAKED_RECIPE_TEMPLATE_VERSION}`,
        )
      }
      return 0
    }
    case 'discover': {
      const install = await discoverBlender()
      console.log(`${install.version}\n${install.executable}`)
      return 0
    }
    case 'addon': {
      if (positional[0] !== 'install') {
        console.error('usage: blendlink addon install')
        return 2
      }
      const { installBlenderAddon } = await import('./addon.js')
      const result = await installBlenderAddon()
      console.log(
        `✓ installed and enabled Blendlink ${result.addonVersion} in Blender ${result.blenderVersion}`,
      )
      return 0
    }
    case 'sync':
    case 'compile': {
      const report = (outcome: Awaited<ReturnType<typeof syncAll>>[number]) => {
        const stats = outcome.stats
          ? ` — ${(outcome.stats.bytes / 1024).toFixed(0)}kB, ${outcome.stats.triangles} tris`
          : ''
        const verb = { exported: '✓ synced ', built: '✓ built  ', skipped: '· in sync' }[
          outcome.action
        ]
        console.log(
          `${verb} ${outcome.scene}${outcome.action === 'skipped' ? '' : ` in ${(outcome.durationMs / 1000).toFixed(1)}s`}${stats}`,
        )
        if (outcome.vocabulary) console.log(`  ◦ ${outcome.vocabulary}`)
        for (const warning of formatHumanWarnings(outcome.warnings)) console.warn(`  ! ${warning}`)
      }
      const outcomes = await compileProject({
        root: process.cwd(),
        force: flags.has('--force'),
        scene: positional[0],
        quality: flags.has('--draft') || flags.has('--preview') ? 'preview' : 'final',
        allowNewerFile: flags.has('--allow-newer'),
      })
      outcomes.forEach(report)
      if (flags.has('--watch')) {
        const config = await loadConfig(process.cwd())
        const { watchScenes } = await import('./watch.js')
        await watchScenes(config, (outcome) => {
          if ('error' in outcome) console.error(`✗ ${outcome.scene}: ${outcome.error}`)
          else report(outcome)
        }, {
          draft: flags.has('--draft') || flags.has('--preview'),
          allowNewerFile: flags.has('--allow-newer'),
          ...(positional[0] ? { only: positional[0] } : {}),
        })
        console.log('watching scene sources, declared inputs, and blendlink.config — ctrl-c to stop')
        await new Promise(() => {}) // stay alive until interrupted
      }
      return 0
    }
    case 'preview': {
      const requestedBlend = flagValue('--blend')
      if (flags.has('--blend')) {
        if (!requestedBlend) {
          console.error('usage: blendlink preview --blend <saved-scene.blend> [--no-open]')
          return 2
        }
        const { runPreviewStudio } = await import('./preview.js')
        return runPreviewStudio({
          blendPath: resolve(process.cwd(), requestedBlend),
          openBrowser: !flags.has('--no-open'),
          force: flags.has('--force'),
          allowNewerFile: flags.has('--allow-newer'),
        })
      }
      const config = await loadConfig(process.cwd())
      const { runWebsitePreview } = await import('./preview.js')
      return runWebsitePreview(config, {
        openBrowser: !flags.has('--no-open'),
        autoUpdate: true,
        ...(positional[0] ? { only: positional[0] } : {}),
        force: flags.has('--force'),
        allowNewerFile: flags.has('--allow-newer'),
      })
    }
    case 'verify': {
      const config = await loadConfig(process.cwd())
      const issues = await verifyAll(config, positional[0] ? { only: positional[0] } : {})
      for (const warning of issues.filter((issue) => !isBlockingVerifyIssue(issue))) {
        console.warn(`! ${warning.scene}: ${warning.problem}\n  follow-up: ${warning.fix}`)
      }
      const blocking = issues.filter(isBlockingVerifyIssue)
      if (blocking.length === 0) {
        console.log(
          `✓ blendlink verify${positional[0] ? ` ${positional[0]}` : ''}: ` +
            (issues.length > 0
              ? 'sources and artifacts are in sync with explicit accepted-risk warnings'
              : 'sources and artifacts are in sync'),
        )
        return 0
      }
      for (const issue of blocking) {
        console.error(`✗ ${issue.scene}: ${issue.problem}\n  fix: ${issue.fix}`)
      }
      return 1
    }
    case 'publish': {
      const { publishWebsiteProject } = await import('./publish.js')
      const result = await publishWebsiteProject({
        root: process.cwd(),
        ...(positional[0] ? { scene: positional[0] } : {}),
        ...(flags.has('--force') ? { force: true } : {}),
        ...(flags.has('--allow-newer') ? { allowNewerFile: true } : {}),
        ...(flags.has('--assets-only') ? { assetsOnly: true } : {}),
      })
      for (const outcome of result.outcomes) {
        const action = outcome.action === 'skipped' ? 'already Final' : 'compiled Final'
        console.log(`✓ ${outcome.scene}: ${action}`)
        for (const warning of formatHumanWarnings(outcome.warnings)) console.warn(`  ! ${warning}`)
      }
      if (result.siteBuild.status === 'passed') {
        console.log(`✓ website build passed: ${result.siteBuild.command}`)
      } else {
        console.log(`· website build skipped: ${result.siteBuild.reason}`)
      }
      if (result.browserSmoke.status === 'passed') {
        console.log(`✓ production browser smoke passed: ${result.browserSmoke.command}`)
      } else {
        console.log(`· production browser smoke skipped: ${result.browserSmoke.reason}`)
      }
      console.log(result.browserSmoke.status === 'passed'
        ? '✓ Final assets, repository build, and configured browser smoke verified; ' +
          'deploy with the website\'s normal hosting workflow'
        : result.siteBuild.status === 'passed'
        ? "✓ Final assets and repository build verified; run the website's browser checks, " +
          'then deploy with its normal hosting workflow'
        : "✓ Final assets verified; run the website's build and browser checks before deployment")
      return 0
    }
    case 'perf': {
      const config = await loadConfig(process.cwd())
      const requested = positional[0]
      const scenes = requested
        ? config.scenes.filter((scene) => scene.name === requested)
        : config.scenes
      if (requested && scenes.length === 0) {
        console.error(`No scene named "${requested}" in blendlink.config.`)
        return 2
      }
      const rawTier = flagValue('--tier') ?? 'balanced'
      if (rawTier !== 'mobile' && rawTier !== 'balanced' && rawTier !== 'showcase') {
        console.error('usage: blendlink perf [scene] [--tier mobile|balanced|showcase] [--json] [--fail]')
        return 2
      }
      const { analyzeCompiledScenePerformance, defaultPerformanceBudgets } = await import('./performance.js')
      const { auditCompiledSceneArtifact } = await import('./compiledSceneAudit.js')
      const { parseManifest } = await import('./typegen.js')
      const reports: Array<{
        scene: string
        report?: ReturnType<typeof analyzeCompiledScenePerformance>
        audit?: Awaited<ReturnType<typeof auditCompiledSceneArtifact>>
        applicationMaterialAdapter?: string
        error?: string
      }> = []
      for (const scene of scenes) {
        if (!existsSync(scene.manifestPath)) {
          reports.push({ scene: scene.name, error: `missing manifest ${scene.manifestPath}; run blendlink compile` })
          continue
        }
        const manifest = parseManifest(readFileSync(scene.manifestPath, 'utf8'))
        if (!manifest) {
          reports.push({ scene: scene.name, error: `${scene.manifestPath} is not a Blendlink manifest` })
          continue
        }
        if (!existsSync(scene.glbPath)) {
          reports.push({ scene: scene.name, error: `missing GLB ${scene.glbPath}; run blendlink compile` })
          continue
        }
        const audit = await auditCompiledSceneArtifact({
          manifest,
          glbBytes: readFileSync(scene.glbPath),
        })
        reports.push({
          scene: scene.name,
          report: analyzeCompiledScenePerformance(manifest, audit, defaultPerformanceBudgets(rawTier)),
          audit,
          ...(scene.applicationMaterialAdapter
            ? { applicationMaterialAdapter: scene.applicationMaterialAdapter.description }
            : {}),
        })
      }
      if (flags.has('--json')) {
        console.log(JSON.stringify({ evidence: 'compiled-artifact-plus-build-estimate', reports }, null, 2))
      } else {
        for (const result of reports) {
          if (!result.report) {
            console.error(`\u2717 ${result.scene}: ${result.error}`)
            continue
          }
          const report = result.report
          const mb = (bytes: number | null) => bytes === null ? '\u2014' : `${(bytes / 1024 / 1024).toFixed(2)} MB`
          console.log(`\n${result.scene} \u2014 ${report.tier} build budget`)
          console.log(`  GLB ${mb(report.measurements.initialBytes)} \u00b7 GPU textures ${mb(report.measurements.gpuTextureBytes)} \u00b7 ${report.measurements.triangles.toLocaleString()} tris \u00b7 ${report.measurements.drawCalls ?? '\u2014'} draws`)
          console.log(
            `  decoded accessors ${mb(report.artifact.decodedAccessorBytes)} \u00b7 ` +
            `geometry ${mb(report.artifact.decodedGeometryAccessorBytes)} \u00b7 ` +
            `embedded images ${mb(report.artifact.embeddedImageBytes)} (${report.artifact.embeddedImages})`,
          )
          const dominant = report.artifact.dominantTriangleMesh
          if (dominant && result.audit && result.audit.counts.renderedTriangles > 0) {
            const share = dominant.renderedTriangles / result.audit.counts.renderedTriangles * 100
            const nodes = dominant.nodes.length > 0 ? dominant.nodes.join(', ') : '(unbound mesh)'
            console.log(
              `  top triangles ${nodes} \u2192 ${dominant.name}: ${dominant.renderedTriangles.toLocaleString()} tris ` +
              `(${share.toFixed(1)}%) \u00b7 ${mb(dominant.referencedDecodedAccessorBytes)} decoded`,
            )
          }
          const dominantDecoded = report.artifact.dominantDecodedGeometryMesh
          if (dominantDecoded && dominantDecoded.index !== dominant?.index) {
            const nodes = dominantDecoded.nodes.length > 0
              ? dominantDecoded.nodes.join(', ')
              : '(unbound mesh)'
            console.log(
              `  top decoded geometry ${nodes} \u2192 ${dominantDecoded.name}: ` +
              `${mb(dominantDecoded.referencedDecodedAccessorBytes)}`,
            )
          }
          if (report.measurements.deliverySavedBytes !== null) {
            console.log(`  verified atlas delivery saving ${mb(report.measurements.deliverySavedBytes)}`)
          }
          if (result.audit) {
            for (const [index, line] of formatMaterialPortabilityAdvisory(result.audit).entries()) {
              console.log(index === 0 ? `  · ${line}` : `    ${line}`)
            }
          }
          for (const diagnostic of report.diagnostics) {
            const marker = diagnostic.severity === 'warning' ? '!' : '\u00b7'
            console[diagnostic.severity === 'warning' ? 'warn' : 'log'](
              `  ${marker} ${diagnostic.message}\n    ${diagnostic.recommendation}`,
            )
          }
          const collapse = result.audit?.materialPayloadCollapse
          if (collapse?.detected) {
            const family = collapse.families[0]
            console.warn(
              `  ! Material appearance collapsed: all ${collapse.affectedTriangles.toLocaleString()} ` +
              'rendered triangles use Needs Bake materials with no meaningful glTF material payload.\n' +
              `    Dominant family: ${family?.materials.slice(0, 3).join(', ') ?? 'unknown'} ` +
              `(${(collapse.dominantAffectedTriangles / collapse.totalRenderedTriangles * 100).toFixed(1)}%). ` +
              `${family?.reasons.slice(0, 2).join(' ') ?? ''}\n` +
              '    Use a proven bake/materialization route, simplify to portable Principled inputs, ' +
              (result.applicationMaterialAdapter
                ? `or keep the acknowledged application adapter verified: ${result.applicationMaterialAdapter}.`
                : 'or declare and verify an application-owned material adapter.'),
            )
          }
        }
      }
      const failed = reports.some(performanceResultFails)
      return flags.has('--fail') && failed ? 1 : 0
    }
    case 'typegen': {
      // GLB-generic mode: no Blender, no config required.
      const glbPath = positional[0]
      if (!glbPath) {
        console.error('usage: blendlink typegen <file.glb> [--name n] [--url u] [--out dir] [--blend file.blend]')
        return 2
      }
      const name = flagValue('--name') ?? basename(glbPath).replace(/\.glb$/i, '')
      let url = flagValue('--url') ?? `/${basename(glbPath)}`
      // Git Bash rewrites leading-slash args into C:/Program Files/Git/...
      // Catch the corruption instead of stamping a filesystem path as a URL.
      if (/^[A-Za-z]:[\\/]/.test(url)) {
        console.error(
          `--url looks like a Windows filesystem path (${url}) — if you ran this from Git Bash, its path conversion mangled the argument. Run from PowerShell/cmd, or set MSYS_NO_PATHCONV=1.`,
        )
        return 2
      }
      if (!url.startsWith('/') && !/^https?:/.test(url)) url = `/${url}`
      const outDir = resolve(process.cwd(), flagValue('--out') ?? dirname(glbPath))
      // --blend stamps provenance so `blendlink verify` and the Blender addon
      // can detect drift even when an external pipeline produced the GLB.
      const blend = flagValue('--blend')
      // Parse external bake evidence before typegen so atlas-layout evidence
      // is finalized against the decoded GLB, rather than patched onto only
      // the manifest after the generated module has already been rendered.
      const planFile = flagValue('--plan')
      let bakePlan: BakePlan | undefined
      if (planFile) {
        const planPath = resolve(process.cwd(), planFile)
        if (existsSync(planPath)) {
          bakePlan = JSON.parse(readFileSync(planPath, 'utf8')) as BakePlan
        } else {
          console.warn(`! --plan ${planFile} not found — manifest stamped without a bake plan`)
        }
      }
      const absoluteGlbPath = resolve(process.cwd(), glbPath)
      return withPublicationScopes({
        roots: [dirname(absoluteGlbPath), outDir],
        intent: 'typegen',
        label: `${name} / Typegen`,
        onWait(fact) {
          console.log(`\u00b7 ${fact.message}`)
        },
      }, async () => {
      const { manifest, module, localProvenance } = await generateSceneModule({
        glbPath: absoluteGlbPath,
        url,
        exportName: name,
        provenanceRoot: process.cwd(),
        ...(blend ? { sourceBlend: blend } : {}),
        ...(bakePlan ? { bakePlan } : {}),
      })
      if (blend) {
        const { createHash } = await import('node:crypto')
        manifest.blendBytesHash = createHash('sha256')
          .update(readFileSync(resolve(process.cwd(), blend)))
          .digest('hex')
          .slice(0, 16)
      }
      const candidates: Array<{ finalPath: string; content: string }> = [
        {
          finalPath: join(outDir, `${name}.manifest.json`),
          content: JSON.stringify(manifest, null, 2) + '\n',
        },
        {
          finalPath: join(outDir, `${name}.gen.ts`),
          content: module,
        },
      ]
      // Setup-generated Vanilla and R3F consumers import this seam for every
      // presentation. It is descriptor-driven (therefore a Realtime no-op)
      // and written once so external-pipeline users can edit it safely.
      const recipePath = join(outDir, `${name}.baked.ts`)
      if (!existsSync(recipePath)) {
        candidates.push({
          finalPath: recipePath,
          content: renderBakedRecipe(name),
        })
      } else {
        const status = inspectBakedRecipeTemplate(readFileSync(recipePath, 'utf8'))
        if (status.kind !== 'current') {
          console.warn(
            status.kind === 'future'
              ? `! ${recipePath} uses newer baked recipe template v${status.version}; it was left untouched`
              : `! ${recipePath} predates baked composition template v${BAKED_RECIPE_TEMPLATE_VERSION}; ` +
                'it was left untouched. In a configured project, run `blendlink recipe update <scene>`.',
          )
        }
      }
      if (manifest.requiresKtx2 === true) {
        const published = await publishKtx2RuntimeAssets(dirname(absoluteGlbPath))
        console.log(
          `\u2713 published KTX2 decoder: ${published.length} files \u2192 ${dirname(published[0]!)}`,
        )
      }
      writeLocalPathProvenance(localProvenance)
      commitPublishedFiles(
        candidates,
        `typegen-${process.pid}-${Date.now()}`,
      )
      console.log(
        `✓ typegen ${name}: ${manifest.nodes.length} nodes, ${manifest.materials.length} materials, ${Object.keys(manifest.clips).length} clips → ${join(outDir, `${name}.gen.ts`)}`,
      )
      for (const warning of formatHumanWarnings(manifest.vocabulary.warnings)) {
        console.warn(`  ! ${warning}`)
      }
      return 0
      })
    }
    case 'plan': {
      const config = await loadConfig(process.cwd())
      const { discoverBlender } = await import('./discover.js')
      const { exportBlend } = await import('./invoke.js')
      const { existsSync } = await import('node:fs')
      const {
        inspectRealtimePlanMaterialDiagnostics,
        readPlanSyncDuration,
      } = await import('./planManifest.js')
      const scenes = positional[0]
        ? config.scenes.filter((scene) => scene.name === positional[0])
        : config.scenes
      if (positional[0] && scenes.length === 0) {
        console.error(`No scene named "${positional[0]}" in blendlink.config.`)
        return 2
      }
      const exportableScenes = scenes.filter((scene) => !scene.external)
      const asJson = flags.has('--json')
      const planQuality = flags.has('--preview') || flags.has('--draft') ? 'preview' : 'final'
      for (const scene of scenes) {
        if (asJson) break
        if (scene.external) console.log(`· ${scene.name}: external — its pipeline owns the bake`)
      }
      if (exportableScenes.length === 0) {
        if (asJson) console.log(JSON.stringify({ scenes: [] }, null, 2))
        return 0
      }
      const blender = await discoverBlender(config.blenderPath)
      const jsonScenes: Array<{
        scene: string
        quality: 'preview' | 'final'
        plan: unknown
        inspection?: unknown
      }> = []
      let hasPlanErrors = false
      for (const scene of exportableScenes) {
        const result = await exportBlend({
          blendPath: scene.blendPath,
          outPath: scene.glbPath,
          settings: {
            ...(planQuality === 'preview' ? draftSettings(scene) : scene.settings),
            planOnly: true,
          },
          blender,
        })
        const plan = result.plan
        const inspection = inspectRealtimePlanMaterialDiagnostics(
          result.sidecar.diagnostics,
          {
            ...(plan ? { bakePlan: plan } : {}),
            ...(scene.applicationMaterialAdapter
              ? { applicationMaterialAdapter: scene.applicationMaterialAdapter }
              : {}),
          },
        )
        if (inspection.errors.length > 0) {
          hasPlanErrors = true
          if (asJson) {
            jsonScenes.push({
              scene: scene.name,
              quality: planQuality,
              plan: plan ?? null,
              inspection,
            })
          } else {
            console.error(
              `\nmaterial plan blocked - ${scene.name}: ` +
                `${inspection.errors.length} used material${inspection.errors.length === 1 ? '' : 's'} ` +
                'would lose authored surface behavior',
            )
            const records = result.sidecar.diagnostics?.materials ?? []
            for (const issue of inspection.errors) {
              console.error(
                `  x ${issue.material}: ${issue.summary} ` +
                `(used by ${issue.usedBy.join(', ')})`,
              )
              for (const reason of issue.reasons) console.error(`      ${reason}`)
              const record = records.find(
                (item) => item.material === issue.material,
              )
              const routes = formatChannelRoutes(record)
              if (routes) console.error(`      channels: ${routes}`)
            }
            console.error(
              '  Open Material Fidelity in Blender and choose an evidenced Website Material, ' +
              'the per-channel Material Bake, portable glTF, or a supported Appearance route ' +
              'before treating this plan as parity.',
            )
          }
          continue
        }
        {
          const records = result.sidecar.diagnostics?.materials ?? []
          const materialBakes = records.filter(
            (item) => ['materialBake', 'tslProgram'].includes(item.materialCompilation?.intent ?? ''),
          )
          if (materialBakes.length > 0 && !asJson) {
            console.log(`\nmaterial bake — ${scene.name}:`)
            for (const record of materialBakes) {
              const routes = formatChannelRoutes(record)
              console.log(
                `  · ${record.material}: ${routes ?? 'per-channel plan pending'}`,
              )
            }
          }
        }
        if (inspection.warnings.length > 0) {
          if (asJson) {
            if (!plan) {
              jsonScenes.push({
                scene: scene.name,
                quality: planQuality,
                plan: null,
                inspection,
              })
            }
          } else {
            console.warn(
              `\nmaterial plan acknowledged - ${scene.name}: ` +
              `${inspection.warnings.length} used material${inspection.warnings.length === 1 ? '' : 's'} ` +
              'still require the declared website-owned material adapter',
            )
            for (const issue of inspection.warnings) {
              console.warn(
                `  ! ${issue.material}: ${issue.summary} ` +
                `(used by ${issue.usedBy.join(', ')})`,
              )
              for (const reason of issue.reasons) console.warn(`      ${reason}`)
            }
            console.warn(
              `  Accepted by applicationMaterialAdapter: ` +
              `${scene.applicationMaterialAdapter?.description}. ` +
              'Keep this adapter covered by the application browser gate.',
            )
          }
          if (!plan) continue
        }
        if (!plan) {
          if (asJson) jsonScenes.push({ scene: scene.name, quality: planQuality, plan: null })
          else console.log(`· ${scene.name}: realtime presentation — nothing to bake`)
          continue
        }
        if ((plan.errors?.length ?? 0) > 0) hasPlanErrors = true
        if (asJson) {
          jsonScenes.push({
            scene: scene.name,
            quality: planQuality,
            plan,
            ...(inspection.warnings.length > 0 ? { inspection } : {}),
          })
          continue
        }
        const supersampled = plan.supersample > 1
          ? ` (baked at ${plan.atlasSize * plan.supersample}px, resolved down)`
          : ''
        console.log(
          `\nbake plan (${planQuality === 'preview' ? 'Preview' : 'Final'}) — ` +
            `${scene.name}: ${plan.atlasSize}px atlas${supersampled}, ` +
            `${plan.samples} samples, margin ${plan.marginPx}px`,
        )
        const multiAtlas = Object.keys(plan.atlases ?? {}).length > 1
        const rows = plan.objects.map((entry) => ({
          name: entry.name,
          px: `${entry.pxPerMeter.toFixed(0)}px/m`,
          screen: entry.screenDensity !== null ? entry.screenDensity.toFixed(0) : '—',
          share: multiAtlas
            ? `${entry.atlas}:${(entry.uvShare * 100).toFixed(1)}%`
            : `${(entry.uvShare * 100).toFixed(1)}%`,
          weight: entry.artistWeight === 1 && entry.autoWeight === 1
            ? '—'
            : `${entry.autoWeight.toFixed(2)}×${entry.artistWeight.toFixed(2)}`,
        }))
        const width = Math.max(...rows.map((row) => row.name.length), 6)
        console.log(
          `  ${'object'.padEnd(width)}  ${'px/m'.padStart(8)}  ${'screen'.padStart(7)}  ${'atlas'.padStart(6)}  ${'weight'.padStart(11)}`,
        )
        for (const row of rows) {
          console.log(
            `  ${row.name.padEnd(width)}  ${row.px.padStart(8)}  ${row.screen.padStart(7)}  ${row.share.padStart(6)}  ${row.weight.padStart(11)}`,
          )
        }
        console.log('  (screen = px/m × camera distance; equal values = equal perceived quality)')
        const bakes = [
          `${plan.states.length} state${plan.states.length === 1 ? '' : 's'} (${plan.states.join(', ')})`,
          ...(plan.lightGroups.length > 0
            ? [`${plan.lightGroups.length} light group${plan.lightGroups.length === 1 ? '' : 's'} (${plan.lightGroups.join(', ')})`]
            : []),
        ]
        const occupancyText = plan.atlases
          ? Object.entries(plan.atlases)
              .map(([name, atlas]) =>
                `${name} ${atlas.size}px ${(atlas.occupancy * 100).toFixed(0)}% (${atlas.objects} objects)`,
              )
              .join(' · ')
          : `atlas occupancy ${(plan.occupancy * 100).toFixed(0)}%`
        console.log(`  ${occupancyText} · ${bakes.join(' + ')} = ${plan.bakeCount} bakes`)
        if (plan.collisionProxies.length > 0) {
          console.log(
            `  collision proxies excluded from the bake: ${plan.collisionProxies.join(', ')}`,
          )
        }
        for (const dynamic of plan.dynamicObjects ?? []) {
          console.log(`  realtime (lit in Three.js): ${dynamic.name} — ${dynamic.reason}`)
        }
        if (existsSync(scene.manifestPath)) {
          const lastSyncDurationMs = readPlanSyncDuration(scene.manifestPath)
          if (lastSyncDurationMs) {
            console.log(`  last sync took ${(lastSyncDurationMs / 1000).toFixed(1)}s`)
          }
        }
        for (const warning of plan.warnings) console.warn(`  ! ${warning}`)
        for (const error of plan.errors ?? []) console.error(`  ✗ ${error}`)
      }
      if (asJson) console.log(JSON.stringify({ scenes: jsonScenes }, null, 2))
      return hasPlanErrors ? 1 : 0
    }
    case 'init': {
      const { initProject } = await import('./init.js')
      const result = initProject(process.cwd())
      if (!result.created) {
        console.log('blendlink.config already exists — nothing to do.')
        return 0
      }
      console.log(`✓ created blendlink.config.mjs`)
      if (result.sampleCopied) {
        console.log('  ◦ no .blend files found — copied the bundled sample to assets/sample.blend')
      } else {
        for (const scene of result.scenes) console.log(`  ◦ found ${scene}`)
      }
      console.log(
        '\nnext steps:\n' +
          '  1. open each .blend and click Blendlink > Set Up Blendlink Scene\n' +
          '  2. blendlink compile       publish a Final build + typed integration data\n' +
          '  3. commit the generated artifacts (plain git, no LFS needed)\n' +
          '  4. blendlink verify        add the Blender-free drift check to CI\n' +
          '  5. run blendlink setup when you want the guided website attachment',
      )
      if (result.sampleCopied) {
        console.log(
          '\nstart with assets/sample.blend: the Blendlink workspace explains scene readiness, ' +
            'object bake choices, Main atlas ownership, Preview, and Final without requiring website code first.',
        )
      }
      return 0
    }
    case 'connect':
    case 'setup': {
      const { setupWebsiteProject } = await import('./projectSetup.js')
      const selectedBlend = flagValue('--blend')
      if (flags.has('--blend') && !selectedBlend) {
        console.error('usage: blendlink connect [site-dir] --blend <saved-scene.blend>')
        return 2
      }
      const root = resolve(process.cwd(), positional[0] ?? '.')
      const result = await setupWebsiteProject(root, selectedBlend
        ? { blendPath: resolve(process.cwd(), selectedBlend) }
        : {})
      const stack = {
        'new-three-vite': 'new Three.js + Vite website',
        'three': 'existing Three.js website',
        'react-three-fiber': 'existing React Three Fiber website',
      }[result.stack]
      console.log(`✓ Blendlink connected ${stack} at ${result.root}`)
      for (const change of result.changes) console.log(`  ◦ ${change}`)
      for (const warning of result.warnings) console.warn(`  ! ${warning}`)
      console.log('\nnext actions:')
      result.nextActions.forEach((action, index) => console.log(`  ${index + 1}. ${action}`))
      return 0
    }
    case 'doctor': {
      const { doctor } = await import('./doctor.js')
      const lines = await doctor(process.cwd())
      const icon = { ok: '✓', warn: '!', fail: '✗' }
      for (const line of lines) console.log(`${icon[line.level]} ${line.message}`)
      return lines.some((line) => line.level === 'fail') ? 1 : 0
    }
    case 'version':
    case '--version':
    case '-v': {
      const { readFileSync: read } = await import('node:fs')
      const pkg = JSON.parse(
        read(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
      ) as { version: string }
      console.log(pkg.version)
      return 0
    }
    default: {
      const usage =
        'blendlink — make the scene in Blender; ship it beautifully in Three.js\n\n' +
        'commands:\n' +
        '  connect [site-dir] [--blend saved-scene.blend]\n' +
        '                           connect an existing Three/R3F site, or scaffold a minimal Three/Vite site\n' +
        '                           (creates a thin scene binding; never overwrites app source)\n' +
        '  setup [site-dir]         compatibility alias for connect\n' +
        '  addon install            install and enable the Blendlink artist workspace in Blender\n' +
        '  compile [scene] [--preview] [--force] [--watch] [--allow-newer]\n' +
        '                           publish Final by default; --preview uses the scene-owned Preview profile\n' +
        '  preview [scene] [--no-open]\n' +
        '                           compile Preview, start the connected project server, and open its reported URL\n' +
        '  preview --blend <saved-scene.blend> [--no-open]\n' +
        '                           one-click disposable Preview Studio: scaffold/cache, compile Preview, and open it\n' +
        '  publish [scene] [--assets-only] [--force] [--allow-newer]\n' +
        '                           compile Final, verify selected artifacts, and run the website build;\n' +
        '                           --assets-only stops at verified static assets for custom pipelines\n' +
        '  sync [scene] [--force] [--watch] [--draft] [--allow-newer]\n' +
        '                           compatibility alias for compile (--draft is the legacy --preview name;\n' +
        '                           external scenes run their build command;\n' +
        '                           --watch follows .blend, declared inputs, and config changes;\n' +
        '                           Preview artifacts are refused by verify)\n' +
        '  plan [scene] [--preview] [--json]\n' +
        '                           inspect Final by default or the resolved Preview profile\n' +
        '  verify [scene]           Blender-free scene-scoped or project-wide drift check (CI)\n' +
        '  perf [scene] [--tier mobile|balanced|showcase] [--json] [--fail]\n' +
        '                           inspect build budgets; browser runtime evidence remains required\n' +
        '  recipe update [scene]    back up an older editable baked recipe, then install the current template\n' +
        '  typegen <glb> [--blend f.blend] [...]\n' +
        '                           expert seam for an externally-built GLB\n' +
        '  init                     config-only discovery; connect is the guided first run\n' +
        '  doctor                   check Blender, addon, config, drift, and local tools\n' +
        '  discover                 locate the Blender executable\n' +
        '  help                     this text (also --help); version prints the version'
      const wantsHelp = !command || command === 'help' || command === '--help' || command === '-h'
      if (wantsHelp) {
        console.log(usage)
        return 0
      }
      console.error(`unknown command "${command}"\n\n${usage}`)
      return 2
    }
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    // The invoker collects Blender's last stderr/stdout lines on failure —
    // showing them is the difference between a fixable traceback and a
    // dead-end "the export script failed".
    const detail = (error as { detail?: { stderrTail?: string } })?.detail
    if (detail?.stderrTail) {
      console.error('\n--- Blender output tail ---\n' + detail.stderrTail)
    }
    process.exit(1)
  },
)
