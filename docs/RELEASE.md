# Release process

This is the release interface for Blendlink. It produces two separately
installable artifacts from one tagged source revision:

1. the mixed-license `blendlink` npm tarball, whose file-level map is
   `LICENSES.md`; and
2. the GPL-3.0-or-later Blender Extension ZIP.

The npm package metadata uses `SEE LICENSE IN LICENSES.md`; its ordinary
Node/compiler/runtime files are MIT, its Blender-dependent Python/add-on files
are GPL-3.0-or-later, and its Basis notices are Apache-2.0. Version equality
does not merge the artifacts' distribution systems or erase those file-level
licenses.

## Current release status

- `npm view blendlink name version --json` returned registry `E404` on
  2026-07-25; no public unscoped `blendlink` package was visible to this
  client at that check.
- No approved Blender Extensions release is recorded by this repository.
- Local packaging and toolchain gates exist.
- Node GitHub Actions and a reusable application-owned Playwright matrix are
  defined under `.github/workflows/` but have not yet produced hosted evidence.
- Exact Blender 4.2.0/5.2.0 Linux/Windows archive acquisition is defined and
  checksum-pinned, but has not run on hosted workers. The tagged workflow now
  defines same-run candidate attestation, numeric-ID transfer, OIDC-only npm
  publication of the retained tarball, public-registry byte/provenance checks,
  and exact immutable GitHub prerelease assets. It has not run on hosted
  workers, and the protected environments, npm trust binding, immutable-release
  setting, marketplace upload, and deployed CDN verification remain external.
- `npm run release:artifacts` now retains one npm tarball and one Blender ZIP,
  installs the exact ZIP, compiles Vanilla/R3F consumers from the exact
  tarball, compares their add-on fingerprints, and writes `release-manifest.json`
  plus `SHA256SUMS`. The normal command refuses a dirty worktree.
- A live production audit currently reports exactly three high-severity entries
  for one Sharp/libvips advisory, `GHSA-f88m-g3jw-g9cj`, through
  `@gltf-transform/functions` -> `ndarray-pixels` -> `sharp`. Blendlink applies
  the advisory's official GIF/TIFF/VIPS loader blocks at every package-owned
  Sharp entry point, and behavioral tests prove those inputs are refused. npm
  still reports the advisory: this is a reviewed public-beta workaround, not a
  claim that the dependency graph is patched. The fail-closed audit policy
  accepts only this exact advisory result while the three direct package edges
  remain exact-pinned. It content-identifies the lock records, registry
  integrity, and every platform-specific Sharp/libvips payload in the reviewed
  loader snapshot. A changed/new finding—or an unexpectedly empty report while
  that vulnerable snapshot remains pinned—is a release blocker. Upgrading to a
  patched compatible dependency graph requires deliberate policy review rather
  than inheriting this exception. Its policy tests passed 7/7 and the live gate
  passed on 2026-07-25 with the reviewed-workaround sentinel.
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

Run from the Blendlink repository:

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

`audit:production` is a fail-closed policy gate, not a zero-vulnerability
claim. For the current candidate it may accept only the reviewed
`GHSA-f88m-g3jw-g9cj` three-entry chain plus the tested official loader blocks;
zero findings fails while the reviewed vulnerable snapshot remains pinned
because advisory omission is not proof that the installed bytes changed.
Malformed output, registry failure, changed severity/range/path/content
identity, or any additional advisory fails. Its current integrated pass
succeeded live on 2026-07-25; npm still reports three high package entries and
zero critical findings.

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

- Node exact `22.12.0`, latest Node 22, and latest Node 24;
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
Blendlink commit:

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
npm publish ./artifacts/release/<version>/blendlink-<version>.tgz \
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
`BLENDLINK_NPM_TRUSTED_PUBLISHING=true`. Do not place `NODE_AUTH_TOKEN`,
`NPM_TOKEN`, or another write token in this steady-state job.

npm currently requires a package to exist before its trusted publisher can be
configured, while `blendlink` returned `E404` on 2026-07-25. Therefore the
first registry write is an explicit external blocker, not a hidden fallback.
If the package is still absent, make one separately reviewed, protected
bootstrap publication of a lower prerelease such as `0.8.0-bootstrap.0` under
a non-default `bootstrap` dist-tag, using that tag's exact retained tarball and
a short-lived granular token. Then configure trust, revoke the token, disallow
token publication after OIDC succeeds, and leave `0.8.0` available for the
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
`BLENDLINK_IMMUTABLE_RELEASES=true` there only after confirming the repository
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
