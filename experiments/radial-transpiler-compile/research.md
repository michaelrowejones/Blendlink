# Radial source-derived TSL compilation scaffold

This experiment advances compiler feasibility only. It adds **zero node support, native numerical cases, saved Final exports, or official-scene acceptance**. Nothing here is imported into the published runtime. [The separate demo inspection](../radial-segment-width/demo-controls.md) corrects the official material to a STEPPED, computed integer Sides field **3/8/12**, Roundness1; fractional3..8 is a broader research control.

The pinned Blender GPU shared function is mechanically decoded with Three r184 GLSLDecoder and emitted with TSLEncoder. It retains its **Apache-2.0**, copyright2024-2025 Blender Authors header and exact source hash. Generated GLSL and TSL retain that header; captured backend shader bytes have a separate attribution sidecar. The node registration/wrapper files have separate upstream GPL licensing. This experiment does not make any license determination for production distribution and does not relabel the generated derivative as MIT.

The preprocessing normalizes native type/function aliases and supplies the native scalar square helper. Initialized locals are materialized as mutable TSL variables. These adaptations change neither Radial arithmetic nor the native branch predicates. The new AST adapter handles only an exhaustive tree of tail value returns; it refuses early non-tail returns, missing final else paths, and void values. Four focused tests exercise these rules.

The initial assumption that callback returns were simply discarded was incorrect. Actual generated shader inspection shows that Three captures the four nested returns as real shader returns. However, the outer JavaScript Fn has no direct return, so Three emits `Invalid generated code, expected a "vec4"` and appends a default vec4 return. Both actual APIs still compile and draw this baseline. Mechanical exhaustive-tail lowering assigns each leaf value to a typed local and returns it once from the outer Fn; this removes the diagnostic and fallback while preserving all2560 sampled baseline/adapted Metal words. That equality is a compiler regression control, not a native reference proof.

The adapted candidate cleanly compiled and drew five programs on each actual API/profile: WebGPU and WebGL2 on Metal and SwiftShader. Each profile includes an independent affine-coordinate control plus fractional and source-shaped STEPPED fields with Normalize false/true. All20 diagnostic draws completed, no validation or page errors were recorded, no sampled components were nonfinite, and texture counters returned to zero after target disposal. The source-derived TSL is34474bytes; Radial fragment shaders are21123–21718bytes, below the predeclared512KiB ceiling. See [the closed receipt](evidence.json) for raw report hashes, actual adapters and per-program measurements. The observed build/compile wall times include Three code generation and API work; no throughput or register-pressure claim is made.

An independent input control exposes different UV/readback orientations across APIs. Therefore cross-API or native word comparisons require explicit field calibration before any numerical proof. No seam epsilon, artist-input quantization, lookup texture, value repair or tolerant comparison was introduced. The8×8 scaffold does not exercise every branch or establish origin, signed-zero, sector-cut or stepped-radius behavior.

Next numerical work should prioritize the actual demo's full-roundness integer regular branch with unmodified computed Sides3/8/12. Establish a pinned **EEVEE GPU-source** reference independently of CPU MF: CPU MF uses a specialized full-roundness branch that differs from the GPU staging. Calibrate actual per-pixel coordinates before measuring the kernel; include origin/signed zero, both sides of sector cuts and radius.5/1 transitions, then integer-adjacent fractional Sides. Declare a justified numerical/branch contract before comparison. Use an independently validated output carrier and retain failures without input quantization or post-hoc tolerance widening. Only after that can unchanged actual saved Final graphs, lifecycle/cost checks and the original authored scene receive acceptance credit.

Replay from the repository root with Node24 (all outputs must be new ignored directories):

```sh
node --test experiments/radial-transpiler-compile/ast-lowering.test.mjs
node experiments/radial-segment-width/transpiler-feasibility.mjs PINNED_SHARED_GLSL artifacts/verification-radial-new/baseline
node experiments/radial-segment-width/transpiler-feasibility.mjs PINNED_SHARED_GLSL artifacts/verification-radial-new/lowered --lower-tail-returns
node experiments/radial-transpiler-compile/run.mjs artifacts/verification-radial-new/baseline artifacts/verification-radial-new/baseline-metal
node experiments/radial-transpiler-compile/run.mjs artifacts/verification-radial-new/lowered artifacts/verification-radial-new/lowered-metal
BLENDLINK_TEST_PROFILE=software node experiments/radial-transpiler-compile/run.mjs artifacts/verification-radial-new/lowered artifacts/verification-radial-new/lowered-software
node experiments/radial-transpiler-compile/close.mjs artifacts/verification-radial-new/baseline-metal artifacts/verification-radial-new/lowered-metal artifacts/verification-radial-new/lowered-software NEW_RECEIPT_JSON
```

The generator rejects any source bytes except the pinned upstream SHA. The runner pins generated input, source, fixture, transpiler and Three build modules before/after capture; the closed reader rechecks those pins and all captured shader/readback archive hashes. Prior r2 attempts remain ignored historical research; the receipt closes r3 captures only.
