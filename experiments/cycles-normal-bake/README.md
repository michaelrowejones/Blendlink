# Static Cycles normal bake carriers

This bounded workflow keeps proved companion channels live and bakes required
Cycles Normal channels instead of dropping them when live Bump translation is
unqualified. It resolves a single Principled surface through actual artist-group
instances, uses typed private group taps, and supports a separate Coat Normal
carrier when its weight is active. Existing automatic EEVEE engine/context
refusals remain in place. Baking earns no new live node coverage.

Lighting-atlas composition with an evaluated static normal receiver refuses at
planning with `material.normal-bake-lighting-atlas-unproven`. Its later atlas
preparation replaces geometry/UVs and clears source modifiers, so the current
normal transaction cannot promise its exact basis and restoration there.
Appearance owners are already excluded from compiled carriers; Realtime owners
remain admitted because atlas preparation does not touch them. The no-render
`baked_plan_check.py` exercises automatic/explicit Lighting refusals, existing
Appearance policy and both Realtime survivors on an owned original Cube Beam2
binding, preserving its mesh/material/modifier ownership and source bytes.

Receivers are static, single-slot meshes. The transaction captures the actual
render modifier settings on owned geometry, retains the original owner name and
Generated texture-space transform, disables the captured modifiers only on the
private installation, then restores mesh/material/group/modifier state after
success or failure. Each normal variant is tied to its actual owner/binding;
there is no cross-owner bake dedupe or flat proxy for object/generated fields.
Poses, shape keys, animation, instancing, unsupported modifiers and unproved
contexts refuse. A 2,000,000-triangle normal receiver budget prevents
an unbounded private unwrap or GLB allocation. The original Cube Floor's render
SUBSURF5 exceeds it: the whole original scene is still blocked by this named
resource limit. A reviewed high-to-coincident-low capture is future work, not a
viewport substitution made by this patch.

Both maps use one explicit private bake UV and native +Y tangent encoding.
Normal and clearcoatNormalTexture slots, image hashes, unit strengths and UV
channels are attested separately. The stock exporter rounds tangents and uses
active-edit UV by default, so existing exact native Mikk/normal adapters select
the actual bake UV before vertex splitting. Per-triangle POSITION, NORMAL,
TANGENT, handedness and UV numeric associations must match native data exactly;
only geometric signed-zero components are equivalent because stock vertex
welding canonicalizes their sign. Every nonzero Float32 component and triangle
winding remains exact. This does not relax a numerical node word gate.

The [predeclared contract](numeric-contract.json) requires data PNG error within
one 8-bit quantization step plus1e-7 on all delivery coverage, and at most1degree
of decoded direction error on independently captured zero-margin surface
coverage. The production save path reopens the actual PNG and enforces these
gates before an image product returns. No production normalization, shader
repair, sRGB conversion or lossier reencoding is introduced. Direction checks
normalize vectors only for error measurement. Filtering/LOD, margin-direction
and whole-material lighting parity are outside this contract.

The first v1 pilot tested unit direction on dilated coverage and refused12 of
157,910 texels. The failure/source snapshot remains local with zero credit.
[Pinned Blender bake.cc](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/render/intern/bake.cc)
normalizes geometric normals before encoding; native margin extension averages
encoded RGB and need not represent a unit surface direction. V2 separates that
oracle domain without widening the component/angular limits. The native1e-5
encoding bias is retained. glTF's
[clearcoat contract](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_clearcoat/README.md)
requires a defined tangent basis and allows separate base/coat normal maps.

The owned original Cube Beam2/Wood6 pilot uses1,580 actual render-evaluated
triangles and a1024x1024 bake selected by the existing UV/density ladder, despite
its128px scene-output control. It has25,278 true surface texels and157,910 expanded
delivery texels. Original wood and an explicitly labelled active-coat derivative
passed the PNG and native basis gates; maximum surface errors were0.3251degrees
for Normal and0.3363degrees for the independent Coat Normal field. The original
Cube's group-default Coat Weight is zero. The derivative deliberately sets it
to0.5 and uses a separate inverted half-distance Bump; this is not an undeclared
change to the original reference. Original and owned source `.blend` bytes are
unchanged. Separate guarded Python prefixes and source/helper/script snapshots
are retained for both probes.

