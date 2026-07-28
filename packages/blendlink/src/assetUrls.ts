import type { CompiledSceneDescriptor } from './runtime.js'

export const BLENDLINK_IMMUTABLE_CACHE_CONTROL =
  'public, max-age=31536000, immutable' as const

export interface CompiledSceneImmutableAssetPolicy {
  readonly algorithm: 'sha256'
  readonly fingerprint: string
  /** Origin-relative or absolute graph-root URL, always ending in `/`. */
  readonly urlPrefix: string
  readonly cacheControl: typeof BLENDLINK_IMMUTABLE_CACHE_CONTROL
}

function urlParts(value: string): { pathname: string; search: string; hash: string } {
  let parsed: URL
  try {
    parsed = new URL(value, 'https://blendlink.invalid/')
  } catch {
    throw new Error(`Blendlink asset URL is invalid: ${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blendlink asset URL must use HTTP(S) or a public path: ${value}`)
  }
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
}

/** Internal graph-root primitive shared by request inventory and loader
 * conventions. Callers must preserve whether the descriptor URL was absolute,
 * origin-rooted, or relative when serializing this URL for the browser. */
export function runtimeAssetGraphRoot(descriptor: CompiledSceneDescriptor): URL {
  const graph = descriptor.runtimeAssetGraph
  if (!graph) {
    throw new Error('Blendlink cannot resolve a runtime asset graph root without a graph.')
  }

  const sceneEntries = graph.entries.filter((entry) => entry.role === 'scene')
  if (sceneEntries.length !== 1) {
    throw new Error(
      `Blendlink runtime asset graph must declare exactly one scene entry; found ${sceneEntries.length}.`,
    )
  }
  const scenePath = sceneEntries[0]!.path
  const scenePathSegments = scenePath.split('/')
  if (!scenePath || scenePath.includes('\\') || scenePath.startsWith('/') ||
      scenePathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(
      `Blendlink runtime asset graph scene path must be a plain relative POSIX path: ${scenePath}`,
    )
  }

  let scene: URL
  try {
    scene = new URL(descriptor.url, 'https://blendlink.invalid/')
  } catch {
    throw new Error(`Blendlink scene descriptor URL is invalid: ${descriptor.url}`)
  }
  if (scene.protocol !== 'http:' && scene.protocol !== 'https:') {
    throw new Error(
      `Blendlink scene descriptor URL must use HTTP(S) or a public path: ${descriptor.url}`,
    )
  }

  const urlSegments = scene.pathname.split('/')
  const encodedSceneSegments = urlSegments.slice(-scenePathSegments.length)
  let decodedSceneSegments: string[]
  try {
    decodedSceneSegments = encodedSceneSegments.map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes('/') || decoded.includes('\\')) {
        throw new Error('encoded path separator')
      }
      return decoded
    })
  } catch {
    throw new Error(
      `Blendlink scene descriptor URL cannot be matched safely to graph scene path ${scenePath}: ` +
        descriptor.url,
    )
  }
  if (decodedSceneSegments.length !== scenePathSegments.length ||
      decodedSceneSegments.some((segment, index) => segment !== scenePathSegments[index])) {
    throw new Error(
      `Blendlink scene descriptor URL must end with graph scene path ${scenePath}: ${descriptor.url}`,
    )
  }

  // Directory-only resolution is Needle's current companion model and works
  // when the scene is at the graph root. For Blendlink's exact graph, stripping
  // the declared scene path is the only design that also preserves root-level
  // companions when the scene itself is nested.
  const rootSegments = urlSegments.slice(0, -scenePathSegments.length)
  scene.pathname = `${rootSegments.join('/')}/`.replace(/\/{2,}/g, '/')
  scene.search = ''
  scene.hash = ''
  return scene
}

/** Resolve one compiler-owned public URL beneath an application-owned deploy
 * root. The root may be origin-relative (Next/Vite base path) or absolute
 * (CDN); queries and fragments on the asset itself remain intact. */
