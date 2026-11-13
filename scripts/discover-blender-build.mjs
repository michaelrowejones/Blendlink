#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { discoverBlenderBuild } from './lib/blender-build-discovery.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === '--output' && args[1] && !args[1].startsWith('--'))) throw new Error('Usage: node scripts/discover-blender-build.mjs [--output PATH]')
  const result = await discoverBlenderBuild(), text = JSON.stringify(result, null, 2) + '\n'
  if (args.length) {
    const path = resolve(args[1]), temporary = join(dirname(path), '.' + basename(path) + '-' + randomUUID() + '.tmp')
    await mkdir(dirname(path), { recursive: true })
    try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
  }
  process.stdout.write(text)
} catch (error) { process.stderr.write(`BLENDLINK_BLENDER_DISCOVERY_FAILED: ${error.message}\n`); process.exitCode = 1 }
