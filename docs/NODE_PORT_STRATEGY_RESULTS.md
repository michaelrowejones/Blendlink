# Port-speed strategy experiments

These are development experiments, not node-support promotions. They compare
Blender 5.3 source/native behavior and the existing SceneToWeb TSL builder on
Apple M5 Pro. Source, tool, input, shader and raw-output pins remain in each
experiment's evidence. No PR, release, npm publication or hosted proof is needed.

## Decision

Use a hybrid pipeline. Automate discovery, canonical reference generation,
structural contracts, case counts and shared transport. Choose runtime kernels
per output/mode only after independent correctness and performance checks.
The current hand-written TSL remains the faster tested runtime for both scalar
workloads. Generic source import is a useful implementation/oracle starting
point; it is not an automatic production replacement.

| Metal WebGL2 workload | Generic imported / hand GPU median ratio | Output-aware imported / hand ratio |
| --- | ---: | ---: |
| Noise Fac, 256×256 | 4.14 | 1.59 |
| Noise Fac, 1024×512 | 3.50 | 1.74 |
| Voronoi F1 Distance, 256×256 | 5.18 | 3.58 |
| Voronoi F1 Distance, 1024×512 | 6.12 | 5.35 |

Ratios are paired-sample medians with nine verified nondisjoint GPU samples per
mode/workload. They are not ratios of separately computed medians. Targets use
the same repeated native 64-point input distribution. This is one device,
browser and bounded microbenchmark; WebGPU GPU timing is unavailable. The
specialized run independently checked 18,874,368 full-target words exactly,
plus 12,288 small-grid and 1,536 input words. Workloads, gates, timers, native
authority and all eight hand shaders were unchanged between runs.

## Reusable results

- A combined library deduplicates 13 canonical source chunks, including one
  hash implementation. Output-aware linking reduces retained functions 43→28
  and module bytes roughly by half without rewriting kernel equations.
- Native source-kernel capture reused the existing calibrated RGBA32F helper:
  six cases in 1.63 seconds guarded process time. A smaller actual EEVEE radial
  crosscheck took 3.11 seconds and matched 256 direct-kernel words exactly.
  Noise/Voronoi/compositions have source-kernel baselines, not actual-material
  qualification. These contexts remain separate.
- Full-color Noise and dependent graphs failed the original strict numeric
  gate. Staged helper observations isolated one literal offset rounding
  difference; fixed source inputs can be captured once as pinned data. The
  six-value table is not yet a runtime fix or general precision qualification.
- Per-family compiler dependencies plus shared compiler/backend flags can
  produce affected-work plans. Combined executable libraries still require
  combined regeneration and current shared-runtime checks.
- Isolated fast protocol variants now join the local pipeline checks: 225 Node
  passes, three platform skips and 11 Python passes in about nine seconds.

## Remaining boundaries

SwiftShader lost its WebGPU device during Noise execution. The current combined
library is not qualified across all profiles. Generic compiler literal handling
also required a guarded, value-preserving FLT_MAX spelling adapter.

The raw `sourceBuildMs` field includes Three's `getShaderAsync`, which awaits
`compileAsync`; subsequent compile calls are warm. No isolated CPU-generation,
cold-driver compilation or authoring-time speedup is claimed. Command/stage
timings are measured; agent reasoning and old developer effort were not.

Detailed results/replay instructions: [runtime comparison](../experiments/port-throughput-benchmark/README.md),
[source bridge](../experiments/shader-kernel-bridge-next/README.md),
[native references](../experiments/native-kernel-reference-pilot/README.md),
[offset diagnosis](../experiments/noise-offset-fma-diagnostic/README.md),
[update planning](../experiments/shader-update-plan-pilot/README.md).
