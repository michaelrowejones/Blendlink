# Bounded Vertex Color Alpha field

The fresh root r6 matrix qualified the bounded Blender 5.3 Alpha slice:
8 native graphs/24 native frames, 8 saved Final scenes and 64 browser case runs
across Metal/SwiftShader × WebGPU/WebGL2 × raw/Final. The exact closed receipt
is `evidence.json`; the node remains **partial**, with earlier Color evidence
and older versions preserved. Source pins and the original transport experiment
are in `../vertex-color-alpha-feasibility/`.

The matrix compared 1,048,576 primary Float32 words. Raw source-to-private-GLB
alpha transport is exact; raster RGB is bounded against actual EEVEE half-film
output. Maximum absolute RGB error was 0.00048828125 against the unchanged
2^-10 gate, with zero contract violations and exact output alpha 1. There were
574,488 RGB word differences, so this is not a bit-exact Float32 field claim.
All pixels and seam/edge bands passed, as did 192 resize frames, 192
apply/dispose cycles and 10 fresh actual native Python prefixes. The numerical
corpus tests Alpha-to-Emission fields and installed material/projection paths;
it grants no general transparent-coverage or whole-scene appearance parity.

The new `vertex_color_alpha` op reads a separate raw Float32 scalar custom
attribute. The existing Color/RGB op and stock COLOR_0 settings are unchanged.
The source profile is Blender 5.3.0 build `02f0899d78e3`, macOS arm64 EEVEE Metal.
Native OpenGL/other hosts remain unqualified; export checks preferences without
initializing a GPU. Browser API/backend qualification is separate. A named layer
must exist; an empty name selects the native **render** color layer, independently
of the editor-active layer. Initial inputs are FLOAT_COLOR POINT/CORNER, +0 or
normal finite Float32 alpha in [0,1]. BYTE_COLOR, signed zero, subnormal/HDR/nonfinite
alpha, deformation/modifiers, shape keys, instances, animated owners/mesh IDs,
missing layers and reserved-name collisions refuse.

At most 300,000 source vertices/corners and four private layers per owned mesh
are admitted. Compiler-owned mesh copies carry the scalar; source meshes and
trees are restored without extra artist attributes. Source alpha is bulk-read
and classified by **raw words before Float32-to-Python conversion**, which can
flush subnormals. Private scalar readback is independently bulk-checked.

The GLB check compares oriented indexed triangle multisets of exact exported
Float32 positions and alpha words, partitioned by actual owner and generated
material. Cyclic corner rotation and exporter vertex/material reordering do not
change the association. Position zero signs are immaterial to this geometric
association; alpha words are untouched. Coincident same-winding triangles using
the same material refuse, because positions alone cannot distinguish their
other field correlations. Dense accessor stride, view span, alignment, count,
type and normalization are checked before reading. The runtime independently
checks the actual loaded Float32 SCALAR attribute, its material/layer mapping,
position/index identities and upload versions, interleaved offset/stride, draw
range and groups. A metadata semantic alone grants no scalar resolver.

Default Final optimization preserves declared Alpha scalars as raw Float32.
The initial bounded fallback also preserves POSITION across the asset, because
the quantizer's POSITION correction transforms apply to whole mesh parents and
cannot safely exclude one material primitive. This choice is explicitly reported
in `optimization.passes.skipped`; it applies only after actual Alpha storage and
material bindings pass validation. Other generic attributes, COLOR and NORMAL
keep their existing quantization policy; TEXCOORD retains its existing exact
policy. Assets with more than 1,000,000 unique position-accessor vertices (including
morph POSITION streams) refuse
this initial fallback. Shared owners do not count the same accessor twice.

Before optimization and again after decoding the actual Meshopt output, a
compact hash compares indexed Float32 position/alpha triangles per actual named
owner and material variant. This permits vertex reordering, welding, index-width
changes and compression without dropping field association. Work is bounded to
3,000,000 rendered corners across the checked Alpha fields. Only hashes/counts
leave the collector; full triangle records stay transient. Initial runtime
binding requires a complete primitive draw with no custom Three geometry groups;
per-draw checks use fixed attribute/range/version snapshots.

New Alpha/opacity programs refuse stock VEC4 COLOR_0 when its actual alpha is
nonunit or unknown: Three would multiply vertex alpha and the opacity node.
The exact exception is a count-matched physical COLOR_0 whose every alpha is
1; Blender's default Alpha-only export creates this safe fake-white carrier.
The exporter verifies actual accessor data before publishing, CPU Final
preflight inspects decoded alpha components, and runtime checks all candidates
before any material mutation. Safe carrier identity/schema/upload version is
then guarded per draw. No tolerance or exporter-setting override grants this
exception. Existing RGB programs and new Alpha fields in Emission/Roughness
retain their routes. General Color+Alpha opacity interoperability remains a
separate gap; this batch does not change Three's RGB multiplication behavior.

