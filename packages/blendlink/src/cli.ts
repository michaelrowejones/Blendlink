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
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
      writeFileSync(join(outDir, `${name}.gen.ts`), module)
      console.log(
        `✓ typegen ${name}: ${manifest.nodes.length} nodes, ${manifest.materials.length} materials, ${Object.keys(manifest.clips).length} clips → ${join(outDir, `${name}.gen.ts`)}`,
      )
      for (const warning of manifest.vocabulary.warnings) console.warn(`  ! ${warning}`)
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
      if (result.scenes.length > 0) {
        for (const scene of result.scenes) console.log(`  ◦ found ${scene}`)
      } else {
        console.log('  ◦ no .blend files found — add scenes to the config when you have one')
      }
      console.log(
        '\nnext steps:\n' +
          '  1. blendlink sync          export scenes + generate typed modules\n' +
          '  2. commit the generated artifacts (plain git, no LFS needed)\n' +
          '  3. blendlink verify        add to CI for Blender-free drift checks\n' +
          '  4. blendlink doctor        check your setup any time',
      )
      return 0
    }
    case 'doctor': {
      const { doctor } = await import('./doctor.js')
      const lines = await doctor(process.cwd())
      const icon = { ok: '✓', warn: '!', fail: '✗' }
      for (const line of lines) console.log(`${icon[line.level]} ${line.message}`)
      return lines.some((line) => line.level === 'fail') ? 1 : 0
    }
    default:
      console.error(
        'blendlink — typed scene modules for any GLB, Blender sync first-class\n\n' +
          'commands:\n' +
          '  init                     scaffold blendlink.config.mjs from found .blend files\n' +
          '  sync [scene] [--force] [--watch]\n' +
          '                           export .blend scenes (external scenes run their build command)\n' +
          '  verify                   Blender-free drift check (CI)\n' +
          '  typegen <glb> [--blend f.blend] [...]\n' +
          '                           generate types from an existing GLB\n' +
          '  doctor                   check Blender, config, drift, and environment\n' +
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
