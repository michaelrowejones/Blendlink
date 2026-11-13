# Release process

This is the release interface for SceneToWeb. It produces two separately
installable artifacts from one tagged source revision:

1. the mixed-license `scenetoweb` npm tarball, whose file-level map is
   `LICENSES.md`; and
2. the GPL-3.0-or-later Blender Extension ZIP.

The npm package metadata uses `SEE LICENSE IN LICENSES.md`; its ordinary
Node/compiler/runtime files are MIT, its marked Cycles-derived numerical
modules (including native Magic) and Basis notices are Apache-2.0, its
Blender-dependent Python/add-on files are GPL-3.0-or-later, and the bundled
`n8ao-webgpu` runtime is CC0-1.0 with its original license and notices. Version equality
does not merge the artifacts' distribution systems or erase those file-level
licenses.

## Current release status

The product is now SceneToWeb, distributed as `scenetoweb` and
`scenetoweb-addon-<version>.zip`. Historical registry checks below refer to
the former name; they do not establish ownership of the new package name.
The repository slug and source directory remain `Blendlink` and
`packages/blendlink`. Publishing requires the new package-specific trust
binding and `SCENETOWEB_NPM_TRUSTED_PUBLISHING` gate.

The [2026-09-07 first-user audit](FIRST_USER_AUDIT_2026-09-07.md) adds local
installation, Blender, browser and isolated-consumer evidence. It is not a
release approval. The status items below retain their dated evidence unless explicitly updated;
this audit did not recheck remote repository settings or registry ownership.

- `npm view blendlink name version --json` returned registry `E404` on
  2026-07-25, 2026-08-04 and 2026-11-11; no public unscoped `blendlink` package
  was visible to this client at those checks.
- No approved Blender Extensions release is recorded by this repository.
- The repository is public; the npm package and GitHub release remain unpublished.
- Local packaging and toolchain gates exist.
- Source pull requests run the full pinned Blender 5.2/KTX gate and the
  Linux/Windows 4.2/5.2 desktop installation checks. Desktop checks install the
  extension ZIP in a clean profile, acquire the private Node runtime with global
  Node/npm removed from PATH, export a website, and reuse the tools offline.
  They are installation/scene-export evidence, not the full material fixture
  suite on every Blender version. Distribution jobs remain restricted to tags.
