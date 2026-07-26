# Support policy

Blendlink is pre-1.0 and has not yet been published to npm or approved on
extensions.blender.org. This file distinguishes the intended compatibility
contract from environments that have actually been exercised.

## Compatibility contract

| Surface | Supported contract | Evidence today |
| --- | --- | --- |
| Node.js | `22.12.0` or newer Node 22; Node 24 | Declared by the npm package. The new CI matrix covers exact 22.12, latest 22, and latest 24 once GitHub Actions runs. |
| Blender | 4.2.0 and newer | The extension manifest is the compatibility floor. Local verification currently covers the discoverable Windows Blender 5.2 installation, not every version or OS. |
| Operating systems | Windows, Linux, and macOS are intended | Windows is locally exercised. Hosted Linux and macOS Blender evidence is not yet available. |
| Three.js / `@types/three` | runtime exact `three@0.184.0`; declarations `>=0.184.0 <0.185.0` | Declared optional peer contract. Blendlink's compiled and loaded capability profiles were audited against the exact r184 runtime source. Declaration-only r184 patch releases do not change loader behavior; the dogfood site exercises `@types/three@0.184.1`. Other runtime releases are unsupported until separately profiled. |
| React | `>=19.0.0 <20.0.0` | Declared optional peer range for React adapters. |
| React Three Fiber | `>=9.0.0 <10.0.0` | Declared optional peer range; packed R3F consumer is locally compiled. |
| Browsers | Modern Chromium, Firefox, and WebKit are intended | Production Chromium is locally exercised. Firefox, WebKit, branded Safari/Firefox, and real mobile devices are not yet verified. |

Playwright mobile profiles emulate viewport, user agent, device scale, and touch
behavior; they are not real iOS or Android support evidence. A local production
server is not evidence for a deployed CDN, base path, CORS, CSP, service worker,
or cache policy.

## What support means

Once publishing begins, the latest Blendlink minor release is the supported
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
analytics, and loading UI remain application-owned. Blendlink can diagnose its
compiler/runtime integration but does not provide hosting or general framework
support.
