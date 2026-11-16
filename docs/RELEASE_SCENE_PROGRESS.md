# Release scene implementation progress

The first fixed porting target is the original CC0 Architectural Visualization
scene by Marek Moravec, hash-pinned in
[the source corpus](release-scene-corpus.json). Its 15 conservatively reachable
shader/compositor node kinds define the initial live-scene backlog. Every used
mode, input domain and graph combination must work through the real compiler
and installed website before the scene is accepted. Existing world/environment
transport may cover a scene dependency without needing a new material opcode.

The second fixed target is the original CC0 Impact Fracture by Simon Thommes /
Blender Studio: 12 reachable shader/compositor kinds, an authored camera,
20,537 evaluated triangles, and no animation or particles. Typed library/image
records are empty; two missing weak append-provenance paths belong to unused
local asset groups outside the current scene's ID closure.
Its original plan succeeds. Its first actual Final failed after glTF writing;
the corrected worker now exports a website that renders on both node-renderer
backends. It remains selected for porting, not accepted. Other auditions and their
negative results are retained in [the audition ledger](release-scene-auditions.json).

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

The earlier plan-only inspection returned valid JSON with exit code 1 and
both Glass and Plaster errors, retaining native issue codes, affected objects,
remedies and per-channel refusals. Hard compiler errors remain errors even with
an application material adapter; real Preview/Final export still refuses them.
The original source hash remains unchanged.

Glass selects a separate EEVEE Material Output, whose outer Mix Shader is driven
by Light Path **Is Shadow Ray**. Its shadow branch is white Transparent BSDF;
its other branch mixes a metallic Principled surface with white transparency.
Replacing Is Shadow Ray with a universal constant would lose the different
shadow behavior. The qualified bounded route below preserves the visible-surface
and shadow-pass contracts separately. The
engine-specific output is selected by Blender's read-only `get_output_node`,
not by treating the global active flag as an EEVEE-only flag.

The [second BOX diagnostic stage](../experiments/box-image-normal-stage/README.md)
retains 78 native renders and 300 browser readbacks. Its masks/coordinate inputs
are exact, and the existing SNORM10/16 normal transport passes all WebGL2
controls. Matching Archviz's render anisotropy improves sampling, but its
maximum WebGL2 error remains `0.0043332577`, above the fixed `2^-10` gate.
Sparse WebGPU normal differences remain unresolved. The new weight fixture was
invalid because its unlinked Vector default is ignored by Blender; that failure
is retained, not interpreted as a weight-math result. Production admission and
support coverage are unchanged. Observe the actual native texture storage and
mip chain before choosing a sampling correction.

The [storage follow-up](../experiments/box-image-storage-stage/README.md)
supersedes those two outstanding diagnostic hypotheses. Actual native/browser
formats belong to the same byte format families. A fixed, API-defined readback
row-origin correction closes every independent normal, polygon, position and
explicit-linked weight control on both APIs. The old sparse normal differences
do not justify a runtime normal/depth change. Native image mip generation uses
a generic two-level compute path with packed intermediate storage; the prior
Metal-blit-only inference was incomplete. Actual image sampling still fails.
The source-derived CPU model and raw failures remain experimental, with no
support or original-scene credit.

The [paired mip follow-up](../experiments/box-image-storage-stage/BSL_F32.md)
now closes the bounded sampling stage. All 44 filtered mip-level comparisons
(11,264 words) are bit-exact for the two original Plaster images on Metal
WebGPU and node WebGL2. The source scene's two-sample anisotropic BOX domain
passes all 73,728 words at the unchanged `2^-10` bound; maximum errors are
`0.0001219809` for color and `0.0004878640` for the normal image. Geometry,
normal, projection, position and weight controls pass. Ordinary mip and no-mip
policies remain discriminating negatives. An additive acceptance command
(`verify-paired-stage.mjs`) reruns the immutable readers and checks every
positive tuple and negative policy; the original diagnostic readers and their
hashes remain unchanged.

This is not a port admission: the experiment uses a hardware-typed sRGB mip
chain generated through WebGPU, plus the independently checked CPU Non-Color
chain. A WebGL2-only generation/transport route and the complete authored
Mapping → BOX → Normal Map → installed Final still need qualification. Plaster
remains a compiler blocker. No node inventory row is promoted by this sampling
result; the separate Glass qualification below covers Light Path's bounded route.

## Qualified Glass shadow branch

The actual original Glass material, loaded with the original file's native
legacy EEVEE conversion, now passes a scoped live route. Six native predicate
renders and eight installed Final/browser tuples cover both an opaque control
and the original `0.05000001192092896` visible Alpha. Metal/SwiftShader ×
WebGPU/WebGL2 pass shadow exclusion, a separate opaque caster, visible primary
identity, exact stored Alpha and unblended Float32 Alpha, source-material
restoration and reinstall. The independent reader closes 5,767,168 browser
words plus 393,216 native decoded PNG words; these are within-engine predicate
controls, not Blender/Three BRDF or whole-scene pixel parity.

