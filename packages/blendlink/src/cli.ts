#!/usr/bin/env node
import { discoverBlender } from './discover.js'
import { loadConfig } from './config.js'
import { syncAll, verifyAll } from './sync.js'
import { generateSceneModule } from './typegen.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

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
        console.log(
          `${outcome.action === 'exported' ? '✓ synced ' : '· skipped'} ${outcome.scene} in ${(outcome.durationMs / 1000).toFixed(1)}s${stats}`,
        )
        for (const warning of outcome.warnings) console.warn(`  ! ${warning}`)
      }
      const outcomes = await syncAll(config, {
        force: flags.has('--force'),
        only: positional[0],
      })
      outcomes.forEach(report)
      if (flags.has('--watch')) {
        const { watchScenes } = await import('./watch.js')
        await watchScenes(config, (outcome) => {
          if ('error' in outcome) console.error(`✗ ${outcome.scene}: ${outcome.error}`)
          else report(outcome)
        })
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
        console.error('usage: blendlink typegen <file.glb> [--name n] [--url u] [--out dir]')
        return 2
      }
      const name = flagValue('--name') ?? basename(glbPath).replace(/\.glb$/i, '')
      const url = flagValue('--url') ?? `/${basename(glbPath)}`
      const outDir = resolve(process.cwd(), flagValue('--out') ?? dirname(glbPath))
      const { manifest, module } = await generateSceneModule({
        glbPath: resolve(process.cwd(), glbPath),
        url,
        exportName: name,
      })
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
      writeFileSync(join(outDir, `${name}.gen.ts`), module)
      console.log(
        `✓ typegen ${name}: ${manifest.nodes.length} nodes, ${manifest.materials.length} materials, ${Object.keys(manifest.clips).length} clips → ${join(outDir, `${name}.gen.ts`)}`,
      )
      for (const warning of manifest.vocabulary.warnings) console.warn(`  ! ${warning}`)
      return 0
    }
    default:
      console.error(
        'blendlink — typed scene modules for any GLB, Blender sync first-class\n\n' +
          'commands:\n' +
          '  sync [scene] [--force]   export .blend scenes from blendlink.config.mjs\n' +
          '  verify                   Blender-free drift check (CI)\n' +
          '  typegen <glb> [...]      generate types from an existing GLB\n' +
          '  discover                 locate the Blender executable',
      )
      return command ? 2 : 0
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
