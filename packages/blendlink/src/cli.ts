#!/usr/bin/env node
import { discoverBlender } from './discover.js'
import { loadConfig } from './config.js'
import { syncAll, verifyAll } from './sync.js'
import { generateSceneModule } from './typegen.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const positional = rest.filter((arg) => !arg.startsWith('--'))
const flagValue = (name: string) => {
  const index = rest.indexOf(name)
  return index >= 0 && rest[index + 1] && !rest[index + 1]!.startsWith('--')
    ? rest[index + 1]
    : undefined
}

async function main(): Promise<number> {
  switch (command) {
    case 'discover': {
      const install = await discoverBlender()
      console.log(`${install.version}\n${install.executable}`)
      return 0
    }
    case 'sync': {
      const config = await loadConfig(process.cwd())
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
        for (const warning of outcome.warnings) console.warn(`  ! ${warning}`)
      }
      const outcomes = await syncAll(config, {
        force: flags.has('--force'),
        only: positional[0],
        draft: flags.has('--draft'),
        allowNewerFile: flags.has('--allow-newer'),
      })
      outcomes.forEach(report)
      if (flags.has('--watch')) {
        const { watchScenes } = await import('./watch.js')
        await watchScenes(config, (outcome) => {
          if ('error' in outcome) console.error(`✗ ${outcome.scene}: ${outcome.error}`)
          else report(outcome)
        }, { draft: flags.has('--draft') })
        console.log('watching for .blend saves — ctrl-c to stop')
        await new Promise(() => {}) // stay alive until interrupted
      }
      return 0
    }
    case 'verify': {
      const config = await loadConfig(process.cwd())
      const issues = await verifyAll(config)
      if (issues.length === 0) {
        console.log('✓ blendlink verify: sources and artifacts are in sync')
        return 0
      }
      for (const issue of issues) {
        console.error(`✗ ${issue.scene}: ${issue.problem}\n  fix: ${issue.fix}`)
      }
      return 1
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
      const { manifest, module } = await generateSceneModule({
        glbPath: resolve(process.cwd(), glbPath),
        url,
        exportName: name,
        ...(blend ? { sourceBlend: blend } : {}),
      })
      if (blend) {
        const { createHash } = await import('node:crypto')
        const { readFileSync } = await import('node:fs')
        manifest.blendBytesHash = createHash('sha256')
          .update(readFileSync(resolve(process.cwd(), blend)))
          .digest('hex')
          .slice(0, 16)
      }
      // External pipelines attach their own bake plan so the addon's Bake
      // panel and table work for ANY scene, not just internally-baked ones.
      const planFile = flagValue('--plan')
      if (planFile) {
        const { readFileSync, existsSync } = await import('node:fs')
        const planPath = resolve(process.cwd(), planFile)
        if (existsSync(planPath)) {
          manifest.bakePlan = JSON.parse(readFileSync(planPath, 'utf8'))
        } else {
          console.warn(`! --plan ${planFile} not found — manifest stamped without a bake plan`)
        }
      }
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
      writeFileSync(join(outDir, `${name}.gen.ts`), module)
      console.log(
        `✓ typegen ${name}: ${manifest.nodes.length} nodes, ${manifest.materials.length} materials, ${Object.keys(manifest.clips).length} clips → ${join(outDir, `${name}.gen.ts`)}`,
      )
      for (const warning of manifest.vocabulary.warnings) console.warn(`  ! ${warning}`)
      return 0
    }
    case 'plan': {
      const config = await loadConfig(process.cwd())
      const { discoverBlender } = await import('./discover.js')
      const { exportBlend } = await import('./invoke.js')
      const { readFileSync, existsSync } = await import('node:fs')
      const scenes = positional[0]
        ? config.scenes.filter((scene) => scene.name === positional[0])
        : config.scenes
      if (positional[0] && scenes.length === 0) {
        console.error(`No scene named "${positional[0]}" in blendlink.config.`)
        return 2
      }
      const bakedScenes = scenes.filter(
        (scene) => !scene.external && scene.settings.mode === 'baked',
      )
      const asJson = flags.has('--json')
      for (const scene of scenes) {
        if (asJson) break
        if (scene.external) console.log(`· ${scene.name}: external — its pipeline owns the bake`)
        else if (scene.settings.mode !== 'baked')
          console.log(`· ${scene.name}: standard export — nothing to bake`)
      }
      if (bakedScenes.length === 0) {
        if (asJson) console.log(JSON.stringify({ scenes: [] }, null, 2))
        return 0
      }
      const blender = await discoverBlender(config.blenderPath)
      const jsonScenes: Array<{ scene: string; plan: unknown }> = []
      for (const scene of bakedScenes) {
        const result = await exportBlend({
          blendPath: scene.blendPath,
          outPath: scene.glbPath,
          settings: { ...scene.settings, planOnly: true },
          blender,
        })
        const plan = result.plan
        if (!plan) {
          console.error(`✗ ${scene.name}: Blender returned no plan`)
          return 1
        }
        if (asJson) {
          jsonScenes.push({ scene: scene.name, plan })
          continue
        }
        const supersampled = plan.supersample > 1
          ? ` (baked at ${plan.atlasSize * plan.supersample}px, resolved down)`
          : ''
        console.log(
          `\nbake plan — ${scene.name}: ${plan.atlasSize}px atlas${supersampled}, ` +
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
          console.log(`  dynamic (lit at runtime): ${dynamic.name} — ${dynamic.reason}`)
        }
        if (existsSync(scene.manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
            if (manifest.lastSyncDurationMs) {
              console.log(`  last sync took ${(manifest.lastSyncDurationMs / 1000).toFixed(1)}s`)
            }
          } catch {
            /* no estimate available */
          }
        }
        for (const warning of plan.warnings) console.warn(`  ! ${warning}`)
      }
      if (asJson) console.log(JSON.stringify({ scenes: jsonScenes }, null, 2))
      return 0
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
          '  1. blendlink sync          export scenes + generate typed modules\n' +
          '  2. commit the generated artifacts (plain git, no LFS needed)\n' +
          '  3. blendlink verify        add to CI for Blender-free drift checks\n' +
          '  4. blendlink doctor        check your setup any time',
      )
      if (result.sampleCopied) {
        console.log(
          '\nthen use it from React Three Fiber (drei):\n' +
            "  import { useGLTF } from '@react-three/drei'\n" +
            "  import { sample, type SampleGLTF } from './src/generated/sample.gen'\n" +
            '\n' +
            '  function Scene() {\n' +
            '    const { nodes } = useGLTF(sample.url) as unknown as SampleGLTF\n' +
            '    return <primitive object={nodes[sample.nodes.Crate]} />\n' +
            '  }\n' +
            '\n' +
            '  open assets/sample.blend, rename Crate, run `blendlink sync` —\n' +
            '  the build now fails at compile time. That is the point.',
        )
      }
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
        'blendlink — typed scene modules for any GLB, Blender sync first-class\n\n' +
        'commands:\n' +
        '  init                     scaffold blendlink.config.mjs from found .blend files\n' +
        '  sync [scene] [--force] [--watch] [--draft] [--allow-newer]\n' +
        '                           export .blend scenes (external scenes run their build command;\n' +
        '                           --draft = quarter-res preview bakes, refused by verify)\n' +
        '  plan [scene] [--json]    what the bake will do: objects, texel density, atlas share, states\n' +
        '  verify                   Blender-free drift check (CI)\n' +
        '  typegen <glb> [--blend f.blend] [...]\n' +
        '                           generate types from an existing GLB\n' +
        '  doctor                   check Blender, config, drift, and environment\n' +
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
