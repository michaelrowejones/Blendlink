#!/usr/bin/env node
import { readFile, open, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { compareRuntimeBenchmarks } from './lib/node-performance-comparison.mjs'

export async function main(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    assert.ok(['--baseline', '--candidate', '--policy', '--output'].includes(key) && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'),
      'usage: node scripts/compare-node-performance.mjs --baseline REPORT --candidate REPORT --policy POLICY --output NEW_JSON')
    options[key] = resolve(argv[i + 1])
  }
  assert.equal(Object.keys(options).length, 4, 'Baseline, candidate, explicit policy and new output are required')
  assert.ok(!Object.entries(options).some(([key, path]) => key !== '--output' && path === options['--output']), 'Output must not replace an input')
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
  await mkdir(dirname(options['--output']), { recursive: true })
  const handle = await open(options['--output'], 'wx')
  let report, inputPins = {}
  try {
    const keys = ['--baseline', '--candidate', '--policy']
    const reads = await Promise.allSettled(keys.map(key => readFile(options[key])))
    for (let index = 0; index < reads.length; index++) {
      const read = reads[index], key = keys[index]
      inputPins[key.slice(2)] = { path: options[key], sha256: read.status === 'fulfilled' ? sha256(read.value) : null,
        ...(read.status === 'rejected' ? { error: String(read.reason.message) } : {}) }
    }
    for (const read of reads) if (read.status === 'rejected') throw read.reason
    report = compareRuntimeBenchmarks(...reads.map(read => JSON.parse(read.value)))
  } catch (error) {
    report = { schemaVersion: 1, kind: 'blendlink-runtime-performance-comparison-v1', status: 'invalid-evidence',
      correctnessQualification: false, performanceQualification: false, error: String(error.message) }
  }
  report.inputPins = inputPins
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n') }
  finally { await handle.close() }
  console.log(JSON.stringify({ status: report.status, output: options['--output'], correctnessQualification: false, performanceQualification: false }))
  return report.status === 'within-threshold' ? 0 : report.status === 'threshold-exceeded' || report.status === 'invalid-evidence' ? 1 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
