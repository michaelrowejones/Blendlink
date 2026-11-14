# Gabor next-port feasibility — research only

This timeboxed source review adds **zero implemented nodes, native numerical
cases, browser draws, saved Final exports or scene acceptance**. No SDK,
fixture, licensing policy or coverage record changes accompany it. Primary
source identities and the CPU-only frontend observation are in [sources.json](sources.json).
All upstream references use Blender5.3.0 build02f0899d78e3, revision
02f0899d78e374b63e7181d9061e1f7ab03419cc.

## Native scope and dependencies

The native node has 2D/3D modes, scalar Value/Phase/Intensity outputs, Vector,
Scale/Frequency/Anisotropy and separate scalar2D/vector3D Orientation sockets.
2D ignores Vector.Z. Shader default coordinates pass through native texture
mapping; compositor defaults use Uniform image coordinates. MF implementation
is in `blenlib/intern/noise.cc`, separate from EEVEE's BSL kernel.

The BSL path uses nine neighboring cells in2D or27in3D, with eight impulses
per cell:72 or216 candidate evaluations per sample. A unit-radius test can
skip each kernel. It uses cosine/sine/exp, dot/length and Jenkins Float32-bit
hashes, plus orientation normalization/acos in3D and atan for Phase.
Frequency is clamped to at least.001 and Anisotropy to[0,1]. There is no octave,
texture lookup or unbounded density loop in this source.

Dependencies are `gpu_shader_common_hash.bsl.hh`, math constants and vector
helpers. Existing `tslNodeRecipe.ts` already contains Jenkins uint rotations,
float-bit hashing and uint-to-unit-float conversion used by White Noise.
Reuse is a candidate, not inherited qualification: verify exact seed packing,
3D hash swizzle `(xyz,zxy)`, integer wrap/shift semantics and conversion words.
Voronoi's integer PCG primitive is a different hash and is not a replacement.

## Licensing boundary

Gabor's GPU kernel, node wrapper and included GPU helpers carry
**GPL-2.0-or-later** headers. The CPU noise translation unit records
**GPL-2.0-or-later AND BSD-3-Clause**. This differs from Radial's Apache-2.0
shared source. A mechanical Gabor derivative cannot quietly be labelled as the
MIT runtime. Any later implementation needs reviewed compatible implementation
and provenance under the repository's existing mixed-license policy; this
research changes no policy and ships no derived runtime kernel.

## What the current transpiler actually establishes

The CPU-only probe adapts aliases/macros and references, then runs the installed
Three r184 GLSLDecoder/TSLEncoder. Loops and Continue are recognized. This is
not dependency resolution, actual shader compilation or numerical evidence.

The complete source should contain ten functions. The combined-module probe
emits only nine returning helpers, loses `node_tex_gabor`, and appends a stray
`phasor.div( normalization_factor );` statement. **The isolated void/out wrapper
parses correctly.** The subsequent independent source census locates the retained
BSL `[[node]]` annotation before that wrapper. The old alias-only adapter did
not remove it, so its input was not fully adapted GLSL. Explicitly removing
that one declaration annotation produces ten native and ten decoded functions.
This corrects the earlier suspected traversal cause; generic void/out syntax
was not the problem. Calling parse/emit success a faithful translation would
have missed the incomplete BSL-to-GLSL ABI adaptation. Function census success
still earns no numerical, dependency-closure or material credit.

The source-only `scripts/lib/glsl-source-census.mjs` gate now checks exact
native-to-AST function signatures and top-level declarations before codegen.
It rejects missing/extra functions and unexpected top-level executable statements.
Function-body loop bounds and control-flow inventory remain separate future
checks. Keep the existing mutable-local materialization pass for accumulators
and separately prove Continue behavior and nested-loop counts. Radial's current
exhaustive-tail adapter refuses non-tail early returns, which the3D orientation
helper contains. Include/attribute/reference adaptation, overload/dependency
closure and single-output lowering of the three out parameters are additional
frontend tasks; do not silently hand-edit arithmetic to make them compile.

## One useful bounded candidate

Prioritize **2D, Anisotropy1, Value and Intensity**, fixed frequency/orientation
controls and a live Vector field whose producer contract is independently
measured. This is the native default directional branch, with a fixed72-candidate
ceiling, and avoids Phase's wrap/cancellation and3D orientation singularities.
Proposed first domains are finite storedFloat32 XY[-2,2], Scale[.25,8],
Frequency[.001,8] and fixed Orientation0 initially. These are research bounds,
not admitted inputs. Preserve authored values: no artist quantization or
baking a sampled lookup into a live claim. Exact nearest Float32 data-image
inputs are a practical first calibrated field; default Position/UV transport
requires its own producer proof before claiming ordinary scene coverage.

Before implementation, derive a finite absolute error bound for the selected
sum and field producer, predeclare it plus a practical absolute ceiling, and
retain exact hash/seed controls. Do not promise exact final transcendental
words or a universal ULP bound near cancellation. A promising mathematical
property to check is that the Hann window vanishes smoothly at its support
boundary, so unit-radius continue disagreement may have a bounded effect;
this is an inference to prove, not permission to relax a failed gate.

## Required proof and stop conditions

1. Close dependencies/census on CPU first. Calibrate the existing direct
   RGBA32F native oracle; compare hash bits and raw phasor/value/intensity
   against both actual browser APIs/profiles, preserving source/compiler pins.
   Label the Python-GLSL-adapted kernel stage explicitly; it is not EEVEE film.
2. Capture actual EEVEE materials with the untouched Gabor node and calibrated
   inputs. Preserve signed/HDR output using an independently verified carrier;
   EEVEE half storage must not become a loose output tolerance. Treat MF
   compositor evaluation as a separate later source stage.
3. Require real saved Final graphs, actual runtime lowering, resize/DPR,
   cancellation, ownership restoration and resource teardown. Check repeated
   positive/negative cells, cell/support neighbors, parameter endpoints and
   finite controls. Unsupported derivatives/Phase/3D/default producers refuse.
4. Benchmark actual generated shaders: bounded nested loops instead of72-fold
   source duplication, <=512KiB shader size, no port-owned textures/targets,
   and completed-draw cost at multiple resolutions against a plain-material
   control. Texture inputs remain caller-owned. Record GPU/driver and timing
   distributions; loop arithmetic counts are not performance evidence.

First implement only the census/dependency prerequisite, then permit one bounded
numeric pilot. If hash/input calibration or the first transcendental comparison
fails beyond the predeclared gate, retain the failure and move to a reusable
primitive. Do not repeat broad precision tuning or attempt full3D/Phase first.
No reliable full-port completion estimate exists before this frontend gate.