No-render policy run:

```sh
node experiments/vertex-color-alpha/run-policy.mjs artifacts/vertex-alpha-policy
SCENETOWEB_VERTEX_ALPHA_GLBS="$PWD/artifacts/vertex-alpha-policy" \
  node_modules/.bin/vitest run packages/blendlink/src/tslVertexColorAlpha.test.ts
```

The guarded native archive admits one policy script and zero render/bake/Final
actions. It exercises two source-sharing owners, two material slots, CORNER
seams, named/default render layers, source groups/reroutes, repeated export and
restoration, POINT transport and explicit refusal controls. Both exported GLBs
are additionally loaded by the actual Three GLTFLoader without a renderer.

## Predeclared numerical proof contract (before capture)

Exact source-to-GLB Float32 transport is separate from raster interpolation.
Actual EEVEE beauty uses half-film storage. The predeclared native-material
comparison gate is finite RGB absolute error **at most 2^-10** for alpha-derived
values in [0,1], with output alpha 1 exact. This includes film storage rounding;
it does not claim an exact Float32 node-field oracle. No output repair,
quantization, fitted coefficients or post-capture gate changes are allowed.

Before node captures, independently measure an authored geometry ramp and its
camera/sample/filter/jitter settings. Use a full-frame overdraw plane to avoid
silhouette coverage ambiguity. Cover every pixel and explicit diagonal seam
and edge bands; include constant and nonuniform alpha 0, 0.1F32, one-third F32
and 1. Record any test-only camera calibration. The closed matrix includes
actual saved Final GLB loading/rendering on both APIs and ownership/resource
controls. This field test earns no whole-Final-camera appearance credit.

## Native material pilot, separate from implementation qualification

`native-pilot-evidence.json` retains a source-pinned, independently re-read
native-only pilot. The fresh 64×64 geometry ramp matches all 4,096 pixels
exactly, with measured pixel offset (0,0), samples 1, filter size 1.5 and no
camera adjustment. Six actual EEVEE Color Attribute captures cover four POINT
constants, nonuniform POINT and a discontinuous CORNER seam. All 24,576 pixels
meet the predeclared gate; maximum absolute RGB error versus independent
geometric barycentrics is 0.000479412117. Each case includes 246 seam-band and
496 edge-band pixels. Every output alpha is exactly 1.

The native source geometry has an authored asymmetric corner, so the diagonal
does not land exactly on pixel centers. The camera calibration precedes the
node captures and stays fixed. This is a fixture choice, with no artist scene
rewrite or node-output repair. Original saved Blender sources, EXRs and raw
readbacks are individually hashed in the receipt.

```sh
node experiments/vertex-color-alpha/run-native-pilot.mjs artifacts/vertex-alpha-native
node experiments/vertex-color-alpha/read-native-pilot.mjs artifacts/vertex-alpha-native
```

This pilot executes native Blender nodes only. It provides **zero SceneToWeb
implementation, Final or browser qualification credit**. The separate raw
source/GLB policy exercises the new transport. The later fresh root matrix
supplies the implementation/Final/browser evidence without promoting this pilot.

## Full closed matrix

```sh
node experiments/vertex-color-alpha/matrix.mjs artifacts/vertex-alpha-union
```

Run after the shared SDK/package build is frozen and the native/GPU window is
free. Eight untouched saved scenes use the ordinary packaged Final pipeline;
their authored scene recipe explicitly selects the normal Meshopt optimization
mode. A fresh factory scene otherwise has optimization set to `none`, so this
is not described as a factory-default optimization setting. No exporter flags
disable vertex colors or quantization globally. The approved bounded POSITION
fallback is explicit in the optimizer report.

The matrix captures 64/32/96-square actual native references, checks raw
compiler GLBs and actual optimized Final GLBs, then runs hardware Metal and
software SwiftShader on WebGPU and WebGL2. Native independent geometry/camera
calibration is unchanged. Browser readback orientation uses exact fragment
centers, `screenCoordinate.x/64, 1-screenCoordinate.y/64`, before port images.
Three's pinned ScreenNode follows the WebGPU top-left convention on both APIs;
`orientation-source.json` records the primary source and installed SHA. The
earlier world-position varying probe failed its exact assertion and remains a
failed calibration, with zero port credit. This probe change removes varying
interpolation from orientation selection without fitting port output or
changing the source camera or numerical gate. Each actual loaded material executes
an ordinary material smoke draw and an Emission projection from its installed
program, followed by three apply/dispose cycles and target/DPR resizes. Every
pixel and the declared seam/edge bands use the unchanged 2^-10 gate; output
alpha 1 is bit-exact. Raw RGB word differences are measured rather than called
exact. Mesh/material/callback identities and actual renderer-owned texture
baselines must restore. Final GLB scalar storage and owner/material indexed
associations are independently re-read after Meshopt.

