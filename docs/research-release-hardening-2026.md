# Release hardening, 2026

Date: 2026-07-22; implementation evidence refreshed 2026-07-25

## Implementation and dogfood update

- `npm run release:artifacts` now creates one retained npm tarball and one
  retained Blender ZIP from the same version/source, compiles packed Vanilla
  and R3F consumers, validates and installs the exact ZIP, compares the npm and
  installed add-on tree fingerprints, and writes npm integrity,
  `release-manifest.json`, and `SHA256SUMS`. Normal runs refuse dirty source;
  the explicit rehearsal flag records `dirty: true` and is not publishable.
- The package prepack step now removes late-created Python bytecode. The packed
  artifact gate verifies 270 files without `__pycache__`, `.pyc`, or tests.
- A live production audit reports exactly three high-severity package entries
  and zero critical findings for Sharp/libvips advisory
  `GHSA-f88m-g3jw-g9cj`, through
  `@gltf-transform/functions@4.4.1` -> `ndarray-pixels@5.0.1` ->
  `sharp@0.34.5`. Blendlink implements the advisory's official GIF/TIFF/VIPS
  loader blocks at every package-owned Sharp entry point, with behavioral
  refusal tests. The audit still reports the high findings: this is a reviewed
  public-beta workaround, not a patched dependency graph. The three direct
  package edges are exact-pinned, and a fail-closed policy accepts only that
  exact advisory/count plus a content fingerprint over the lock records,
  registry integrity, and all platform-specific Sharp/libvips payloads in the
  reviewed loader snapshot. An unexpectedly clean advisory response fails
  while those vulnerable bytes remain pinned.
  `npm run audit:production` passed live on 2026-07-25 with
  `BLENDLINK_PRODUCTION_AUDIT_VERIFIED reviewed-workaround
  GHSA-f88m-g3jw-g9cj functions=4.4.1 ndarray-pixels=5.0.1 sharp=0.34.5`;
  its policy tests passed 7/7. Any changed/new finding or content drift blocks release, and a
  compatible patched dependency upgrade remains follow-up.
- Cube Diorama exposed static custom-property drivers being classified as
  timeline motion. The compiler now distinguishes static dependency drivers
  from frame/time/context/action/NLA motion; the real 10,000-frame scene and a
  new headless regression both pass, while a frame expression still blocks.
- Blender 4 Splash exposed expected safe refusal at 210 frames for 23 temporal
  Geometry Nodes candidates. An artifact-only 120-frame derivative sampled all
  frames, proved zero topology/position/appearance changes, and compiled. It
  also exposed warning noise, missing dependency visibility, and recipe
  fallback ambiguity; loader-renaming notes now aggregate, missing Blender
  references are promoted, and a missing recipe explains that the starter view
  is diagnostic rather than authored presentation.
- A real production Next/Chromium fixture now loads the site's retained
  KTX2+Meshopt workbench GLB under paired response-header policies. It proved
  that Three r184's WorkerPool strands a KTX2 load when CSP asynchronously
  blocks its Blob worker. Blendlink now watches only enforced Blob
  `worker-src`/fallback violations during package-owned KTX2 loading, aborts
  the private request graph, disposes the loader, and reports the policy remedy.
  The blocked route reaches Error instead of hanging; the allowed route reaches
  Ready and traversal finds decoded `CompressedTexture` maps.

## Decision summary

Blendlink has a credible **local release candidate gate** and an implemented
exact-artifact publication workflow, but it does not yet have hosted proof of a
public release channel. The repository verifies the npm
tarball, compiles Vanilla and React Three Fiber consumers from that tarball,
builds and installs the Blender extension in an isolated profile, runs real
Blender/KTX tools, and exercises baked output. It does not currently have
hosted evidence from its newly defined Node and exact-version Blender matrices,
the protected-environment npm/GitHub jobs, a caller of the reusable
cross-browser workflow, or public artifacts. Changelog, security, support,
migration, and release policies are now present but remain unreleased
governance.

The recommended release boundary is two separately installable artifacts made
from one tagged source revision:

1. the public `blendlink` npm package; and
2. the Blender Extension `.zip`.

