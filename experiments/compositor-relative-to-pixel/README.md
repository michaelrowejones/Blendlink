# Relative To Pixel: bounded scalar image-size references

This is a partial Blender 5.3 compositor port, separate from the float2/int2
Image Coordinates family. Its compact proof is [evidence.json](evidence.json),
verified against machine-local raw artifacts by [verify.mjs](verify.mjs).

The measured native source is Blender 5.3.0 build `02f0899d78e3` on macOS arm64.
`FLOAT` with `X`, `Y`, `Greater` and `Smaller` reference dimensions supports
exact Float32 literal, Value and group-default coefficients that are positive
zero or normal, with magnitude at most 65536. The Image reference must resolve
to a direct, untransformed Render Layers Image. Static/computed/transformed
references, render borders, non-square pixels, vector/per-dimension/diagonal
modes and other native profiles remain unqualified. Animation/drivers continue
to refuse through the shared extractor.

Image is a domain-only dependency: it supplies reference dimensions but does
not make the output an image field. The extractor keeps only the numerical
Value in `inputs`; the validated Image reference is transported separately.
This preserves native single-value evaluation and downstream domain behavior.
The runtime independently rederives the reference and Value producer from the
bounded topological program, uses the live texture dimensions, and preserves
the original scalar output. It allocates no port-owned textures or RTTs and
performs no per-frame readback. This is structural cost evidence, not an FPS
measurement.

The native operation uses CPU single-value evaluation even when the authored
compositor device is GPU. The current proof covers 32 nonsquare 13x9 native
graphs per source-device setting, including nonbinary factors, smallest normal
values and signed bounds. Four nested-group scenes per setting are saved and
published through the actual built Final exporter. Raw and Final browser phases
run both actual WebGPU and WebGL2 on Apple Metal and SwiftShader. Native pixel,
program, source, compiled exporter, runtime snapshot and actual Final asset pins
are retained; missing-API fallback and malformed models/reference/input domains
refuse independently.

## Precision and resource boundaries

A real negative-zero probe produced native RGB word `80000000` and WebGPU word
`00000000` at all 117 pixels (351 RGB words). This is retained in
[negative-zero-evidence.json](negative-zero-evidence.json). The extractor and
runtime explicitly refuse negative-zero coefficients; no tolerance or expected
pixel rewrite conceals this boundary.

Rendering an actual PBR scene creates Three's renderer-owned 16x16 `DFG_LUT`
lookup texture. A zero-total-textures assertion therefore confused this cache
with port ownership. The Final fixture first renders the same actual GLB scene
without the compositor, recording the actual cache texture identities. Three
apply/dispose cycles must restore exactly that identity set, preserve source
materials/callbacks, and leave zero additional textures and zero render targets.
There is no arbitrary residual-count allowance or manual disposal of the
renderer-owned lookup. Raw cases return to zero total textures.

Image Coordinates exposes native float2/int2 sockets. The existing public IR
uses VECTOR for float3, so treating those outputs as vec3 would silently change
conversion semantics (for example scalar averaging divides by two rather than
three). That shared typed-width foundation remains separate work; scalar
Relative To Pixel does not weaken it or claim those vector outputs.

## Reproduce

Coordinate one stable build before capture; avoid concurrent semantic edits.
Use Node 24 and the exact measured Blender executable.

```sh
npm run build
node experiments/compositor-relative-to-pixel/capture.mjs CPU
node experiments/compositor-relative-to-pixel/capture.mjs GPU
```

The capture launcher creates a fresh Python cache prefix before every native
Python action, including nested Final exporter calls. It records actual binary
identity and per-invocation guard/cleanup receipts, without deleting user caches.

For each CPU/GPU reference directory, run both browser phases, then repeat on
SwiftShader with the corresponding launch flags:

```sh
BLENDLINK_RELATIVE_TO_PIXEL_REFERENCES="$PWD/artifacts/verification-relative-to-pixel/cpu" \
BLENDLINK_TEST_PROFILE=metal BLENDLINK_TEST_CHROMIUM_CHANNEL=chromium \
BLENDLINK_TEST_CHROMIUM_ARGS='[]' \
  node experiments/compositor-relative-to-pixel/run.mjs --built
# Repeat with --final, then the gpu directory.

BLENDLINK_RELATIVE_TO_PIXEL_REFERENCES="$PWD/artifacts/verification-relative-to-pixel/cpu" \
BLENDLINK_TEST_PROFILE=software \
BLENDLINK_TEST_CHROMIUM_ARGS='["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]' \
  node experiments/compositor-relative-to-pixel/run.mjs --built
# Repeat with --final, then the gpu directory. Unset BLENDLINK_TEST_CHROMIUM_CHANNEL.

node --test experiments/compositor-relative-to-pixel/protocol.test.mjs
node experiments/compositor-relative-to-pixel/verify.mjs \
  artifacts/verification-relative-to-pixel \
  experiments/compositor-relative-to-pixel/evidence.json
```

Raw native pixels, saved scenes, Final bundles and frozen runtime snapshots stay
under the ignored `artifacts/verification-relative-to-pixel/` directory. The
tracked compact receipt is not a substitute for regenerating numerical proofs
when semantic inputs change.
