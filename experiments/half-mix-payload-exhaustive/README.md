# Payload-preserving HalfFloat decoder research

This is a new research contract, not a production calibration change or software-support promotion. It retains the earlier canonical-model refusal: both actual SwiftShader APIs decode Half0x7c01 as F32 signaling NaN0x7f802000, rather than canonical0x7fc00000.

Both APIs independently upload every65,536 binary16 encoding in each RGBA channel, with channel permutations. Their actual decoded F32 words are captured and supplied unchanged to a fresh pinned Blender5.3 CPU Image oracle. No NumPy Half decoder generates native inputs. Independent Image→EXR32 controls preserve all source words, including signaling/signed NaN payloads.

The observed exact mapping is `half-payload-sign-signaling-preserved-v1`: finite values, signed zero and infinities match ordinary IEEE Half→F32 widening; NaNs preserve sign and every payload bit, shifting the10-bit Half fraction into the F32 fraction by13, including the signaling/quiet bit. It is not an any-NaN equivalence rule. Per API, the262,144 decoded words contain4,088 signaling and4,096 quiet NaNs. All source NaNs become the same payload/sign with its F32 quiet bit set after actual native Mix, matching the existing uint implementation.

The browser calls the current production `buildEllipseSceneBinaryMix` function from its unchanged source module. Three background controls—RGBA0, RGBA1 and (.125,.25,.5,.75)—cross both source operand directions and factor0, factor1 and an actual alternating image factor. Thirty-eight fresh native renders comprise36 arithmetic references and two exact image copies. Both actual SwiftShader WebGPU/WebGL2 compare36 cases and **9,437,184 raw words with zero differences**. The independent closing reader recomputes equality and NaN classes/payload quieting from retained browser output files, including294,624 source-NaN result words; it does not trust browser pass counters alone.

Native CPU execution is Blender5.3.0 build02f0899d78e3 on macOS arm64, using the same source-pinned Mix/ramp_blend and AArch64 worker FP setup listed in `sources.json`. These are CPU image-field references with a CyclesCPU carrier, not native GPU or EEVEE evaluation. The browser profile is actual SwiftShader; this does not qualify other devices or platforms.

## Proposed next step

A future calibration may admit exactly two complete declared tables: the existing canonical-NaN model, or this exact payload/sign/signaling-preserving model. Every finite, infinity and zero word must still match exactly; mixtures, unexpected payload changes or partial matches must refuse. The immutable certificate must identify which complete model matched. No user payload flag or output repair is appropriate.

The existing uint binary law required no change. Actual owned ScenePass attachment decoding and fresh installed Final composition still need a combined frozen production transaction before software support can be extended. This source-only Vite research does not include the full immutable built SDK/vendor runtime archive used by the integrated qualification harness. Support and Final credit stay zero, and the current production canonical-model refusal remains correct until the new contract is implemented and qualified.

## Reproduce

From this isolated checkout, with Node24/dependencies and a fresh directory:

```sh
node experiments/half-mix-payload-exhaustive/browser.mjs decode artifacts/verification-half-payload-new
node experiments/half-mix-payload-exhaustive/native.mjs artifacts/verification-half-payload-new
node experiments/half-mix-payload-exhaustive/browser.mjs compare artifacts/verification-half-payload-new
node experiments/half-mix-payload-exhaustive/close.mjs artifacts/verification-half-payload-new
```

The guarded launcher owns a fresh private Python prefix, archives actual tool/invocation identities and disposes its cache. `closed.json` hashes the retained raw decoded/native/browser outputs, EXRs, logs and experiment/helper/actual production kernel source inputs. `receipt.json` pins the machine-local closed research artifact and compact counts. No previous numerical receipt is reused or rewritten.