The shared family preflight, strict native script/Final census, frozen fixture
hashes and immutable runtime archive reject stale or cross-family evidence.
The source/Final stage can start independently with `capture.mjs`; subsequent
`run.mjs` phases and `verify.mjs` close the same transaction. The original pilot
and failed fixture preflights remain diagnostic and grant no matrix credit.

The retained r5 software-WebGPU counterexample is one physical pixel whose
independent native/browser material-ID passes select different triangles.
`raster-ownership-counterexample.json` records the original data with zero
qualification credit. The fresh node fixtures use the independently declared
dyadic rectangle in `fixture-geometry.json`: local diagonal slope 2, and shared
owner world slopes 4 with integer offsets ±4. At every 32/64/96 size, even
integer slopes and integer pixel intercepts leave half-integer distances from
pixel centers, with minimum 0.5 physical pixel clearance. The CPU test exhausts
all centers before capture. All alpha words, source camera, numerical gates,
whole-pixel comparisons and seam/edge-band checks stay unchanged. Independent
native calibration explicitly retains all four original ±2-square vertices.
This fixture correction grants no geometric raster-ownership port credit and
rewrites no artist/demo scene.

## Named Attribute Alpha variant (qualified next15)

The shared harness accepts an explicit `attribute` source variant without copying its native/raw/Final/browser/normal-Meshopt proof stages. The omitted selector preserves the original eight Vertex Color definitions. The Attribute variant has nine source definitions: the previous constants/nonuniform/seam/group/shared-owner/material/RGB workflows use native ShaderNodeAttribute GEOMETRY Alpha with explicit named layers, plus a lowercase `color` surface-Mesh control. The native generator authors actual Attribute nodes; it never substitutes Vertex Color nodes for those Alpha outputs. An unrelated active/render color layer distinguishes explicit lookup from fallback.

```sh
node experiments/vertex-color-alpha/matrix.mjs artifacts/verification-NEW-attribute-alpha attribute
# Individual stages/readers must select the same explicit variant:
SCENETOWEB_ALPHA_SOURCE=attribute node experiments/vertex-color-alpha/verify.mjs artifacts/verification-NEW-attribute-alpha
```

The closed [Attribute receipt](../attribute-alpha/evidence.json) records nine native field graphs / 27 field frames plus the independent calibration render, nine actual saved Final scenes, 72 raw/Final browser cases across both APIs/profiles, 1,179,648 primary Float32 comparison words, 216 resize frames, 216 lifecycle cycles and 12 distinct guarded Python invocations. It records 667,434 RGB word differences, maximum absolute RGB error 0.00048828125, zero contract violations and exact alpha-one output; raw scalar transport remains exact. Existing EEVEE half-film RGB absolute gate 2^-10, alpha-one exactness, every seam/edge pixel, source/material ownership and normal authored Meshopt publication checks remain unchanged. Raw and Final programs must retain the named, profile-bound scalar field leaf; a constant, empty name, another layer or unsupported source class cannot satisfy the reader.

The production candidate reuses the existing `vertex_color_alpha` opcode/model, exact F32 private scalar carrier, indexed material/corner association proof, optimizer and runtime. No browser kernel, texture, pass or per-frame native work is added. The source emitter requires GEOMETRY and an explicit nonempty name, and refuses exact lowercase `temperature` because Blender forces its Alpha to one. The carrier still requires present FLOAT_COLOR POINT/CORNER data, raw +0/normal [0,1], and its existing bounded static primary Mesh/ownership profile. Other Attribute types, missing/default/empty names, BYTE_COLOR, other domains, deformation/instances, volume pipelines and transparent-coverage behavior are outside this slice. Original Vertex Color empty-name active-render behavior and RGB/Attribute Color/Fac routes are preserved.

`attribute_alpha_check.py` is a separate no-render native policy script. The Attribute capture runs it alongside the original Vertex policy, without changing that policy's authored fixtures. The fresh combined-build closing reader passed for this named Attribute field scope; the already-partial Attribute class remains partial and no class counts change. This proof gives no explicit-opacity qualification. The separately source-certified opacity adapter retains its own scope/evidence; untagged opacity guards remain distinct.
