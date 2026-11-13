# Squeeze Value: bounded EEVEE live translation

The fresh `squeeze_native` model ports a narrow static input domain of the
legacy shader node. Native viability research is retained separately below. This
is partial node support; it does not admit arbitrary linked input graphs.

Actual Blender 4.2.0/5.2.0/5.3.0 shader trees accept and connect the node. The
three scalar inputs are `Value=0`, `Width=1`, `Center=0`; the single output is
`Value`. All are enabled. Modern RNA calls it **Squeeze Value (Legacy)** and
**Deprecated**, but native EEVEE evaluates it. The node is omitted from link
search and has no multi-function evaluator; those facts do not make its GPU
function unusable.

The six primary source files, revisions and SHA256 hashes are pinned in
[sources.json](sources.json). All three versions implement the same GPU
function: a logistic using the Float32 literal `2.71828183`, Float32
subtraction/multiplication and native `pow`. Do not replace that base/staging
with an ideal double-precision exponential and call it exact native parity.

## Observed native domain

Nine ordinary graphs/version exercise default, positive/negative Value,
zero/negative Width, Center translation, two saturation corners, and a nearest
Non-Color float image driving all three inputs independently. The varying image
spans Value `[-8,7.984375]`, Width `[-2,1.99609375]`, Center
`[-.5,.4990234375]`, with alpha 1. Those linked image values are actual native
inputs; no unit UV range or generic graph bounds are inferred from them.

All three versions render the expected meaningful response: default and
zero-width give 0.5; Value 1 gives approximately 0.731; Value -1 and the negative-Width
case give approximately 0.269. The two tested large corners saturate to 0/1.
These finite samples do not prove arbitrary float/overflow/NaN domains.

The ordinary scene-color carrier is lossy: Value -1 returns 0.268798828125,
whereas its raw function is approximately 0.2689414. A direct comparison with
ideal nearest-half values can differ by 0.00048828125 in this corpus. That is
not a reason to widen the 2e-5 kernel budget.

The packed follow-up has 15 graphs/version, adding near-center cancellation, a
tiny positive Width, three independent digit-field calibrations and an
endpoint-one control. It encodes three base-256 digits with native power-of-two
multiplies, `FRACT`, `FLOOR` and division by 256. Every resulting `k/256`
component survives the scene carrier exactly. Decoding gives a raw interval of
width at most 2^-24; all 256 values of each digit position and the endpoint-one
control reconstruct exactly. Across all three versions the maximum distance
between that interval and an independently staged Float32 equation is
1.1920928955078125e-7. The near-center case differs by one Float32 step from
that staged equation, so this is not a bit-exact analytic-transcendental claim.
That research measurement is separate from the qualified literal-coordinate
browser corpus described below.

Source node defaults, links and image samples are checked unchanged around each
render. JSON records actual controls/version/build/engine, per-file pixel hashes
and the probe hash. `preferredBackend` is only a Blender preference; this
research does not relabel it as an actual GPU-platform attestation.

## Engine fallback counterexample

The default connected `Squeeze -> Emission Color -> ALL Material Output` graph
renders `[.5,.5,.5,1]` in EEVEE, while actual Cycles 4.2/5.2/5.3 returns
`[1,1,1,1]`. The unsupported Cycles node link appears to be ignored in favor of
the Emission socket default. Matching output-root identity therefore cannot
prove an automatic EEVEE-to-Cycles bake equivalent. The producer adds Squeeze to
the engine-sensitive fallback guard. This corpus grants no Cycles live support
or BSDF/lighting equivalence.

## Reproduce

Use a fresh process and isolated Blender preferences for each supported binary:

```sh
BLENDLINK_SQUEEZE_PROBE=/tmp/squeeze/schema.json \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/squeeze-node-differential/schema_probe.py

BLENDLINK_SQUEEZE_REFERENCES=/tmp/squeeze/ordinary \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/squeeze-node-differential/native_probe.py

BLENDLINK_SQUEEZE_PACKED=1 BLENDLINK_SQUEEZE_REFERENCES=/tmp/squeeze/packed \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/squeeze-node-differential/native_probe.py

BLENDLINK_SQUEEZE_CYCLES=/tmp/squeeze/cycles.json \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/squeeze-node-differential/cycles_probe.py
```

