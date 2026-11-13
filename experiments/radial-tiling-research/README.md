# Radial Tiling: native viability research

**Research only.** This native-capture phase contains no Blendlink emitter,
opcode, SDK runtime kernel, capability promotion or Final-site proof. The
subsequent private browser kernel trial is documented in [TRIAL.md](TRIAL.md)
with its separate exclusions and evidence roles. Existing serialized documents
and the main workspace are unchanged. This starts from
`509a58eecba6ba59ca45685ae71b6c0570755241`.

## Native scope and primary sources

`sources.json` pins upstream 5.2.0/5.3.0 registration, GPU wrapper/shared
algorithm, native MF wrapper and Cycles SVM files by URL and SHA256. The shared
algorithm is Apache-2.0; the node-registration and GPU-wrapper files have their
own upstream license headers. The GPU shared algorithm is byte-identical in
both source tags. CPU/MF additionally enables specialized geometry branches;
this is not proof that all evaluated stages round alike.

Actual native schema/create/save/reload probes find the node in shader,
geometry and compositor trees in **5.2.0 and 5.3.0**. Actual 4.2.0 creation fails
in all three contexts. Inputs are a **two-component Vector** (default zero),
Sides (default 5), and Roundness (default 0); outputs are Segment Coordinates
(three components), Segment ID, Segment Width and Segment Rotation. Normalize
defaults false. The upstream CPU/GPU functions lower-bound Sides at 2 and clamp
Roundness to 0..1. Do not infer their admitted domain from UI ranges: direct RNA
assignments preserve tested negative/out-of-range values before evaluation.

Only these actual local builds/devices were measured:

| Version | Native build | Machine/evaluation |
| --- | --- | --- |
| 4.2.0 | `a51f293548ad` | Darwin arm64, schema/absence only |
| 5.2.0 | `fbe6228777e7` | Darwin arm64; MF, Cycles CPU, EEVEE Metal |
| 5.3.0 | `02f0899d78e3` | Darwin arm64; MF, Cycles CPU, EEVEE Metal |

The EEVEE profile is actual `gpu.platform`: Apple M5 Pro / Metal API / version
1.2 / backend METAL. No OpenGL, Linux, Windows, browser API or unmeasured native
build is qualified by these observations.

## Captures and independent carrier

`native_mf.py` uses the actual node in an evaluated geometry modifier and reads
four stored attributes as raw Float32. It never evaluates a copied Python
formula. Each version has **42 configurations × 382 coordinate samples × six
scalar output components**. These observations establish the native MF path;
they do not certify every shader-stage field as equivalent to MF.

`native_eevee.py` creates real saved shader materials, actual embedded
Float/Non-Color/opaque/nearest data images, and renders native EEVEE. Each
version has **28 configurations × five scalar output planes × 1024 samples**,
both Normalize states, literal and actual data-field input, integer/fractional
Sides and unrounded/rounded cases. Cycles CPU has a separate, smaller **14 ×
five-plane** comparison (default five-sided/unrounded only). Cycles is research
evidence, not a request to make it the live export target.

Each scalar is transported by a signed-magnitude digit carrier. For `|v|<16`,
let `m=abs(v)/16`, `a=floor(512m)`,
`b=floor(1024 fract(512m))`, and
`c=floor(1024 fract(524288m))`. RGB contains
`((a+512 sign(v))/1024, b/1024, c/1024)`. Each digit `k/1024` is exactly
representable in a half target. Reconstruction is
`sign ×16×(a/512+b/(512×1024)+c/(512×1024²))`.
All source scales are powers of two. The derived absolute truncation bound is
**16/2^29 = 2.9802322387695312e-8**. No kernel output/native pixel determines
production coefficients; there is no production kernel here. Signed zero and
subnormal bit identity are outside this carrier contract.

Independent signed powers/near-zero/endpoint controls have zero measured
error. Independently authored coordinate-image controls measure at most
`2.8311713862194665e-8`, within the predeclared bound. Raw packed RGB, EXRs,
authored inputs, reconstructed planes, source materials, hashes and native
profiles are retained. Input upload accuracy is measured, not assumed from the
image settings.

A **separate coarse source-before-carrier control**, `v/64+.5`, must be in
`.25..75` and agree with reconstruction under a fixed scene-target allowance
`2^-10`. This never improves a decoded value or expands the raw-kernel bound.
It marks unqualified samples in a separate byte mask: otherwise an undefined
native output can collapse to black during rendering and impersonate packed
zero. Every comparison excludes mask-zero samples explicitly. Native raw
pixels and those masks remain intact; exclusions do not turn into passed cases.

## Findings and preserved counterexamples