export function resolveCompiledAssetUrl(value: string, baseUrl: string | URL): string {
  const base = String(baseUrl)
  const asset = urlParts(value)
  let parsedBase: URL
  try {
    parsedBase = new URL(base, 'https://blendlink.invalid/')
  } catch {
    throw new Error(`Blendlink assetBaseUrl is invalid: ${base}`)
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    throw new Error(`Blendlink assetBaseUrl must use HTTP(S) or an origin-root path: ${base}`)
  }
  if (parsedBase.search || parsedBase.hash) {
    throw new Error('Blendlink assetBaseUrl cannot contain a query or fragment.')
  }
  if (!base.startsWith('/') && parsedBase.origin === 'https://blendlink.invalid') {
    throw new Error(
      `Blendlink assetBaseUrl must be origin-rooted or absolute; got ${base}. ` +
        'Pass Vite import.meta.env.BASE_URL or the configured Next base path.',
    )
  }

  const prefix = parsedBase.pathname.replace(/\/+$/, '')
  const pathname = `${prefix}/${asset.pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  if (parsedBase.origin === 'https://blendlink.invalid') {
    return `${pathname}${asset.search}${asset.hash}`
  }
  return `${parsedBase.origin}${pathname}${asset.search}${asset.hash}`
}

/** Exact host-facing cache policy for one complete graph. It returns data,
 * never edits Next/Vite/CDN configuration. A host may grant the returned
 * header only beneath urlPrefix; mutable pointers and lookalike digests stay
 * outside this policy. */
export function compiledSceneImmutableAssetPolicy(
  descriptor: CompiledSceneDescriptor,
  assetBaseUrl?: string | URL,
): CompiledSceneImmutableAssetPolicy {
  const graph = descriptor.runtimeAssetGraph
  if (!graph || graph.algorithm !== 'sha256' ||
      !/^[a-f0-9]{64}$/u.test(graph.fingerprint)) {
    throw new Error(
      'Blendlink immutable caching requires a complete runtime graph with a full lower-case SHA-256 fingerprint.',
    )
  }
  const graphRoot = runtimeAssetGraphRoot(descriptor)
  const segments = graphRoot.pathname.split('/').filter(Boolean)
  if (segments.at(-1) !== graph.fingerprint) {
    throw new Error(
      `Blendlink descriptor URL is not graph-addressed by ${graph.fingerprint}: ${descriptor.url}`,
    )
  }
  const originalPrefix = graphRoot.origin === 'https://blendlink.invalid'
    ? graphRoot.pathname
    : graphRoot.href
  const urlPrefix = assetBaseUrl === undefined
    ? originalPrefix
    : resolveCompiledAssetUrl(originalPrefix, assetBaseUrl)
  return Object.freeze({
    algorithm: 'sha256' as const,
    fingerprint: graph.fingerprint,
    urlPrefix: urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`,
    cacheControl: BLENDLINK_IMMUTABLE_CACHE_CONTROL,
  })
}

/** Test one request against a descriptor-derived immutable policy. Exact
 * origin and path-segment boundaries are required. */
export function matchesCompiledSceneImmutableAssetPolicy(
  requestUrl: string | URL,
  policy: CompiledSceneImmutableAssetPolicy,
): boolean {
  try {
    const placeholder = 'https://blendlink.invalid/'
    const prefix = new URL(policy.urlPrefix, placeholder)
    const request = new URL(String(requestUrl), placeholder)
    return prefix.origin === request.origin
      && request.pathname.startsWith(prefix.pathname)
  } catch {
    return false
  }
}

/** Complete compiler-declared HTTP asset graph. Application-owned browser
 * smokes can classify failures from this list without guessing filenames. */
export function compiledSceneAssetUrls(descriptor: CompiledSceneDescriptor): readonly string[] {
  const urls = new Set<string>([descriptor.url])
  const add = (value: string | undefined): void => { if (value) urls.add(value) }
  add(descriptor.environmentAsset?.url)
  add(descriptor.environmentAsset?.optimized?.url)
  add(descriptor.materialPrograms?.url)
  for (const asset of Object.values(descriptor.reflectionProbeAssets ?? {})) add(asset.url)
  for (const state of Object.values(descriptor.states ?? {})) {
    if (typeof state === 'string') add(state)
    else Object.values(state).forEach(add)
  }
  for (const group of Object.values(descriptor.lightGroups ?? {})) {
    if (typeof group.url === 'string') add(group.url)
    else {
      Object.values(group).forEach((layer) => {
        if (typeof layer === 'object' && layer !== null) add(layer.url)
      })
    }
  }
  for (const [source, variants] of Object.entries(descriptor.textureVariants ?? {})) {
    add(source)
    variants.forEach((variant) => add(variant.url))
  }
  const knownPaths = new Set([...urls].map((url) => urlParts(url).pathname))
  if (descriptor.runtimeAssetGraph) {
    const graphRoot = runtimeAssetGraphRoot(descriptor)
    for (const entry of descriptor.runtimeAssetGraph.entries) {
      if (entry.role === 'scene') continue
      const resolved = new URL(entry.path, graphRoot)
      if (knownPaths.has(resolved.pathname)) continue
      const url = resolved.origin === 'https://blendlink.invalid'
        ? resolved.pathname
        : resolved.href
      urls.add(url)
      knownPaths.add(resolved.pathname)
    }
  }
  return Object.freeze([...urls])
}

/** Build a modifier that rebases compiler-owned requests only. Artist-authored
 * Component media and application requests passing through the same manager
 * are deliberately left untouched. */
export function createCompiledAssetUrlModifier(
  descriptor: CompiledSceneDescriptor,
  baseUrl: string | URL,
  compilerOwnedPrefixes: readonly string[] = [],
): (url: string) => string {
  const exact = new Set(compiledSceneAssetUrls(descriptor))
  return (url) => {
    if (exact.has(url) || compilerOwnedPrefixes.some((prefix) => url.startsWith(prefix))) {
      return resolveCompiledAssetUrl(url, baseUrl)
    }
    return url
  }
}
