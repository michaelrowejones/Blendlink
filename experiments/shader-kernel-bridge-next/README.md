# Composable canonical kernel bridge

Research only. No SDK changes, support promotion, saved Final or lighting claim.

One canonical library combines Gradient, Checker, White Noise, Noise and Voronoi. Native metadata discovers 46 entrypoints; this experiment retains six wrappers. Thirteen source chunks are deduplicated before compilation, including exactly one shared hash library. Naga compaction leaves 43 unique internal function names. A single Three `CodeNode` per renderer backs all wrappers, including actual dependent Noise → Noise and Noise → Voronoi graphs.

Metal WebGPU and WebGL2 completed all 18 draws. Exact input controls cover 512 words; primary outputs cover 4,096 words. The two APIs differ in 58 words. Against the independent Blender Python GPU Metal reference, radial Gradient and Voronoi F1/F2 are bit-exact on both APIs. Noise Fac/R is exact, but Color.G differs by up to 310 ULP. Both dependent compositions fail the unchanged `abs ≤ 2^-20 AND ULP ≤ 8` gate. Overall: 3,072 native comparisons, 746 word differences and 702 violations. Do not infer interchangeable full-color kernels from successful compilation.

SwiftShader WebGPU passed input and the first three legacy-family cases, then lost its device during Noise readback. Software WebGL2 was not reached. This is not an all-profile success.

## Two concrete compiler boundaries

The native Metal oracle needs the canonical `GPU_METAL` preprocessing choice: Blender's lowering tool intentionally guards 20 method declarations. The native-only export removes those declarations and proves every remaining token unchanged; browser kernels remain unchanged. The oracle consumes pre-Naga GLSL, never target WGSL/ES. Original failed placements, including a compiled-but-zero result, remain excluded.

Naga 30 emits FLT_MAX as a decimal spelling rejected by Dawn. `adapt-max-literal.py` changes only three exact known tokens to `0x1.fffffep+127f`. Integer RNE and independent bit guards prove value `0x7f7fffff`; the native FLT_MAX definition is pinned. Original/adapted WGSL, minimal repros and adapter SHA/version/count are archived separately. No arithmetic, inputs, outputs or gates are repaired.

## Reproduce and replay

Use the old pilot's isolated tool bootstrap. Run `generate.py --blender-source ... --shader-tool ... --naga ... --out NEW`, then `adapt-max-literal.py --generated NEW --naga ... --out ADAPTED`. `run.mjs ADAPTED NEW_CAPTURE metal|software` performs the bounded browser capture; coordinate GPU leases first.

Current artifacts are under `/tmp/scenetoweb-shader-kernel-next-build`. CPU-only replay:

```sh
node experiments/shader-kernel-bridge-next/verify.mjs /tmp/scenetoweb-shader-kernel-next-build/adapted-r2 /tmp/scenetoweb-shader-kernel-next-build/browser-r2-metal - /tmp/new-metal-close.json
node experiments/shader-kernel-bridge-next/compare-native.mjs /tmp/scenetoweb-shader-kernel-next-build/adapted-r2 /tmp/scenetoweb-native-kernel-direct-r4 /tmp/scenetoweb-shader-kernel-next-build/browser-r2-metal - /tmp/new-native-comparison.json
```

`-` explicitly selects Metal-only scope. The comparison writes the failed result and exits nonzero. `adapter.mjs` exposes shared generated functions and an existing-production TSL builder hook; F2 has no matching hand-written comparator and refuses. The separate benchmark owns performance measurement.

Original shader copyright and license headers are retained. Voronoi carries `MIT AND GPL-2.0-or-later`; other inspected Blender libraries carry GPL-2.0-or-later. Generated derivatives are not labelled MIT. See source/tool pins and retained histories in `sources.json` and `evidence.json`.