- `npm run test:preview-ux` now exercises actual browser rendering, orbit
  inspection, portrait framing, nonblank PNG capture, keyboard focus, load
  retry, failed-save recovery, and standalone export in a hosting subfolder.
  The standalone fixture passes in Playwright Chromium/Firefox/WebKit on
  macOS and hosted Linux. [Preview UX run 43366540752](https://github.com/michaelrowejones/Blendlink/actions/runs/43366540752)
  on commit `98ff98a` passed the complete flow and retained screenshots/report.
  Linux uses Xvfb and software rendering; this does not certify physical GPUs.
- The Node contract has hosted passes for exact Node 22.15.0, latest Node 22,
  and Node 24. [Release contract run 43366541099](https://github.com/michaelrowejones/Blendlink/actions/runs/43366541099)
  on commit `98ff98a` passed those checks, the full Blender 5.2.0/KTX 4.4.2
  release suite, and all four Linux/Windows Blender 4.2.0/5.2.0 desktop checks.
  Its latest attempt passed every required job after retrying an archive
  download failure. The full gate includes real codecs, discovered Blender
  suites, packed consumers and baked appearance/lighting/material end-to-end
  checks. [Native canaries run 43366540747](https://github.com/michaelrowejones/Blendlink/actions/runs/43366540747)
  also passed all sixteen jobs, including the bounded asynchronous Noise
  install/cancel/reapply lifecycle. These results certify that checkpoint;
  later node ports require their own combined and hosted qualification.
- Exact Blender 4.2.0/5.2.0 Linux/Windows archive acquisition and checksums have
  now run successfully on hosted workers. macOS arm64 retains local CPU-only
  evidence; its hosted prototype and an application-owned reusable browser
  matrix remain unrun. The tagged workflow defines same-run candidate
  attestation, numeric-ID transfer, OIDC-only npm
  publication of the retained tarball, public-registry byte/provenance checks,
  and exact immutable GitHub prerelease assets. Distribution jobs were skipped
  on this pull-request run. Protected environments, npm trust binding, immutable-release
  setting, marketplace upload, and deployed CDN verification remain external.
- `npm run release:artifacts` now retains one npm tarball and one Blender ZIP,
  installs the exact ZIP, compiles Vanilla/R3F consumers from the exact
  tarball, compares their add-on fingerprints, and writes `release-manifest.json`
  plus `SHA256SUMS`. The normal command refuses a dirty worktree.
- The 2026-11-11 dependency refresh pins Sharp 0.35.5 and ndarray-pixels
  5.2.0. Both production and complete dependency audits returned zero findings.
  The former Sharp advisory exception has been removed. The release gate
  requires an empty, well-formed audit and verifies the exact patched chain's
  lock records and native-payload integrity. A new advisory or dependency drift
  blocks release. The existing GIF/TIFF/VIPS input restrictions remain.
- The Blender source and retained ZIP embed the full GPL version 3 text in
  `LICENSE`; release assembly refuses a missing/wrong text. The npm artifact
  embeds the complete MIT and GPL texts, the Basis Apache notice, and its
  `LICENSES.md` file map.

Do not describe a local archive, workflow definition, upload submission, or
preview deployment as a public release.

## Prepare the release

1. Choose a SemVer version and update both
   `packages/blendlink/package.json` and
   `packages/blender-addon/blender_manifest.toml`.
2. Move relevant `CHANGELOG.md` entries from Unreleased into a dated version.
3. Add any required user action to `docs/MIGRATIONS.md`.
4. Update `SUPPORT.md` and `SECURITY.md` for the release line.
5. Confirm generated documentation and package metadata name the same version,
   licenses, repository, Node range, Blender floor, and peer ranges.
6. Release only from a reviewed, committed, protected tag. The worktree must be
   clean and the tag must identify the exact reviewed commit.

## Required repository evidence

Run from the SceneToWeb repository:

```powershell
npm ci
npm run test:full
npm run audit:production
npm run release:artifacts
git diff --check
```

`test:full` must include build, unit tests, real Blender/KTX tools, unpacked and
packed Vanilla/R3F consumers, npm archive inspection, isolated Blender add-on
installation, and baked appearance/lighting e2e. A missing real tool is a
failure, not an allowed skip.

`audit:production` requires zero findings over the exact reviewed patched
image-processing chain. Malformed output, registry failure, nonzero exit,
changed dependency/native payload integrity, or any advisory fails. Do not
restore the old workaround exception to accommodate a failing audit.

For an independent consumer installation, after retaining the archive run:

```sh
npm run test:fresh-install -- artifacts/release/<version>/scenetoweb-<version>.tgz
```

This optional network gate installs the exact archive outside the repository
with an empty npm cache, verifies its lockfile SRI, evaluates the compiler root,
and builds a browser consumer using only that installation. It complements the
offline packed consumers. It does not replace post-publication registry-byte or
provenance checks. The 2026-11-11 local rehearsal passed this independent gate.

`release:artifacts` writes the exact verified `.tgz`, `.zip`, manifest, and
checksums under `artifacts/release/<version>/`. CI must upload that directory as
one retained artifact. Do not rebuild either archive after approval. A local
rehearsal may pass `-- --allow-dirty`; its manifest records `dirty: true` and
those bytes must never be published.

For same-version local dogfood, never overwrite and force-install one mutable
tarball path. Build and optionally install a content-addressed rehearsal:

```powershell
npm run dogfood:package -- --output <archive-dir> --install <website-root>
```

The helper performs an ordinary saved install, then proves that the archive
SRI, both npm lock views, exact content-addressed locator, and installed package
tree agree. This is local rehearsal identity, not a substitute for SemVer or
the retained release manifest.

## Required hosted compatibility evidence

Before the first public release, required checks must include:

- Node exact `22.15.0`, latest Node 22, and latest Node 24;
- exact Blender 4.2.0 and 5.2.0 archive validation/install/headless tests on
  Linux x64 and Windows x64;
- a macOS arm64 prototype before claiming macOS Blender support, using hardware
  that meets Blender's documented memory minimum;
- production Chromium, Firefox, and WebKit application smoke from a committed
  application-owned route;
- mobile Playwright profiles labeled as emulation, not device certification;
- application build, TypeScript checks, and `git diff --check` in the dogfood
  repository.

The reusable browser workflow only supplies browser binaries and the three
browser jobs. The calling application owns its route, Canvas, test thresholds,
web server, loading/error UI, and Playwright test file. Until a caller commits
and invokes that workflow, it is proposed CI rather than verified behavior.

An application can invoke it from its own workflow after pinning a reviewed
SceneToWeb commit:

```yaml
jobs:
  blendlink-browser-smoke:
    uses: michaelrowejones/Blendlink/.github/workflows/browser-smoke-reusable.yml@<full-commit-sha>
    with:
      working_directory: .
      test_path: e2e/blendlink-lab.spec.ts
      node_version: "24"
```

The test must be self-contained after `npm ci`, normally by declaring its
production web server in `playwright.config.*`. Mobile, service-worker, or
special CSP projects remain application configuration rather than hidden
workflow behavior.

## Dogfood acceptance

From the MichaelRoweJonesSite repository, the current release candidate gate is:

```powershell
npm run blendlink:publish -- workbenchDogfood
npx playwright test e2e/blendlink-lab.spec.ts
npm run build
npx tsc --noEmit
git diff --check
```

This local Chromium gate does not establish Firefox, WebKit, real mobile,
deployed CDN/base-path/CORS/CSP/service-worker, or immutable-cache evidence.
Those claims require dedicated hosted projects and retained artifacts.

## Publish npm

The steady-state publisher is the `publish-npm` job in
`.github/workflows/blender-contract.yml`. It runs on GitHub-hosted Ubuntu in
the protected `npm-production` environment, installs the reviewed npm 11.18.0
CLI on Node 24, has read-only `actions`, `attestations`, and `contents` access
plus `id-token: write`, and refuses npm write-token environment variables. It
downloads the candidate by the producer's
numeric artifact ID, checks the service digest, reruns the retained verifier,
verifies GitHub build attestations, and invokes exactly:

```text
npm publish ./artifacts/release/<version>/scenetoweb-<version>.tgz \
  --registry=https://registry.npmjs.org/ --access=public \
  --provenance --tag=<latest-or-beta>
```

It never runs `npm pack` or publishes a directory. After any definite or
ambiguous publish response, it resolves the exact registry version, downloads
the canonical tarball, requires byte-for-byte equality, verifies SRI/SHA-1,
repository identity, SLSA provenance, GitHub trusted-publisher metadata, the
dist-tag, and `npm audit signatures`. An existing different or token-published
version fails permanently rather than being overwritten.

Before enabling the job, bind npm's trusted publisher to the exact public
repository, `.github/workflows/blender-contract.yml`, environment
`npm-production`, and allowed action `npm publish`. Protect `v*` tags and the
environment, then set its environment variable
`SCENETOWEB_NPM_TRUSTED_PUBLISHING=true`. Do not place `NODE_AUTH_TOKEN`,
`NPM_TOKEN`, or another write token in this steady-state job.

npm currently requires a package to exist before its trusted publisher can be
configured, while `blendlink` returned `E404` on 2026-07-25. Therefore the
first registry write is an explicit external blocker, not a hidden fallback.
If the package is still absent, make one separately reviewed, protected
bootstrap publication of a lower prerelease such as `0.9.0-bootstrap.0` under
a non-default `bootstrap` dist-tag, using that tag's exact retained tarball and
a short-lived granular token. Then configure trust, revoke the token, disallow
token publication after OIDC succeeds, and leave `0.9.0` available for the
first trusted publication. The repository intentionally contains no permanent
token branch in the production job.

Do not publish manually from a maintainer workstation. A mistaken version is
deprecated and replaced; it is never overwritten or blindly retried.

## Publish the GitHub prerelease

Only after public npm bytes verify, `publish-github-release` downloads the same
numeric candidate artifact in the separate `github-release-production`
environment. It verifies the candidate, tag commit, attestations, and npm bytes;
creates or resumes one draft prerelease with exactly the npm tarball, Blender
ZIP, `release-manifest.json`, and `SHA256SUMS`; downloads and byte-compares the
assets; then performs one publish transition. It never uses asset clobbering.

Enable GitHub immutable releases first, protect the environment, and set
`SCENETOWEB_IMMUTABLE_RELEASES=true` there only after confirming the repository
setting. The final verifier requires the REST release record to be non-draft,
prerelease, immutable, targeted at the exact commit, and to expose the exact
four server-side SHA-256 digests. Workflow definition and local policy tests
are implemented; a real tagged hosted run remains required evidence.

## Publish the Blender Extension

Validate the source directory and final retained archive with Blender's native
extension validation command. Install that exact ZIP into isolated Blender
4.2.0 and 5.2.0 profiles, enable it, and verify ID, version, package, and
operators before upload.

Attach the ZIP and checksum to the same GitHub release as the npm tarball.
Submission to extensions.blender.org is external and remains pending until
moderation approves it. The add-on must not install the Node CLI or other
packages; missing external prerequisites must fail loudly with a remedy.

## Deployment and caching claims

Website deployment remains application-owned. A release may say local
production smoke passed. It may not claim deployed CDN, non-root base path,
CORS, response-header CSP, required-KTX2 worker, service-worker update, or
cache-header verification until those exact hosted projects run.

Internally compiled scenes are sealed as a complete compiler-declared graph
under `<scene>/<full-sha256>/`, including the GLB, declared atlas/environment/
probe companions, and concrete Basis runtime files when required. The
descriptor-derived policy grants `immutable` only to that exact digest prefix.
Application-owned remote Component assets and generic external build
companions are outside that closure and must keep their own policy. Mutable
HTML, stable compatibility paths, descriptors, and latest pointers must not
inherit immutable headers. A release may claim this local policy contract, but
not deployed header behavior until the target host is verified.

## Final checklist

- [ ] Versions, `SEE LICENSE IN LICENSES.md`, the file-level map, and embedded
      license texts agree with the intended artifacts.
- [ ] `npm run audit:production` has no unreviewed production vulnerability;
      any reviewed workaround is named rather than described as patched.
- [ ] Changelog, migration, support, and security documents are current.
- [ ] Required local and hosted checks passed without silent skips.
- [ ] Exact `.tgz` and `.zip` were retained and checksummed.
- [ ] Each retained artifact contains the correct full license text and notices.
- [ ] Dogfood publish/build/browser/TypeScript checks passed.
- [ ] Protected tag and GitHub release identify the reviewed commit.
- [ ] npm trusted publish and provenance were verified.
- [ ] Blender upload status is recorded honestly.
- [ ] External deployment/cache claims include their own evidence or are omitted.
