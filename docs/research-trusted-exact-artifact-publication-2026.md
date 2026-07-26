# Trusted exact-artifact publication, 2026

Date: 2026-07-25

Status: **Implemented and statically verified locally; external configuration
and a real tagged publication remain pending.**

## Scope and conclusion

This note answers one narrow release question: how Blendlink can publish the
already-built, already-tested `blendlink-<version>.tgz` to npm, prove that the
registry serves those exact bytes with provenance, and attach that same tarball
plus the retained Blender Extension ZIP to an immutable GitHub release.

The recommended steady-state design is:

1. the existing `release-candidate` job builds and validates the four retained
   files once;
2. it uploads that directory as one immutable workflow artifact and exports the
   artifact's numeric ID;
3. a protected, GitHub-hosted npm job downloads that exact artifact by ID,
   reruns [`scripts/verify-retained-release.mjs`](../scripts/verify-retained-release.mjs),
   and publishes the explicit `./blendlink-<version>.tgz` path through npm
   trusted publishing;
4. the job polls the public registry, downloads the published version, and
   proves byte equality, registry integrity, repository identity, and npm
   provenance;
5. a separate least-privilege GitHub job creates a draft release from the
   already-existing tag, uploads the same four retained files, verifies their
   server-reported digests, and publishes the immutable prerelease.

No job after candidate assembly may run `npm pack`, rebuild the package, or
publish a workspace/directory. The tarball is the release unit.

There is one unavoidable bootstrap exception: npm's documented trust command
requires the package to **already exist** on the registry. The current release
record reports `blendlink` as absent (`E404`), so the first publication cannot
be an OIDC-only trusted publish. The safest bootstrap path is a one-time,
environment-protected GitHub Actions publish of a lower retained prerelease
such as `0.8.0-bootstrap.0` under the non-default `bootstrap` dist-tag, using a
short-lived granular npm token that can publish noninteractively, with GitHub
OIDC enabled and `--provenance --access public`. This leaves `0.8.0` available
for the first trusted publication. Immediately after the package exists,
configure the trusted publisher, prove one OIDC release, select
"Require two-factor authentication and disallow tokens," and revoke the
bootstrap token. This exception must be visible in the workflow and release
record; it must not silently become the permanent path.

## Evidence labels

- **Implemented:** code already present in this repository.
- **Official behavior:** stated in current npm or GitHub documentation, or
  inspected in a versioned upstream source file.
- **Recommended:** selected architecture, not yet a repository guarantee.
- **External:** requires npm/GitHub settings, credentials, a public tag, or a
  registry/release mutation.

## What already exists

Blendlink already has most of the byte-level verifier needed by the release
jobs:

- `npm run release:artifacts` writes exactly four files beneath
  `artifacts/release/<version>/`: the npm tarball, Blender ZIP,
  `release-manifest.json`, and `SHA256SUMS`.
- The manifest records the clean source commit, version, byte sizes, SHA-256,
  npm SHA-512 SRI, license contracts, and matching add-on tree fingerprints.
- [`scripts/verify-retained-release.mjs`](../scripts/verify-retained-release.mjs)
  already has `retained`, `registry`, and `github` verification modes. It
  compares downloaded registry bytes with the retained tarball and validates
  GitHub release asset size/digest/state.
- [`.github/workflows/blender-contract.yml`](../.github/workflows/blender-contract.yml)
  already gates candidate assembly on the portable, full, Linux, and Windows
  contracts, verifies tag/version/commit identity, and uploads one candidate
  directory with `if-no-files-found: error`.

These byte contracts and the same-workflow candidate, npm, and GitHub release
jobs are **Implemented** and locally policy-tested. Hosted publication,
protected settings, public attestations/provenance, immutable release state,
and registry equality remain **External/Pending** until an actual tagged run
proves them.

## Primary-source findings

### npm trusted publishing

npm trusted publishing exchanges a CI OIDC identity for a short-lived publish
credential. Current npm documentation requires npm CLI 11.5.1 or newer, Node
22.14.0 or newer, a GitHub-hosted runner, and `id-token: write`. Self-hosted
runners are not supported. The npm package setting binds the publisher to an
exact owner, repository, workflow filename, optional environment name, and one
or both allowed actions (`npm publish` and `npm stage publish`). Only one
trusted publisher can be configured per package. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

