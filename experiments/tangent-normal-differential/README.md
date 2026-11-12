# Native EEVEE tangent-space Normal Map

This ports EEVEE tangent-space Normal Map composition over the exact exported
Mikk frame. Color and Strength can stay live when their actual finite ranges
certify a nonzero, sufficiently conditioned normal. This includes literals,
Checker and Mix graphs, byte-image Color, and image Alpha driving Strength.
The separate verified Object/World routes and serialized Cycles tangent route
keep their existing behavior. EEVEE is the live reference; Cycles appearance
belongs on the explicit material-bake path when a verified live route is absent.

## Reproduce

From the repository root with Node 24 and a native Blender executable:

```sh
npm run build
BLENDLINK_TANGENT_NORMAL_BLENDER=/path/to/blender \
BLENDLINK_TANGENT_NORMAL_NATIVE="$PWD/artifacts/verification-tangent-normal" \
node experiments/tangent-normal-differential/suite.mjs --built --profiles shared,single,named,hq
```

`--reuse-native` retains the independent reference renders while repeating Final
export and browser readback. It checks the fixture hash before reuse. The
harness checks shipped Python against source and captures an immutable runtime
snapshot with whole-program TypeScript equality. It runs the actual compiler,
Final optimizer, GLTFLoader and production material installer. Source `.blend`
hashes remain unchanged; no installed add-on or real preferences change.

Focused checks:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/tangent_normal_domain_check.py
node packages/blendlink/scripts/run-vitest.mjs packages/blendlink/src/tslTangentNormalMap.test.ts
```

## Measured scope

Blender 4.2.0, 5.2.0 LTS and 5.3.0 EEVEE Metal supply independent native
references. Both actual WebGPU and forced WebGL2 backends of WebGPURenderer run
the shipped programs. Ordinary WebGLRenderer has no live material installer.

Each version publishes 32 actual Final GLBs across shared-owner, single-owner,
explicit named UV and high-quality packed-normal/tangent profiles. Per browser
backend there are 3,528 field/control readbacks for 4.2 and 3,864 each for 5.2 and
5.3: 22,512 readbacks across both backends and all versions. These are shared
family measurements, not distinct node counts. Actual loaded Float32 tangent
xyz, handedness, split normals and UVs must match the native exported data.

The corpus covers negative, zero, fractional and greater-than-one Strength;
HDR/neutral Color; OpenGL and available DirectX conventions; direct Normal and
active Coat Normal slots; Checker/Mix inputs; embedded and external PNG Color;
and Alpha-driven Strength. The frame may use a named edit UV while the image
independently uses a different active-render UV. Owners are shared, parented,
nonuniform, reflected and animated, with one owner moving independently in the
last frame. Both exported coordinate bases, front/back perspectives,
orthographic views and positive nonuniform camera scale are checked.

The fixed 2e-5 camera-raster allowance adds one independent native final
half-float ULP. RGB controls check that output representation separately. The
maximum encoded-RGB error is 0.000491083; no fixture-specific budget is enlarged.
Existing UV Tangent's full three-version/four-profile corpus is rerun after the
shared frame refactor. Linux/OpenGL native certification remains separate.
This proves channel functions and transport, not full BSDF/lighting parity.

Reports are `artifacts/verification-tangent-normal{42,52,53}/results.json` and
their per-profile `browser-report.json` files.

## Native stages and proof boundaries

The frame follows the earned [UV Tangent transport](../tangent-node-differential/README.md).
EEVEE packs tangent and split-normal xyz to SNORM10 or SNORM16, transforms and
normalizes in the vertex stage, then interpolates the raw frame. Normal Map
combines that frame before fragment normalization. XY use raw Strength; Z uses
saturated Strength. Native face and object-reflection signs are modeled
explicitly. Direct material Normal output gets the native world-to-view
conversion. See the native
[normal-map shader](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/material/gpu_shader_material_normal_map.glsl)
and [node setup](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/shader/nodes/node_shader_normal_map.cc).

Source planning and runtime independently derive input ranges from actual
serialized pixels or actual bound decoded images, never claimed blue minima or
caller-supplied bounds. A conservative component interval, packed-frame cone
and live matrix condition certificate reject zero/cancelling or poorly
conditioned blends. Installation and Final audit validate actual primitive
data and pinned image bytes even for a portable Base Color with a live-only
Normal channel. Draw-time checks retain those guards as owners or image data
change. Range inspection is cached by actual geometry/image identity and
version; repeated draws do not scan an unchanged image.

External Color currently needs opaque Non-Color/Raw byte PNG. Alpha may drive
Strength independently. Embedded images currently need byte storage. Image
range inspection is limited to 4,096 squared pixels. Unmeasured float uploads,
associated RGB with partial alpha, Noise and other unknown input ranges refuse
with a named diagnostic. Supported scalar arithmetic and bounded clamped-factor
Mix can compose proved inputs; this is a conservative finite-range contract,
not admission of arbitrary graphs.

**Image pixel fidelity is measured at LOD0 only.** The fixtures intentionally
use small UV spans with distinct edit/render UV offsets. A wider-footprint
experiment exposed native mip bleed that the current level-zero sampler does
not reproduce. PNG decoding and exact Mikk transport do not prove native mip
generation, minification, anisotropic filtering, derivatives or LOD bias.
Those sampler domains need separate ports and evidence. The input-range check
only certifies finite nonzero composition; it is not a sampling-fidelity claim.

Primary geometry restrictions remain: first four bound UV channels, one Mikk
basis per mesh, an unambiguous UV name across material owners, smooth finite
triangles with independently valid normal/tangent cones, no unsupported
modifiers, skins, morphs, generated/GPU instances, animated mesh/UV/node data,
material displacement or Simplify Normals. ORIGINAL/DISPLACED selectors are
preserved; displaced-surface effects remain outside proof. Existing camera,
visibility and live-matrix conditioning guards apply. No broad Cycles Mikk or
ray-dependent claim is added.
