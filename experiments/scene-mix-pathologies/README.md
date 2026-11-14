# Binary scene Mix pathology research

This is a retained negative result, not a production port or a Final qualification. The finite, LDR scene pilot in `../ellipse-scene-composition` does not certify arbitrary live ScenePass inputs. No SDK source, native implementation, source scene or capability status changed.

On pinned Blender 5.3 CPU FULL (`02f0899d78e3`, macOS arm64), `ShaderNodeMix` Color/MIX delegates to `ramp_blend`, whose four-channel expression is `(1-f)*A + f*B`. Both weighted operands participate even at the exact binary endpoints. Primary source links and SHA-256 values are in `sources.json`; the relevant methods are `MixColorFunction::call` and `ramp_blend/MA_RAMP_BLEND`. The existing Three recipe uses `tslMix`, which is a different compiler operation; a shared name is insufficient evidence of equal exceptional behavior.

The owned 16×4 image contains +0, -0, negative finite values, 65504, both infinities, positive/negative payload quiet NaNs, smallest signed F32 subnormals, smallest signed normal F32 values, ±maximum finite F32, and ordinary positive values. Pathologies occur in all RGBA channels. Three independent native image→EXR32 copies and six browser texture-copy controls preserve every raw word. These controls rule out the image/EXR/readback stage as the explanation for arithmetic differences. They are consistent with `../cpu-mf-word-transport` research; source socket constants would not be equivalent controls.

Nine native renders comprise three copies plus A→finite-B and finite-B→A, each with an actual alternating image-derived binary factor and literal factors zero and one. B has manually declared finite positive dyadic RGBA values (.125,.25,.5,.75). Both actual browser APIs compare endpoint selection, the existing typed `buildTslBlendOperation('MIX', ...)`, and explicit two-multiply/add algebra. There are 36 browser cases and 9,216 compared words. Results below count the A→finite-B **varying-factor** case, 256 words per API:

| Prototype | Word differences | Class differences | NaN payload/sign-only differences |
| --- | ---: | ---: | ---: |
| endpoint select | 56 | 56 | 0 |
| existing typed MIX | 48 | 16 | 32 |
| explicit multiply/add | 32 | 0 | 32 |

Both APIs gave this table. The classifier distinguishes ±zero, subnormal, finite, ±infinity and NaN; the last column separately records raw differences between NaNs, including sign and payload. All failures remain in the receipt; zero class differences does not mean word-exact success. On WebGL2 the explicit algebra with literal factors also changes 48 or 64 result classes as compiler simplification removes a weighted operand. Literal endpoints cannot substitute for the varying-factor controls. Native arithmetic flushes tested F32 subnormals, changes source -0 to +0 with positive B, and propagates NaNs where endpoint selection would choose finite B. Typed `mix` changes some retained infinities into NaNs. The explicit arithmetic canonicalizes payload/signed NaNs instead of preserving native words.

A separate actual HalfFloat render-target round trip retains tested infinities and -0, canonicalizes tested NaNs to positive canonical NaN, underflows tiny signed values to signed zero, and clamps the tested maximum finite F32 inputs to ±65504 on this measured stack. This is a transport observation, not a certified finite source domain. Infinities remain possible. Three PassNode's default HalfFloatType does not prove that authored scene shaders cannot generate nonfinite values. WebGPU adapter model fields are redacted (`apple/metal-3`); WebGL2 reports ANGLE Metal Apple M5 Pro. These are local API observations, not wider platform certification.

## Decision and next bounded experiment

Do not extend Ellipse→RenderLayers production admission using endpoint select, GPU `mix`, or the measured explicit algebra. Do not invent a `finiteScene` payload flag or add per-frame readback. Keep the existing production refusal until exceptional semantics are closed.

The most focused next candidate is a bit-classified implementation of **binary native arithmetic**, with one HalfFloat scene input A and a bounded positive finite constant B. A source bit classifier must explicitly reproduce native signed-zero normalization, NaN provenance/quieting/sign/payload and infinity cases, rather than evaluate floating expressions that shader compilers may rewrite. This is an unimplemented proposal. A proof must independently cover all 65,536 HalfFloat encodings, both binary factors, signed/payload/signaling NaNs after actual texture decoding, RGB and alpha, both APIs, and varying/literal/hidden-zero-factor routes. It must compare actual native CPU image fields against the shader's raw output words, preserve copy controls, and test compiler optimizations in the actual final pipeline. HalfFloat transport must be proven for the actual ScenePass attachment and sample path; this pilot's generic target alone is insufficient. If NaN encoding provenance cannot be closed, retain the refusal rather than weaken the word/sign contract silently.

Only after that decision closes should the staged workflow resume: independent actual Three ScenePass baseline, untouched native image-oracle reference of that exact frame, then saved Final pipeline pixels using the same attachment precision. No assertion that Three PBR equals Cycles, no original-demo acceptance, no node coverage credit, and no timing/performance claim is made here.

## Reproduce

From an isolated source checkout with Node 24 and installed dependencies, use a fresh output directory:

```sh
node experiments/scene-mix-pathologies/native.mjs artifacts/verification-scene-mix-pathologies-new
node experiments/scene-mix-pathologies/browser.mjs artifacts/verification-scene-mix-pathologies-new
node experiments/scene-mix-pathologies/close.mjs artifacts/verification-scene-mix-pathologies-new
```

The native launcher owns a fresh private Python prefix and archives its identities/invocation before disposal. `close.mjs` checks archive identity, exact copy controls, expected negative results and both real APIs, and hashes all retained artifacts plus experiment/native-helper/SDK source inputs. It does not convert this research into a numerical qualification. `receipt.json` pins the retained local artifact closure; inputs, raw outputs, EXRs, native log and browser failures remain in the ignored artifact directory.