For Blendlink, configure the final publication workflow's **filename only**
(including `.yml` or `.yaml`) and the exact protected environment name. Keep
the actual publish job in that top-level workflow instead of hiding it behind a
reusable publisher: npm documents that reusable workflows are validated against
the calling workflow name, and both caller and callee need OIDC permission.

The publisher should use a current Node 24 and explicitly update npm to a
reviewed version at or above the trusted-publishing minimum. This does not
change Blendlink's Node consumer floor. Give the job only:

```yaml
permissions:
  actions: read
  attestations: read
  contents: read
  id-token: write
```

`id-token: write` only permits requesting an OIDC token; it does not itself
grant repository writes. Use a GitHub environment with required reviewers,
prevent self-review where available, and restrict deployments to protected
`v*` tags. [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc),
[deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

Trusted publishing authenticates only `npm publish` and `npm stage publish`.
Commands such as `npm view`, `npm whoami`, and stage administration do not use
that OIDC authorization. Public registry reads need no publish credential, so
post-publish verification must not interpret `npm whoami` as an OIDC test.
[npm trusted publishing limitations](https://docs.npmjs.com/trusted-publishers/#limitations-and-future-improvements)

For a public package in a public repository, trusted publishing automatically
generates npm provenance. The flag is not required, but the selected Blendlink
command should still include `--provenance`: it makes accidental
`provenance=false` configuration fail loudly and documents the release
contract. npm's provenance prerequisites also require the case-sensitive
`repository` URL to match the publishing repository. Blendlink currently
declares `git+https://github.com/michaelrowejones/Blendlink.git`; confirm that the
public repository owner and casing match before publication.
[npm trusted-publisher provenance](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation),
[npm provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/#prerequisites)

After OIDC succeeds, npm recommends selecting "Require two-factor
authentication and disallow tokens" and revoking obsolete automation tokens.
The maximum-security alternative is a trusted publisher allowed to run only
`npm stage publish`, followed by human 2FA approval. That is a credible future
hardening step, but direct trusted publishing plus a protected GitHub
environment is the smaller first public-beta transaction.
[npm publishing-access recommendation](https://docs.npmjs.com/trusted-publishers/#recommended-restrict-token-access-when-using-trusted-publishers)

### The first-release bootstrap constraint

The current `npm trust` documentation (npm 11.18.0) requires npm 11.15.0 or
newer, package write access, account-level 2FA, a supported maintainer
authentication method, and an existing registry package. In particular, it
states that the package being configured "must already exist on the npm
registry." [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)

That produces two distinct paths:

| Path | Authentication | Provenance | Lifetime |
| --- | --- | --- | --- |
| Lower bootstrap prerelease only, for example `0.8.0-bootstrap.0` under `bootstrap` | Protected GitHub environment plus a narrowly scoped granular token capable of the initial publish | Explicit GitHub OIDC plus `--provenance --access public` | One run; revoke immediately and preserve `0.8.0` for OIDC |
| Every later publication | npm trusted publisher OIDC; no write token | Automatic, with explicit `--provenance` as a fail-closed assertion | Permanent steady state |

The bootstrap job must publish the retained tarball, never the working tree.
Do not expose the token to candidate build/test jobs. Do not configure a
repository-wide token when an environment-scoped secret suffices. If the first
publish happens manually from a workstation instead, the exact-tarball contract
can still hold, but npm's cloud-CI provenance requirement will not; that would
be a knowingly weaker public first release.

### Publishing a tarball preserves the selected bytes

`npm publish` accepts a gzipped tarball package specification, and npm asks
that relative tarball paths begin with `./`. A published name/version can never
be reused, even after unpublish. The registry records SHA-1 and SHA-512
integrity for the tarball. [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

The reviewed npm CLI 11.18.0 source is stronger evidence for exact-byte
handoff:

- [`lib/commands/publish.js`](https://github.com/npm/cli/blob/v11.18.0/lib/commands/publish.js)
  runs lifecycle scripts only for directory specs, then hands the package spec
  to `libnpmpack`;
- [`libnpmpack/lib/index.js`](https://github.com/npm/cli/blob/v11.18.0/workspaces/libnpmpack/lib/index.js)
  obtains the tarball buffer through `pacote.tarball` and does not run `prepack`
  or `postpack` for a tarball spec; and
- [`libnpmpublish/lib/publish.js`](https://github.com/npm/cli/blob/v11.18.0/workspaces/libnpmpublish/lib/publish.js)
  computes the registry SHA-1/SHA-512 from that buffer, uploads that buffer as
  the package attachment, and uses the same SHA-512 as the provenance subject
  digest.

Therefore the selected command is:

```sh
npm publish ./blendlink-0.8.0.tgz \
  --registry=https://registry.npmjs.org/ \
  --access=public \
  --provenance \
  --tag=latest
```

Derive the path and version from the verified manifest; do not hard-code
`0.8.0` in the eventual workflow. If a future version contains a SemVer
prerelease suffix, publish with an explicit non-`latest` tag such as `beta`;
npm 11 refuses a prerelease version without an explicit dist-tag.

### Workflow-artifact transfer

GitHub's current upload action makes artifacts immutable from v4 onward, but
`overwrite: true` deletes the old artifact and creates a new ID. Its outputs
include a numeric `artifact-id` and an `artifact-digest`. Its default behavior
when no files match is only a warning. [upload-artifact inputs and outputs](https://github.com/actions/upload-artifact#usage),
[artifact immutability](https://github.com/actions/upload-artifact#not-uploading-to-the-same-artifact)

The current download action can select `artifact-ids` rather than a name and
defaults digest mismatch handling to `error`. Use the ID exported directly by
the candidate job, never `overwrite: true`, and keep `digest-mismatch: error`
explicit. [download-artifact inputs](https://github.com/actions/download-artifact#usage),
[download by artifact ID](https://github.com/actions/download-artifact#download-artifacts-by-id)

The action digest is the workflow-artifact container digest when a directory
is archived; it does not replace the four-file release manifest. After every
download, run the repository verifier, which checks the inner `.tgz` and `.zip`
bytes. GitHub Actions artifacts also expire, whereas GitHub release assets are
the durable public distribution surface.

When the workflow is implemented, use reviewed current major versions and pin
every action to its full commit SHA. GitHub identifies a full-length commit SHA
as the only immutable action reference. Record the human-readable tag in a
same-line comment and re-resolve it during dependency maintenance.
[GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)

The official release identities observed on 2026-07-25 were:

| Action | Official release | Full commit SHA |
| --- | --- | --- |
| `actions/upload-artifact` | [`v7.0.1`](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `actions/download-artifact` | [`v8.0.1`](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
| `actions/attest` | [`v4.2.0`](https://github.com/actions/attest/releases/tag/v4.2.0) | `f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6` |

Recheck these official tag-to-commit mappings at implementation time rather
than treating a dated research note as an update mechanism. Blendlink's
existing workflow currently pins upload-artifact v6; upgrading should be a
reviewed workflow dependency change, not an unrecorded substitution.

### GitHub build attestations and npm provenance are complementary

The candidate producer can attest the retained `.tgz`, `.zip`,
`release-manifest.json`, and `SHA256SUMS` immediately after assembly. GitHub's
official action requires `contents: read`, `id-token: write`, and
`attestations: write`; binary attestations use `subject-path`. Consumers and
later jobs can verify them with `gh attestation verify <path> -R
michaelrowejones/Blendlink`. [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

These statements prove different boundaries:

- the GitHub build attestation identifies the exact candidate files produced
  by the candidate workflow;
- npm provenance identifies the source/build workflow and the SHA-512 of the
  exact tarball submitted to npm; and
- registry byte comparison proves that a fresh public download equals the
  retained candidate.

Do not call any one of those the other. Do not grant `packages: write` for
ordinary files; GitHub documents that permission for container-registry
attestation flows, not binary `subject-path` attestations.

### Immutable GitHub release

Enable immutable releases in repository settings **before** the first public
release; the protection applies only after publication. GitHub locks the
release tag and assets and automatically generates a release attestation.
GitHub recommends creating a draft, attaching all assets, then publishing the
draft. [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)

Create the release only from the existing protected tag. `gh release create
--verify-tag` aborts if the tag is absent instead of creating it from the
default branch. Mark `0.8.0` as a prerelease because the existing repository
contract requires the public beta to remain a GitHub prerelease.
[gh release create](https://cli.github.com/manual/gh_release_create)

The release job needs `contents: write` but does not need npm OIDC or an npm
credential. Keep it separate from the npm publisher so neither privileged job
has both mutation capabilities. Never use `gh release upload --clobber`; the
CLI warns that clobbering deletes the old asset before replacement, and an
upload failure can lose the original. Prefer one draft creation with all four
files, server-side digest verification, and one publish transition.
[gh release upload](https://cli.github.com/manual/gh_release_upload)

## Selected job architecture

Two alternatives were considered.

### Alternative A: rebuild and publish from the tagged workspace

This is the shortest conventional npm workflow: check out the tag, install,
build, test, and run `npm publish` in `packages/blendlink`. It is rejected. It
creates a second pack transaction after the retained artifact was reviewed and
allows lifecycle/configuration drift between tested and published bytes.

### Alternative B: promote one retained candidate through isolated jobs

This is selected. Candidate assembly is the only build. Downstream jobs receive
the immutable artifact ID, revalidate all inner bytes, and mutate only their
own destination: npm or GitHub Releases. It provides smaller permission sets,
clear retry semantics, and a direct equality proof from candidate to registry
and release.

### Alternative C: npm staged publishing

Stage-only OIDC plus human 2FA approval is stronger against accidental direct
publication and is npm's maximum-security recommendation. It adds a second npm
state machine and approval transaction, and still cannot solve the package's
first-publication bootstrap. Adopt it after the direct OIDC path has one
successful public-beta run and the team is ready to operationalize stage
expiry, inspection, approval, and rejection.

Recommended dependency and permission shape:

```text
node/full/platform gates
        |
        v
release-candidate (build once, verify, attest, upload; artifact ID output)
        |
        v
publish-npm (protected environment; contents:read + id-token:write)
        |
        +--> poll registry -> download -> byte/provenance/install verification
        |
        v
publish-github-release (contents:write only; exact four assets; immutable prerelease)
```

The GitHub release should depend on successful registry verification so the
public release is not presented as complete when npm publication failed. A
failed GitHub release after successful npm publication is recoverable by
creating the draft from the retained workflow artifact; the npm version must
never be republished.

## Fail-closed publication sequence

### Candidate producer

1. Require a protected `v<version>` tag and exact `GITHUB_SHA` checkout.
2. Require every release-contract dependency to pass.
3. Run `npm run release:artifacts` exactly once.
4. Run the retained verifier with version, commit, and
   `michaelrowejones/Blendlink`.
5. Generate GitHub artifact attestations for all four files.
6. Upload the directory with a unique commit/tag-derived name,
   `if-no-files-found: error`, no overwrite, and an explicit retention period.
7. Export both artifact ID and upload digest as job outputs.

### npm publisher

1. Run only on a GitHub-hosted runner and protected npm environment.
2. Download the producer's exact numeric artifact ID with digest mismatch set
   to `error`.
3. Verify GitHub attestations and run `verify-retained-release.mjs retained`.
4. Assert the tag, manifest version, clean commit, package repository URL,
   archive names, checksums, and SRI again.
5. Assert no `provenance=false` source, environment, or npm configuration is
   effective.
6. Before publishing, query `blendlink@<version>` anonymously:
   - absent: continue;
   - present and byte-identical: treat an earlier ambiguous attempt as already
     published and continue to full registry verification;
   - present but different: stop permanently and investigate.
7. Publish the explicit `./blendlink-<version>.tgz` with public access,
   provenance, the public registry, and an explicit dist-tag.
8. Do not blindly retry a failed network response. Poll the registry first,
   because npm versions are immutable.

### Registry verifier

Registry propagation can lag a successful write, so poll with a bounded timeout
and clear diagnostics. Once visible:

1. save the exact public version metadata returned by the npm registry;
2. download the canonical registry tarball URL recorded by that metadata;
3. run `verify-retained-release.mjs registry`, which compares the downloaded
   bytes, SHA-256, SHA-1, npm SRI, repository, identity, and SLSA provenance
   metadata against the retained candidate;
4. transfer the candidate's already-passed packed Vanilla and R3F consumer
   evidence through that byte-for-byte equality proof rather than recompiling
   identical bytes under a second toolchain;
5. lock the exact public version in an empty package and require its resolved
   URL and integrity to match the verified registry metadata; and
6. run `npm audit signatures` with a current npm CLI to verify npm registry
   signatures and provenance attestations. [npm provenance verification](https://docs.npmjs.com/generating-provenance-statements/#verifying-provenance-attestations)

The success sentinel should include version, retained SHA-256, registry SRI,
source commit, and provenance URL. Keep registry metadata and command logs as
release evidence.

### GitHub release publisher

1. Download the same candidate artifact by numeric ID.
2. Verify candidate attestations and the retained directory contract again.
3. Confirm the remote tag exists and resolves to the manifest commit.
4. Create a draft prerelease with `--verify-tag` and attach exactly:
   - `blendlink-<version>.tgz`;
   - `blendlink-addon-<version>.zip`;
   - `release-manifest.json`; and
   - `SHA256SUMS`.
5. Fetch release metadata and run `verify-retained-release.mjs github` in
   `draft` mode before publication.
6. Publish the draft once.
7. Require the result to be non-draft and immutable, refetch metadata, run the
   verifier in `published` mode, and use GitHub's release/asset integrity
   verification commands where available.
   [Verifying release integrity](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)

## Retry and recovery policy

| Failure | Safe response |
| --- | --- |
| Candidate build/upload fails | Fix or rerun before any external publish. The unique artifact ID changes only on a new producer run. |
| npm command returns ambiguous network failure | Query the exact version, download it if present, and compare bytes. Never issue a blind second publish. |
| Registry version exists with different bytes | Stop. The version is consumed and cannot be repaired in place; investigate and release a new version if necessary. |
| Registry publish succeeds but verification fails | Keep GitHub release draft/unpublished, preserve evidence, and determine whether the failure is propagation, verification, or a genuine mismatch. Never unpublish as a routine retry mechanism. |
| GitHub draft upload fails | Delete the incomplete draft only after its exact ID/state is confirmed, then recreate from the same retained artifact. Do not clobber individual assets. |
| GitHub release publication succeeds but post-check fails | Immutable assets cannot be changed. Preserve evidence and publish a corrective version rather than mutating the release. |

## External setup checklist

Before the first tagged publication:

- Confirm the public repository is exactly `michaelrowejones/Blendlink` and the
  case-sensitive packed `repository.url` matches.
- Protect release tags and configure a required-reviewer GitHub environment.
- Enable repository immutable releases before creating the first public
  release.
- Create only the one-time bootstrap npm token, store it in the protected
  environment, use it only for a lower prerelease under the `bootstrap`
  dist-tag, and plan its immediate revocation.
- Review the Linux Foundation immutable-record notice linked by npm before
  emitting public Sigstore provenance.
- After first publication, configure the exact trusted-publisher workflow
  filename, repository, owner, environment, and allowed `npm publish` action.
- After one OIDC success, disallow token publication and revoke the bootstrap
  credential.
- Verify Actions used in the new workflow against their official repositories,
  pin full commit SHAs, and retain same-line release-tag comments.

## Evidence required before calling this shipped

The workflow definition alone is not verification. Record a real tagged run
with all of the following:

- candidate artifact ID/digest and successful inner checksum verification;
- GitHub build-attestation URLs for all retained files;
- npm authentication path (`bootstrap-token` once or `trusted-oidc` later);
- public registry metadata plus downloaded-tarball byte equality;
- npm provenance and successful `npm audit signatures` evidence;
- packed Vanilla and R3F retained-candidate builds plus exact registry byte
  equality;
- GitHub release ID, exact four asset digests, tag/commit identity, prerelease
  state, and immutable state; and
- revoked bootstrap token plus token-disallowed npm package settings after the
  OIDC migration.

Until then, hosted/public claims are **External/Pending**, while the retained
artifact builder, verifier, and least-privilege workflow are **Implemented and
locally policy-verified** as recorded in
[`research-release-hardening-2026.md`](research-release-hardening-2026.md).

## Source ledger

Primary sources reviewed on 2026-07-25:

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm trust 11.18.0](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [npm publish 11.18.0](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm pack 11.18.0](https://docs.npmjs.com/cli/v11/commands/npm-pack/)
- [npm CLI publish command, tag `v11.18.0`](https://github.com/npm/cli/blob/v11.18.0/lib/commands/publish.js)
- [npm `libnpmpack`, tag `v11.18.0`](https://github.com/npm/cli/blob/v11.18.0/workspaces/libnpmpack/lib/index.js)
- [npm `libnpmpublish`, tag `v11.18.0`](https://github.com/npm/cli/blob/v11.18.0/workspaces/libnpmpublish/lib/publish.js)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub upload-artifact](https://github.com/actions/upload-artifact)
- [GitHub download-artifact](https://github.com/actions/download-artifact)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create)
- [GitHub release integrity verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)

Needle Engine has no relevant analogue in this scope: this is Blendlink's npm
and GitHub supply-chain boundary, not a Blender-to-runtime behavior. No Needle
parity claim is made.
