import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The shared TSL IR op vocabulary: one list executed against BOTH this
 * package's builder and the addon's tsl_ir.py emitter (its headless
 * tsl_ir_ops_check.py loads the same JSON). ~4,700 lines of hand-mirrored
 * implementation sit on either side of that language gap with 43 shared
 * op names and, until this file, nothing binding them — an op added to
 * the emitter alone survived until a Blender e2e happened to exercise it.
 * conformance/vocabulary.json holds the same contract for the node
 * vocabulary, and exists because those parsers drifted three ways once.
 *
 * Scope is deliberately the VOCABULARY, not the numbers: per-op numeric
 * fidelity is measured by experiments/tsl-node-differential against
 * Cycles, and that proof is not duplicated here.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(here, '..', 'conformance', 'tsl-ir-ops.json'), 'utf8'),
) as { ops: string[] }

/** The builder expresses its vocabulary as the case labels of one switch,
 * so the vocabulary is read from the source it is expressed in. A regex
 * that stops matching fails this test loudly rather than silently
 * shrinking the compared set. */
function builderOps(): Set<string> {
  const source = readFileSync(join(here, 'tslNodeRecipe.ts'), 'utf8')
  return new Set([...source.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1]))
}

describe('TSL IR op vocabulary conformance', () => {
  it('declares a non-trivial vocabulary', () => {
    expect(fixture.ops.length).toBeGreaterThan(30)
    expect([...fixture.ops].sort()).toEqual(fixture.ops)
    expect(new Set(fixture.ops).size).toBe(fixture.ops.length)
  })

  it('builds exactly the declared ops — no more, no fewer', () => {
    const built = builderOps()
    expect(built.size).toBeGreaterThan(30)
    const declared = new Set(fixture.ops)
    const missing = [...declared].filter((op) => !built.has(op)).sort()
    const extra = [...built].filter((op) => !declared.has(op)).sort()
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })
})
