# Cooperative finite nearest-image Noise fields

Fresh source exports can emit `noise_field_nearest` with profile
`finite-nearest-f32-v1`. Its `kernel` contains the original precise 4D FBM Color
program. Existing serialized `noise`, `noise_fractal`, `noise_normalized`, Math,
and unqualified kernels retain their existing execution paths.

This promotes the pointwise algebra from `../noise-field-kernel`: evaluate the
existing pure Float32 kernel once per immutable input texel, then sample the
result with the original nearest UV/repeat rule. It never reads native output
or GPU pixels to construct a table. Native source and runtime independently
qualify the actual decoded/uploaded sample profile, exact scale/W arithmetic,
alpha one, normal half-representable RGB, bounded seeded octaves below 90,000,
static 4D Color/control/model semantics, and closed metadata sets. HDR/signed
RGB is retained. See the earlier experiment for the complete sampled-domain
contract; source qualification may be narrower, never broader.

The source also certifies an actual direct float data-image (Non-Color/Raw,
Half Precision disabled, straight alpha, native `is_data` role) and the same-image W chain, recording
`sourceSamples: native-float-data-v1` plus the authored `sourceColorSpace`
(Non-Color or Raw). Unknown/future tags refuse. Float Linear Rec.709, color-managed or
indirect group/reroute sources keep their original precise kernel. The IR's
pixel payload alone does not grant this native sampling certificate.

The original IR remains unchanged during preparation and graph building.
Parent range, shape, normal, Roughness, and UV-binding validators still see the
original kernel. Normalize metadata does not establish a unit range. Source
stage classification correctly remains shader evaluation because the input is
an image. A private weak handle registry supplies the prepared image only at
the exact fresh opcode during graph construction.

## Installation and low-level use

`installThreeCompiledScene` / `installTslMaterials` prepare automatically before
material mutation or draw-callback installation. The installation AbortSignal
reaches cooperative preparation; a cancelled attempt retains the old material,
callbacks, and pixels. Equal immutable source programs share actual kernel work
within that attempt. There is no global program/table work cache. Disposal
releases handle references; constructed DataTextures own independent arrays and
remain covered by the normal material resource disposal.

Certification, hashing, interval checks, and kernel evaluation use cooperative
CPU slices (default 4 ms, configurable .25–8 ms). Yielding uses another timer task,
not only a microtask. Cancellation also interrupts a pending application
scheduler. Each table is capped at 16,384 texels / 256 KiB, and one transaction owns
at most 262,144 unique table texels / 4 MiB payload. A cap failure is named, without a
fallback to the unprepared expensive shader. Source documents must remain
immutable until synchronous graph construction is finished. Default sidecar
fetching privately parses its own JSON; custom transports borrow caller data
under that same immutable-input contract. Attempt-owned per-field snapshots
reject observed source mutations during scheduler yields and on lookup,
including changed pixels and future profile tags; caller objects are not frozen
or rewritten.

The synchronous low-level builder deliberately refuses an unprepared fresh
opcode. A caller using the public material-program builder prepares explicitly:

```js
import {
  buildMaterialProgram, createTslBuildResources, prepareTslNoiseFields,
} from 'blendlink/three/tsl-materials'

const preparation = await prepareTslNoiseFields(channels, { signal })
const resources = createTslBuildResources()
try {
  const built = buildMaterialProgram(channels, {
    resources, preparedNoiseFields: preparation,
  })
  // Apply built.nodes to the caller-owned material.
} catch (error) {
  resources.dispose()
  throw error
} finally {
  preparation.dispose()
}
// Dispose resources when the caller-owned material is released.
```

The actual compiled-material Ready/Blocked preflight also prepares, then calls
the real synchronous builder on actual primitive bindings. It does not grant
support from an opcode allowlist. Its optional final argument accepts `{signal}`.

## Repeating proof

Build first, then run the normal native runner with **no experimental overlay**:

```sh
BLENDLINK_BLENDER=/absolute/path/to/Blender \
BLENDLINK_NOISE_ENGINE=EEVEE \
BLENDLINK_NOISE_FIELD_FOCUS=1 \
BLENDLINK_NOISE_FIELD_TABLE_CONTROLS=1 \
BLENDLINK_NOISE_EVIDENCE=/absolute/evidence/52-raw \
npm exec --yes --package=node@24 -- node experiments/noise-fractal-differential/run.mjs --built
```

Repeat for 4.2 / 5.2 / 5.3, add `BLENDLINK_NOISE_NORMALIZED=1` for normalized, and
`BLENDLINK_NOISE_FIELD_CAP=1 BLENDLINK_NOISE_REFERENCE_SIZE=128` for full cap.
The cap retains HDR and odd-size negative/positive repeated-UV fields plus
independent input/carrier controls. Per-backend cap assertions require an actual
16,384-unique-point / 262,144-byte table. Reports distinguish production preparation
statistics from the optional historical overlay. Mixing a fresh production
profile with the experimental flag refuses rather than mislabeling the proof.

```sh
node experiments/noise-field-production/run.mjs /absolute/52-cap-raw/reference /absolute/ownership-evidence
node experiments/noise-field-production/compare-legacy.mjs /absolute/4209e1b-checkout /absolute/retained-old/raw/reference /absolute/legacy-evidence
```

The lifecycle proof uses the actual high-level material installer and observes
RAF rendering while preparation is pending, old pixels after cancellation,
changed source payloads, repeated installation, callback restoration, texture
counts, and resize. Its direct installed-program readback omits lighting so the
lifecycle test does not invent an extra native shading error budget. Numeric
native fidelity remains the independent native corpus. The legacy comparison
covers old opcodes, a formerly eligible precise field without the new profile,
rejected fresh shapes, and old Math including negative zero, bit for bit on both
APIs with LLVM and physical Metal profiles. No native-pixel claim is made by the
before/after compatibility comparison.

## Evidence and limits

Promotion prerequisite is actual hosted Linux SwiftShader Subzero, not the
local LLVM implementation:

- Run 43342259860 / artifact 14000292142: raw 22 / normalized 12 experimental readbacks,
  zero numerical or execution failures; raw 10 / normalized 6 lowered rows.
- Run 43346907140 / artifact 14002516547: raw 18 / normalized 18 full-cap, HDR and repeated
  UV readbacks, both APIs; all 9 native cases/API complete with zero failures.
  Each cap has 16,384 unique points and 262,144 bytes. WebGL2 reports
  `SwiftShader Device (Subzero)`; WebGPU reports Google's SwiftShader architecture.
  These are the retained synchronous experiment prerequisites, not claims that
  the promoted async plumbing has already run on that hosted driver.

Local worker evidence under `artifacts/verification-field-production/`:

- Fresh native source→built default runtime:4.2 / 5.2 / 5.3, 120 native graphs and
  240 readbacks, including full cap/HDR/UV controls. Original numeric budgets
  remain unchanged. Native build hashes a51f293548ad/fbe6228777e7/02f0899d78e3.
- Longest measured cooperative slice across the final `verified-*` corpus: 5.5 ms,
  including source-lease revalidation. The former synchronous experiment took 549–568 ms on hosted Subzero.
- `immutable-ownership`:14 high-level lifecycle rows across both APIs. Full-cap
  preparation rendered 63–70 RAF frames; largest frame gap 16.8 ms, no browser long
  tasks, maximum measured CPU slice 5.5 ms. Cancellation completed in about 21 ms
  without clone callbacks or changed pixels. First installed readback took
  1.08–1.23 seconds while frames continued. That total includes yielding, validation,
  ordinary material binding and first GPU compilation; the UI remains live.
- `release-legacy`: 720,896 Float32 words match the pre-promotion runtime exactly.

This is a bounded optimization for the certified immutable nearest-image family,
not a generic Noise driver fix, support for arbitrary UV/working-space inputs,
or a wider shader-kernel accuracy claim. New async production hosted-default
canaries must remain part of integration verification.
