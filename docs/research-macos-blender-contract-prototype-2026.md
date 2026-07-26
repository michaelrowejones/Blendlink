# macOS Blender contract prototype, 2026

Date checked: 2026-07-25

## Decision

`BLD-CI-MAC-001` is a **Prototype / pending hosted run**, not macOS support
evidence. The repository now has a separate manual-only workflow,
[`macos-blender-prototype.yml`](../.github/workflows/macos-blender-prototype.yml),
that can exercise the existing add-on/archive contract with exact official
Blender 4.2.0 and 5.2.0 Apple Silicon builds.

The prototype deliberately uses `macos-15-xlarge`. GitHub's standard arm64
macOS runner has 7 GB RAM, below Blender's documented 8 GB minimum. GitHub
documents 14 GB RAM for the arm64 xlarge runner. The job also checks `arm64`
and at least 8 GiB at runtime before it downloads Blender.

The xlarge label is not assumed to be available. GitHub documents larger
runners as an organization/enterprise feature for GitHub Team or Enterprise
Cloud, and this repository has no retained account-entitlement evidence.
Until the job is dispatched successfully and its retained evidence is reviewed,
macOS remains intended but unverified.

## Official archive identity

The following Foundation URLs returned HTTP 200 on 2026-07-25. Their SHA-256
values come from the matching official checksum manifests, not from a mirror.

| Blender | Exact archive | Bytes observed by HTTP HEAD | Official SHA-256 |
| --- | --- | ---: | --- |
| 4.2.0 | [`blender-4.2.0-macos-arm64.dmg`](https://download.blender.org/release/Blender4.2/blender-4.2.0-macos-arm64.dmg) | 308,191,094 | `241dbfa6dac2c3b5e15bb1c132e0fcf16f7bf6e5bf3959440b6c8052b7b26d08` |
| 5.2.0 | [`blender-5.2.0-macos-arm64.dmg`](https://download.blender.org/release/Blender5.2/blender-5.2.0-macos-arm64.dmg) | 346,163,615 | `ed4d8390166dec5ea0a2813a03db6221f206ce016442be7f59f41d760972568a` |

Primary checksum sources:

- [Blender 4.2.0 SHA-256 manifest](https://download.blender.org/release/Blender4.2/blender-4.2.0.sha256)
- [Blender 5.2.0 SHA-256 manifest](https://download.blender.org/release/Blender5.2/blender-5.2.0.sha256)

The 5.2.0 manifest also exposed a pre-existing workflow defect: the Linux x64
digest was mistyped in the full gate, Linux matrix, and release-candidate
assembly. All three pins now use the Foundation-published value
`96f6c181a30f4950607839dc84d42a354b250d8a0231b098b59b7bc69c351c48`.

## Runner constraints

Blender's current [system requirements](https://www.blender.org/download/requirements/)
name Apple Silicon or Intel for macOS and require 8 GB RAM. GitHub's
[hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
documents these standard hosted shapes:

- `macos-15`: arm64 M1, 3 CPU, 7 GB RAM, 14 GB SSD;
- `macos-15-intel`: Intel, 4 CPU, 14 GB RAM, 14 GB SSD.

GitHub's [larger macOS runner table](https://docs.github.com/en/actions/how-tos/using-larger-runners/running-jobs-on-larger-runners?platform=mac)
documents `macos-15-xlarge` as arm64 M2, 5 CPU plus 8 GPU hardware-
acceleration cores, 14 GB RAM, and 14 GB SSD. The prototype does not infer GPU
rendering support from that hardware description; it runs only the existing
headless add-on/archive contract.

## Designs compared

| Design | Advantage | Disqualifier or cost | Decision |
| --- | --- | --- | --- |
| Standard `macos-15` arm64 | Native Apple Silicon and available as a standard hosted label | 7 GB RAM is below Blender's 8 GB minimum | Rejected as release-support evidence, even if a small test happened to pass |
| Standard `macos-15-intel` | 14 GB RAM meets the memory minimum | Blender 5.2.0's official checksum manifest publishes no macOS x64 archive, so it cannot test the intended 5.2 arm64 endpoint | Rejected for this matrix |
| `macos-15-xlarge` | Native arm64 and 14 GB RAM meet the documented minimum | Requires eligible larger-runner access and consumes a scarce/costed runner | Selected for a manual, max-parallel-one prototype |
| Self-hosted Apple Silicon Mac with at least 8 GB | Can meet Blender's requirements and avoids the standard-runner RAM gap | Hardware ownership, isolation, patching, and runner security become external operational responsibilities | Viable future adapter, not implemented |

The platform acquisition step is intentionally a small adapter at the existing
`BLENDLINK_BLENDER` seam. The deep package-owned
`npm run test:addon-headless` interface remains unchanged and owns extension
build, isolated installation, enablement, and contract tests.

## What the prototype proves if it passes

For each exact Blender version, the workflow:

1. records macOS version, model, architecture, memory, and available disk;
2. refuses non-arm64 or less than 8 GiB RAM;
3. downloads the official checksum manifest and requires it to contain the
   hard-coded archive digest;
4. downloads and independently hashes the exact DMG;
5. mounts it read-only, verifies the application code signature, and checks the
   exact Blender version;
6. runs `npm ci`, `npm run test:addon-headless`, and `git diff --check`;
7. retains the runner, checksum, signature, version, and test logs for 14 days.

It does **not** prove the full KTX toolchain, GPU baking/rendering, interactive
Blender UI, browser behavior, Intel macOS, branded end-user hardware, or long-
running production-scene memory behavior. It is not connected to the release
candidate's `needs` graph and has no publication permission.

## Remaining blocker and promotion rule

The immediate blocker is access to an eligible `macos-15-xlarge` runner (or
an equivalently controlled native arm64 runner with at least 8 GB RAM).
Workflow syntax and checksum identity can be checked locally, but a definition
must not be called hosted evidence.

Promote macOS from intended/unverified only after both 4.2.0 and 5.2.0 jobs pass
on the same committed revision, their retained logs show the required runner
resources and exact archive identities, and any failure is reproduced or
resolved without relaxing the resource/checksum guards.