Actual WebGPU/WebGL2 under Metal and SwiftShader loaded embedded normal PNGs,
installed the published companion IR, retained both baked maps on UV1 while
source UV0 remained available, rendered finite nonblank direction diagnostics,
and restored source material/callback ownership. Missing WebGPU adapters refuse.
An initial direct-export harness lacked the production Object Info Random stamp;
that was corrected and native captures repeated. These are carrier-loading
smokes, not cross-renderer lighting comparisons or full-scene Final acceptance.
Historical browser smokes lacked complete fixture/vendor/closing inventories and
are not relabelled as closed qualification. The updated browser harness captures
those inventories before execution and independently re-emits the whole program
at closing for the fresh combined replay. The native producer also writes an
exclusive `capture-manifest.json` only after successful execution, source checks,
launcher archival and disposal. It closes every owned output file, including the
actual GLB, programs, extracted textures, raw fields, both masks, report and native
source/launcher archives. Only the manifest itself is excluded. Browser capture
checks that producer census before and after rendering and carries its SHA plus
the original native-report/GLB/program hashes; it cannot bless a replacement GLB
at browser startup. Older captures without this producer manifest must be run
fresh and receive no closed-proof credit.

With Node24 and an independently built SDK:

```sh
node experiments/cycles-normal-bake/run.mjs artifacts/verification-normal-wood /absolute/path/to/pinned/cube_diorama.blend
node experiments/cycles-normal-bake/run.mjs artifacts/verification-normal-coat /absolute/path/to/pinned/cube_diorama.blend --active-coat
BLENDLINK_TEST_PROFILE=metal node experiments/cycles-normal-bake/browser.mjs artifacts/verification-normal-browser-metal artifacts/verification-normal-wood artifacts/verification-normal-coat
```

GPU ownership must cover native baking and browser phases. Use fresh output
directories. Repeat the browser phase under SwiftShader using the existing
Chromium profile variables. Then run the independent CPU reader:

```sh
node experiments/cycles-normal-bake/verify.mjs artifacts/verification-normal-wood artifacts/verification-normal-coat artifacts/verification-normal-browser-metal artifacts/verification-normal-browser-software
```

The reader rechecks both native source/launcher/output archives, unique guarded
Python invocations, both actual API/profile reports, original producer links and
closed runtime/fixture/vendor inventories. It independently emits the current
whole runtime and runs the PNG decoder before writing the bounded receipt. It
starts no Blender, browser or GPU job. The SDK must already be independently
built; the reader never builds or repairs evidence. `validate_pixels.py` independently decodes embedded
PNG chunks/filters with CRC checks and compares their raw pixels to the retained
native float fields and both masks; it starts no Blender/browser/GPU process.
`encoding_check.py` and `transport_check.py` cover CPU gate/refusal/restoration
and synthetic GLB corruption. The latter deliberately substitutes synthetic
images and has zero bake/appearance credit. `protocol.test.mjs` requires complete
browser case/API/pin/closing metadata; `archive.test.mjs` refuses stale GLB,
report, raw-field and program bytes, wrong role pins, missing/extra artifacts,
symlinks and incomplete manifests; shared archive tests cover stale emitter,
missing/extra modules/maps/vendor, fixture tampering and symlinks.


The original Floor's 4,096 source quads and sole render SIMPLE level5 modifier
prove 8,388,608 triangles. Its single source material slot can therefore be
resolved without evaluating the mesh merely to rediscover slot zero; a required
normal bake gets `material.normal-bake-geometry-budget` before that allocation.
The shortcut requires a DATA-linked single slot, an oriented manifold quad source and only SIMPLE or
topology-preserving normal modifiers (Normal Edit must disable face-normal
correction). Bevel, Decimate, Catmull-Clark, unknown
modifiers, animated object/mesh/scene IDs, edit mode, active Simplify/adaptive subdivision,
loose geometry, malformed edge/corner arrays and unproved topology decline
this early count and retain the actual evaluated-mesh gate. This removes the old
unsafe source-count multiplier on arbitrary modifier chains. An ordinary live
material gets no new resource refusal. Original Wood's Bevel/Catmull-Clark/
Decimate chain stays on the existing path.

`budget_preflight_check.py -- /absolute/path/to/pinned/cube_diorama.blend` loads
only owned Floor/Beam2 datablocks and never evaluates Floor. Its planning control
forbids evaluated-object/material-use/hash calls, checks the object/material
diagnostic, and preserves source bytes and native ownership. Small synthetic
SIMPLE meshes independently match native evaluated triangle counts at levels1–3;
unsafe-chain and malformed-topology controls decline the shortcut. No render,
bake, complete-scene export or additional live-node credit is claimed. The count
follows pinned Blender's [resolution rule](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/modifiers/intern/MOD_subsurf.cc#L94)
and [quad face census](https://github.com/blender/blender/blob/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/subdiv_foreach.cc#L139).