Local retained evidence is under `artifacts/squeeze/{native,packed}{42,52,53}`;
process logs are `/tmp/blendlink-squeeze-{native,packed}{42,52,53}.log`.

## Qualified production domain

The producer requires actual Blender 5.2.0 or 5.3.0, macOS arm64 and an actual
`gpu.platform.backend_type_get()` result of `METAL`. A requested preference or
platform name cannot attest a GPU backend. Blender 4.2 background export cannot
make the required platform query and emits a closed `SOURCE_ATTESTATION_NA`
receipt with zero production cases. Other versions/platforms/backends refuse;
native research remains available independently. Browser rendering is qualified
on both Apple Metal and SwiftShader using WebGPU and WebGL2 through
`WebGPURenderer`. Ordinary `WebGLRenderer` does not install live programs.

Each Value/Width/Center may be an exact Float32 literal, a previously qualified
Squeeze result, or a direct RGB channel of a pinned embedded nearest image.
Image coordinates must themselves be literal `const_vec3` or three literal
Combine XYZ components. UV, Generated, Object, animated or other spatial
coordinates remain refused: CPU position/UV arrays do not prove prior GPU
storage history. The earlier spatial 14-case experiments under
`artifacts/squeeze/production{52,53}` are explicitly marked research, not
production admission.

Images require actual opaque Float32 pixels, Non-Color data processing, Half
Precision off, straight alpha 1, flat projection and Closest interpolation.
FILE/GENERATED images and REPEAT/EXTEND/CLIP are the qualified source shapes.
The packed EXR fixture is saved/reloaded and its decoded Float32 bytes verified
before export. Other color spaces, alpha association, external texture refs,
filtering and unknown processing refuse. Modern default OCIO has no `Raw` image
color-space entry; scene view `Raw` is a separate oracle setting.

Source and runtime independently recompute bounds from actual literals/pixels.
All scalar inputs, coordinate components and pixel components must be finite
exact Float32 numbers of magnitude at most 16. The conservatively staged Float32
maximum of `abs((Value-Center)*Width)` must not exceed 24. CLIP adds 0 to pixel
bounds. No asserted interval or unit-range annotation grants admission. Each
image is capped at 1024 pixels before native pixel access; total native
preflight is capped at 64 unique nodes and 12288 pixel values. Each expression
validation is capped at 64 structural visits, depth 8 and 12288 pixel values.
Runtime validation precedes child texture allocation. The function retains
Blender's Float32 base/pow staging; it is not an ideal exponential replacement.
The existing generic animation and material-context guards still apply.

## Native, built and actual Final proof

`reference.py` creates 26 admitted native scenes per qualified source version:
25 Squeeze scenes plus one independent image/digit calibration. Defaults, signed
inputs, negative/zero Width, Center, actual data-image channels, groups,
cascades, multiple differently controlled instances and literal coordinate/wrap
modes are included. Nine admitted stresses add Width 16 / Center .5 at
`nextafter(.5,-infinity)`, exact .5 and `nextafter(.5,+infinity)`, for depths
2..4. The existing depth 8 validation walk permits at most four nested Squeeze
nodes; depths 5..8 are source refusals, with all 12 native stress
renders/version retained as refused evidence. Three-channel instance measurement
needs three packed renders, so there are 28 admitted packed raw files/version.
The caller's saved blend, node links, defaults and source image bytes remain
unchanged around measurement/export. Native IR, source blends, reference pixels
and source/helper hashes are pinned.

The actual Final path exports 52 GLBs in total (50 Squeeze and 2 controls),
checks full compiler audits, published manifest/GLB/program digests, real
GLTFLoader material bindings and exact shipped embedded image bytes, then
installs the production material program on the actual loaded mesh. It reads the
installed channel function, rather than claiming full Blender lighting/BSDF
parity. Across raw and Final paths, two source versions and four recorded
browser adapter/API combinations, 416 case runs compare 1277952 RGB components.
Maximum distance outside the native raw interval of width 2^-24 is 0; maximum
distance to its lower bound is 2.9802322387695312e-8. All admitted steep stress
cases match the native packed lower endpoint exactly on all four adapter/API
combinations. The 2e-5 kernel budget is unchanged.

