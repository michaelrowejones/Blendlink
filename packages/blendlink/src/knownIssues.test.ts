import { describe, expect, it } from 'vitest'
import {
  loadBlenderKnownIssueRegistry,
  matchingBlenderKnownIssues,
  parseBlenderKnownIssueRegistry,
} from './knownIssues.js'

const fixture = {
  schemaVersion: 1,
  policy: 'Primary evidence only.',
  issues: [{
    id: 'fixture-export-regression',
    summary: 'Fixture export regression.',
    action: 'Use a supported patch release.',
    severity: 'warning',
    minInclusive: '5.1.0',
    maxExclusive: '5.1.3',
    evidence: ['https://projects.blender.org/blender/blender/issues/123'],
  }],
} as const

describe('Blender known-issue registry', () => {
  it('ships a valid evidence-gated registry even when no current issue is proven', () => {
    expect(loadBlenderKnownIssueRegistry()).toMatchObject({ schemaVersion: 1, issues: [] })
  })

  it('matches bounded patch ranges deterministically', () => {
    const registry = parseBlenderKnownIssueRegistry(fixture)
    expect(matchingBlenderKnownIssues([5, 1, 0], registry)).toHaveLength(1)
    expect(matchingBlenderKnownIssues([5, 1, 2], registry)).toHaveLength(1)
    expect(matchingBlenderKnownIssues([5, 1, 3], registry)).toHaveLength(0)
    expect(matchingBlenderKnownIssues([5, 2, 0], registry)).toHaveLength(0)
  })

  it('rejects missing or empty upper bounds', () => {
    const missingUpperBound: Record<string, unknown> = { ...fixture.issues[0] }
    delete missingUpperBound.maxExclusive
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [missingUpperBound],
    })).toThrow(/issues\[0\]\.maxExclusive must be non-empty text/)
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [{ ...fixture.issues[0], maxExclusive: '  ' }],
    })).toThrow(/issues\[0\]\.maxExclusive must be non-empty text/)
  })

  it('rejects hearsay entries and unbounded prose disguised as versions', () => {
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [{ ...fixture.issues[0], evidence: [] }],
    })).toThrow(/at least one primary-source URL/)
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [{ ...fixture.issues[0], minInclusive: 'latest' }],
    })).toThrow(/numeric Blender version/)
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [{ ...fixture.issues[0], evidence: ['https://example.com/forum-post'] }],
    })).toThrow(/primary source/)
    expect(() => parseBlenderKnownIssueRegistry({
      ...fixture,
      issues: [{ ...fixture.issues[0], evidence: ['https://github.com/random/project/issues/1'] }],
    })).toThrow(/primary source/)
  })
})
