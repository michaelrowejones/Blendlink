# Content-addressed scene bundle prototype

Status: **throwaway deployment prototype**, 2026-07-23.

Run:

```powershell
node --test experiments/content-addressed-bundle-prototype/publisher.test.mjs
```

## Question

Can Blendlink place one exact, compiler-owned runtime graph behind a permanent
directory URL, while keeping the website's route, framework, host, base path,
CDN, cache headers, and deployment fully application-owned?

The critical state transition is:

```text
compiler stage
  -> exact closure and byte verification
  -> private seal directory
  -> full SHA-256 directory rename
  -> small mutable pointer replacement
```

The user explicitly requested a focused evidence runner, so this prototype uses
`node:test` despite the general prototype guideline to avoid maintaining tests.
The runner is the experiment: it drives temporary directories and prints the
complete pass/fail state.

## Existing seams inspected

- `packages/blendlink/src/sceneAssetGraph.ts` already supplies deterministic
  full-graph identity, exact staging closure, glTF external buffer/image closure,
  KTX2 runtime closure, safe nested paths, and persisted graph integrity.
- `packages/blendlink/src/sync.ts` currently stages beneath the mutable
  publication directory, maps compiler URLs relative to the configured GLB,
  and transactionally replaces individual runtime/generated files. That is a
  rollback-capable file set, not one atomically visible directory.
- `packages/blendlink/src/config.ts` defaults to `public/models` and `/models`;
  explicit scene paths and URLs mean migration cannot assume every scene uses
  that default.
- `packages/blendlink/src/typegen.ts` emits absolute public URL strings and an
  exact `runtimeAssetGraph`. It correctly says immutable caching still requires
  a graph-addressed publication directory.
- `packages/blendlink/src/assetUrls.ts` already owns origin-root/subpath/CDN
  rebasing. This prototype reuses that resolver rather than creating framework
  branches.

The exact Needle baseline verifier passed before implementation:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 108 files, 5 source version identities
(2026-07-23) integration=mixed-source
```

Relevant inspected Needle sources remain stable-path publication rather than a
complete immutable scene directory:

| Exact source | SHA-256 | Observed behavior |
| --- | --- | --- |
| Engine 5.1.7 `plugins/vite/copyfiles.js` | `a53513a43f69439b6f7b23cd78ebe74b3c9915142f0986095e6cb8e94b0a06c1` | Clears and recursively copies the source assets directory to stable `dist/assets`. |
| Engine 5.1.7 `plugins/vite/config.js` | `d0207db1ce17a7a58b15cd14ef1de032744701491a6d5167bfe230a1e5871990` | Returns the conventional stable `assets` output directory. |
| Engine 5.1.7 `plugins/common/buildinfo.js` | `18218dc81a790741f20d94261835366287708756c0d60c689192a867947bda63` | Recursively records per-file SHA-256 build inventory, but does not use one full-graph digest as a browser directory. |
| Engine 5.1.7 `plugins/next/next.js` | `947cd6a36dd59e099af8b0e36833ad946d53c6df0c7f10dd1b2958579ab82459` | Adds Next export/build integration; no general scene `basePath` or public CDN rebasing was found. |
| Build pipeline 3.0.0 `dist/cli/index.js` | `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1` | Content-identifies individual progressive companions, not the complete scene directory. |

This is a **No analogue / prospective Improvement** over the inspected Needle
publication path. It is not parity evidence and the pinned Needle inventory
remains `integration=mixed-source`.

## Primary-source constraints

- Next 16.2.6's bundled `basePath.md` says the base path is a build-time
  application setting and even public image sources must include it. Its
  `assetPrefix.md` says the prefix covers `/_next/static`, not arbitrary public
  files. Its `public-folder.md` documents `Cache-Control: public, max-age=0`
  because public filenames may change.
  ([current Next basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath),
  [assetPrefix](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix),
  [public folder](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder))
- Vite's current production guide says imported references are rewritten for
  `base`, while dynamic concatenation must use `import.meta.env.BASE_URL`; its
  public files are copied without imported-asset hashing.
  ([Vite production base](https://vite.dev/guide/build),
  [Vite static assets](https://vite.dev/guide/assets.html))
- RFC 9111 defines the cache key as including at least method and target URI.
  A permanent full-graph directory makes a changed graph a changed target URI;
  it does not itself configure a host's cache policy.
  ([RFC 9111 section 2](https://www.rfc-editor.org/rfc/rfc9111.html#section-2))

## Layouts compared

### A. Per-scene graph directory plus generated pointer

```text
public/models/hero/<full-graph-sha256>/...
src/generated/hero.bundle.json
```

The pointer contains only algorithm, fingerprint, public bundle path, and scene
path. The bundle directory is renamed into existence only after exact closure
and copied-byte verification. The pointer is replaced only after the final
directory passes verification.

Strengths: scene locality, understandable cleanup, one host-header pattern,
direct mapping from current `ResolvedScene`, and no schema-v4 asset-reference
port. A failed pointer switch can leave a complete orphan, never a pointer to a
partial bundle.

Costs: identical files across different scenes are not globally deduplicated,
and generated schema-v3 URL fields still need a coordinated migration.

### B. Global graph store plus per-scene public pointer

```text
public/.blendlink/bundles/<full-graph-sha256>/...
public/models/hero/current.json
```

Strengths: cross-scene graph deduplication and one global garbage collector.

Costs: a browser-visible mutable pointer needs a different cache policy and an
extra request; global cleanup couples otherwise independent scenes; existing
generated descriptors still need rewriting; static hosts may not treat a dot
directory consistently; and a public runtime pointer makes offline/static
deployment more subtle.

## Choice and prototype interface

Layout A has the deeper module for Blendlink's current product boundary:

```js
publishContentAddressedBundle({
  stageDirectory,
  declaredAssets,
  publicationRoot,
  publicBundlePath,
  pointerPath,
  requiresKtx2,
})

