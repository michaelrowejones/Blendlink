import { describe, expect, it } from 'vitest'
import {
  BLENDLINK_IMMUTABLE_CACHE_CONTROL,
  compiledSceneAssetUrls,
  compiledSceneImmutableAssetPolicy,
  createCompiledAssetUrlModifier,
  matchesCompiledSceneImmutableAssetPolicy,
  resolveCompiledAssetUrl,
} from './assetUrls.js'

describe('compiled asset URL resolution', () => {
  it('preserves asset queries and fragments under Next/Vite base paths and CDNs', () => {
    expect(resolveCompiledAssetUrl('/models/hero.glb?v=abc#scene', '/portfolio/'))
      .toBe('/portfolio/models/hero.glb?v=abc#scene')
    expect(resolveCompiledAssetUrl('/models/hero.glb?v=abc', 'https://cdn.example/assets/'))
      .toBe('https://cdn.example/assets/models/hero.glb?v=abc')
  })

  it('rejects ambiguous relative bases and base queries', () => {
    expect(() => resolveCompiledAssetUrl('/models/hero.glb', './'))
      .toThrow(/origin-rooted or absolute/)
    expect(() => resolveCompiledAssetUrl('/models/hero.glb', '/portfolio/?release=1'))
      .toThrow(/cannot contain a query/)
  })

  it('rewrites only compiler-owned descriptor assets and decoder prefixes', () => {
    const modify = createCompiledAssetUrlModifier({
      url: '/models/hero.glb?v=glb',
      nodes: {},
      environmentAsset: {
        url: '/models/hero.hdr?v=env',
        sourceName: 'hero.hdr', format: 'hdr', bytes: 1, hash: 'env', source: 'packed',
      },
      states: { day: '/models/hero.day.png?v=day' },
    }, '/portfolio/', ['/models/blendlink-basis/'])

    expect(modify('/models/hero.glb?v=glb')).toBe('/portfolio/models/hero.glb?v=glb')
    expect(modify('/models/hero.day.png?v=day')).toBe('/portfolio/models/hero.day.png?v=day')
    expect(modify('/models/blendlink-basis/basis_transcoder.wasm'))
      .toBe('/portfolio/models/blendlink-basis/basis_transcoder.wasm')
    expect(modify('https://media.example/audio.ogg')).toBe('https://media.example/audio.ogg')
  })

  it('enumerates the compiler-declared graph for browser request assertions', () => {
    expect(compiledSceneAssetUrls({
      url: '/hero.glb', nodes: {},
      environmentAsset: {
        url: '/studio.hdr', sourceName: 'studio.hdr', format: 'hdr', bytes: 1,
        hash: 'raw', source: 'packed',
      },
      states: { day: { main: '/day.png' } },
      lightGroups: { lamp: { url: '/lamp.png', maxValue: 2 } },
      textureVariants: {
        '/day.png': [{
          url: '/day.webp', format: 'webp', width: 256, height: 256,
          bytes: 1, hash: 'day', lossless: true,
        }],
      },
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph', entries: [
          { path: 'hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
          { path: 'studio.hdr', role: 'companion', bytes: 1, sha256: 'env' },
          {
            path: 'blendlink-basis/basis_transcoder.wasm', role: 'basis-runtime',
            bytes: 1, sha256: 'wasm',
          },
        ],
      },
    })).toEqual([
      '/hero.glb', '/studio.hdr', '/day.png', '/lamp.png', '/day.webp',
      '/blendlink-basis/basis_transcoder.wasm',
    ])
  })

  it('strips the declared nested scene path instead of guessing the descriptor directory', () => {
    expect(compiledSceneAssetUrls({
      url: '/releases/graph-sha/scenes/hero.glb?v=graph', nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph-sha', entries: [
          { path: 'scenes/hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
          { path: 'textures/albedo.png', role: 'companion', bytes: 1, sha256: 'albedo' },
          {
            path: 'blendlink-basis/basis_transcoder.wasm', role: 'basis-runtime',
            bytes: 1, sha256: 'wasm',
          },
        ],
      },
    })).toEqual([
      '/releases/graph-sha/scenes/hero.glb?v=graph',
      '/releases/graph-sha/textures/albedo.png',
      '/releases/graph-sha/blendlink-basis/basis_transcoder.wasm',
    ])

    expect(compiledSceneAssetUrls({
      url: 'https://cdn.example/releases/graph-sha/scenes/hero.glb', nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph-sha', entries: [
          { path: 'scenes/hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
          { path: 'textures/albedo.png', role: 'companion', bytes: 1, sha256: 'albedo' },
        ],
      },
    })).toEqual([
      'https://cdn.example/releases/graph-sha/scenes/hero.glb',
      'https://cdn.example/releases/graph-sha/textures/albedo.png',
    ])
  })

  it('rejects an inconsistent graph scene URL rather than falling back to a basename heuristic', () => {
    expect(() => compiledSceneAssetUrls({
      url: '/releases/graph-sha/hero.glb', nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph-sha', entries: [
          { path: 'scenes/hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
        ],
      },
    })).toThrow(/descriptor URL.*scenes\/hero\.glb/i)
  })

  it('rejects malformed graph scene ownership instead of resolving an ambiguous root', () => {
    expect(() => compiledSceneAssetUrls({
      url: '/releases/graph-sha/hero.glb', nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph-sha', entries: [
          { path: 'hero.glb', role: 'companion', bytes: 1, sha256: 'glb' },
        ],
      },
    })).toThrow(/exactly one scene entry/i)

    expect(() => compiledSceneAssetUrls({
      url: '/releases/graph-sha/hero.glb', nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256', fingerprint: 'graph-sha', entries: [
          { path: 'hero.glb', role: 'scene', bytes: 1, sha256: 'glb-a' },
          { path: 'nested/hero.glb', role: 'scene', bytes: 1, sha256: 'glb-b' },
        ],
      },
    })).toThrow(/exactly one scene entry/i)
  })

  it('derives an exact immutable policy only from a full graph-addressed URL', () => {
    const fingerprint = 'a'.repeat(64)
    const descriptor = {
      url: `/models/hero/${fingerprint}/scenes/hero.glb`,
      nodes: {},
      runtimeAssetGraph: {
        algorithm: 'sha256' as const,
        fingerprint,
        entries: [{
          path: 'scenes/hero.glb',
          role: 'scene' as const,
          bytes: 1,
          sha256: 'b'.repeat(64),
        }],
      },
    }
    const policy = compiledSceneImmutableAssetPolicy(
      descriptor,
      '/portfolio/',
    )
    expect(policy).toEqual({
      algorithm: 'sha256',
      fingerprint,
      urlPrefix: `/portfolio/models/hero/${fingerprint}/`,
      cacheControl: BLENDLINK_IMMUTABLE_CACHE_CONTROL,
    })
    expect(matchesCompiledSceneImmutableAssetPolicy(
      `/portfolio/models/hero/${fingerprint}/textures/albedo.png`,
      policy,
    )).toBe(true)
    expect(matchesCompiledSceneImmutableAssetPolicy(
      `/models/hero/${fingerprint}/textures/albedo.png`,
      policy,
    )).toBe(false)
    expect(matchesCompiledSceneImmutableAssetPolicy(
      `/portfolio/models/hero/${fingerprint.slice(0, 63)}/lookalike.png`,
      policy,
    )).toBe(false)
  })

  it('refuses immutable policy for a stable or malformed-digest scene URL', () => {
    const fingerprint = 'c'.repeat(64)
    const graph = {
      algorithm: 'sha256' as const,
      fingerprint,
      entries: [{
        path: 'hero.glb',
        role: 'scene' as const,
        bytes: 1,
        sha256: 'd'.repeat(64),
      }],
    }
    expect(() => compiledSceneImmutableAssetPolicy({
      url: '/models/hero.glb',
      nodes: {},
      runtimeAssetGraph: graph,
    })).toThrow(/not graph-addressed/i)
    expect(() => compiledSceneImmutableAssetPolicy({
      url: `/models/hero/${fingerprint.slice(0, 63)}/hero.glb`,
      nodes: {},
      runtimeAssetGraph: graph,
    })).toThrow(/not graph-addressed/i)
  })
})
