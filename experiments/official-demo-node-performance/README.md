# Official real-scene node performance research

Measured 2026-11-13 on Apple M5 Pro, macOS arm64, official Blender 4.2.0 / 5.2.0 / 5.3.0. This corpus contains **real official Blender demos**, not synthetic graphs. Assets and captures stay in ignored local artifacts; this commit contains tools, pins and compact measurements only. Nothing was published or redistributed.

[corpus.json](./corpus.json) pins official HTTPS URLs, exact byte lengths, locally computed SHA-256 and license evidence. Blender does not publish checksum companions for these scene downloads. All three embedded README notices identify CC0; the [official demo page](https://www.blender.org/download/demo-files/) also lists the modern shader demos and their creators. Mandelbrot Grow is by Shahzod Boyhonov; Radial Tiling is by Johannes Kollmer, with its Poly Haven CC0 texture credited in the source. Cube is the original Blender 3.0 Asset Browser bundle. Its extracted SHA `a9906942…` matches the earlier corpus inventory; the repository showcase's different `48ef1f81…` file is a derivative and was not substituted.

Download size is 12,164,562 bytes total (about 11.6 MiB), including the 11.6 MB Cube ZIP. The source `.blend` files were never saved or rewritten. Probes operate on checked private copies, disable automatic Python execution, and verify original/copy hashes afterward.

## What the actual scenes show

| Original scene | Physical nodes / used active-surface nodes | Evaluated triangles | 5.3 stock control | Actual production Final |
| --- | ---: | ---: | ---: | --- |
| Mandelbrot Grow | 35 / 25 | 2 | 1,416 B, no images | Refused animated Normal/driver transport; Repeat shader is not replaced with a faithful static material. |
| Radial Tiling | 30 / 24 | 4 | 348,076 B, one image | Refused used CobbleStone material fidelity, including native Radial/procedural coordinate behavior. |
| Cube Diorama | 723 / 98 | 2,106,644 | 64,673,072 B, 19 draws | Refused five Cycles materials with six unsupported live Normal / Coat Normal channels; Cycles appearance requires a supported bake route. |

Physical counts include unused asset-library material trees. Active-surface counts use the compiler's contributing-socket walker on active-view-layer used materials, deduplicating physical nodes. Neither count estimates emitted GPU instructions or loop iterations. The complete root/group inventories and channel refusals remain in raw reports. For example, Cube's raw inventory contains Magic nodes in unused assets; its actual used surface set does not. Prioritizing ports by raw class count would give the wrong answer.

Both modern demos load in Blender 5.2 / 5.3. Native Blender 4.2 rejects their Blender 5 format files before the probe starts (`not a blend file`); these are two retained load failures with no numerical/port credit. Original Cube loads and exports under all three versions. Stock GLB hashes/lengths vary across Blender versions; no forced-export byte reproducibility claim is made.

The actual `blendlink export` attempts used a byte-identical owned snapshot of 810 main `dist` files, Node 24.22.3 for the CLI **and child npm**, and separate private caches. All three returned 1, preserved sources, and published no site. Radial's native material-planner decision alone appears partly lowerable, but the full Final fidelity gate correctly refuses it; planning is not publication acceptance. The earlier first attempt's child Node 26 warnings are retained separately, not used as the supported Node receipt. There is no Final `.materials.json`/manifest/browser success to claim.

The stock GLBs are deliberate geometry/decode controls for the independent browser performance harness. A tiny or fast white/fallback stock export is not successful node translation or artistic fidelity.

## Measured compiler improvement

The real Cube exposed a material-planning allocation hotspot: `evaluated_material_uses` built tuples of millions of evaluated RNA face wrappers solely to collect `material_index`. Initial instrumented 5.3 planning spent 0.469 s there within 0.566 s total; this is not a shader-math bottleneck.

The independent production change `6e268ff` uses Blender's bulk `foreach_get` into an integer array. The reusable paired harness freezes exact SDK trees from baseline `1827c24` and candidate `6e268ff`, asserts that only `procedural.py` differs, then loads the **same untouched original Cube** into separate factory processes using fresh, separate SDK source directories. It compares complete plan JSON, without stripping any fields, for the first call and two warm calls. It also checks source object/material bindings, modifier flags and mesh-datablock counts after every call.

| Version | First planner old → new | Warm planner old → new | Peak Python-tracked allocation old → new |
| --- | ---: | ---: | ---: |
| 4.2 | 750.13 → 559.05 ms | 592.68 / 598.23 → 463.93 / 458.22 ms | 67,112,024 → 8,392,904 B |
| 5.2 | 619.65 → 482.54 ms | 469.91 / 469.90 → 377.85 / 375.86 ms | 134,222,912 → 8,393,152 B |
| 5.3, three fresh pairs with alternating execution order | First calls vary; all retained | Median 467.35 → 380.47 ms across six samples each (**18.6% lower**) | 134,222,912 → 8,393,152 B in every pair |

All full plan JSONs match across baseline/candidate; original/copy hashes, bindings/modifiers and mesh counts are unchanged. The peak measurement is a separate **untimed fourth call** using `tracemalloc`; it measures Python allocations only, excluding Blender-native/GPU/driver memory. This single-scene result does not establish frame-rate, whole-export, cross-device or universal percentage improvements. [receipt.json](./receipt.json) preserves exact timings, hashes, execution order and scope, including both extra 5.3 order controls.

An explicit process-only Floor experiment disables its authored Simple Subdivision modifier. Triangles drop 2,106,644 → 17,684; stock bytes 64,673,072 → 4,186,976, while draws remain 19. It also reduces planning 599.8 → 151.7 ms and stock export 1,580.8 → 263.5 ms in the retained single exploratory runs. This is **a separately recorded derivative**, not an automatic compiler optimization, visual acceptance, or successful Final export. The source file remains unchanged.

## Controlled native rendering

Seven nonblank 256 × 256 EEVEE controls with 1 sample completed: all three scenes on Blender 5.2 / 5.3 plus Cube on Blender 4.2. Actual `gpu.platform` receipts identify Apple M5 Pro / Metal API / METAL. These are native cost controls, not web-pixel acceptance or authored full-resolution benchmarks. Persistent OS/driver shader caches were not cleared; native version timings are not a controlled performance ranking.

Every adjustment is retained: square 256 px output and 1 sample, explicit Image/PNG output in place of Mandelbrot's video format, a generated orthographic camera because Radial has none, enabling Cube's authored-disabled Studio render layer, and Cube's Cycles → EEVEE override. The untouched Cube remains Cycles-authored and its EEVEE control is not a Cycles reference. Initial failed format/no-camera/headless RenderResult-save trials are retained separately. No materials or node math were rewritten to produce a render pass.

## Repeat the research

Run from the repository using supported Node 24. Sources and all outputs default to ignored `artifacts/verification-official-demo-performance`; choose a **new** output directory each time.

```sh
node experiments/official-demo-node-performance/acquire.mjs
node experiments/official-demo-node-performance/run.mjs \
  --blender /absolute/Blender --output artifacts/verification-official-demo-performance/native \
  --stock-export
# Coordinate a GPU window before adding --render --camera-control.
# Repeat fresh processes: --repeat 3. Instrument separately: --profile-materials.
# Explicit Cube derivative only: --scene cube-diorama --floor-experiment.
```

For actual Final, first capture a stable complete SDK `dist` in an owned checkout, verify its complete file-list+SHA equality against the source before/after copy, and keep that receipt. This harness never rebuilds or edits shared dist:

```sh
node experiments/official-demo-node-performance/final.mjs \
  --blender /absolute/Blender --cli /absolute/captured/dist/cli.js \
  --output artifacts/verification-official-demo-performance/actual-final
```

It fingerprints all captured dist files before/after, pins child Node via PATH, records exact real export argv/logs, and distinguishes explicit source-preserving production refusals from unexpected failures. Initial install/setup time is included in wall time; it is not labeled compiler-only latency. Browser acceptance must follow any actual published-site result independently.

The historical receipts retain their original local revision hashes. Those intermediate commits were not published separately by checkpoint mirroring. To repeat the comparison from published history, use baseline `ad813ba7d398da77076f155cc04e172f3b60fc8d` and candidate `HEAD`: their exact SDK roots differ only in `procedural.py`, which the harness asserts before running. The pinned original Cube is still required.

Blender's isolated Python ignores `PYTHONPYCACHEPREFIX` and `PYTHONDONTWRITEBYTECODE`; those environment variables did not control the historical runs. Their measurements remain valid because each Git source snapshot was a fresh, unique directory. Current tooling explicitly sets `sys.pycache_prefix` to a fresh owned temporary directory and `sys.dont_write_bytecode=True` through `--python-expr` before probe or benchmark imports, then cleans only that owned cache directory. Historical receipts are unchanged.

```sh
python3 experiments/official-demo-node-performance/planner_pair.py \
  --sdk-root /absolute/Blendlink --baseline ad813ba7d398da77076f155cc04e172f3b60fc8d --candidate HEAD \
  --blend artifacts/verification-official-demo-performance/sources/cube_diorama.blend \
  --blender /absolute/Blender42 --blender /absolute/Blender52 --blender /absolute/Blender53 \
  --output artifacts/verification-official-demo-performance/material-index-pair
# Extra independent pair: --order candidate-first with only --blender Blender53.
node --test experiments/official-demo-node-performance/corpus-policy.test.mjs
```

## Next useful work

Keep the bulk material-use scan and its exact-binding tests. Prioritize real contributing normal/animated-loop/Radial domains or honest bake workflows before calling the tiny stock controls useful web ports. Retain output/fidelity gates while measuring preview load/compile/frame costs independently. Treat evaluated modifiers and texture payloads as separate geometry/transfer budgets; do not infer them from `.blend` size or node count.