resolveContentAddressedAssetUrl(pointer, graphPath, baseUrl)
```

The publication entry point hides recursive inventory, exact graph creation,
copy verification, reuse/corruption checks, directory commit, and pointer
replacement. The resolver hides root/subpath/CDN URL behavior. Filesystem I/O
is local-substitutable; Next, Vite, and CDNs are hosts, not runtime adapters.

## Evidence target

The runner must prove:

1. Identical staged bytes and paths reuse the same directory without touching
   existing bundle files.
2. A one-byte GLB change, nested companion change, or Basis WASM change yields
   a different directory.
3. Undeclared staging residue blocks before publication.
4. A pointer-replacement fault leaves the last pointer byte-for-byte intact.
5. During publication the pointer names only the old complete graph or the new
   complete graph; the final digest path does not exist during copying.
6. One descriptor resolves nested files under `/`, `/portfolio/`, and an
   absolute CDN root.

## Truthful limitations and migration hazards

- This is temp-directory evidence on Node 24.15.0 and the current Windows
  filesystem. It is not a cross-filesystem, network filesystem, power-loss, or
  deployed-CDN atomicity proof.
- The namespace transition is atomic at the final directory/pointer paths in
  this run. A host that exposes unpredictable private seal-directory names or
  directory listings is outside this claim.
- A pointer failure after directory commit deliberately leaves a complete
  orphan. Removing it automatically would race another publisher or reader;
  garbage collection must be explicit and reference-aware.
- The prototype serializes no competing publishers. Same-graph directory races
  can be verified and reused, but last-writer-wins pointer races need a
  production generation/lock policy.
- The pointer is intentionally outside the content digest. It must never receive
  the immutable header applied to `<fingerprint>/...`.
- `runtimeAssetGraph` proves directly declared glTF buffer/image URIs and
  compiler-declared companions. Extension-specific or application-owned remote
  resources remain outside the immutable compiler graph unless explicitly
  declared later.
- Production migration must update URL generation, reverse URL-to-local-path
  resolution, incremental bake cache paths, unchanged-scene verification,
  cleanup, external typegen behavior, and compatibility for existing stable
  outputs as one coordinated slice. Moving only the files would be unsafe.
- The small pointer does not authorize arbitrary graph paths. Production
  callers must resolve paths from the verified `runtimeAssetGraph`, not
  user-controlled input.
