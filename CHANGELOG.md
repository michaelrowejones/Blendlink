# Changelog

All notable user-facing changes to Blendlink will be recorded here.

This project follows [Semantic Versioning](https://semver.org/) and keeps an
Unreleased section using the categories from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Blendlink is still
pre-1.0; breaking changes must still be called out with a migration note.

## [Unreleased]

### Added

- Initial public-release candidate for the `blendlink` npm package and Blender
  Extension. Neither artifact has been published from this repository yet.
- Artist-owned `preview`, `connect`, and `publish` workflow with website-owned
  routes, Canvas, loading presentation, framework, analytics, and deployment.
- Vanilla Three.js and React Three Fiber installation interfaces, generated
  bindings, asset verification, and opt-in application-owned browser smoke.
- Compile/typegen and loaded-parser capability gates for the exact Three r184
  profile. Unknown required extensions and unsupported
  `KHR_animation_pointer` targets fail before scene commit instead of silently
  losing authored behavior.
- A pinned 20-asset Khronos browser corpus now imports the exact production
  compatibility module before raw Three loading, so required-extension and
  animation-pointer refusal cannot drift behind an experiment-only allowlist.
- Blender add-on actions for connecting, previewing, and publishing websites.
- Local aggregate verification for unit tests, packed consumers, real Blender
  and KTX tools, extension archive installation, and baked appearance evidence.
- Retained dual-artifact release assembly with npm integrity, SHA-256 sums,
  source revision/dirty-state evidence, exact consumer compilation, exact
  Blender ZIP validation/install, and cross-artifact add-on fingerprints.
- Complete compiler-owned runtime graphs sealed beneath
  `<scene>/<full-sha256>/`, with exact immutable-policy derivation that excludes
  stable paths and application-owned external assets.
- A mixed-license npm artifact map (`SEE LICENSE IN LICENSES.md`) covering the
  MIT Node/compiler/runtime files, GPL-3.0-or-later Blender-dependent files, and
  Apache-2.0 Basis notices, with complete license texts verified during release
  assembly.
- Loud package-owned KTX2 failure when response-header CSP blocks Three's Blob
  transcoder worker, replacing an otherwise permanently pending load.
- Complete GPL version 3 license text in the separately licensed Blender
  Extension artifact, verified by release assembly.

### Fixed

- Importing the renderer-neutral `blendlink` root no longer eagerly loads the
  optional React peer. React lifecycle helpers remain available from the
  explicit `blendlink/react` subpath, and packed/workspace consumer gates now
  refuse accidental React or R3F resolution through the root.
- Installed local-package identity now ignores only ordinary Python bytecode
  debris (`__pycache__`, `.pyc`, and `.pyo`) that may be created by executing
  shipped Blender scripts; every other added file still changes identity.
- Generated manifests and TypeScript comments no longer expose absolute source
  or linked-dependency paths outside the connected project. Public artifacts
  use basename-free opaque keys; exact local paths live only in a per-user OS
  cache, and missing or corrupt cache state fails stale with a resync remedy.
- Static custom-property drivers feeding Geometry Nodes no longer masquerade
  as timeline animation and trigger an exhaustive long-frame cache audit;
  frame/time/context/action/NLA and dependency-driven geometry remain guarded.
- npm packaging removes Python bytecode and `__pycache__` created after the
  build before the tarball is assembled.
- The executable Three.js peer contract is narrowed to exact `0.184.0` so
  runtime capability claims match the source-audited implementation.
  New `connect` starters use that exact runtime and reject ranges escaping
  r184; declaration-only `@types/three` patches remain allowed within r184.
- Material Fidelity now follows Blender 5.2.39's evaluated export scope:
  unused attached slots no longer create false failures, Geometry Nodes
  material assignments and stock `[None]` fallback align with emitted
  primitives, skin armatures are suppressed/restored like the stock exporter,
  and conflicting `export_apply` / `export_skins` overrides refuse loudly.

### Security

- Added public reporting and supported-version guidance in `SECURITY.md`.
- Blocked Sharp's GIF, TIFF, and VIPS loaders at package-owned entry points,
  following the official workaround for `GHSA-f88m-g3jw-g9cj`. npm still
  reports the reviewed three-entry high-severity dependency chain; the
  fail-closed policy gate now rejects any changed/new result and passed against
  the live reviewed graph. A compatible patched dependency upgrade remains
  follow-up.

[Unreleased]: https://github.com/michaelrowejones/Blendlink/commits/main
