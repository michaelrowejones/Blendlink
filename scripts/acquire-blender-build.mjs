#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { acquireBlenderBuild } from './lib/blender-build-acquisition.mjs'

try {
  const args = process.argv.slice(2), options = {}
  const usage = 'Usage: node scripts/acquire-blender-build.mjs --discovery FILE --cache-dir DIR --work-dir DIR [--output FILE]'
  if (args.length % 2) throw new Error(usage)
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--discovery', '--cache-dir', '--work-dir', '--output'].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error(usage)
    options[key] = value
  }
  if (!options['--discovery'] || !options['--cache-dir'] || !options['--work-dir']) throw new Error(usage)
  const input = await open(resolve(options['--discovery']), 'r')
  let bytes
  try {
    if (!(await input.stat()).isFile()) throw new Error('Discovery document must be a regular file')
    const buffer = Buffer.alloc(64 * 1024 + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await input.read(buffer, size, buffer.length - size, size)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > 64 * 1024) throw new Error('Discovery document exceeds its byte budget')
    bytes = buffer.subarray(0, size)
  } finally { await input.close() }
  const result = await acquireBlenderBuild(JSON.parse(bytes.toString('utf8')), { cacheDir: options['--cache-dir'], workDir: options['--work-dir'] }), text = JSON.stringify(result, null, 2) + '\n'
  if (options['--output']) {
    const path = resolve(options['--output']), temporary = join(dirname(path), '.' + basename(path) + '-' + randomUUID() + '.tmp')
    await mkdir(dirname(path), { recursive: true })
    try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
  }
  process.stdout.write(text)
} catch (error) { process.stderr.write(`BLENDLINK_BLENDER_ACQUISITION_FAILED: ${error.message}\n`); process.exitCode = 1 }