The corpus also includes actual Roughness-only Squeeze programs (literal and
nearest-image input) with portable nonwhite Base Color and constant Metallic.
The stock exported/loaded Roughness carrier is 1, while Value 1 / Width 1 /
Center 0 requires approximately .731. A portable base color cannot establish
that this other channel survived. Fresh exports stamp an exact versioned
`blendlink_tsl_runtime.requiresNodeRenderer` marker on the actual mesh. The
legacy renderer checks a matched Squeeze program and refuses by name, even with
portable Base Color. The ordinary unmarked portable/older-IR no-fetch behavior
remains unchanged. CPU Final preflight independently builds every
Squeeze-bearing channel on every actual binding and rejects missing markers,
unlit incompatible carriers, bad source profiles, unknown attributes and invalid
image inputs. The actual Roughness-only exports exercise forged profile and
removed-marker negatives with otherwise valid publication pins. The browser
reads the installed `roughnessNode`, rather than substituting the base-color
function; the actual legacy refusal is checked before installation.

All published-program bad pins are refused before swapping material/callbacks.
Forged overflow and changed-image-pixel controls refuse before allocating a
texture. Repeated frames, disposal and reinstall preserve exact pixels, restore
original material/callback ownership and leave zero owned textures. Each WebGPU
request acquires an actual adapter/device and asserts the renderer backend. A
real null-adapter negative control must refuse; two WebGL2 rows cannot count as
two API qualifications. Both adapters are recorded, rather than inferred from
launch flags.

At the full 1024-pixel / 12288-value validation limit, 30 browser iterations per
adapter/API/path measured median 0.10 ms and maximum 0.50 ms on this host.
Native source validation 20-iteration medians were 1.981 ms / 2.068 ms for
5.2/5.3, maximum 2.111 ms; warm full IR emission maximum 5.371 ms. These are
validation-work measurements, not total preview or GPU compile/upload timings.
The explicit caps prevent a large embedded image from entering this new
synchronous walk.

Fresh receipts are `artifacts/squeeze/carrier{52,53}/references.json`,
`final-proof.json`, `browser-{raw,final}-{metal,software}.json` and
`suite-{metal,software}.json`. The 4.2 zero-case receipt is
`artifacts/squeeze/carrier42/not-applicable.json`. Raw spatial failure/history
and all 3 Cycles counterexamples remain retained separately.

## Reproduce the production boundary

Build this isolated checkout once. Run from the repository root with an actual
qualified Blender binary; the suite runs policy, native source, copied add-on
package, actual Final export and both requested browser APIs:

```sh
npm exec --yes --package=node@24 -- npm run build --workspace blendlink
BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
  BLENDLINK_TEST_CHROMIUM_ARGS='[]' \
  npm exec --yes --package=node@24 -- node \
  experiments/squeeze-node-differential/suite.mjs --built \
  --blender "$BLENDLINK_BLENDER" --output /tmp/squeeze-live

BLENDLINK_TEST_PROFILE=software \
  BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  npm exec --yes --package=node@24 -- node \
  experiments/squeeze-node-differential/suite.mjs --built --reuse-native \
  --blender "$BLENDLINK_BLENDER" --output /tmp/squeeze-live
```

`--reuse-native` requires the already generated current source/IR/native/export
pins; it only avoids repeating native work for the second browser environment. A
4.2 or other unqualified source run returns a strict named N/A packet with no
browser rows and no numeric pass count. Direct native source generation uses
`BLENDLINK_SQUEEZE_REFERENCES`; the focused native test success sentinel is
`BLENDLINK_SQUEEZE_TRANSLATION_PASSED`, the suite success sentinel is
`BLENDLINK_SQUEEZE_SUITE_PASSED`, and source N/A uses
`BLENDLINK_SQUEEZE_SUITE_SOURCE_ATTESTATION_NA`.
