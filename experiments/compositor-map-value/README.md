# Legacy compositor Map Value

This is a version-scoped partial live port of `CompositorNodeMapValue`, through
fresh `map-value` / `native-legacy-map-value-f32-v1` documents. Actual factory
creation succeeds in root/group contexts in Blender 4.2.0 and fails in both
contexts in Blender 5.2.0 and 5.3.0. Modern Map Range remains a separate node and
implementation; no compatibility node is invented.

Primary native sources, revisions, URLs and SHA256 hashes are pinned in
[sources.json](sources.json). Actual schemas and property ranges can be probed
with [probe_native.py](probe_native.py), setting `BLENDLINK_MAP_VALUE_PROBE` to
an output file. Offset, Size, Min and Max are **one-element scalar arrays**,
with native RNA range [-1000,1000].

## Qualified behavior

- Offset is added **before** Size multiplies. Minimum condition executes first,
  Maximum second, using strict comparisons. With both enabled and reversed
  bounds, Maximum wins. They are not replaced with a sorted `clamp` operation.
- Fixed controls support the native [-1000,1000] range, finite normal Float32
  values and zero. Subnormal controls are named limitations. Inactive Min/Max
  fields are not evaluated or changed; their published values are null.
- Signed/HDR fixed scalar values, negative/zero Size, signed-zero controls,
  supported authored bounded fields, group defaults, differently configured cascades
  and Map Value into Set Alpha are included. There is no added unit clamp.
- Blender 4.2 source CPU compositing is qualified. Source GPU compositing is
  currently qualified on Metal. Both browser APIs are tested independently of
  the native source device. Unknown source profiles refuse with an artist-node
  diagnostic.

Legacy implicit color/vector-to-scalar conversion uses the **mean** of three
components, not luminance. This port handles that conversion at its own input
boundary, without changing the old generic conversion behavior or serialized
programs. Native CPU performs a left-associated Float32 sum then correctly
rounded division by three. A small integer significand quotient/remainder
kernel retains that rounding in both browser APIs. Native Metal GPU instead
multiplies the staged sum by Float32(1/3).

GPU implicit averaging currently requires Offset zero. Native Metal fuses a
nonzero Offset with averaging; the unfused browser stages differ by one Float32
ULP in the retained counterexamples. Those configurations are refused, with
explicit channel separation or CPU source compositing as alternatives. No alpha
tolerance was widened. GPU scalar inputs retain nonzero Offset support.

Known unqualified legacy implicit color/vector-to-scalar conversions farther
upstream also refuse, within a bounded 256-input dependency audit. A new Map
Value independently validates its own boundary. The source guard and runtime
check inspect actual input descriptors and dependencies, not an annotation
claiming their conversion is safe. The current generic compositor and image
canvas restrictions remain independent requirements; this port does not opt
into fixed-Image RTT caching or certify new spatial vector producers.

## Proof and reproduction

```sh
npm exec --yes --package=node@24 -- npm run build
BLENDLINK_COMPOSITOR_MAP_VALUE_REFERENCES=/absolute/native-directory \
BLENDLINK_COMPOSITOR_MAP_VALUE_DEVICE=CPU \
/path/to/Blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/compositor_map_value_check.py
```

Repeat with source device GPU on the qualified native backend. The default
success sentinel is `BLENDLINK_COMPOSITOR_MAP_VALUE_PASSED`. Without an output
environment variable, the fixture uses temporary files. It fingerprints source
properties, custom data, defaults, links and groups before/after extraction,
and verifies extraction from a real copied add-on package namespace.

A modern native process emits the same success sentinel with explicit
`qualification.json` status `native-node-absent`, `nativeApplicable:false`,
`cases:0`, an empty index and actual root/group creation diagnostics. This is
verified absence, never a numerical Map Value family completion.

