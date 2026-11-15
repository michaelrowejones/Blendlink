# Release scene implementation progress

The first fixed porting target is the original CC0 Architectural Visualization
scene by Marek Moravec, hash-pinned in
[the source corpus](release-scene-corpus.json). Its 15 conservatively reachable
shader/compositor node kinds define the initial live-scene backlog. Every used
mode, input domain and graph combination must work through the real compiler
and installed website before the scene is accepted. Existing world/environment
transport may cover a scene dependency without needing a new material opcode.

Classroom and Lone Monk remain auditions for additional bake/compositor coverage.
Their node usage stays visible in [the complete backlog](release-scene-node-backlog.json);
the final eight-scene release corpus is not frozen. Classroom's three render
scenes/particle source and Lone Monk's particle instances/license version need
deliberate decisions before either becomes a guaranteed release scene.

## First measured original scene

The actual SceneToWeb `plan --json` command against the untouched Archviz source
refused Plaster's Normal channel. The authored graph uses packed 1024×1024 color
and normal images, BOX projection with blend `0.09966777265071869`, Mapping in
TEXTURE mode, and tangent/OpenGL Normal Map. The existing source emitter admits
only sharp embedded BOX sampling and refuses this blended image domain.

This is an implementation blocker, not an accepted output or a visual mismatch
measurement. No export, reference render or browser result is credited. The
original source SHA-256 was independently checked unchanged after planning.
The local evidence is `/tmp/scenetoweb-v1-archviz-baseline/`; it contains the
project config and failure log, not redistributable release artifacts.

The improved plan-only inspection now returns valid JSON with exit code 1 and
both Glass and Plaster errors, retaining native issue codes, affected objects,
remedies and per-channel refusals. Hard compiler errors remain errors even with
an application material adapter; real Preview/Final export still refuses them.
The original source hash remains unchanged.

## Work order

| Work | State | Acceptance |
| --- | --- | --- |
| Node-capable Three/R3F happy path | Implemented and checked against packed consumers and guide snippets | Browser scene/visual acceptance remains separate |
| Stable publication policy | Implemented with release-policy tests | No publication or external settings change performed |
| Pinned 5.3 complete local lane | Passed from clean source on the pinned macOS arm64 host | Four unqualified stock-material relaxations remain explicitly excluded; wider host/device and public release gates remain |
| Headless policy discovery | Support both product prefixes and exact historical sentinels with source-profile applicability | Current source-policy checks earn no native numerical credit |
| Archviz blended BOX image/Normal graph | Measured compiler blocker; general transport and fidelity path under investigation | Actual source → Final → installed browser, including normal response |
| Classroom horizontal Lens Distortion | Qualified bounded partial 5.3 CPU route | Four saved Finals and all four browser tuples pass; original Classroom graph and broader Lens modes remain blocked |
| Additional positive originals | Auditioning; no successful originals accepted yet | Licensed originals, manageable scope, all used modes and complete scene acceptance |

Continue the wider node catalog after the selected scenes work. Do not clear
an inventory row merely because its class exists, a candidate compiles or a
scene was baked. Track live, bake and explicit refusal routes separately.

## Combined local checkpoint

The clean `a4bdde2` checkpoint passed the complete pinned Blender 5.3 local
contract: 185 applicable native headless suites, 1,859 unit tests (six optional
skips), 124 release-policy checks, real KTX round trips, packed Three/R3F
consumers, isolated extension installation and Appearance, Lighting and Material
Atlas end-to-end checks. The exact tested npm payload contained 992 files.
The report records a stable workspace and the actual conservative policy witness
for its four excluded material relaxations. This is not native parity for those
features or public-release approval. Local evidence is
`artifacts/v1-53-full-contract-r5/report.json` in the integration checkout.

The Lens qualification receipt was independently replayed four times with the
same SHA-256 `8b1e29336d6bbc311aebe15d0f983dcdbe42396958c7d7f484871a9e83ef6953`.
Its 41,760 primary and 41,760 supporting sampling Float32 words are exact. The
scope and lifecycle evidence are in
[the qualified record](../experiments/compositor-lens-horizontal/qualified-evidence.json).
Coverage is now 46 supported, 141 partial, 131 unsupported and 14 structural;
native catalog audit history remains unchanged.
