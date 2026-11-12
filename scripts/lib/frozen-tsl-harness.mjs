import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keep both rendering backends on the same harness bytes during long proofs. */
export function freezeTslHarness(root, destination) {
  const source = join(root, 'experiments/tsl-node-differential')
  const directory = join(destination, 'harness')
  mkdirSync(directory, { recursive: true })
  const hashes = {}
  for (const name of ['index.html', 'main.js']) {
    const bytes = readFileSync(join(source, name))
    writeFileSync(join(directory, name), bytes)
    assert.ok(bytes.equals(readFileSync(join(source, name))), 'Harness changed while capturing ' + name)
    hashes[name] = createHash('sha256').update(bytes).digest('hex')
  }
  return { directory, hashes }
}
