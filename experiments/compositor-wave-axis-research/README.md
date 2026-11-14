Research only: native CPU Wave axis factors
=========================================

The first 64 native Blender 5.3 CPU compositor FULL frames match the independent staged JavaScript axis evaluator in all 1,074,784 RGBA words. This is **zero production support credit**. No SDK, source admission, saved Final, browser, EEVEE or official demo acceptance was changed. The three byte-pinned official demos contain no Wave nodes in their retained used material inventories; artist value is an engineering judgment, not observed usage.

The candidate is implicit Uniform coordinates, Bands X/Y, Distortion exactly 0, static Scale/Phase and SAW/TRI profiles. Default Scale 5/Phase 0, ordinary nonhalf and negative inputs, zero Scale, minimum 2^-16 and adjacent Float32 Scale 5 controls were preserved. The independent CPU formula stages Float32 arithmetic and retains native double 2π division before the Float32 cycle value. The existing shader `tex_wave` uses GPU arithmetic and cannot automatically stand in for this compositor CPU contract. Rings, DIAGONAL and nonzero Distortion are unqualified. Phase/floor seams require independent controls, with no tolerance or input quantization repair.

A future live port can compute factor rows in O(W+H) when extent/static settings change, then sample owned R32F rows, preserving mathematical field behavior across resize. It must reuse a reviewed shared row-allocation factory after the in-flight White Noise resource fixes settle. It must not copy lifecycle code or refactor the active SDK. Maximum extent 8192 bounds row storage; sampler counts, immutable source/settings, one-entry atomic extent cache, callback retention, actual upload order, invalid-to-valid resize, renderer loss/disposal and ownership need fresh actual API/profile qualification. No O(W*H) table or rasterized scene bake is proposed. The current prototype allocates no renderer texture.

`receipt.json` pins the raw native/comparison reports and guarded launch archive. The initial research pins only its script, native setup helper and raw socket helper; this is explicitly not a complete production/transitive SDK closure. Future qualification must capture fresh after a source/runtime union freeze.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-wave-axis-research/run.mjs artifacts/verification-wave-axis-native-unique
```

Primary source pins in `sources.json` retain Blender's GPL-2.0-or-later attribution. No native function body was transplanted into the published runtime.

The separate SIN/default-profile pilot captured 32 native CPU frames and 537,392 words. Its budget was declared before capture: absolute error ≤ 2^-20, finite values in [0,1], exact alpha/gray channels and exact native zero/one controls when present. There were 1,224 nonzero word differences, maximum absolute error 5.960464477539063e-8, zero contract violations and 1,800 exact native-zero RGB words. No native-one endpoint occurred, so that control remains pending. `sin-receipt.json` retains the first result and a CPU-only gray-channel recheck with unchanged raw pixels and the guarded launch archive. SIN is bounded research, not a bitexact claim. The observed discrepancy is not tuned away or attributed to specific native instructions without evidence. Run it with `SCENETOWEB_WAVE_AXIS_PROFILES=SIN`.

DIAGONAL is deferred. Its output depends jointly on separately rounded X/Y phases before a nonlinear profile; exact dependence on only `x+y` cannot be presumed from the real-number formula. Rings and distortion similarly break the simple one-axis factor contract. Do not replace these with O(W*H) output atlases and call them the same live enabler.

The [production design](./design.md) keeps the Wave source contract separate from the proposed shared row-resource owner. It is a proposal, not an implemented or qualified route.

The declared signed-bound and seam plan adds 378 CPU frames and 6,445,896 words. Each profile has 126 frames and 2,148,632 words. SAW/TRI each remain wordexact. SIN has 12,426 word differences and 24 **exact-endpoint gate violations**, so its proposed domain is failed and closed, despite maximum absolute error remaining only 5.960464477539063e-8. At maximum extent 8192×4, Bands X, Scale -8, Phase -8 and pixel index 352, native SIN is +0 while the host result is 2.9802322387695312e-8. The transposed Y case also fails. No gate was relaxed. Native-one RGB words were actually reached and matched: 396 SIN, 198 TRI and 186 SAW. SAW can return 1 after Float32 subtraction; no clamp or strictly-below-one assumption is added. The original receipts remain unchanged.

`bound-receipt.json` preserves the failure and the separate exact SAW/TRI results. The pinned Blender executable's actual Wave call and lambda disassembly confirms separate Float32 stages, double π/2 subtraction, conversion back to Float32, imported libSystem `sinf`, then separate half multiply/add. The first argument reconstructs to `0x4308a8d7`. A public-libm probe returns `sinf = 0xbf800000` and factor +0, whereas double `sin` rounded to Float32 gives `0xbf7fffff` and factor `0x33000000`. This distinguishes a real library result from a host staging mistake. These words are reconstructed from actual instructions and inputs, not live register instrumentation. Raw disassembly stays in ignored research artifacts; no native library body is copied into the runtime.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-wave-axis-research/bound-plan.mjs
SCENETOWEB_WAVE_AXIS_PLAN="$PWD/experiments/compositor-wave-axis-research/bound-cases.json" \
  PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-wave-axis-research/run.mjs artifacts/verification-wave-axis-bounds-unique
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-wave-axis-research/compiler-evidence.mjs artifacts/verification-wave-sinf-compiler-unique
```
