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
associated RGB with partial alpha, unverified Noise models and other unknown
input ranges refuse with a named diagnostic. Supported scalar arithmetic and bounded clamped-factor
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
basis per mesh, an unambiguous UV name across material owners, flat or smooth finite
triangles with independently valid normal/tangent cones, no unsupported
modifiers, skins, morphs, generated/GPU instances, animated mesh/UV/node data,
material displacement or Simplify Normals. ORIGINAL/DISPLACED selectors are
preserved; displaced-surface effects remain outside proof. Existing camera,
visibility and live-matrix conditioning guards apply. No broad Cycles Mikk or
ray-dependent claim is added.

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
The Blender 4.2/5.2/5.3 checkpoint contains 96 Final GLBs and 22,512
readbacks per browser environment. Independent runs record Apple Metal and
local SwiftShader adapters on both APIs. Reports include browser version,
channel and harness hashes; no numerical budget changes. Linux parity also
runs the flat profile. Native fixture settings and authored shading stay intact.

The complete Blender 5.2 baked export test passes with the default flat Gallery
cube, authored normal texture and separated lighting atlas. This preserves the
existing PBR/UV/program-carrier assertions rather than changing the source to
smooth shading. Native minification and unrestricted Cycles frame parity remain
outside the tangent contract.

## Bounded normalized Noise inputs

`--noise` selects a separate native corpus. Use a separate evidence directory
and generate new references when switching that selector:

```sh
BLENDLINK_TANGENT_NORMAL_BLENDER=/path/to/blender \
BLENDLINK_TANGENT_NORMAL_NATIVE="$PWD/artifacts/verification-normal-noise" \
node experiments/tangent-normal-differential/suite.mjs --built --noise --profiles shared,single,named,hq
```

Only the fresh `noise_normalized` capability with the qualified
`native-standard-f32`, `mf-periodic-f32` or `eevee-metal-periodic-f32` Perlin
models is eligible. The old MaterialX-based `noise` documents, other fractals and live
Roughness are separate domains. This extends tangent-space Normal Map inputs;
the earlier literal-only Object/World normal-map routes retain their limits.
Actual Final sidecars from the current producer exercise Metal-periodic in
4.2 and both Metal-periodic and constant-evaluated MF-periodic in 5.2/5.3.
These model names do not widen the Normal Map coordinate domain: the
conservative cutoff below still excludes periodic-boundary sampling.

Signed Perlin gradient and normalization bounds are below three in every
dimension. Nonnegative normalized octave weights and the final half remap
therefore have the conservative range `[-1.01, 2.01]`, including float32
headroom. This is not a claim that normalized Noise stays in `[0,1]`: native
3D and 4D Noise can be negative. Factor may drive Strength without clipping.
Color at low Strength can pass the independent nonzero-normal certificate;
direct full-Strength Color commonly cannot, because its component intervals
can include a cancelling zero vector.

Object/Generated inputs and proved coordinate arithmetic require static Scale
within magnitude one, Detail at most two, and zero Distortion. The actual
coordinate slope times Scale times the positive-amplitude-weighted octave
frequency must not exceed 0.25. Fractional Detail uses the conservative next
endpoint and the base octave when frequency decreases. The real mesh and
exported texspace supply those bounds; a hidden
Vector Scale cannot bypass them. Constant degenerate Generated axes do not
inflate the frequency. The artist setting Scale 0.15, Detail one, Roughness
0.5 has frequency 0.2 with direct Object coordinates. Literal coordinate
inputs separately retain the kernel's static bounds, including measured Scale
80 and Detail six. Every scaled, distorted and color-seeded octave coordinate
must stay below the conservative 90,000 non-periodic cutoff. Native periodic
reduction begins at 100,000; generic coordinate magnitude alone never grants a
live Normal Map frequency domain.

These limits are enforced independently during source planning, actual GLB
publication audit, production installation and draw-time updates. Ranges come
from actual Float32 geometry and decoded image data, and cached attribute
versions invalidate on edits. Focused source and real-GLB regressions prove
rejection and recovery for out-of-range coordinates, higher frequencies,
distortion, unported kernels and cancelling normal inputs.

The wider stress corpus is intentionally unpromoted. Scale 80 Object inputs
and a 4D Color Detail-six/Roughness-one case exceeded the unchanged error
budget; Scale-one/Detail-two stress variants also revealed misses. Native
coordinate-stage probes isolate the differences: Object coordinates use a
world-to-object roundtrip on `g_data.P`, whereas the current browser operation
uses interpolated local positions. Generated ORCO is precomputed before
interpolation, whereas the current browser formula runs in the fragment. On
the retained three-version scenes their native residuals reach 4.2915344e-6
and 1.1920929e-7 respectively, before cross-renderer raster differences.
Exact native coordinate transport and the common Scale-five artist workflow
need further work. No tolerance is enlarged to admit these stress cases.
See the native [coordinate shader](https://github.com/blender/blender/blob/v5.2.0/source/blender/gpu/shaders/material/gpu_shader_material_tex_coord.glsl).

The separate 27-case Noise corpus passes all three native versions and four
Mikk profiles through actual Final export and both browser backends: 96 GLBs,
4,536 field/control readbacks per backend per version, 27,216 total readbacks.
The maximum encoded RGB error is 0.000494361 within the unchanged native
half-float envelope. The actual GLB/sidecar regression also rejects a translated
million-unit primitive despite a claimed coordinate bound. Reports are
`artifacts/verification-normal-noise{42,52,53}/results.json`; failed broader
stress corpora and native stage probes remain separate retained research.
