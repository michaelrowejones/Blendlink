# Asset addressing and static deployment, 2026

Date: 2026-07-21

Implementation update, 2026-07-23: Blendlink now emits an additive schema-v3
`runtimeAssetGraph` from the exact publication candidates. The graph uses full
SHA-256, rejects traversal, ambiguous encoded separators, and case-fold
collisions, requires one GLB, and requires concrete Basis
JS/WASM/README/LICENSE entries whenever KTX2 is needed. Before publication, the
package recursively walks its wholly owned compiler staging directory and
requires its regular-file set to equal the compiler-declared set exactly.
Nested paths are preserved; undeclared residue, undeclared directories, missing
declarations, leaf links, and linked/junction ancestors fail loudly.

The graph also parses the finalized GLB JSON chunk and proves every directly
declared external `buffers[].uri` and `images[].uri` resolves to a declared
compiler companion. Embedded `data:` URIs remain legal. Remote, traversing,
query/fragment, malformed-percent, and encoded-separator URIs are refused.
Extension-specific resource locators are deliberately not called closed by
this v1 parser.

Generated descriptors expose the graph and browser-smoke enumeration no longer
has to infer Basis filenames. A package-owned integrity verifier re-walks every
path segment and rejects missing, changed, malformed, noncanonical, traversing,
colliding, linked/junction, or non-file entries. Internal unchanged-scene skip
and `verify` both call that verifier, and `sceneAssetGraph` itself participates
in the compiler pipeline signature. New compiler companions therefore inherit
staging and persisted integrity protection without another field-specific
check. Focused evidence is 39 graph/sync tests plus a package build.

This proves the compiler-owned graph's declared closure and exact local
identity. It does **not** prove that a stable publication directory is
immutable. The experiment in
[`content-addressed-bundle-prototype`](../experiments/content-addressed-bundle-prototype/)
adds nine passing temp-directory cases for stage → verify → seal → full-graph
directory rename → generated-pointer replacement. Identical graphs reuse one
directory; one-byte GLB, nested companion, or Basis changes choose another;
pointer failure leaves the last pointer intact; and root, subpath, and CDN URL
resolution preserve nested paths. It remains a prototype: production URL
generation, incremental-bake reverse mapping, compatibility output,
concurrency, cleanup, and deployed cache-header/browser evidence must migrate
together before immutable caching is a release claim. Generic external
`typegen` remains honest but incomplete because Blendlink cannot discover an
external pipeline's full file closure.

Implementation update, 2026-07-23 (deeper production audit): the package now
also contains a seal-only `scenePublication` Module. Thirty focused graph/seal
tests prove it copies an already closed graph into a private same-parent
directory, verifies the copy, renames it to the full graph fingerprint, and
only reuses an existing directory after exact re-verification. It deliberately
does not own a pointer, cleanup, manifest, or framework URL and is not yet
wired into `sync`.

Implementation update, 2026-07-24 (production activation and browser
evidence): `sync` now seals the complete internal graph beneath
`<scene-name>/<full-sha256>/`, rewrites every compiler-owned generated URL to
that graph, and switches the generated manifest/module only after the seal
verifies. Incremental reuse and `verify` resolve addressed URLs back to the
sealed directory. Byte-identical builds reuse the directory without touching
it; changed graphs retain the old directory. A verified stable compatibility
mirror remains during the pre-1.0 migration and is never granted immutable
headers.

Publication is coordinated across processes with sorted asset/generated
namespace leases, delegated child tokens, source/config revision fences, and a
same-revision Preview-after-Final non-downgrade rule. `publish` holds the
selected scopes through Final compilation, all artifact checks, the
application build, and its optional browser smoke so the build cannot consume
a hybrid generation.

The packed production browser gate now imports the actual
`sceneAssetGraph`, `scenePublication`, and `assetUrls` Modules from the npm
tarball. Four Chromium cells pass across Vite/Next and same-origin/second-origin
CDN modes under `/portfolio/`, including an external PNG, concrete Basis
closure, exact CORS, and immutable headers only on the 64-hex graph route. The
MichaelRoweJonesSite dogfood additionally publishes its real 45-file,
62,058,268-byte workbench graph and drives a Next header rule directly from
`compiledSceneImmutableAssetPolicy`; its focused production browser check
proves selected graph responses are immutable while the stable compatibility
GLB is not. These are local production-server facts, not a deployed edge-CDN
claim.

Three publication designs were compared:

1. one immutable per-scene graph directory plus the generated typed
   descriptor/module as the mutable pointer;
2. the same directory plus a browser-fetched `current.json`; and
3. bundler-managed static imports for every GLB/companion.

Design 1 is retained. The generated module is already rebuilt with the
website and must agree with generated node types and baked code. A
`current.json` would add a request, mutable-cache/CORS policy, and an
independent drift point. Static imports would transfer arbitrary GLB/KTX2/HDR
rules into the host framework and do not rewrite `public/` trees as one graph.

