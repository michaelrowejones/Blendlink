# Exhaustive HalfFloat binary Mix prototype

This research prototype closes a narrower input domain than the failures retained in `../scene-mix-pathologies`. It changes no SDK, source scene, native implementation or node capability. It is not a ScenePass attachment proof or saved Final qualification.

Actual WebGPU and WebGL2 each upload all 65,536 raw IEEE binary16 encodings to a HalfFloat DataTexture and sample into a full-Float32 target. Every RGBA channel independently covers the complete domain, with different permutations. The actual decoded raw F32 words are captured, then injected unchanged into an owned native CPU compositor Image. NumPy does not decode HalfFloat or reconstruct NaN payloads. Independent Image→EXR32 copies are word-exact. A fresh browser process repeats the HalfFloat decode and checks exact stability before comparing the prototype.

Pinned Blender 5.3 CPU FULL (`02f0899d78e3`, macOS arm64) evaluates the actual unmodified ShaderNodeMix RGBA/MIX. Each API supplies six cases: both A/B directions with literal factor zero, literal factor one, and an actual image-derived alternating binary factor. The finite positive dyadic background is independently declared (.125,.25,.5,.75). Four endpoint/direction cases test every HalfFloat encoding at both binary factors; the two varying-factor cases additionally exercise runtime shader branching. Fourteen native renders comprise twelve arithmetic references and two exact image-copy controls.

The shader prototype classifies integer words **before output**, without floating Mix algebra, CPU pixel generation, readback repair or normalization. For this bounded source/background:

- A decoded NaN returns its source word with the quiet bit set.
- An unselected decoded infinity returns positive canonical invalid-operation NaN, matching native zero-times-infinity.
- A selected finite decoded source is preserved, except either zero becomes positive zero when added to the positive weighted-background zero.
- Otherwise the finite positive background is selected.

These are a narrowly tested native binary-arithmetic model, not a general-purpose IEEE arithmetic replacement. The preceding negative experiment explains why endpoint selection and GPU `mix` are insufficient.

**Result: all 3,145,728 compared raw F32 words match; zero word or classifier differences across twelve browser cases.** Raw native references, actual decoded source words, browser per-case measurements, independent-copy controls, logs, source hashes and native launcher archive remain in the receipt's artifact directory. The browser computes mismatch counts against raw native words; this research does not retain per-pixel browser result dumps or claim an independent production receipt reader.

## Exceptional provenance and limits

For each API, the 262,144 decoded words contain 8,184 NaNs, four positive zeros, four negative zeros, four positive infinities and four negative infinities. Every uploaded NaN encoding—including both signs, payloads and signaling encodings—decodes on this measured texture path to **positive canonical F32 NaN 0x7fc00000**. No F32 subnormals survive because nonzero HalfFloat values are normal in F32. Consequently this result proves all uploaded HalfFloat NaN encodings through the measured decoder. It does not prove a generic source carrying arbitrary signed F32 NaN payloads. The earlier F32 image research retains such failures separately. A different decoder profile must be requalified rather than assumed equivalent.

WebGPU reports apple/metal-3 with model fields redacted; WebGL2 reports ANGLE Metal Apple M5 Pro. These are measured API observations only. Source hashes and links in `sources.json` pin MixColorFunction/ramp_blend and Blender's task-worker FP setup. The task scheduler observer and pthread worker entry set flush-to-zero; BLI_simd.hh pins the AArch64 FPCR control path. That source evidence explains worker state handling, but does not by itself establish every NaN-selection instruction or portability claim. Native exceptional result words come from the actual immutable CPU oracle, not an assumed universal ARM NaN rule.

The candidate still needs actual ScenePass attachment type, MSAA, framebuffer texel/sample path and color-conversion proof before production use. Generic HalfFloat DataTexture decoding alone does not establish the behavior of a rendered HalfFloat scene attachment. A useful next slice is one direct current-scene/current-view-layer RenderLayers Image/Alpha, one exact binary Ellipse factor, one RGBA/MIX with bounded finite positive/+0 background, closed sampler accounting and no extra effects. The staged proof must compare an independent actual Three ScenePass frame, the untouched native CPU image-oracle composition of that exact frame, and the actual saved Final pipeline at matching attachment precision. No Three-PBR-versus-Cycles equivalence or original-demo acceptance is claimed.

## Reproduce

From this isolated checkout, with Node 24 and installed dependencies, choose a fresh output directory:

```sh
node experiments/half-mix-exhaustive/browser.mjs decode artifacts/verification-half-mix-exhaustive-new
node experiments/half-mix-exhaustive/native.mjs artifacts/verification-half-mix-exhaustive-new
node experiments/half-mix-exhaustive/browser.mjs compare artifacts/verification-half-mix-exhaustive-new
node experiments/half-mix-exhaustive/close.mjs artifacts/verification-half-mix-exhaustive-new
```

The guarded native launcher owns a fresh private Python prefix, archives invocation/tool identities and cleans its prefix. The closing research reader validates that archive, strict case census, source-copy controls, actual decoder census/stability and zero per-case differences; it hashes all retained artifacts and fixture/helper sources. The final receipt is excluded from its own source census to avoid circular self-pinning. Support and Final credit remain zero.