An unqualified GPU source backend emits
`BLENDLINK_COMPOSITOR_MAP_VALUE_SOURCE_PROFILE_REFUSED` and qualification status
`source-profile-refused`, protocol `blendlink-map-value-gpu-source-profile-v1`,
`cases:0`, `numericalMapValueCases:0`, `controlCases:1`, actual source backend and
hashed `profileRefusals`. Only its independent control enters the browser index.
Refusal files contain actual native pixels and production diagnostics; they are
excluded from qualified numerical case counts.

```sh
BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
npm exec --yes --package=node@24 -- node \
  experiments/native-compositor-differential/run.mjs --built \
  --out /absolute/browser-directory \
  /absolute/native-cpu-directory /absolute/native-gpu-directory
```

For explicit Chromium SwiftShader, additionally set
`BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'`.
The harness records actual adapters, copies immutable compiled modules, and
checks whole-program TypeScript/source equality before both API readbacks.

The accepted native corpus has 82 CPU graphs and 62 Metal GPU graphs. Twenty
GPU implicit-mean/nonzero-Offset configurations and an upstream implicit
conversion per device are retained as source-preserved, native-rendered named
refusals. The field includes signed/HDR RGB/alpha, limit ties, large scalar
values, fractional/negative/zero controls, all four Min/Max flag combinations,
reversed/collapsed limits, means, scalar/vector inputs, groups and cascades.
Accepted Set Alpha cases require exact alpha, in addition to the unchanged
2e-5 numerical error budget. Actual native schema/absence and numerical reports
remain under `artifacts/map-value/`; generated references are not committed.

The superseding normal-domain qualification passed all 144 explicitly bounded
accepted native graphs on each actual
Apple Metal WebGL2, Apple Metal WebGPU, LLVM SwiftShader WebGL2 and LLVM
SwiftShader WebGPU profile: 576 readbacks, zero maximum numerical error, exact
alpha, and no shader/page/console errors. The aggregate
`artifacts/map-value/domain-qualification-summary.json` checks native fixture/helper
hashes against current source and every retained refusal file against its pin;
all match. The full worker suite passed 1,400 unit tests (five unrelated skips)
and 29 release-policy tests.

## Finite normal-or-zero certification

The initial raw-field corpus is retained as unpromoted evidence. It is superseded
by `domain-final-*` native captures and `domain-browser-*` built readbacks. A
real native CPU counterexample maps scalar 1e-40 with default controls, then
applies alpha to finite RGB 1e38: native RGB is 0.0099999458 while both browser
APIs produce 0. Size 1000 amplifies the error to 9.9999456. Normal input 1e-20
with normal Size 1e-20 likewise underflows before later HDR amplification. These
are not acceptable merely because the unamplified error is small.

The fresh `finite-normal-or-zero-v1` certificate is derived independently from
actual executable input descriptors in Python and TypeScript. Fixed literal,
Value and group defaults must retain finite normal-or-zero input, mean stages,
addition and multiplication. Unknown Render Layers fields are refused.

The useful dynamic lane recognizes authored upstream Math Maximum/Minimum
bounds, including separately bounded RGB channels before a mean, and verified
ancestor Map Value outputs with the same source evaluation device. An interval
must be finite and wholly away from zero by at least 2^-120, or identically zero.
The added and multiplied intervals must also be normal-or-zero. If the sum can
cross zero, normal operands near magnitude>=2^-50 leave zero or a conservative
Float32 quantum>=2^-77; requiring |Size|>=2^-40 keeps a nonzero product above
2^-117. A stronger interval lower bound can qualify smaller Size values without
using that cancellation route. Endpoint bounds also reject intermediate
overflow, even if final Min/Max might hide it. Active final limits remain
normal-or-zero. No certificate is trusted without independent rederivation.

The fixture authors explicit upstream bounds [.25,16] for its dynamic fields;
the compiler never inserts those nodes or changes the artist graph. Fixed vector
means use real group defaults rather than assuming Normal-node pixel precision.
Raw-field, underflow, overflow, mixed-device ancestry and forged certificates
have focused regressions. The actual amplified normal-input underflow is
retained as a native-rendered named refusal per source device. Default Map Value
with its unlinked Value input remains supported; raw connected fields need
proved upstream bounds or source evaluation.