The five-channel program explicitly owns transparent/depth-write/coverage state
because Blender 5.3 stock glTF loses this graph's visible Alpha. Scoped owned
callbacks invalidate Three r184's shadow override cache across same-object
material replacement, preserve app callbacks and restore normal stock shadows
after disposal. Original artist materials remain unchanged. Incomplete channels,
missing state, mismatched Alpha and missing node-renderer declarations refuse.

[The closed receipt](../experiments/shadow-transparent-branch/qualified-evidence.json)
limits this to the pinned 5.3 build/macOS arm64 Metal, direct terminal Is Shadow
Ray and exact white Transparent shadow closure. The non-shadow closure is one
literal-Alpha Principled, or one literal-factor white-Transparent/Principled
mix with Principled Alpha one. No standalone Light Path values, other outputs,
Cycles route, groups, animation, nested visible mixes or other source profiles
are admitted. Blender 4.2/5.2 remain unsupported. Archviz remains selected and
unaccepted while Plaster's complete material is blocked.

## Plaster color and normal-frame split

The original color Mapping → independent BOX blend → OVERLAY signal passes
36,864 positive words at the unchanged `2^-10` bound, with 12,288 exact mask
words and strong omitted-Mapping/OVERLAY negatives. The original-source color
capture is experimental until its own saved Final and installed proof close.
Cold headless Blender 5.3 `gpu.init()` also extracts every native sRGB mip byte
without a beauty render or visible UI: all 5,592,404 bytes match both passing
browser chains. Export-owned compressed companions can remove runtime mip
generation and keep Node audit and browser inputs identical.

The [normal-frame audit](../experiments/archviz-tangent-frame/README.md) found
actual degenerate UV triangles and authored n-gons. Stock glTF omits tangents
after its Python API refuses n-gons; blanket or selective private triangulation
changes native frames. Finite vectors do not certify zero-UV fallback. Preserve
the NormalMap refusal while developing original-corner normal/Mikk provenance;
artists must not need a C++ compiler.

## Original-scene startup experiments

The [Impact profiling checkpoint](../experiments/impact-program-startup-profile/README.md)
retains the original website and exact shader/geometry associations. It finds
53 fragment shader sources, largely split by Generated-coordinate bounding-box
literals. A uniform candidate reduces that to 11, but changes 572 RGB bytes
with a maximum difference of 25. It is retained as a patch, not installed in
the runtime. Historical and newly warmed startup timings are not comparable;
no performance acceptance or 17-second improvement is claimed.

The native per-vertex Generated follow-up verifies all 281 original evaluated
mesh-owner associations, including oriented triangles and texture space. Its
three actual BEVEL cases close render-mode metadata and independent position
and mask controls. One of 196,608 Generated field words exceeds the fixed
`2^-10` gate on the WebGL2 glTF-coordinate case (`0.001321733` maximum).
The wrong-bounds negatives all discriminate. This second candidate also stays
experimental. The next useful control isolates that one varying/vertex result;
it does not widen the image gate or rewrite the original scene.

## Camera DOF remains private research

The [camera DOF experiment](../experiments/camera-dof-physical/README.md)
preserves three failed candidates and a reproducible SDK patch. It does not
add an option or optics implementation to the published SDK/addon. Its entry
point checks all 16 implementation-file hashes before opening a GPU and
refuses an unapplied patch. The original missing-DOF warning remains active.

Actual native DOF-on/off renders isolate the authored optical effect from the
fixed Blender/Three material and lighting differences. Candidate 3 passes 19
GPU layer-boundary checks and three declared constant-HDR controls on both
backends, but its signed full-frame effect error is 2.20 times the no-DOF
baseline on WebGPU and 2.08 times on WebGL2. The foreground/focus resolve is
not artist-ready. Layer eligibility alone does not fix accumulator/coverage
semantics; further approximate gather rewrites are paused for this batch.
Native kernels retain their upstream licenses; the SDK candidate is an
independent functional implementation. No DOF, node or Impact acceptance is
credited. All 281 original materials still install in these research captures.

## Work order

| Work | State | Acceptance |
| --- | --- | --- |
| Node-capable Three/R3F happy path | Implemented and checked against packed consumers and guide snippets | Browser scene/visual acceptance remains separate |
| Stable publication policy | Implemented with release-policy tests | No publication or external settings change performed |
| Pinned 5.3 complete local lane | Passed from clean source on the pinned macOS arm64 host | Four unqualified stock-material relaxations remain explicitly excluded; wider host/device and public release gates remain |
| Headless policy discovery | Support both product prefixes and exact historical sentinels with source-profile applicability | Current source-policy checks earn no native numerical credit |
| Archviz blended BOX image/Normal graph | Measured compiler blocker; general transport and fidelity path under investigation | Actual source → Final → installed browser, including normal response |
| Archviz Light Path shadow branch | Qualified bounded 5.3 partial live route, including original Glass material | Complete Archviz scene remains unaccepted; broader Light Path outputs/source profiles remain unsupported |
| Impact Fracture | Original Final and installed website smoke pass on WebGPU and node WebGL2 after worker/Area-light fixes | Native camera DOF remains untransported; fidelity and startup performance remain open |
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

