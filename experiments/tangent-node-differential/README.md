# Native EEVEE UV Tangent fields

This batch ports Shader Tangent's `UV_MAP` mode with an explicitly owned Mikk
basis. It supports the active-render UV map and explicit names among the first
four UV channels, one tangent basis per exported mesh. The node follows live
owner transforms and the active camera. Direct material Normal slots use the
native world-to-view conversion. Radial Tangent and Cycles UV Tangent remain
named refusals; the legacy tangent-space Normal Map path is separate and is not
certified by this field port.

## Reproduce

From the repository root, with Node 24 and an actual native Blender executable:

```sh
npm run build
BLENDLINK_TANGENT_NODE_BLENDER=/path/to/blender \
BLENDLINK_TANGENT_NODE_NATIVE="$PWD/artifacts/verification-tangent-nodes" \
node experiments/tangent-node-differential/suite.mjs --built --profiles shared,single,named,hq
```

The profiles exercise shared and single-owner geometry, an explicit edit UV
that differs from the active-render UV, and high-quality normal/tangent packing.
`--reuse-native` repeats actual Final export and browser readback against the
exact retained fixture hash. The harness compares shipped/source Python bytes
and captures an immutable whole-program TypeScript runtime snapshot. Source
`.blend` hashes stay unchanged. No installed add-on or user preferences change.

Focused checks:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/tangent_export_check.py
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/tangent_domain_check.py
node packages/blendlink/scripts/run-vitest.mjs packages/blendlink/src/tslTangentNodes.test.ts
```

## Measured scope

Blender 4.2.0, 5.2.0 LTS and 5.3.0 EEVEE Metal generate the native references.
Production Final export, optimizer, actual GLTFLoader and material installer
then run the shipped programs through both actual WebGPU and forced WebGL2
backends of WebGPURenderer. Legacy WebGLRenderer does not have a live installer.

Each version publishes 32 actual Final GLBs over four profiles. The shared,
named and high-quality profiles have 144 field/control readbacks per browser
backend; the single-owner profile has 72. Across all three versions and both
backends this is 3,024 readbacks, including independent RGB controls. These are
field measurements, not node-type counts. Actual loaded Float32 positions,
split normals and four-component tangents are checked against native data;
Mikk xyz and handedness must remain bit-identical, including mirrored UVs.

Owners use parented, nonuniform, reflected and animated transforms. The final
frame changes one owner while the other owner and camera stay fixed. Front and
back perspective/orthographic views, glTF Y-up and raw Blender Z-up, positive
nonuniform camera scale and direct Normal-slot output are measured separately.
The fixed 2e-5 raster allowance adds one final native half-float ULP, independently
calibrated by RGB controls. No fixture-specific allowance is enlarged. The
reported maximum encoded RGB error is below 4.9e-4. Linux/OpenGL native EEVEE
certification is separate. This proves the channel function and transport;
whole BSDF, lighting and render parity are outside this claim.

Reports: `artifacts/verification-tangent-nodes{42,52,53}/results.json` and the
per-profile `browser-report.json` files.

## Exact UV ownership and source models

The stock exporter calls `mesh.calc_tangents()` with the active edit UV, while
an unnamed native shader tangent requests the active-render UV. Those can be
different maps. It also rounds tangent components to four decimal places before
vertex welding. The private, version-scoped adapter computes the explicitly
bound named UV and reads the original Float32 vectors and handedness before
welding. Exporter hooks are restored on success, failure and bypass. Active UV
selection and authored source data are preserved. Quantization of POSITION,
NORMAL, TANGENT and UV data is skipped for these geometry programs; lossless
Meshopt remains enabled.

EEVEE packs Mikk xyz as SNORM10 or SNORM16, transforms and normalizes in the
vertex stage, interpolates, then normalizes the tangent in the fragment. The
browser models those stages explicitly. References:

- [Native tangent extraction](https://github.com/blender/blender/blob/v5.2.0/source/blender/draw/intern/mesh_extractors/extract_mesh_vbo_tan.cc)
- [Vertex attribute transform](https://github.com/blender/blender/blob/v5.2.0/source/blender/draw/engines/eevee/shaders/eevee_attributes_mesh_lib.glsl)
- [Tangent node shader](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/material/gpu_shader_material_tangent.glsl)

Cycles generates Mikk frames from triangulated geometry and its own normal
representation. Modern decoded OCT16 normals cannot be written exactly through
Blender's custom-normal API: that API re-encodes them as INT16_2D. A private
triangulated mesh with approximate replacement normals is insufficient proof of
native frame equality. Cycles appearance belongs on an explicit reviewed material bake path.
This batch refuses an unverified live Cycles frame instead of using the
authored EEVEE frame; a separate live Cycles Mikk transport is deferred. See
[Cycles Mikk inputs](https://github.com/blender/blender/blob/v5.2.0/intern/cycles/scene/mesh.cpp)
and [packed normals](https://github.com/blender/blender/blob/v5.2.0/intern/cycles/util/types_normal.h).

## Boundaries

Source planning and installation require smooth, finite, nondegenerate triangles
and UV triangles; actual Float32 unit Mikk vectors; exact +/-1 handedness; and
an independently nonzero normal/tangent frame cone. Cross-material conflicts
between UV tangent bases on one mesh fail during planning. The renderer repeats
checks against the actual decoded primitive and live owner matrix, with cached
geometry validation keyed by attribute/index identity and version. A claimed
bounds property supplies no evidence. Required Normal-slot programs are checked
even when Base Color has a portable carrier.

Primary geometry limits still apply: no enabled modifiers, animated mesh data,
skins/morphs, generated/GPU instances, material displacement or Simplify Normals;
unit normals with outward triangle cosine above 0.05; finite invertible normal
matrices within the existing condition bounds; and no unverified reflected,
sheared, shifted/cropped or panoramic authored camera context. Animated node
settings/UV data are not part of this port. Automatic capture cannot silently
replace this owner-dependent field or change its source renderer.

### Flat-shaded surfaces

Flat-shaded faces retain the same actual corner-normal and Mikk-tangent
transport contract. Removing the blanket smooth-only admission restriction
requires no change to the frame shader or serialized programs. Finite geometry
and UVs, actual unit vectors/handedness, frame-cone conditioning, source
preservation and loaded-Float32 attribute checks remain mandatory. Native
planning also checks mixed source shading without treating a shading flag as
a substitute for a valid frame.

Use `suite.mjs --built --profiles shared,single,named,hq --flat` to repeat all
four flat profiles; `--profiles flat` runs the ordinary shared flat profile.
The Blender 4.2/5.2/5.3 checkpoint contains 96 Final GLBs and 3,024
readbacks per browser environment. Independent runs record Apple Metal and
local SwiftShader adapters on both APIs. Reports include browser version,
channel and harness hashes; no numerical budget changes. Linux parity also
runs the flat profile. Native fixture settings and authored shading stay intact.

The complete Blender 5.2 baked export test passes with the default flat Gallery
cube, authored normal texture and separated lighting atlas. This preserves the
existing PBR/UV/program-carrier assertions rather than changing the source to
smooth shading. Native minification and unrestricted Cycles frame parity remain
outside the tangent contract.
