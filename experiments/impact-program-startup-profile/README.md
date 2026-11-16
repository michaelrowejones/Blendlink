# Impact startup and source ORCO research — failed gates retained

**No production SDK files, defaults, catalog, support counts or tolerances change.** The uniform implementation is retained only in `uniform-candidate.patch` and its source-test snapshot. The ORCO attribute helper and native/browser producers are isolated experiments. All support/performance/scene-acceptance credit is zero.

## Measured startup fan-out

The retained `/tmp/scenetoweb-impact-original-website-099e993` is untouched. Transparent GL observation records actual shader text/call timing and preserves every source. Its warm run reaches ready in 1.672s. Historical 17.285s was a different cold/cache observation, so it is not used to claim a 17s optimization. Camera culling matters:278 CPU material variants do **not** mean 278 driver programs.

A fresh app copy uses the same original source GLB/material-program bytes and public751dcff SDK, with wall-clock marks around renderer init, install, compileAsync and first render. A separate candidate app enables immutable per-material Generated location/denominator uniforms. Operation order stays subtract → divide → add; no reciprocal rewrite or material merging. Both retain 281 assignments, zero skips and 278 private material variants.

| Single observed run | Literal baseline | Uniform candidate |
| --- | ---: | ---: |
| Unique fragment shader strings | 53 | 11 |
| Unique vertex shader strings | 10 | 10 |
| First ready | 1,834ms | 1,208ms |
| Renderer init | 25.7ms | 14.3ms |
| Installation including compile | 309.0ms | 447.1ms |
| compileAsync | 95.6ms | 254.6ms |
| First actual render | 1,424.3ms | 690.1ms |

These are observer/cache-sensitive samples, not a budget pass or distribution. In the retained baseline, 44 roughness shaders embed bbox literals; 43 are byte-identical after replacing **only** the known Generated location/denominator tuples. One differs in emitted helper ordering. Full captured shader sources remain available; diagnostic normalization is not rendering-equivalence evidence.

The exact image gate was declared before candidate capture and **fails**: 572 of 2,764,800 RGB8 screenshot bytes differ, maximum 25. A clean sequential literal self-repeat is exactly identical. Screenshots are composited RGB8, not a claim of raw alpha equivalence.

Independent direct Float32 Generated controls also fail the declared exact-word gate. On both APIs, small-source bbox  + glTF basis differs in 192 of 1,024 words, maximum 4.76837158203125e-7. The other seven tuples/API are exact; every wrong-bbox negative differs. A lower shader count therefore cannot be promoted as an exact performance-only change.

One accidental overlap of the first controls/repeat jobs is explicitly excluded. Their artifacts remain; the affected 67.757s repeat is not used for timing or proof. Subsequent controls and repeat were sequential. No caches belonging to the user were deleted.

## Native source model and concrete attribute prototype

Pinned native source distinguishes two routes:

- Render evaluation requests `CD_MASK_ORCO` (`object_update.cc`). Modified mesh evaluation builds a parallel ORCO mesh, applies the constructive modifier and normalizes its positions as `(co-location)/size` (`mesh_data_update.cc`, `mesh.cc`). EEVEE loads raw Float32 ORCO, converts it with `*.5+.5` **in the vertex stage**, then interpolates it (`eevee_attributes_mesh_lib.bsl.hh`).
- Unmodified meshes can instead use vertex-position multiply/add coefficients finalized from reciprocal bbox factors. This is a separate path; it cannot be silently substituted for the first.

`MeshVertex.undeformed_co` inversely transforms ORCO or returns position. It does **not** expose exact normalized ORCO words. The experiment does not mistake that RNA value for a raw source-field reference.

Two concrete CPU steps precede the field candidate:

1. A guarded native Geometry Nodes CPU subtract/divide field on three small/nonuniform/auto-flat fixtures matches the independent Float32 helper for all 36 words. This validates the finite, nonzero-size CPU normalization primitive, not EEVEE interpolation.
2. All 281 actual Impact Material meshes match the retained GLB's exact Float32 position sets, oriented triangle-position multisets and texspace tuples. 275 have unique owner fingerprints; six belong to equivalent geometry/texspace pairs. No name-only matching is used. Shape-key count, texture-mesh count and render/view modifier-flag mismatch count are all zero; each owner has an active BEVEL. This context-depsgraph census is explicitly VIEWPORT, not a fabricated render observation.

`orco-attribute.mjs` is the real experimental transport candidate: copy source-normalized Float32 ORCO into an owned unnormalized attribute, keep its Blender semantic lanes unchanged through glTF, and explicitly put `raw*.5+.5` inside a TSL `varying()` so conversion occurs before interpolation. It refuses unproved zero-size texspace rather than inventing a replacement. It changes no SDK admission and does not infer ORCO ancestry from arbitrary deformed positions.

