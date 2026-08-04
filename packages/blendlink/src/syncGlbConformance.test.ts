import { describe, expect, it } from 'vitest'
import { glbConformanceVerificationIssues } from './sync.js'
import type { CompiledSceneConformance } from './compiledSceneConformance.js'

/**
 * The audit reports and verify decides. These cases pin that split: a
 * conformance failure blocks publication, a named waiver downgrades exactly
 * the subjects it names, and a waiver that has stopped matching is itself a
 * failure - otherwise the config would quietly keep accepting a class of
 * defect long after the instance it was written for was fixed.
 */
function conformance(
  issues: CompiledSceneConformance['issues'],
): { conformance: CompiledSceneConformance } {
  return {
    conformance: {
      profile: 'blendlink-glb-conformance-v1',
      issues,
      conformant: issues.length === 0,
      checked: {
        'conformance.texcoord-out-of-range': 1,
        'conformance.texcoord-accessor-missing': 1,
        'conformance.base-color-carrier-missing': 1,
        'conformance.blender-default-material-bound': 1,
        'conformance.skin-joint-budget-exceeded': 1,
      },
    },
  }
}

const carrierMissing = {
  code: 'conformance.base-color-carrier-missing' as const,
  location: '/materials/3',
  subject: 'eyes',
  affects: ['Eyes'],
  summary: 'Material "eyes" reaches the runtime with no carrier.',
  fix: 'Give the material a colour Blendlink can carry.',
}

describe('glb conformance verification', () => {
  it('says nothing about a conformant artifact', () => {
    expect(glbConformanceVerificationIssues({ name: 'hero' }, conformance([])))
      .toEqual([])
  })

  it('blocks publication once per code, naming every affected subject', () => {
    const issues = glbConformanceVerificationIssues(
      { name: 'hero' },
      conformance([
        carrierMissing,
        { ...carrierMissing, location: '/materials/4', subject: 'gums' },
      ]),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.problem).toContain('"eyes", "gums"')
  })

  it('downgrades only the subjects a waiver names', () => {
    const scene = {
      name: 'hero',
      glbConformance: {
        accept: [{
          code: 'conformance.base-color-carrier-missing',
          subjects: ['eyes'],
          reason: 'the website supplies this material at runtime',
        }],
      },
    }
    const waivedOnly = glbConformanceVerificationIssues(scene, conformance([carrierMissing]))
    expect(waivedOnly[0]?.severity).toBe('warning')
    expect(waivedOnly[0]?.problem).toContain('the website supplies this material at runtime')

    const partlyWaived = glbConformanceVerificationIssues(
      scene,
      conformance([
        carrierMissing,
        {
          ...carrierMissing,
          subject: 'gums',
          summary: 'Material "gums" reaches the runtime with no carrier.',
        },
      ]),
    )
    expect(partlyWaived[0]?.severity).toBe('error')
    // The blocking subject leads; the waived one is named as already covered
    // so the artist can see the difference between the two.
    expect(partlyWaived[0]?.problem).toContain('affecting "gums"')
    expect(partlyWaived[0]?.problem).toContain('A waiver already covers "eyes"')
  })

  it('warns rather than blocks where Blendlink substituted on purpose', () => {
    // A mesh with no material of its own gets a neutral dielectric so the
    // surface is visible. Naming that is useful; refusing to publish it is
    // not, and the same is true of a joint count the classic WebGL runtime
    // renders perfectly well.
    const advisory = glbConformanceVerificationIssues(
      { name: 'hero' },
      conformance([{
        code: 'conformance.blender-default-material-bound',
        location: '/materials/0',
        subject: 'Blendlink Blender Default',
        affects: ['hair.scalp'],
        summary: '2 primitive(s) had no material of their own.',
        fix: 'Assign a material to those meshes in Blender.',
      }]),
    )
    expect(advisory[0]?.severity).toBe('warning')
  })

  it('refuses a waiver that no longer matches anything', () => {
    const issues = glbConformanceVerificationIssues(
      {
        name: 'hero',
        glbConformance: {
          accept: [{
            code: 'conformance.base-color-carrier-missing',
            subjects: ['eyes', 'teeth'],
            reason: 'supplied at runtime',
          }],
        },
      },
      conformance([carrierMissing]),
    )
    const stale = issues.find((issue) => issue.problem.includes('no longer reports'))
    expect(stale?.severity).toBe('error')
    expect(stale?.problem).toContain('"teeth"')
  })
})