Both artifacts should carry version `0.8.0` today, but they have different
distribution systems and file-level licenses. The npm tarball is a mixed
aggregate declaring `SEE LICENSE IN LICENSES.md`: Node/compiler/runtime files
are MIT, Blender-dependent Python/add-on files are GPL-3.0-or-later, and Basis
notices are Apache-2.0. The standalone Blender extension is
GPL-3.0-or-later. A release workflow should prove version agreement, license
maps/texts, and attach both artifacts to the same GitHub release without
pretending their licensing is homogeneous.

This note uses four evidence labels:

- **Implemented**: present in the repository.
- **Locally verified**: exercised on the maintainer's current Windows toolchain.
- **CI-proposed**: a concrete design, not yet a repository guarantee.
- **External**: requires registry configuration, hosted deployment, moderation,
  credentials, or hardware outside this repository.

## Current posture

| Area | Evidence today | Honest status |
| --- | --- | --- |
| npm package | `files` allowlist, exports, engines, exact Three r184 peer contract, mixed-license map, repository, and version are declared in [`packages/blendlink/package.json`](../packages/blendlink/package.json) and [`packages/blendlink/LICENSES.md`](../packages/blendlink/LICENSES.md). [`scripts/test-package.mjs`](../scripts/test-package.mjs) runs `npm pack --json`, checks required/forbidden paths and embedded license texts/notices, extracts the archive, checks npm/add-on version equality, and compiles Vanilla and R3F consumers from that exact tarball. The same workspace/exact-packed consumer gate evaluates the root through a resolver that refuses React/R3F, while `blendlink/react` still compiles. | **Implemented; locally verified.** No registry publish or install-from-registry evidence. |
| Node support | The package declares `^22.12.0 || ^24.0.0`; the workflow defines exact 22.12, latest 22, and latest 24 jobs. | **Implemented contract / CI-proposed.** The matrix has not produced hosted results. |
| Blender Extension | [`blender_manifest.toml`](../packages/blender-addon/blender_manifest.toml) declares schema 1.0.0, add-on version 0.8.0, Blender minimum 4.2.0, permissions, and GPL-3.0-or-later. [`scripts/test-addon-headless.mjs`](../scripts/test-addon-headless.mjs) runs headless suites, builds with Blender's extension command, installs into isolated `BLENDER_USER_RESOURCES`, enables it, and verifies package/operator/version. The workflow pins official Blender 4.2.0/5.2.0 Linux and Windows archives by SHA-256. | **Implemented locally / CI-proposed.** Only discoverable Windows Blender 5.2 has run locally; hosted endpoint jobs have not run. |
| Real tools | [`scripts/test-real-toolchains.mjs`](../scripts/test-real-toolchains.mjs) requires a supported Blender and KTX-Software, and runs real texture/HDR round trips. The release workflow checksum-pins official Blender 5.2.0 and KTX-Software 4.4.2 archives for the full contract. | **Implemented; locally verified.** Hosted workflow evidence remains pending. |
| Aggregate gate | Root [`package.json`](../package.json) defines `test:full`: build, unit, real tools, unpacked consumers, packed package, add-on headless/archive, and baked e2e. | **Implemented; locally verified.** No hosted runner evidence. |
| Browser smoke | `publish` optionally runs an application-owned smoke command after build and artifact re-verification. The package classifier distinguishes asset, console/page, CORS, CSP worker, decoder, canvas, pixel, WebGL, and service-worker evidence. The dogfood record includes a real required-KTX2 blocked/allowed response-header pair in production Next/Chromium. | **Implemented; locally verified in Chromium.** Firefox, WebKit, mobile, service-worker, real CDN, and deployed-origin coverage remain absent. |
| Asset identity | Internally compiled scenes publish a canonical closed runtime graph beneath `<scene>/<full-sha256>/`; integrity checks cover the GLB, compiler-declared companions, and concrete Basis runtime files when KTX2 is required. `assetBaseUrl` preserves root/base-path/CDN forms, and `compiledSceneImmutableAssetPolicy` derives the exact digest prefix. | **Implemented; locally verified for compiler-owned graphs.** Stable compatibility paths, generic external build companions, and application-owned remote Component assets are excluded. Deployed host/CDN header evidence remains external. |
| Release governance | npm and Blender versions are synchronized; `CHANGELOG.md`, `SECURITY.md`, `SUPPORT.md`, migration/release policies, retained dual-artifact assembly, candidate attestations, numeric-ID transfer, exact-tarball OIDC publication, registry equality, and immutable GitHub release checks are defined. | **Implemented locally / hosted and external setup pending.** No protected tagged run, signed/attested public artifact, npm trusted publish, or Blender marketplace approval exists. |