## Actual EEVEE field matrix

The bounded native matrix uses private copies of two original large/small BEVEL owners plus a flat/degenerate BEVEL fixture. Nine actual EEVEE Metal renders capture mask, independent encoded position and Generated at 64×64. Native `frame_change_post` captures genuine RENDER-mode evaluated positions, normals and topology, all bit-identical to the serialized geometry; original/evaluated texspace agrees. Source files and captures are pinned. The first attempt deliberately stopped when its older callback exposed no render metadata; those three partial renders are not credited.

The browser uses actual serialized geometry and cameras, both coordinate bases and both Metal APIs, with no native per-pixel answers. WebGPU rows use the fixed API-origin adapter already source-grounded in the preceding experiment. The existing native half-film field bound 2^-10 and exact mask gate were declared before capture. No bound was chosen after observing differences.

| Positive stage | Compared words | Violations | Maximum absolute difference |
| --- | ---: | ---: | ---: |
| Mask | 196,608 | 0 | 0 |
| Encoded position | 196,608 | 0 | 0.0005767941 |
| Generated attribute | 196,608 | **1** | **0.001321733** |

All twelve wrong-bbox negative controls fail strongly. The browser has no page, HTTP or shader errors. The initial browser attempt stopped before draws because the helper imported a Node-only assertion module; the failed helper is retained, and the retry changes only input guards.

The sole failed word is WebGL2/glTF-basis/large Cube at pixel (28,42), channel X: 0.3626919389 vs native 0.3640136719. The other three API/basis tuples produce approximately 0.3642097 and pass. Independent encoded position is bit-identical between both WebGL2 bases at that pixel, and all coverage masks match. A varying/vertex/compiler-layout issue is plausible, but remains unproved. It is not an origin mistake or permission to waive the word.

Frame-cache source audit finds no ShadowNode or frame-updated field resource here: camera uniforms use render updates, model matrices object updates and Renderer advances renderId per call. A future discriminating check should nevertheless use real public animation-loop ticks and archive actual vertex shaders/clip outputs for this single tuple, separating interpolation/vertex-code differences from normalization. No further GPU retry was run after this matrix.

## Artifacts and replay

All raw shaders, PNGs, Float32 words and native transactions remain outside Git:

- `/tmp/scenetoweb-impact-startup-retained-baseline-r1`
- `/tmp/scenetoweb-impact-startup-baseline-r2`, `-candidate-r1`, `-baseline-repeat-r2`
- `/tmp/scenetoweb-impact-uniform-controls-r2`
- `/tmp/scenetoweb-impact-orco-cpu-r1`, `-orco-association-r2`
- `/tmp/scenetoweb-impact-orco-field-native-r2`, `-orco-field-browser-r3`

`evidence.json` records compact counts, declared failures, excluded attempts and exact artifact hashes. CPU readers recompute hashes, pixel/word differences and native archive/Render-metadata checks. They intentionally retain failed statuses. Tests require those failures and zero credit, rather than converting them into support.

```sh
UNIFORM_BASELINE=/tmp/scenetoweb-impact-startup-baseline-r2 UNIFORM_CANDIDATE=/tmp/scenetoweb-impact-startup-candidate-r1 UNIFORM_REPEAT=/tmp/scenetoweb-impact-startup-baseline-repeat-r2 UNIFORM_CONTROLS=/tmp/scenetoweb-impact-uniform-controls-r2 ORCO_FIELD_NATIVE=/tmp/scenetoweb-impact-orco-field-native-r2 ORCO_FIELD_BROWSER=/tmp/scenetoweb-impact-orco-field-browser-r3 ORCO_CPU_NATIVE=/tmp/scenetoweb-impact-orco-cpu-r1 PATH=/tmp/scenetoweb-apply-tooling:$PATH node --test experiments/impact-program-startup-profile/*.test.mjs
```

For new captures, coordinate the GPU lease first and use fresh output paths. `website.mjs` preserves the original-source/website hashes and uses a supplied original source, website directory and new evidence directory, like the original smoke producer. `orco-cpu.mjs` and `association-cpu.mjs` are CPU-only. `orco-field-native.mjs` and `orco-field-browser.mjs` require `--gpu-lease`. The uniform patch must be applied only in another isolated checkout, built, and paired with a fresh app copy; it is not part of the production source tree. Captured producer worktree/dependency paths remain pinned rather than silently relocating results.
