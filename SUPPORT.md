# Support policy

SceneToWeb is pre-1.0 and has not yet been published to npm or approved on
extensions.blender.org. This file distinguishes the intended compatibility
contract from environments that have actually been exercised.

## Compatibility contract

| Surface | Supported contract | Evidence today |
| --- | --- | --- |
| Node.js | `22.15.0` or newer Node 22; Node 24 | Declared by the npm package. The CI matrix covers exact 22.15, latest 22, and latest 24; 22.15 is the first Node 22 release with the Zstandard API required to inspect compressed `.blend` headers. |
| Blender | 4.2.0 and newer | The extension manifest is the compatibility floor. Windows Blender 5.2 evidence is retained. macOS Blender 5.2 passes the full contract with a CPU override, and Blender 5.3 has a verified first-preview/standalone flow; the complete material compatibility suite intentionally requires Blender 5.2 / exporter 5.2.39. |
| Operating systems | Windows, Linux, and macOS are intended | Hosted Linux/Windows x64 checks pass extension installation, private tools, website export and offline tool reuse on Blender 4.2.0/5.2.0. The full pinned 5.2/KTX suite passes on hosted Linux. macOS arm64 has local CPU-only 5.2 and preview/export 5.3 evidence; hosted macOS remains pending. |
| Three.js / `@types/three` | runtime exact `three@0.184.0`; declarations `>=0.184.0 <0.185.0` | Declared optional peer contract. SceneToWeb's compiled and loaded capability profiles were audited against the exact r184 runtime source. Declaration-only r184 patch releases do not change loader behavior; the dogfood site exercises `@types/three@0.184.1`. Other runtime releases are unsupported until separately profiled. |
| React | `>=19.0.0 <20.0.0` | Declared optional peer range for React adapters. |
| React Three Fiber | `>=9.0.0 <10.0.0` | Declared optional peer range; packed R3F consumer is locally compiled. |
| Browsers | Modern Chromium, Firefox, and WebKit are intended | The standalone fixture renders in Playwright Chromium, Firefox, and WebKit on macOS and hosted Linux, including a deployment subfolder. Linux uses a software renderer with Xvfb. Branded Safari/Firefox, real mobile hardware, and wider scene coverage still need verification. |

Playwright mobile profiles emulate viewport, user agent, device scale, and touch
behavior; they are not real iOS or Android support evidence. A local production
server is not evidence for a deployed CDN, base path, CORS, CSP, service worker,
or cache policy.

On the 2026-11-11 macOS test host, Playwright WebKit mouse events arrived at
incorrect coordinates even on plain HTML; native touch events targeted controls
correctly. `BLENDLINK_TEST_WEBKIT_TOUCH=1` explicitly selects touch activation for
local acceptance checks and records that mode in their report. Hosted Linux uses
normal pointer activation. This is browser-engine evidence, not real iOS hardware.

## Desktop preview tools

Artist-facing Preview and Export actions prepare a private Node 24.22.3 runtime
for macOS, Windows, or Linux on x64/arm64. Six official archive SHA-256 values
are pinned in the extension. Fresh setup and cached execution have been exercised
on macOS arm64 with system Node/npm absent from PATH. Hosted Windows/Linux x64
checks also pass the installed ZIP's fresh download, extraction, website export
and offline reuse on Blender 4.2.0 and 5.2.0. Linux/Windows arm64 remain untested.

For a CPU-only headless Blender contract run, set
`BLENDLINK_TEST_CYCLES_DEVICE=CPU`. This is explicitly CPU evidence and does not
certify a GPU backend. The full material fixtures require the pinned Blender
5.2.0 / glTF exporter 5.2.39; a newer Blender is not an interchangeable full-suite
runner even when its normal preview workflow succeeds.

## What support means

Once publishing begins, the latest SceneToWeb minor release is the supported
pre-1.0 line. Compatible bug fixes are released as patches. Older pre-1.0
minors may receive critical security fixes at the maintainer's discretion but
are not promised general maintenance.

Removing a Node or Blender line, narrowing a peer range, changing a manifest
schema, or breaking a documented CLI/config/generated-binding interface must be
announced in `CHANGELOG.md` and `docs/MIGRATIONS.md` before release.

## Getting help

- Use GitHub Issues for reproducible bugs and compatibility questions.
- Include exact versions, operating system, framework/build tool, relevant
  configuration, the failing command, and the complete artist-readable error.
- Use `SECURITY.md` rather than a public issue for vulnerabilities.

Website layout, routes, Canvas ownership, deployment configuration, CDN policy,
analytics, and loading UI remain application-owned. SceneToWeb can diagnose its
compiler/runtime integration but does not provide hosting or general framework
support.