- All **140 EEVEE output planes**, packed digits, coarse controls and masks
  are byte-identical between the measured 5.2/5.3 Metal builds. This establishes
  native cross-version evidence, not web parity.
- A separately authored native Shader Math `atan2 / tau`, negative-Y and
  five-sided sector-ID composition matches Radial ID on all **1009 qualified
  field samples/version**, exact zero difference. Its origin handling is
  different; the 15 Radial-origin samples remain excluded by the independent
  coarse control. No assumption that `(0,0)` is a finite shader-stage input is
  permitted from this dataset.
- MF and GPU stage selection differs at actual sector boundaries. At authored
  Float32 `(-0.8090168833732605, .5877854228019714)`, default five-sided MF
  selects ID 1 while native Metal EEVEE selects ID 2; Segment Coordinate X can
  switch sign. This is not carrier error (the jump exceeds 1), and must not be
  hidden by a wider error budget or a universal MF/shader formula.
- Signed-zero field evaluation also differs between native builds. For example
  `(1,-0)` can select ID 5 / rotation about 6.9115 in 5.2 MF versus ID 0 /
  rotation about .6283 in 5.3 MF. Literal and field stages must remain distinct;
  no ideal `[0,Sides)` ID claim follows from the UI description.
- Both native MF builds produce non-finite values for Sides 2 / Roundness .5:
  **249 scalar values with Normalize off, 498 with it on** in the sampled
  field. Segment Width also reaches about `-5.14e6`. These actual raw MF words
  remain available; a future finite web model should refuse this unearned
  source domain rather than silently sanitize it.
- Normalize does **not** make the complete vector unit-bounded. The native
  normalized default at `(-1,-1)` has coordinate Y about `1.2600733`. No unit
  range should be inferred for any future opcode merely from Normalize.
- Cycles stage/source observations have their own signed-zero boundary
  differences (66/70 decoded planes byte-identical across these builds).
  They do not qualify a new live Cycles contract.

`artifacts/radial/analysis.json` preserves comparisons and explicit native
counterexamples. `native-receipt.json` is a compact, hash-pinned summary for
review; full arrays and `.blend` sources remain in this private worker.

## Proposed next experiment, not an admitted port

The best first kernel trial is **EEVEE shader-stage, integer Sides ≥3,
Roundness 0**, both Normalize states and all outputs, with actual finite input
data and explicit origin/sector-edge controls. Start with measured finite data
values and literal knobs; demonstrate browser/native agreement before choosing
an angular margin or admitting generated/UV geometry fields. Do not assume
unit UV storage, infer arbitrary linked-input bounds, substitute native MF at
shader boundaries, or grant a universal CPU/platform profile. Rounded and
fractional-Sides domains are retained for later trials; two-sided intermediate
roundness remains an explicit counterexample. The native literal/default path
is separately useful but is not evidence for a varying shader path.

## Reproduce native research

Run from this worker. Set `BLENDLINK_RESEARCH_BLENDER` to an actual executable;
use suffix `52` or `53` consistently below. No npm build or browser is needed.

```sh
BLENDLINK_RADIAL_OUTPUT=artifacts/radial/schema53 "$BLENDLINK_RESEARCH_BLENDER" --factory-startup -b --python-exit-code 1 --python experiments/radial-tiling-research/schema_probe.py
BLENDLINK_RADIAL_OUTPUT=artifacts/radial/mf53 "$BLENDLINK_RESEARCH_BLENDER" --factory-startup -b --python-exit-code 1 --python experiments/radial-tiling-research/native_mf.py
BLENDLINK_RADIAL_OUTPUT=artifacts/radial/eevee53-calibrated BLENDLINK_RADIAL_MF=artifacts/radial/mf53 "$BLENDLINK_RESEARCH_BLENDER" --factory-startup -b --python-exit-code 1 --python experiments/radial-tiling-research/native_eevee.py
BLENDLINK_RADIAL_OUTPUT=artifacts/radial/cycles53 BLENDLINK_RADIAL_MF=artifacts/radial/mf53 BLENDLINK_RADIAL_ENGINE=cycles "$BLENDLINK_RESEARCH_BLENDER" --factory-startup -b --python-exit-code 1 --python experiments/radial-tiling-research/native_eevee.py
```

Run the schema command with suffix `42` using actual Blender4.2 to preserve its
absence evidence. After both modern versions finish:

```sh
python3 experiments/radial-tiling-research/analyze.py
```

Analysis verifies every referenced native binary pin and current generator
hash before comparing stages. Source-state fingerprints include actual input
and output values, node settings, links and actual image payload hashes, and
are checked before/after each readback. Only private carrier copies are changed;
the original source material is fingerprinted throughout.