The same source tree subsequently passed `test:preview-ux`, exit code 0, on
Chromium, Firefox and WebKit. The gate covered comparison/keyboard controls,
inspection/capture, retry/save recovery, standalone atlas planning, scene
replacement, manual playback, reduced-motion navigation and rollback. WebKit
automation is not physical Safari/iOS evidence, and this fixture-level pass is
not original-demo acceptance. The local log is
`/tmp/scenetoweb-v1-preview-ux-final.log`.

The initial Lens qualification receipt was independently replayed four times with the
same SHA-256 `8b1e29336d6bbc311aebe15d0f983dcdbe42396958c7d7f484871a9e83ef6953`.
Its 41,760 primary and 41,760 supporting sampling Float32 words are exact. The
scope and lifecycle evidence are in
[the qualified record](../experiments/compositor-lens-horizontal/qualified-evidence.json).
That checkpoint's coverage was 46 supported, 141 partial, 131 unsupported and 14 structural;
native catalog audit history remains unchanged.

After the worker and Area-light changes, the complete Lens transaction passed
again on frozen `7ab99950`, with four matching independent closes and receipt
SHA-256 `7db33d9893975d6f4c7d9102a81ce8f7658870e7a7e2df364c898c930e24ba46`.
All four backend tuples, four saved Finals, 40 native renders, exact primary and
supporting words, and ownership/cancellation controls remain passing. The
initial record is retained separately; the port's scope and coverage category
did not widen.

## Original-scene vertical slice

Impact Fracture revealed two independent export problems: saved Edit Mode can
silently ignore a private Mesh assignment, and exporter 5.3.43 can leave a
temporary Mesh backlink holding a private Mesh user. The worker now prepares
and restores editing state, verifies data swaps, and closes only the observed
temporary-to-owned-private reference. Native regressions preserve source IDs,
last-good output and foreign users, including intentional `-noimp` exclusions.

The first website then refused the combination of live programs and authored
Area lights. [Renderer-local Area lighting](NODE_RECT_AREA_LIGHTS.md) now uses
private LTC tables and light-node registrations without replacing application
lighting globals. Generated websites, Studio and developer integrations opt in.
This remains Three's declared lighting approximation, without native shadows
or indirect bounce.

The untouched original exported from `099e993` and rendered under `/showcase/`
on actual WebGPU and node WebGL2 contexts: 281 translated material assignments,
zero skipped, with the authored compositor and display stages active. WebGPU
reported no browser errors; WebGL2 reported only its deliberately induced
WebGPU-unavailable fallback warning. Sources and all exported website bytes
were unchanged during the browser captures. These are local artifact smoke
checks, not an exact published-package installation or whole-scene acceptance.

First-ready observations were 1.168 seconds on WebGPU and 17.285 seconds on
WebGL2. Driver caches were not cleared, no frozen network/device budget was
applied, and these are not performance passes. The
[CPU cache audit](../experiments/impact-program-cache-audit/README.md) finds
278 material/cache-key variants from one authored material, differing in
Generated-coordinate bounding-box metadata. Installation itself took about
48 ms in that separate CPU run; final shader counts and driver costs are still
unmeasured. Measure those phases before changing the shader binding model.

A controlled 1280×720 native EEVEE reference retains the original frame 0,
64 samples, lights, materials, compositor and camera. It exposes an immediate
visual gap: the source's 50 mm camera, f/0.5 and focus distance 6.9289999 create
foreground blur which the website does not preserve. Readiness/export now warn
and retain those settings; the separate Preview DOF component is not presented
as a native conversion. No numerical scene-fidelity gate was frozen for these
first baseline captures, so no pixel-parity or visual acceptance is claimed.

Reproduction helpers for original pin validation, fresh evidence directories,
subfolder loading, backend observation and source/artifact preservation are in
[the corpus guide](../experiments/release-scene-corpus/README.md).

## Latest combined validation

Clean checkpoint `5dbe74d` passed the complete pinned 5.3 local contract in
300.795 seconds: 218 unit-test files, 1,866 passing tests and six optional skips,
124 release-policy checks, 16 real KTX round-trip checks, 189 applicable native
headless suites with no applicability skips, packed Three/R3F consumers and
guide snippets, isolated extension install/reinstall, and all three bake
end-to-end workflows. The tested npm payload contained 1,003 files. Workspace
stability and the four conservative stock-material scope exclusions were
verified; native-positive qualification and public-release readiness remain
false. Evidence: `artifacts/v1-53-full-contract-r6/report.json` in the integration
checkout.

The same executable source then passed the complete preview UX gate on
Chromium, Firefox and WebKit, including recovery and replacement. Local log:
`/tmp/scenetoweb-v1-preview-ux-polished-final.log`. WebKit remains browser-test
evidence rather than physical Safari/iOS acceptance. The source coverage export
has no fingerprint drift, validation failure or native availability changes.
No spreadsheet write, hosted workflow, package publication or real-user test
was performed in this batch.