## npm publishing and the supported Node matrix

### Support contract

As of this note, Node 22 is Maintenance LTS through 2027-04-30 and Node 24 is
Active LTS, scheduled to enter Maintenance on 2026-10-20 and reach end of life
on 2028-04-30. Node recommends production use of Active or Maintenance LTS
lines. [Node release policy](https://nodejs.org/en/about/previous-releases),
[Node Release Working Group schedule](https://github.com/nodejs/Release)

The current engine expression is therefore sensible for a pre-1.0 release, but
the test plan must cover the actual floor, not merely a floating major. Use:

- `22.12.0`: compatibility-floor job;
- `22`: newest Node 22 maintenance patch; and
- `24`: newest Node 24 LTS patch.

The user-facing support promise can remain “Node 22.12+ or Node 24.” The extra
latest-22 job catches changes in the maintained line without silently raising
the floor. `actions/setup-node` accepts both exact and major version selectors,
recommends declaring the version explicitly, and supports matrix use. It caches
package-manager data, not `node_modules`; the lockfile should remain committed.
[setup-node documentation](https://github.com/actions/setup-node/blob/main/README.md)

When Node 22 reaches EOL, removing it from `engines` is a breaking support
decision for Blendlink users even if npm itself would still execute. Announce it
in the changelog and support table. Do not add Node 26 to the supported range
until its runtime, native dependencies, packed consumers, and real-tool gates
pass; “Current” is not evidence of product support.

### Trusted publishing and provenance

Use npm trusted publishing from one dedicated GitHub-hosted release job. npm's
OIDC path avoids a long-lived write token, requires npm CLI 11.5.1 or newer and
Node 22.14.0 or newer, requires `id-token: write`, and binds authorization to an
exact repository/workflow (and optionally environment). It does not support a
self-hosted GitHub runner for this flow. Trusted publishing automatically adds
provenance for public packages built from public repositories.
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

That minimum affects the **publisher**, not Blendlink's Node 22.12 consumer
floor. Use the newest Node 24 patch in the release job, update npm explicitly if
needed, disable package-manager caching, and grant only `contents: read` plus
`id-token: write`. Protect the release environment and `v*` tags, and configure
the exact workflow filename on npmjs.com. npm recommends disabling unused
tokens after migration.

Provenance links published bytes to public source and build instructions and is
signed through Sigstore/transparency infrastructure. It is valuable supply-chain
evidence, not proof that the code is safe; consumers can verify signatures and
attestations with `npm audit signatures`.
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/)

The release must build and inspect the publishable artifact before publication.
At minimum:

1. check out the protected tag at its exact commit;
2. run `npm ci` without release-job caching;
3. run the required gates and the Node/Blender/browser jobs;
4. run `npm pack --json` once and retain the `.tgz` as a workflow artifact;
5. verify its file list, version, license, exports, executable, add-on version,
   and packed consumer builds;
6. publish the retained package specification, rather than rebuilding from a
   mutable workspace; and
7. confirm the registry exposes the expected version and provenance.

npm registry versions are immutable: a published name/version cannot be reused,
even after unpublish. A bad version should normally be deprecated with a message
and replaced with a new version instead of removed from dependent builds.
[npm publish](https://docs.npmjs.com/commands/npm-publish/),
[npm unpublish policy](https://docs.npmjs.com/policies/unpublish/),
[npm deprecation](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/)

**Status:** the same-workflow candidate, trusted-publisher, registry,
protected-environment, tag, attestation, Actions-artifact read, and
post-publish checks are
**implemented and statically verified**. npm/GitHub configuration and a real
tagged run remain **external/pending**. npm's requirement that a package exist
before trust is configured also leaves one explicit lower-prerelease bootstrap
publication external; the steady-state workflow has no token fallback.

## Blender Extension release contract

Blender Extensions are `.zip` archives containing a manifest and, for add-ons,
an `__init__.py`. The official CLI builds, validates, and installs packages;
`blender --command extension validate <archive>` validates the final archive,
while `build` can split platform-specific packages when bundled wheels justify
it. The manifest's minimum must be at least Blender 4.2.0.
[Blender extension creation](https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html),
[Blender extension CLI](https://docs.blender.org/manual/en/latest/advanced/command_line/extension_arguments.html)

Blendlink currently contains pure Python add-on code and no platform wheels, so
one OS-neutral archive is the right release artifact. Do not produce per-platform
archives until a native wheel or other real platform dependency exists. Omitting
both `platforms` and `blender_version_max` makes a broad claim: the extension is
available on every extension platform and supports later Blender versions. A
maximum, when present, names the first unsupported Blender release. Keep:

- `blender_version_min = "4.2.0"` as the single compiler/add-on compatibility
  floor (the Node compiler reads it directly);
- no maximum version only while the current Blender release and the common
  platform set pass release CI; otherwise narrow the manifest rather than leave
  an untested claim;
- explicit `files` and `clipboard` permission reasons; and
- GPL-3.0-or-later for the add-on artifact; the npm aggregate retains its
  explicit MIT/GPL/Apache file-level map rather than claiming one license for
  every tarball member.

Every release runs both directory validation and final-archive validation,
installs the retained archive into an empty user resource directory, enables
the extension, and queries its ID/version/operators. The implemented local
assembly and same-commit candidate workflow perform that complete sequence;
hosted execution remains a separate pending fact.

Publishing on extensions.blender.org is **external**: the final ZIP requires a
Blender ID upload and moderation before it is publicly available. Local archive
success must not be described as marketplace approval.

The official repository also requires add-ons to work from a read-only extension
directory, keep bundled modules inside their package namespace, respect
`bpy.app.online_access`, and avoid installing packages or manipulating other
add-ons at runtime. Blendlink's separately user-installed CLI should therefore
remain a loud prerequisite, not something the add-on installs; moderator
clarification before first submission is prudent.
[Blender add-on guidelines](https://developer.blender.org/docs/handbook/extensions/addon_guidelines/),
[Blender moderation guidelines](https://developer.blender.org/docs/features/extensions/moderation/guidelines/)

## GitHub Actions design

GitHub-hosted standard runners exist for Ubuntu, Windows, and macOS, but their
resources and architectures differ; current `macos-latest` is arm64 while
explicit Intel labels are available. Matrix jobs can set `fail-fast` and
`max-parallel`. [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[matrix controls](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)

Avoid a full Node × Blender × OS Cartesian product. It repeats independent
contracts and makes expensive bake failures harder to diagnose. Use these jobs:

| Job | Matrix | Gate | Rationale |
| --- | --- | --- | --- |
| `node-contract` | Ubuntu × `22.12.0`, `22`, `24` | build, unit, unpacked consumers, `npm pack`, packed consumers | Fast proof of the declared runtime floor and both supported LTS lines. |
| `blender-core` | Linux x64, Windows x64, and macOS arm64 × exact Blender `4.2.0`, `5.2.0` | discovery/doctor, headless add-on suite, extension build/validate/install, representative export | Exercises the declared floor and current endpoint on the common architecture set without multiplying Node versions. Exact 4.2.0 matters because later 4.2 patches can add APIs. Use Node 24 for orchestration. |
| `real-toolchains` | Ubuntu `5.2.0` primary; Windows `4.2.0` secondary | KTX texture/HDR, real export, packed consumers where relevant | Pins costly external tools to a small but meaningful cross-version set. |
| `baked-e2e` | Ubuntu or Windows `5.2.0` canonical, CPU render | two-state baked appearance/lighting and image assertions | Standard hosted runners should not be treated as GPU farms. CPU evidence is slower but reproducible; GPU-specific claims require external runners. |
| `package-release-candidate` | Ubuntu, Node 24 | exact `.tgz` and extension ZIP, manifests, checksums, artifact upload | Produces the only artifacts eligible for release after dependencies pass. |
| `publish-npm` | Ubuntu GitHub-hosted, protected environment | read exact Actions artifact metadata, OIDC trusted publish of retained `.tgz`, provenance and registry verification | Separates elevated release permission from ordinary CI. |
| `publish-github-release` | Ubuntu GitHub-hosted, separate protected environment | read exact Actions artifact metadata, exact four retained files, draft verification, one immutable prerelease transition | Keeps npm OIDC and GitHub content mutation in different jobs. |

Use explicit Blender patch URLs and SHA-256 checksums from Blender's official
download service, cache downloads by exact version/OS/architecture if desired,
and never let a mutable “latest” resolve a compatibility job. Blender 4.2 and
5.2 share Linux x64, Windows x64, and macOS arm64 downloads; 5.2 does not offer
a macOS Intel package, so an Intel-only matrix cannot represent the current
release. [Blender 4.2 downloads](https://download.blender.org/release/Blender4.2/),
[Blender 5.2 downloads](https://download.blender.org/release/Blender5.2/)

The tagged-candidate workflow now acquires pinned official Blender 4.2.0 and
5.2.0 Linux/Windows archives and runs the named contracts before artifact
assembly. Hosted results and the macOS prototype remain **CI-proposed/pending**;
the workflow definition alone is not support evidence.

For Actions security, set workflow permissions to read-only by default and pin
third-party actions to full commit SHAs; GitHub identifies a full-length SHA as
the only immutable action reference. [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)

### Feasibility limits

- Blender's pure headless Python/archive tests are feasible on Ubuntu and
  Windows standard runners. The standard GitHub macOS arm64 runner has 7 GB RAM,
  below Blender's documented 8 GB minimum, so macOS must first be prototyped and
  then either use an arm64 larger runner or be explicitly excluded from the
  support claim. [Blender requirements](https://www.blender.org/download/requirements/),
  [GitHub larger macOS runners](https://docs.github.com/en/actions/reference/runners/larger-runners#available-macos-larger-runners-and-labels)
- Full rendering is feasible on CPU but may exceed practical pull-request time;
  keep the expensive bake matrix scheduled/release-gated if timings demand it.
- Hardware GPU/WebGL/driver equivalence is not established by a hosted runner.
  Any CUDA/Metal/driver performance claim needs labeled external hardware.
- The dogfood site lives in another repository. A Blendlink release workflow
  cannot honestly gate on an unspecified moving checkout. Either trigger a
  pinned dogfood revision with an explicit compatibility input or maintain a
  package-owned production fixture. Cross-repository credentials and preview
  deployment are **external infrastructure**.

## Browser matrix and its limits

Playwright projects can exercise its version-matched Chromium, patched Firefox,
and WebKit builds. Playwright's Firefox is not branded Firefox, and its WebKit
comes from WebKit mainline rather than branded Safari. Media/platform behavior
varies by OS; Playwright recommends macOS WebKit for the closest Safari
experience where media matters.
[Playwright browsers](https://playwright.dev/docs/browsers)

Recommended projects for the application-owned smoke route:

| Project | Purpose | What it does not prove |
| --- | --- | --- |
| Chromium, Firefox, WebKit on Ubuntu | Core scene installation, declared requests, ready/presented state, canvas size/non-empty pixels, error/retry, WebGL creation | Branded Firefox/Safari, real GPU diversity, mobile OS behavior |
| WebKit on macOS | Higher-value Safari/WebKit and media/audio approximation | Actual Safari release and iOS device policy |
| Pixel descriptor on Chromium | small viewport, DPR, touch/pointer layout path | Android Chrome, a phone GPU, thermal/memory pressure |
| iPhone descriptor on WebKit | viewport, UA, touch, DPR, responsive loading UI | iOS Safari, real autoplay/interruption, device memory/GPU |

Playwright device descriptors simulate values such as user agent, screen,
viewport, device scale, and touch. Call these **mobile emulation**, never mobile
device certification. [Playwright emulation](https://playwright.dev/docs/emulation)

CI should install matching browsers and OS dependencies with
`npx playwright install --with-deps`; Playwright does not recommend caching its
browser binaries because restore cost is comparable and Linux system
dependencies are not cacheable. Use one worker initially for the GPU-sensitive
smoke route, retain traces/screenshots/console logs on failure, and shard only
after isolation is proven. [Playwright CI guidance](https://playwright.dev/docs/ci)

Service-worker evidence needs two intentional projects:

1. `serviceWorkers: 'block'` for deterministic network-completeness and HTTP
   failure classification; and
2. a Chromium-only service-worker-allowed project that waits for activation,
   proves expected control/cache behavior, and records worker-owned requests.

Playwright warns that service workers can hide requests from page routing, and
its service-worker inspection support is Chromium-only. A passing blocked-SW
test is not evidence that the shipped service worker updates or invalidates
correctly. [Playwright network caveat](https://playwright.dev/docs/network),
[Playwright service workers](https://playwright.dev/docs/service-workers)

## Deployed CDN, base-path, CORS, CSP, and cache verification

Local production mode proves the built application, not its edge platform. A
release candidate should optionally gate a real HTTPS preview/staging origin
owned by the website. The deployed gate must discover the application-declared
smoke route rather than asking Blendlink to own a route.

At minimum, verify:

1. **Base path:** serve the application at a non-root prefix and assert every
   compiler-declared GLB, atlas, environment, probe, and Basis request resolves
   under the application-provided base/CDN. Next `basePath` is build-time and
   Next `assetPrefix` applies to `/_next/static`, not arbitrary `public/` files.
   Vite rewrites assets in its graph for `base`, but public files retain names
   and dynamic URL construction must use the configured base.
   [Next basePath](https://nextjs.org/docs/pages/api-reference/config/next-config-js/basePath),
   [Next assetPrefix](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix),
   [Vite build base](https://vite.dev/guide/build),
   [Vite static assets](https://vite.dev/guide/assets.html)
2. **Cross-origin CDN:** test a permitted origin and a deliberately missing or
   wrong `Access-Control-Allow-Origin`. If credentials are ever enabled, `*`
   is invalid and the server must return the explicit allowed origin; dynamic
   origin responses should vary on `Origin`.
   [Fetch CORS protocol](https://fetch.spec.whatwg.org/)
3. **CSP/decoders:** serve a real response header, not a meta-only simulation.
   Test allowed and blocked worker configurations with a scene that actually
   requires KTX2. CSP `worker-src` governs Worker, SharedWorker, and
   ServiceWorker creation and falls back through other directives when absent.
   [CSP Level 3 `worker-src`](https://www.w3.org/TR/CSP3/#directive-worker-src)
4. **Service worker:** run the deterministic SW-blocked asset audit, then the
   real SW-controlled flow. Service workers can handle fetch events and keep a
   response store similar to HTTP cache, so stale success is possible unless
   version transition and cache eviction are tested.
   [Service Workers specification](https://www.w3.org/TR/service-workers/)
5. **Headers and bytes:** assert status, MIME type, CORS, cache policy, content
   length/hash where observable, no HTML fallback for binary paths, and that
   every URL from `compiledSceneAssetUrls` was either successfully fetched or
   explicitly classified.
6. **Visible result:** retain canvas geometry, WebGL state, presented-frame,
   non-empty-pixel evidence, a screenshot, and application console/page errors.
   Pixel thresholds remain application-owned because transparent or sparse
   scenes can be valid.

All real CDN, DNS/TLS, edge-header, and deployed service-worker evidence is
**external**. The current classifier and application-owned command seam are
**implemented**; the existing dogfood run is **locally verified Chromium
evidence**, not deployed-origin certification.

## Immutable caching requires complete graph identity

`Cache-Control: immutable` tells clients that a fresh representation will not
change. RFC 8246's enabling pattern is a versioned URL: changed bytes receive a
new URL, allowing a long freshness lifetime without revalidation.
[RFC 8246](https://www.rfc-editor.org/info/rfc8246/)

Blendlink therefore does not recommend a route-wide immutable header.
Internally compiled scenes now publish one canonical compiler-declared graph
beneath `<scene>/<full-sha256>/`; stable compatibility paths can still refer to
changed bytes and remain mutable. The addressed closure covers:

- GLB and embedded payloads;
- canonical atlases and every delivery/resolution variant;
- raw and optimized HDR/EXR/KTX2 environments;
- reflection probes;
- Basis transcoder JavaScript/WASM and attributions;
- every compiler-declared runtime companion. The authoritative generated
  manifest and mutable activation descriptor stay outside the immutable
  subtree by design.

The implemented publication root is:

```text
public/models/<scene>/<graph-sha256>/...
```

The graph hash is computed from a canonical inventory of roles, relative paths,
byte hashes, and required runtime metadata. Publication writes a fresh
directory, verifies complete closure, refuses to overwrite a corrupt immutable
directory, and then emits the activation record used by the generated binding.
HTML, route data, mutable “latest” pointers, stable compatibility paths, and
generated bindings must use revalidation/no-cache policy rather than inherit
the immutable scene header.

Only the graph-addressed subtree may receive, for example,
`public, max-age=31536000, immutable`. A deploy gate must rebuild after changing
one dependency and prove both that the graph directory changes and that every
old URL still returns its old bytes. The detailed design is recorded in
[`research-asset-addressing-deployment-2026.md`](research-asset-addressing-deployment-2026.md).

**Status:** canonical graph inventory, fingerprinted directory publication,
old-graph retention, descriptor addressing, corruption refusal, and exact
immutable-policy derivation are **implemented and locally verified** for the
compiler-owned graph. Packed Next/Vite policy fixtures and Next dogfood verify
that addressed routes receive the header while stable/lookalike paths do not.
Generic externally produced companions and application-owned remote Component
assets are outside the closure. Real deployed CDN/header retention remains
**external**.

## SemVer, changelog, migration, security, and support

Blendlink 0.8.0 is still in SemVer's initial-development range, where the public
API is not considered stable. That is not permission to make silent breakage.
SemVer still requires released contents never be modified, and its major/minor/
patch meanings should guide the path to 1.0.
[Semantic Versioning 2.0.0](https://semver.org/)

The repository now keeps these release-owned documents. Refresh each one for
every candidate rather than treating its initial presence as sufficient:

- **`CHANGELOG.md`:** one human-readable, reverse-chronological entry per
  version, an Unreleased section, and only relevant headings among Added,
  Changed, Deprecated, Removed, Fixed, and Security. Link versions to diffs.
  [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
- **Migration policy:** name changes to CLI/config/generated bindings/runtime
  exports/manifest schemas/Blender properties; identify automatic rewrite or
  manual action; show before/after examples; state backup behavior and whether
  older generated sites remain loadable. Existing schema discipline remains:
  additive changes within a version, reshapes require a schema bump, and
  unsupported schemas fail loudly.
- **`SECURITY.md`:** supported release lines, private reporting instructions,
  expected acknowledgement cadence, and disclosure/update process. Enable
  GitHub private vulnerability reporting so reports need not start as public
  issues. GitHub describes that as a secure structured channel; it is separate
  from `SECURITY.md`.
  [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
- **`SUPPORT.md`:** distinguish “supported” from “tested”: Node 22.12+/24,
  Blender 4.2+ with CI endpoints listed, current Three/R3F peer ranges, OSes,
  browsers, KTX requirements, and best-effort areas. State how long the latest
  minor receives fixes and when old Blender/Node lines can be removed.
- **Release checklist:** clean tag, synchronized npm/add-on versions, changelog,
  migration note, all required CI checks, exact artifact checksums, provenance,
  GitHub release, npm registry verification, extension submission status, and
  dogfood compatibility result.

Public API includes more than exported TypeScript symbols: CLI flags/output
used by automation, config keys, generated binding shape, manifest schema,
Blender custom properties/operators, package subpath exports, asset layout, and
documented lifecycle/error behavior are all compatibility surfaces. Record that
inventory before declaring 1.0.

## Release acceptance ladder

### Stage A — repository-only hardening

- **Implemented/defined:** CI with Node floor/latest matrices; pinned Blender
  4.2/5.2 acquisition and extension validation/install jobs; reusable fast
  Node CI plus same-commit release dependencies; changelog, migration,
  security, support, and release-checklist documents; and one retained exact
  npm `.tgz`/Blender ZIP/checksum assembly command.
- **Pending hosted evidence:** run those definitions on the protected release
  infrastructure.

### Stage B — browser and dogfood hardening

- Invoke the defined reusable Chromium/Firefox/WebKit projects and honest
  mobile emulation projects from a committed application-owned route.
- Add SW-blocked and Chromium SW-allowed projects.
- Gate against either a package-owned production fixture or an explicitly
  pinned dogfood revision; do not consume a moving external branch.
- Preserve screenshots, traces, console/page errors, and declared-asset evidence.

### Stage C — external release infrastructure

- **Implemented locally:** same-run attestation and numeric artifact handoff,
  OIDC-only publication of the explicit retained `.tgz`, public-registry byte
  and signature verification, and exact immutable GitHub prerelease assets.
- **External:** if the package remains absent, perform one protected lower
  bootstrap-prerelease publication; then configure npm trust, protected GitHub
  environments/tags, immutable releases, confirmation variables, and private
  vulnerability reporting. Run the tagged workflow and retain hosted evidence.
- Submit the exact validated Blender ZIP to Blender Extensions; record
  moderation as pending until approved.
- Deploy a real non-root preview with a separate CDN origin and run base-path,
  CORS, CSP/required-KTX2, service-worker, cache-header, and visible-render
  projects.

### Stage D — immutable publication

- **Implemented locally:** publish the complete compiler-owned graph-addressed
  scene directory, prove byte changes alter its URL, reuse unchanged sealed
  graphs, retain old graph directories, and derive policy only for the exact
  digest subtree.
- **External:** verify those response headers, old-URL retention, and
  service-worker/CDN behavior on each deployed host.

## Bottom line

Blendlink is ready to create **local public-beta release candidates** and has a
reproducible exact-artifact workflow definition, but it is not yet ready to
claim a verified public release channel. The explicit dual-artifact assembler,
fail-closed reviewed-audit gate, graph-addressed publication, and least-
privilege publication jobs now exist. The highest-value next change is to
complete the first-package npm bootstrap/trust and GitHub protection settings,
run the hosted definitions on protected infrastructure, and replace the
reviewed Sharp/libvips workaround with a compatible patched graph. npm still
reports three high entries and must not be described as clean. Deployed
CDN/service-worker/old-URL claims remain external gates even though the local
immutable graph and policy are implemented.

## 2026-07-25 exact local rehearsal

After the fixed-camera cloud-card transport change, the complete local gate
passed again on Node `24.15.0` and Blender `5.2.0 LTS`: 82 Vitest files (685
tests passed, two skipped), 14 release-policy tests, all real Blender/KTX
toolchain cases, packed Vanilla and R3F consumers, the 270-file npm payload,
dogfood install identity, registered and isolated-archive add-on tests, and
both baked appearance/lighting states. The pinned Needle identity verifier also
passed 130 files and nine source-version identities.

`npm run release:artifacts -- --allow-dirty` then rebuilt and exercised the
version-scoped rehearsal bytes:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `blendlink-0.8.0.tgz` | 1,445,402 | `6f1d1fb19ed5c89997c5a62f45839b0fed6b4ba38450873699523e91eca30c9b` |
| `blendlink-addon-0.8.0.zip` | 384,146 | `af391fe5c36ec81bccba2029ce485b0df6469dca584623a613fbfcd56a3f802b` |

Both package surfaces contain add-on fingerprint
`6ffb947cdef750d9fc74463081a988e625e965e4d42e9a085654cd557eedae02`.
The npm production audit again passed only through the exact reviewed
`GHSA-f88m-g3jw-g9cj` workaround; this is not a zero-advisory claim. The
manifest deliberately records `dirty=true`, and the retained-release verifier
correctly refuses to bless it. These bytes are a local reproducibility and
consumer-install rehearsal, not a publishable candidate. A clean reviewed
commit and protected hosted release run remain required.

The MichaelRoweJones dogfood site installed that exact npm SHA, completed a
Final publish and production Next build, passed all 21 configured production
browser checks, and then passed the focused Blendlink lab suite 3/3. This is
current local browser evidence; deployed CDN, protected OIDC publication, and
public-registry byte equality remain external.
