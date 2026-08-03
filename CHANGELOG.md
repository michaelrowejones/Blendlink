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
- WebGPU renderer support: the scene installer accepts an initialized
  `WebGPURenderer` (runtime family typing), R3F context-loss handling covers
  the WebGPU family, KTX2 transcoding, PMREM, and RectArea behavior are
  family-aware, and all post-processing effect types run on a
  RenderPipeline-backed WebGPU service behind the existing interface. New
  `connect` starters and the committed examples construct `WebGPURenderer`.
- A node-to-TSL material compiler translates Blender shader node trees into
  TSL IR under a differential harness measured against Cycles: Math/Vector
  Math/Mix enums, RGB Curves, Checker/Gradient/Magic/Wave, color utilities,
  White Noise (byte-exact), Noise/Voronoi within measured frequency and
  detail bounds, Image Texture, Mix Shader surface expressions per channel,
  coordinate spaces, node groups, muted nodes, Object Info Random, and
  Shader to RGB. Nodes and parameter ranges outside the measured bounds
  refuse by name; bounded deviations ship as approximations declared in the
  manifest instead of silent drift.
- TSL program transport: compiled materials can ship their per-channel TSL
  IR in a hash-verified material-programs sidecar published beside the GLB;
  the runtime fetches, verifies, and applies the programs by mesh identity,
  and over-budget images ride as exact hash-pinned texture references the
  runtime prefetches and byte-verifies. On the WebGPU family the installer
  applies shipped programs automatically.
- Standalone `tslProgram` route: a material can ship its TSL IR program
  without bake plans, compiled and attested. New `bakeOutput: "material"`
  bakes lit PBR surface pages; unique-route bakes pack onto attested shared
  atlas pages arranged as bounded power-of-two bins so page VRAM tracks
  member VRAM. Lighting and compiled-material intents compose: a
  Lighting-owned object with an explicit Material Bake or TSL Program mark
  stays in compile scope, while marking an atlas-owned object as a compiled
  carrier refuses by name at mark time instead of being silently ignored.
- Per-channel Material bake route with Fidelity-card controls: per-channel
  routes classified by coordinate space, deforming receivers supported
  through a measured modifier allowlist, multi-slot objects baked with
  slot-scoped split receivers, surface-resolvable Mix Shader materials
  planned through surface-resolved routing, and per-object attributes baked
  through a dedicated `attribute_object` op wired into the runtime.
- Character deformation contract: a mesh whose modifier stack freezes a
  deformer the pipeline cannot ship refuses loudly, refusals and
  silently-dropped shape-key/skinning approximations are carried into the
  manifest, and a frozen SurfaceDeform lowers onto glTF skin weights.
- A budgeted evaluated-geometry realization route: evaluated
  (modifier/Geometry Nodes) geometry can be realized into the published
  scene under an explicit size budget instead of refusing outright.
- Opt-in orbit/zoom viewer navigation and a performance HUD for installed
  scenes.
- Committed Vanilla Three and R3F example consumers exercised by a CI gate,
  and in-repo showcase scenes (cube-diorama, ellie) compiled end to end
  through the full pipeline as living acceptance evidence.

### Changed

- Published scenes prune UV layers the output never samples and merge
  byte-identical emissive maps into one shared image; when no emissive
  image ships, the emissive factor is attested instead.
- Compiler-side material consolidation (stage 1) merges compatible
  materials in the published scene, reducing material count and draw calls
  without changing appearance.

### Fixed

- The declared Node 22 floor is now 22.15, the first Node 22 release whose
  built-in `node:zlib` can inspect Blender's Zstandard-compressed files. This
  replaces the untruthful 22.12 declaration that allowed installation but
  failed while evaluating the packed renderer-neutral package root.

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
- Skins export deform bones only; a full non-deform armature hierarchy
  previously produced joint counts (measured: 1867) that could never render
  under Three's joint-uniform ceiling.
- Bake gutters are measured between packer islands (not topological ones)
  and the receiver pack proves its gutter contract in final atlas space,
  retrying up a bounded resolution ladder when a recipe size cannot honor
  it — the recipe size is a quality floor, not a correctness cap. The bake
  atlas seeds from the measurably best UV layer instead of the first, and
  UV repair reprojects only the degenerate or folded islands, keeping
  healthy authored islands bit-for-bit.
- Publication rewrites program-sidecar image basenames to their published
  names (older sidecars pinned staging basenames the runtime could never
  resolve), texture-referencing program images are declared to the staging
  integrity check, and partial-ORM material variants keep private textures
  instead of tripping byte attestation via the glTF exporter's re-encoded
  metallicRoughness image.
- Closed measured TSL emitter gaps found by the widened corpus sampler, a
  WGSL u32 const-folding overflow that prevented 1D-noise shaders from
  compiling, and a TSL var-in-branch hazard; baked textures targeting a
  TEXCOORD slot Three cannot bind refuse instead of publishing an unusable
  binding.

### Security

- Added public reporting and supported-version guidance in `SECURITY.md`.
- Blocked Sharp's GIF, TIFF, and VIPS loaders at package-owned entry points,
  following the official workaround for `GHSA-f88m-g3jw-g9cj`. npm reports
  the reviewed high-severity dependency chain (narrowed by npm's advisory
  service to a two-entry rollup in 2026-08 over byte-identical lock
  records); the fail-closed policy gate rejects any changed/new result and
  passed against the live reviewed graph. A compatible patched dependency
  upgrade remains follow-up.

[Unreleased]: https://github.com/michaelrowejones/Blendlink/commits/main