The URL prerequisite is now implemented and tested: when the graph scene entry
is `scenes/hero.glb`, companion and Basis URLs derive from the graph root
rather than the GLB's basename directory. The resolver strips the exact
declared scene path, preserves origin-root/subpath/CDN forms, and fails loudly
for missing/multiple scene ownership, mismatches, or encoded separators.
Needle's dirname-relative companion model remains the fallback for descriptors
without a complete graph.

A Windows/Node 24.15 cross-process audit reproduced the former activation
blocker: two individually successful stable-directory transactions interleaved
into `B-GLB` plus `A-MANIFEST`. Needle 1.4.2's `needle.lock` is a reload marker,
not mutual exclusion. The shipped cooperative publication scopes now serialize
every intersecting compiler namespace, delegate ownership to configured child
typegen, and make verification wait for active writers. Focused concurrent
Final/Preview, reader/writer, source-change, config-change, and exact-config
publish tests close the reproduced race for cooperative local publishers.
UNC/network filesystems and arbitrary non-cooperative external writers remain
outside the claim.

## Scope and conclusion

This note audits Blendlink's compiler-owned scene assets against Next.js
16.2.6 and Vite 7.3.6. The question is narrower than deployment generally:
how can a website-owned Next or Vite application place a complete Blendlink
scene under a base path or on a CDN, and when may the host truthfully apply an
immutable cache policy?

The implemented answer is:

1. Internal compilation publishes one never-mutated, full-SHA-256 scene graph
   and makes the generated typed descriptor its build-time activation pointer.
2. `assetBaseUrl` relocates only compiler-owned requests beneath an explicit
   Next/Vite base path or absolute CDN root. It does not pretend that Next
   `assetPrefix` rewrites `public/`.
3. `compiledSceneImmutableAssetPolicy` derives one exact host-facing prefix and
   header from the complete graph. The website decides whether and how to
   install it.
4. Keep schema version 3 while the runtime still consumes its existing URL
   fields. A schema version 4 should be considered only if Blendlink wants
   first-class asset IDs, typed roles, per-request transport policy, or a public
   manifest whose byte representation is intrinsically relocatable. That is a
   real reshape, not a casual additive field.

Immutable caching becomes truthful only when **every URL under the immutable
route is permanent**: GLB, canonical and variant atlases, raw and optimized
environment maps, baked/custom probe textures, Basis runtime files and
attributions, and any public manifest companion. User-authored remote audio,
LUT, and navigation URLs are dependencies of the experience, but they are not
compiler-owned publication bytes and must stay outside that cache claim.

## Evidence and installed versions

The repository lockfile installs Vite 7.3.6. The dogfood site installs Next
16.2.6, React Three Fiber 9.6.1, and Three r184. These versions were verified
from the two lockfiles/package files and, for Next, the bundled documentation in
`node_modules/next/dist/docs/` as required by the site's `AGENTS.md`.

The current primary-source rules are:

- A Next `basePath` is fixed at build time and inlined into client bundles.
  Next automatically applies it to its router links, but even its image example
  requires the author to include the base path in a public image source.
  [Next `basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
- Next's `assetPrefix` rewrites `/_next/static` JavaScript/CSS URLs. It
  explicitly does **not** prefix files in `public/`; applications must add that
  CDN prefix themselves.
  [Next `assetPrefix`](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix)
- Next serves `public/` files from base URL `/` and defaults them to
  `Cache-Control: public, max-age=0`, because their filenames may be mutated.
  [Next public folder](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder)
- A running Next server can apply headers to `public/` paths because configured
  headers are checked before the filesystem. A Next static export cannot use
  the `headers` feature; the static host must own those headers.
  [Next headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers),
  [Next static exports](https://nextjs.org/docs/app/guides/static-exports)
- Vite rebases JavaScript-imported assets, CSS URLs, and HTML asset references
  for its configured `base`. Dynamic concatenation must explicitly use the
  build-time constant `import.meta.env.BASE_URL`. A relative Vite base (`""` or
  `"./"`) makes generated build assets relative to each output file.
  [Vite production build and public base](https://vite.dev/guide/build),
  [Vite environment constants](https://vite.dev/guide/env-and-mode.html)
- Vite copies `public/` to the output as-is. Public files are deliberately used
  through root-absolute paths and do not receive imported-asset hashing. Vite
  recommends imported assets unless stable public filenames are specifically
  required.
  [Vite static asset handling](https://vite.dev/guide/assets.html)
- HTTP cache selection includes at least the request method and target URI.
  A content version in either a filename or query is therefore a valid cache
  buster. `immutable` is appropriate only when changed bytes always receive a
  changed URL.
  [RFC 9111 section 2](https://www.rfc-editor.org/rfc/rfc9111.html#section-2),
  [MDN `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#caching_static_assets_with_cache_busting)
- A leading slash resolves at the origin root, while a path-relative reference
  resolves from the base URL's directory. This is browser URL behavior, not a
  framework choice.
  [URL constructor](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL)
- A cross-origin asset host must opt into CORS. Credentialed requests cannot
  use wildcard `Access-Control-Allow-Origin`; the exact origin and
  `Access-Control-Allow-Credentials: true` are required. This is host policy,
  not something a static scene compiler can infer.
  [WHATWG Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-new-header-syntax)
- Three's KTX2 loader needs a separately served JS wrapper and WASM transcoder,
  and `setTranscoderPath()` is the explicit CDN seam.
  [Three `KTX2Loader`](https://threejs.org/docs/pages/KTX2Loader.html)

The installed source adds useful exact-version evidence. Vite 7.3.6 replaces
internal asset placeholders through its `toOutputFilePathInJS()` path; an
ordinary string literal emitted by Blendlink has no placeholder and is not
rebased. Three r184 requests `basis_transcoder.js` and
`basis_transcoder.wasm` beneath `transcoderPath` and synthesizes a Blob worker
from the fetched wrapper. These observations agree with the public docs; they
are not extra contracts Blendlink should depend on.

### Exact Needle baseline

The content-identified comparison uses installed `@needle-tools/engine` 5.1.7
source plus the exact add-on-selected `@needle-tools/gltf-build-pipeline`
3.0.0 bundled CLI, alongside the pinned Needle Blender add-on 1.4.2 recorded in
[`research-needle-behavioral-baseline-2026.md`](research-needle-behavioral-baseline-2026.md).
The historical generated spike's pipeline 1.2.2 is retained only as negative
identity evidence; it does not support a current Auto Compress conclusion.
The package inventory remains `integration=mixed-source`: a clean
add-on-selected npm tree now passes, but authenticated transform plus browser
execution is still pending. Relevant exact source anchors are:

| Needle source | SHA-256 | Observed behavior |
|---|---|---|
| `plugins/vite/copyfiles.js` | `a53513a43f69439b6f7b23cd78ebe74b3c9915142f0986095e6cb8e94b0a06c1` | Clears and recursively copies the configured source-assets directory to stable `dist/assets`; filenames are preserved rather than content-addressed. |
| `plugins/vite/config.js` | `d0207db1ce17a7a58b15cd14ef1de032744701491a6d5167bfe230a1e5871990` | Uses Vite's configured base and conventional `assets/scene.glb` locality; it does not introduce a complete scene-graph digest. |
| `plugins/common/buildinfo.js` | `18218dc81a790741f20d94261835366287708756c0d60c689192a867947bda63` | Recursively SHA-256 inventories build output in `needle.buildinfo.json`; this is upload/build evidence, not browser URL identity or an immutable directory contract. |
| `plugins/next/next.js` | `947cd6a36dd59e099af8b0e36833ad946d53c6df0c7f10dd1b2958579ab82459` | Supplies Next export/transpile/worker integration, but no general `basePath` or public-CDN rebasing for scene files. |
| `src/engine/engine_utils.ts` | `adb259462e2d859aaca599d2f191c6cdfaf3eb86d4fc92e6b181ca45ba77cb3c` | Resolves `rel:` dependencies relative to the source GLB, preserving useful scene-locality. |
| build pipeline 3.0.0 `dist/cli/index.js` | `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1` | Emits embedded low tiers plus content-identified `image_<level>_<guid>.glb` and `mesh_lod_<level>_<guid>.glb` companions with per-resource hashes/density; it does not make the complete scene directory itself content-addressed. |

The exact 3.0.0 CLI content-identifies individual progressive companions, and
the progressive runtime consumes their recorded URLs. That is materially
stronger than the historical 1.2.2 spike, but it still does not bind the root
GLB, every companion, decoder bytes, and a directory URL into one immutable
bundle identity. `AssetReference` retains a legacy `_hash` constructor input,
but Engine 5.1.7 likewise does not use it to provide a complete addressed scene
bundle.

Therefore Needle's current approach is the baseline for **local recursive
publication and relative dependency locality**. Blendlink now improves upon it
for compiler-owned assets by recording a deterministic, exact graph and
revalidating every declared entry before skip/publish verification. Blendlink
now also improves Needle's stable-directory deployment behavior for internally
compiled scenes: the graph digest is the directory identity, and packed
non-root/CDN browser cells prove the resolver and header contract. This remains
a product-boundary improvement rather than framework ownership creep:
Blendlink owns compilation identity and returns policy data, while the website
owns deployment and response headers.

## Current implementation audit

The important implementation path is:

- [`config.ts`](../packages/blendlink/src/config.ts) defaults `outDir` to
  `public/models`, `urlPrefix` to `/models`, and each scene URL to
  `/models/<name>.glb`. [`assetUrls.ts`](../packages/blendlink/src/assetUrls.ts)
  validates an application-supplied origin-rooted Next/Vite base path or
  absolute HTTP(S) CDN root and rebases only compiler-owned requests. The
  package-owned Three loader installs that policy through one URL modifier;
  application-owned loaders retain their own URL/header/credential policy.
- [`sync.ts`](../packages/blendlink/src/sync.ts) stages the GLB and every
  compiler-owned companion, creates one canonical relative-path
  `runtimeAssetGraph`, seals it beneath the full graph digest, then
  transactionally activates its addressed generated artifacts. Concrete Basis
  files are graph entries rather than an inferred runtime side effect. Stable
  sibling files remain a separately verified compatibility mirror.
- [`typegen.ts`](../packages/blendlink/src/typegen.ts) uses one
  `versionedAssetUrl()` helper for GLB, atlases, variants, environments, and
  probes, preserving existing queries with `&v=`. The generated descriptor also
  carries the exact runtime graph for generic enumeration and smoke evidence.
  Internal generated URLs point into the sealed graph; generic external
  typegen remains legacy/unaddressed unless its owning pipeline supplies
  complete closure.
- [`threeRuntime.ts`](../packages/blendlink/src/threeRuntime.ts) derives its
  private Basis loader policy from the compiled graph/scene directory and lets
  the same `assetBaseUrl` modifier relocate scene, companions, and decoder
  requests together. It refuses that option with application-owned loaders so
  two URL policies cannot silently conflict.
- Verification and unchanged-scene reuse now walk the canonical graph paths
  and re-read every regular file with full length/SHA-256 checks. Traversal,
  malformed order/metadata, case collisions, symbolic links, wrong scene
  identity, and incomplete Basis closure fail loudly. Generic external typegen
  remains outside this closure claim because it does not own an external build
  pipeline's companions.
- [`publish.ts`](../packages/blendlink/src/publish.ts) loads one exact config
  revision, acquires every selected publication scope, compiles Final, verifies,
  runs the application's existing build, verifies again, runs optional browser
  smoke, and performs a final verification before release. It does not
  inspect the built deployment tree or mutate framework/host caching settings.
  That ownership is correct.
- The dogfood site confirms the real output:
  `/models/workbench-dogfood/workbenchDogfood/<full-sha256>/...`. Its
  [`next.config.ts`](../../MichaelRoweJonesSite/next.config.ts) derives the
  exact immutable matcher/header from the generated descriptor rather than
  copying a digest or inventory. The focused production browser check proves
  requested graph files receive the policy and the stable GLB does not.

### Asset-by-asset matrix

| Graph member | Production address and integrity evidence | Remaining gap | Policy |
|---|---|---|---|
| GLB | Unchanged filename inside the graph-hash directory; generated descriptor retains the per-file query; `verify` hashes stable and addressed bytes | External generic typegen may remain stable-only | Stable mirror stays mutable during migration |
| Embedded material textures and Meshopt payload | Bytes are inside the GLB and inherit its URL identity | None once the GLB address is immutable | No separate entry; retain decoded-size/extension evidence in the manifest |
| Canonical state/light atlases | Bake-derived filenames inside the graph; exact hashes remain in `bakeArtifactHashes` | Old graphs accumulate until explicit cleanup exists | Generated canonical and layer URLs switch together |
| PNG/WebP delivery variants | Each records bytes/dimensions/format/hash and is sealed inside the same graph | Delivery-tier selection is still runtime policy | Canonical-source keys and variants are rewritten together |
| Raw HDR/EXR environment | Exact bytes/hash inside the graph and relocated with one base | Published-EXR browser pixels remain a separate visual gate | Raw fallback and derivatives share graph identity |
| Optimized KTX2 environment | Exact derivative plus raw fallback and all Basis files in one graph | This deployment fixture fetches Basis but does not transcode KTX2 | Publication refuses incomplete decoder closure |
| Baked/custom reflection probes | Exact bytes/hash and graph-relative verification inside the graph | Wider published-panorama browser evidence remains pending | Every declared probe URL is addressed |
| Basis transcoder JS/WASM, README, license | Concrete, exact-byte graph entries under the digest directory | Stable compatibility copies remain during migration | The graph directory versions all four together |
| Generated manifest | Hash-enforced schema-v3 file in `genDir`; not normally a public runtime request | Not part of the static scene directory; absolute machine/source metadata also harms cross-machine reproducibility | Keep the authoritative build manifest in `genDir`; optionally publish a normalized runtime copy inside the addressed directory only after its role and canonicalization are specified |
| Generated TypeScript and editable baked recipe | Module hash is verified; website build fingerprints bundled JavaScript; recipe remains application-owned | These are build inputs, not static scene requests, and copying them into `public/` would duplicate framework ownership | Keep outside the scene graph; their job is to point to one graph identity |
| Audio URL and color-grade LUT URL in portable Components | Artist-authored `http(s)` locator; application loaders may own credentials/cache | No compiler-owned bytes/hash, so Blendlink cannot claim immutability or relocation | Classify as external dependencies; optional future import-to-bundle must be explicit, never inferred |
| Navigation URL | Artist intent, not an asset request | Must never be rewritten as a scene asset | Explicitly excluded from graph discovery |

### Audit against the known deeper-work requirement

| Requirement | Status now | Evidence-based conclusion |
|---|---|---|
| Complete dependency graph | Implemented/verified for internal compiler publication; externally produced closure remains explicit Future Work | Internal candidates, including concrete Basis files, are one `runtimeAssetGraph`; exact stable and addressed files are revalidated by graph path and full SHA-256. Application-owned remote Component assets and generic external build companions are intentionally outside the claim. |
| Base-path-safe Next | Implemented and verified in a packed Next 16.2.6 production browser cell | `assetBaseUrl` rebases compiler-owned requests only. `assetPrefix` still does not automatically apply to `public/`. |
| Base-path-safe Vite | Implemented and verified in a packed Vite 7.3.6 production browser cell | The application passes `import.meta.env.BASE_URL`; generated strings are not rewritten by the bundler. |
| CDN-safe | Implemented and verified against a second loopback origin | Exact-origin anonymous CORS and graph requests pass. Credentials, custom headers, and a deployed edge remain host-owned and unproven. |
| Immutable caching | Implemented/verified for the exact graph prefix only | Packed Next/Vite/CDN cells plus Next dogfood prove the header on addressed files and its absence on stable/lookalike paths. |
| Atomic publication | Implemented/verified for cooperative local publishers | The complete graph seals first; generated activation switches last under publication scopes. Network filesystems and non-cooperative external writers remain outside the claim. |
| Framework ownership | Correct | `publish` runs the existing build and does not deploy or rewrite host config. Preserve this boundary. |

## Required invariants for a complete scene bundle

These invariants should hold regardless of the chosen interface:

1. **Graph closure.** Every compiler-owned request reachable from the generated
   descriptor is an entry: GLB, all atlas authorities and variants,
   environment sources/derivatives, non-runtime probe sources, and all required
   Basis runtime/attribution files. Embedded GLB resources are represented by
   the GLB entry, not duplicated.
2. **One-way ownership.** Remote Component media and application loader
   resources are explicitly external. Blendlink neither downloads nor rewrites
   them without a future opt-in import feature.
3. **Path safety.** Entry paths are normalized POSIX-relative paths. Absolute
   paths, drive letters, backslashes, `.`/`..`, fragments, queries, duplicate
   normalized paths, symlinks escaping staging, and case-fold collisions are
   loud errors.
4. **Address truth.** The graph digest covers a domain/version marker, sorted
   relative path, byte length, and exact bytes for every entry. Use full SHA-256
   for the directory identity; the existing 16-hex drift fields may remain for
   compatibility. The digest algorithm and exclusions are documented.
5. **No self-reference.** A manifest included in the digest cannot contain its
   final hash directory as literal bytes. Either it uses graph-relative asset
   references (schema reshape), or schema-v3 publication hashes a documented
   canonical form containing a root placeholder and then substitutes the
   directory. Do not call the latter a raw directory-byte hash; call it the
   canonical graph fingerprint.
6. **Atomic switch.** A fresh staging directory is recursively verified, then
   renamed to a never-mutated hash path. If that path already exists, exact
   graph identity is verified and reused. Only afterward are the generated
   module/manifest switched transactionally. Cleanup of old bundles is a
   separate, explicit operation.
7. **Relocation locality.** One application-owned base URL relocates every
   compiler-owned request, including the Basis directory. No framework adapter
   walks manifest fields in application code.
8. **Cache honesty.** Only the graph-hash route receives
   `public, max-age=31536000, immutable`. Mutable pointers, HTML, generated
   source, and unaddressed external URLs do not inherit that header.
9. **CORS honesty.** Cross-origin public assets default to credential omission.
   Credentialed/custom-header loading uses an application-owned loader or
   manager and an exact-origin CORS configuration; Blendlink never emits
   wildcard-plus-credentials advice.
10. **Loud verification.** Missing entries, byte/hash disagreement, an
    unexpected KTX2 requirement without Basis, manifest/schema disagreement,
    or a public URL escaping the chosen base blocks publication with the scene,
    role, path, and correction.

## Three radically different deep module interfaces

The dependency classification is common to all three designs:

- graph discovery, canonicalization, hashing, and URL resolution are
  **in-process** dependencies;
- filesystem staging/rename is **local-substitutable** and already has a test
  stand-in through injected rename behavior;
- a CDN or static host is **true external**; its headers, CORS, credentials, and
  upload behavior require an explicit Adapter if Blendlink ever crosses that
  seam;
- Next and Vite are build-time **local-substitutable** dependencies for packed
  consumer tests, but they are not runtime asset transports.

### Design A — minimal interface: one published bundle, one resolver

This design minimizes the Interface to two entry points and keeps schema v3.

```ts
type PublishedSceneBundle = Readonly<{
  id: string                    // full graph SHA-256
  directory: string             // local final directory
  defaultBaseUrl: string        // root-deployed public default
  manifestPath: string
}>

publishSceneBundle(scene: CompiledSceneStage): Promise<PublishedSceneBundle>

resolveSceneAssets<T extends CompiledSceneDescriptor>(
  descriptor: T,
  options?: { baseUrl?: string | URL },
): T
```

**Invariants and ordering.** `publishSceneBundle()` discovers and verifies the
closed graph, commits the never-mutated directory, then creates the schema-v3
generated artifacts. `baseUrl` is the replacement public root, not the scene
directory: `/models/hero/<hash>/hero.glb` under `/portfolio/` becomes
`/portfolio/models/hero/<hash>/hero.glb`. `resolveSceneAssets()` accepts only
that public-root URL, preserves every per-file query/fragment, and rewrites all
and only compiler-owned descriptor locators. It must run before any loader is
created.

**Errors.** Publication rejects every graph/path/integrity failure named above.
Resolution rejects a base containing query/fragment, a non-HTTP(S) production
base, an unknown absolute compiler URL, or a resolved URL that escapes the
base. Errors name the descriptor field and asset role.

**Usage.** Root deployment remains trivial; a subpath or CDN is one option.

```ts
const scene = resolveSceneAssets(workbenchDogfood)

const cdnScene = resolveSceneAssets(workbenchDogfood, {
  baseUrl: 'https://cdn.example.com/portfolio-assets/',
})
```

**Hidden Implementation.** Recursive graph discovery, exact hashing,
placeholder canonicalization for the optional public manifest copy, Basis
inclusion, path collision checks, atomic directory commit, current schema-v3
field walking, query-safe URL construction, and error formatting all stay
behind the seam.

**Dependencies and Adapters.** No external Adapter is introduced. The
filesystem seam remains internal with real and in-memory/temp-directory
Adapters. A host/CDN receives ordinary static files; it does not implement this
Interface.

**Depth, locality, and leverage.** This Module is deep: two entry points hide
the complete inventory and every framework distinction. Locality is strong
because new schema-v3 asset fields update one walker. Leverage is high for
Vanilla, R3F, Next, Vite, preview, and verification. Its thin point is that the
walker knows every URL-bearing v3 field, and the manifest is relocatable only
through canonicalization rather than intrinsically.

**Migration and tests.** Existing root deployments keep working. First add
query-safe resolution and table-driven URL-field tests; then publish hashed
directories while leaving old stable outputs for one compatibility window.
Test two byte-identical builds for identical IDs, each one-byte graph change
for a changed ID, nested paths/case-fold collisions, KTX2 closure, rollback,
root/Next-base/Vite-base/full-CDN resolution, existing query preservation, and
packed Next/Vite production requests. Old schema-v3 fixtures remain readable.

### Design B — maximum host flexibility: asset-reference port

This design places the seam at every asset request and evolves the manifest to
schema version 4. It maximizes host control for authenticated archives, signed
CDN URLs, custom telemetry, and non-HTTP stores.

```ts
type SceneAssetRef = Readonly<{
  id: string
  role: 'scene' | 'atlas' | 'environment' | 'probe' | 'basis-js' | 'basis-wasm'
  path: string
  hash: string
  bytes: number
  mediaType?: string
}>

interface SceneAssetPort {
  resolve(ref: SceneAssetRef): string | URL
  request?(ref: SceneAssetRef): RequestInit
  transcoderBase?(refs: readonly SceneAssetRef[]): string | URL
}

installThreeCompiledScene({ descriptor, assets }: {
  descriptor: SchemaV4Descriptor
  assets: SceneAssetPort
}): Promise<InstalledThreeCompiledScene>
```

**Invariants and ordering.** Schema v4 semantic fields refer to asset IDs, not
URLs. Every ID resolves to exactly one typed graph entry. The Port is provided
before preload/load and returns stable answers for one installation. Request
options are applied only by loaders that truthfully support them; a Basis
transcoder needs one common directory or a custom KTX2 Adapter.

**Errors.** Unknown/missing IDs, role mismatches, a Port returning different
origins for coupled Basis entries, credentials without an application-owned
manager, unsupported headers on image/worker paths, and hash/length mismatch
are loud. Because response-byte verification in the browser is expensive and
can duplicate decoding, it should be opt-in smoke evidence, not silently done
on every load.

**Usage.** The host can supply a static Adapter or an authenticated Adapter.

```ts
const assets: SceneAssetPort = {
  resolve: (ref) => new URL(ref.path, signedDeploymentBase),
  request: () => ({ credentials: 'include', headers: sessionHeaders }),
}
await installThreeCompiledScene({ descriptor: workbenchDogfood, assets })
```

**Hidden Implementation.** Asset-ID lookup, dependency ordering, loader
selection, progress accounting, CORS/credentials compatibility checks, Basis
group validation, URL encoding, and disposal remain behind the seam.

**Dependencies and Adapters.** This is a real port only if at least two
Adapters ship: a static-public Adapter and an application/test Adapter (for
example an in-memory archive). A hypothetical single static Adapter would add
indirection without earning a seam. CDN/authentication is a true-external
dependency; tests use an in-memory Adapter, production uses an application
Adapter.

**Depth, locality, and leverage.** The manifest Module becomes very deep and
intrinsically relocatable. Change locality is excellent for graph evolution.
Host leverage is maximum, but the Interface is substantially larger and leaks
HTTP/loader constraints into ordinary callers. The common static-site case
pays for flexibility it does not need.

**Migration and tests.** This is a schema reshape and requires version 4,
dual-generation during a bounded migration, loud v3/v4 readers, updated
`docs/MANIFEST.md`, and every Vitest/headless-addon/e2e contract required by the
repository rules. Contract tests run the same graph through static,
authenticated, and in-memory Adapters; loader tests prove which request options
actually reach GLB, HDR/EXR, KTX2, probe, and Basis fetches. Do not implement
this only to solve base paths.

### Design C — trivial common default: deployment-bound generated association

This design moves the seam to `connect`: deployment location is configuration,
and generated application-owned association code has no runtime asset option.
It keeps schema v3 but requires rebuilding/reconnecting for another base.

```ts
// blendlink.config.mjs
export default defineConfig({
  publicBase: '/portfolio/',
  scenes: [/* ... */],
})

// generated once by connect; ordinary caller learns nothing about assets
export const WorkbenchScene = createR3FCompiledScene({
  descriptor: bindPublishedBase(workbenchDogfood, '/portfolio/'),
  createBakedScene,
})
```

**Invariants and ordering.** One configured base is normalized during
`connect`; all generated associations bind it before runtime loading. The base
must match the actual deployment and is fixed for that application build.

**Errors.** Missing/ambiguous framework base configuration, a Next
`basePath`/configured base disagreement, a Vite configured `base` disagreement,
or a full CDN base without explicit CORS acknowledgement blocks `connect` or
the production check. Blendlink must not edit `next.config.ts` or
`vite.config.ts` to repair it.

**Usage.** The normal caller remains only `<WorkbenchScene />` or
`installWorkbenchScene(...)`; root deployment needs no new authored code.

**Hidden Implementation.** Framework detection, config normalization, generated
association binding, graph publication, and diagnostic comparison stay behind
the seam. The application still owns routes, Canvas, framework config, headers,
and deployment.

**Dependencies and Adapters.** Next and Vite readers would be
local-substitutable Adapters only if both are implemented and tested. Executing
arbitrary framework config to infer values is unsafe and phase-dependent, so
the reliable implementation should prefer explicit Blendlink config and use
framework inspection only for diagnostics.

**Depth, locality, and leverage.** Caller leverage is ideal for the common
case: no runtime option exists. The Module is deep for artists but locality is
weaker because deployment identity is baked into generated associations and
connect/config logic. Preview, staging, multi-tenant hosting, runtime CDN
switching, and signed URLs are thin or impossible. A framework-specific
inference layer also risks becoming shallow glue.

**Migration and tests.** Add optional `publicBase` config with strict validation
and no rewrite of existing configs. Test root, `/portfolio/`, and absolute CDN
bases against packed Next and Vite builds; prove reconnect idempotence and loud
framework disagreement. Existing generated associations remain valid. This is
the easiest user experience but should not be the only lower-level Interface.

## Comparison and recommendation

Design A has the best current **depth**: a small Interface hides a large,
well-bounded implementation and gives every caller the same behavior. It
maximizes **locality** by keeping graph discovery, rewriting, and verification
inside Blendlink. Design B has the most expressive seam and the strongest
future manifest model, but its Interface is too large for the demonstrated
base-path/CDN job and forces a schema reshape. Design C makes the default
nearly invisible but couples a relocatable artifact to one application build
and tempts unsafe framework-config inference.

The recommended hybrid is Design A with Design C's root-deployment default:

- publish `public/models/<scene>/<graph-sha256>/...` as one verified immutable
  bundle;
- keep the generated descriptor directly usable for the ordinary same-origin
  root case;
- expose one optional `baseUrl` at the package-owned runtime seam and have the
  tiny generated Vanilla/R3F association pass it when the website needs a
  subpath or CDN;
- generate host-header snippets or diagnostics only as opt-in Adapters. Never
  rewrite an application's Next/Vite config automatically;
- keep schema version 3 for this work, because URL *values* and publication
  layout can evolve without reshaping runtime semantic fields;
- defer asset IDs/roles and schema version 4 until authenticated transport,
  archives, or application-wide shared asset policy proves the larger Port is
  real.

This also passes the deletion test: deleting the bundle Module would scatter
graph discovery, hashing, URL rewriting, Basis handling, transactional commit,
and verification back across compiler, typegen, runtime, generated bindings,
and framework-specific callers. The Module therefore earns its seam.

## Concrete implementation sequence

1. **Implemented:** the pure graph enumerator returns sorted, role-labelled
   relative entries; rejects unsafe/colliding paths and incomplete KTX2
   runtime; and produces full SHA-256 identity. External dependencies remain
   explicit manifest evidence.
2. **Implemented:** compiler-owned URL rebasing and query preservation live in
   one package utility rather than framework-specific string concatenation.
3. **Implemented:** safe relative-path resolution replaced basename reverse
   mapping in skip, verification, and incremental reuse. The wholly owned
   staging tree is recursively compared against the explicit compiler result,
   and direct glTF buffer/image URIs must close over companion entries.
4. **Implemented and verified:** graph digest and exact directory validation
   include Basis and gate unchanged skip plus `verify`. Production sync seals
   the never-mutated digest directory, resolves incremental paths back into it,
   retains old graphs, and refuses to overwrite a corrupt immutable directory.
   Recovery removes that complete directory. An intact stable compatibility
   atlas may then seed the same Blender-side fingerprint/artifact-hash gate,
   but never publication or URL selection; the real two-state Blender e2e
   proves a missing and a corrupt fallback each reuse `1/2` independent jobs,
   rebuild exactly `1`, and seal a fresh complete graph. Cooperative
   publication scopes close the reproduced local race. External pipeline
   semantics and automatic retention cleanup remain explicit Future Work.
5. **Decision recorded:** do not add a runtime `current.json`. Transactionally
   replace the generated descriptor/module only after the graph directory is
   sealed; that typed build artifact is the one mutable activation pointer.
   Keep the authoritative schema-enforced manifest in `genDir` during the v3
   migration.
6. **Implemented:** one `assetBaseUrl` option on the Three and R3F installation
   seam resolves all
   compiler-owned URLs once before loaders begin. Application-owned loaders and
   managers remain application-owned.
7. **Implemented and dogfooded:** `compiledSceneImmutableAssetPolicy` returns
   the exact prefix/header data without editing host configuration. Next server
   dogfood installs it explicitly. For `output: 'export'` and Vite, the
   production host still configures equivalent headers.
8. **Verified locally:** a non-root path and a second-origin CDN-like local
   server in browser
   tests. Assert exact GLB, atlas, environment/probe (fixture permitting), Basis
   JS/WASM, CORS, and cache headers. A root-only dogfood cannot verify this
   contract.

## Verification strategy

The minimum new evidence should be layered on top of, not substituted for, the
existing full gate:

- pure property tests for deterministic graph IDs, path normalization, closure,
  and one-byte invalidation;
- interface-level publication tests using a temp-directory filesystem Adapter,
  including rollback/reuse and Windows case-fold collisions;
- schema-v3 fixtures proving every URL-bearing field is relocated exactly once
  and existing queries/fragments survive;
- packed Vanilla and R3F consumer builds under Vite `base: '/portfolio/'`;
- a Next 16.2.6 production build with `basePath: '/portfolio'`, plus a request
  assertion showing the scene does not fall back to origin-root `/models`;
- a cross-origin browser fixture for permissive anonymous CORS and an explicit
  failing credential/wildcard case;
- a KTX2 fixture proving the GLB, environment if present, Basis JS, and Basis
  WASM all share one graph identity and a decoder update changes that identity;
- response-header assertions proving only graph-addressed paths receive
  `max-age=31536000, immutable`;
- `npm run test:full`, packed consumers, add-on headless/archive verification,
  baked appearance/lighting e2e, dogfood Final publish, its Playwright suite,
  Next production build/TypeScript checks, and both `git diff --check` gates.

## Explicit non-goals

- No cloud upload, hosting account, or deployment credential ownership.
- No generated application route, Canvas, or framework tree.
- No automatic rewrite of arbitrary Next/Vite configuration.
- No claim that `assetPrefix` relocates Next `public/` files.
- No blanket immutable policy before graph closure.
- No silent import of artist-authored remote media into the compiler graph.
- No manifest reshape merely to add a base URL.
