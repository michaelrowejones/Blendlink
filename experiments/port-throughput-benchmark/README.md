# Port throughput and authoring-stage instrumentation

Research harness only, based on speed-pilot `ebd502f`. No SDK/runtime replacement, numerical gate changes, support promotion, Sheet/PR/publication changes. **No browser benchmark has been executed for this commit.** The independent native source oracle is a prerequisite; source/native failures must be resolved before timing candidates. CPU tests use synthetic timing/oracle controls and real short subprocesses, not fabricated GPU measurements.

## Predeclared fair workload

`plan.json` is pinned before runs. A lease selects at most eight workloads and ends after 120 seconds across both APIs. The default extents are 256×256 and 1024×512; both candidates use the same fullscreen QuadMesh, RGBA Float32 target, MSAA0, no depth/blending/tone mapping, and pixel ratio1. All outputs are stored and read after timing, preventing an unused result from becoming the workload.

The first input model repeats the **same separately captured 64 native RGBA32F input words** via one common nearest integer `textureLoad`. Three phases add integer index offsets 0/17/43 modulo64, without altering any source float. Both candidates receive the exact same vector node. All256 input words are independently checked at each phase before kernels run. This limits input entropy; it is a kernel-throughput baseline, not a claim about continuous fields or whole artist scenes.

The adapter implements `makeBridge(module,{buildHandTsl})`, `availableKinds`, and `createVariant({renderer,mode,kind,inputs:{vector}})`. The modes are explicitly `hand-tsl` / `native-generated`; absent modes/features must refuse. The hand callback invokes the actual current SDK builder, not a second arithmetic rewrite. The native callback uses the combined dependency-deduplicated generated library. Parameter/output/resource contracts must agree. The host pins both sources and optionally complete source directories. The first actual comparison configuration selects direct Noise Fac and F1 Distance only. The retained compiler comparison found Noise G/compositions outside the unchanged bounds, so these do not gain performance authority. Adapter-provided `noise-twice` / `noise-to-voronoi-first` represent two genuinely dependent calls and require their **own** independent native outputs. Missing hand F2 support is a refusal, never an alias to F1.

Projection is fixed in the configuration before runs: `rgba` compares all four wrapper outputs; `scalar` projects the wrapper's captured lane3 into RGB and exact alpha1 on both paths. A failed RGBA comparison may not be silently relabeled scalar. Separate explicitly preregistered trials may study scalar work, and must retain prior failed records. The current independent kernel research oracle requires BOTH absolute error≤2^-20 AND ULP≤8. Scalar alpha1 is exact. These are research limits against separately captured source outputs, not a new Blender EEVEE scene-parity contract. Pair equality alone never passes accuracy.

## Measurements

For each workload, source/library construction is fresh within that renderer session. The first mode alternates by workload; block order alternates by repetition. Shared renderer/driver caches already exist, so these are **first-instance-in-process**, not cold-OS measurements.

- `nodeConstructionMs`: adapter/TSL graph construction, before shader generation.
- `sourceBuildMs`: `renderer.debug.getShaderAsync` wall time. It measures node/source generation, not a GPU compiler duration.
- `pipelineCompileAwaitMs`: `renderer.compileAsync` wall time. It can include CPU/backend work and is not isolated GPU compilation.
- `firstRenderCompletionMs`: first render plus explicit completion; includes target/backend work.
- `warmCompileAwaitMs`: repeat `compileAsync` on the same material after accuracy draws; explicit warm path.
- Per block: **12 discarded warmup frames**, completion drain, then20 synchronous API submissions with no readback in that interval. Report CPU API submission per frame separately from subsequent completion-drain wall time and one readback wall time/byte count.
- Three paired blocks retain all observations and distributions (minimum, median, p90/p95, maximum, mean, standard deviation). GPU queries run in a separate diagnostic phase, three queries/block ×one draw/query, followed by explicit query resolution and target readback before another query.

The prospective plan was revised **before any browser measurement** from eight overwriting draws/query to one observable draw/query. This avoids uncertain tiled-driver hidden-surface/dead-store elimination; it adds no extra targets and changes no accuracy or performance thresholds. The earlier CPU stage observations remain verbatim and refer to the plan hash captured at commit25afa9d.

Only WebGL2 `EXT_disjoint_timer_query_webgl2` with an actual available, non-disjoint, positive-duration result earns GPU milliseconds. Unsupported, disjoint, invalid or timed-out results remain `null` with a reason. WebGPU feature presence is recorded but GPU duration is **null**: the bounded harness does not verify fresh raw timestamp resolution there. A queue wait/readback/submission clock is never substituted. `trackTimestamp:false` avoids nesting Three queries inside owned GL queries.

Meaningful performance reporting is Metal-only. SwiftShader runs correctness/compile observations only. At least **nine verified GPU samples per mode** and passed independent accuracy are required. The predeclared native/hand paired-duration signal thresholds are median>1.10 AND p95>1.15 for regression, median<.90 AND p95<.95 for improvement. These are local bounded-workload signals, not statistical proof or universal winners. With absent GPU timings there is **no performance winner**, even if CPU submission is lower.

## Run after Root grants the GPU lease

Create an actual configuration from `example-config.json`, with immutable independently validated native input/reference files and real source paths. Pin the complete generated directory and the actual hand-builder module closure. A mandatory independently reviewed closed native receipt and its expected SHA bind the direct report, exact input file, selected kind files and original source shaders; arbitrary replacement1024-byte arrays refuse. Missing references fail before browser launch. An unavailable feature/kind or failed accuracy leaves a failed zero-credit namespace; use a fresh namespace for a revised declared experiment.

```sh
node --test experiments/port-throughput-benchmark/core.test.mjs
node experiments/port-throughput-benchmark/run.mjs /absolute/config.json --execute-browser
node experiments/port-throughput-benchmark/verify.mjs /absolute/config.json /absolute/output/report.json /absolute/fresh-closed.json
```

The host pins config/plan/adapter/generated module/hand parameters/native references/Three and optional source trees, rechecks them after capture, snapshots served harness files, and exclusively archives input controls, each accuracy readback and shader sources. The reader rehashes archived bytes/current pins, recomputes every accuracy relation and GPU/CPU summary, validates actual API/profile and planned census, and refuses synthetic GPU durations on WebGPU. One full-sized actual timing target per mode/workload is checked at phase17 before performance collection, streamed to an exclusive token/API-owned binary archive, and independently rechecked at every pixel in the reader. The modulo8 mapping and scalar projection use exactly the native64 expected words. Additional timing/query readbacks consume output but do not add independently archived numerical credit. This benchmark reader is not the product's qualification reader: it does not claim saved Final, whole-scene, source ownership or renderer lifetime coverage.

## Measure port work without inventing authoring time

`stage-run.mjs` wraps an actual command with `spawn(...,shell:false)`, monotonic process elapsed time, exit/signal/error, timeout/process-group cleanup, source-instrumentation hash and stdout/stderr hashes. Fresh output directories are exclusive. Declared stages are **tooling, generation, adapter, preflight, validation**; budgets are in `plan.json`. Failed attempts remain recorded. `SCENETOWEB_STAGE_ATTEMPT=2` distinguishes a retry in the same method/trial. `summarizeStages` sums all observed command attempts, labels missing stages unobserved and never calls the sum a parallel critical path.

```sh
node experiments/port-throughput-benchmark/stage-run.mjs generation native-generated 1 /absolute/new-stage -- python3 /absolute/generate.py ...
node experiments/port-throughput-benchmark/stage-run.mjs preflight shared 1 /absolute/new-preflight -- node --check /absolute/adapter.mjs
```

The observations retained here record actual CPU syntax/preflight and this harness's validation commands only. Tooling/generation/adapter work is unobserved, not zero. There is no claim to measure LLM thinking, interactive editing or engineering time from commit timestamps.

For a fair **next-node authoring** study, freeze the target node/context/parameter/domain/output scope and held-out native oracle first; keep the definition of done identical (independent accuracy plus the same installed canary/required reader). Counterbalance manual/generated methods over two comparable tasks or authors. Record explicit author-active sessions, breaks and queue waits separately from commanded stages; report both cold tool setup and amortized per-port work, all retries and failed approaches. Begin timing before implementation, not retrospectively at the first successful commit. This instrumentation supplies command evidence, not a retrospective claim of developer speedup.

## First actual Metal baseline (r3)

The independent reader passed both APIs and rechecked **18,874,368 full-frame words**, 12,288 small accuracy words and1,536 input-control words. All gates passed; WebGPU scalar outputs were exact. WebGL native F1 had110,592 full-frame word differences, maximum1ULP, with zero contract violations. Only direct Noise Fac/F1 Distance scalar outputs were compared. The native baseline uses generic **RGBA wrappers before scalar projection**; it is not an output-aware scalar-only implementation.

| Metal WebGL2 workload | Hand GPU median ms | Generic native GPU median ms | Paired native/hand median |
|---|---:|---:|---:|
| Noise256² | .167 | .692 | 4.14× |
| Noise1024×512 | .711 | 2.178 | 3.50× |
| F1 256² | .094 | .486 | 5.18× |
| F1 1024×512 | .443 | 2.744 | 6.12× |

All four crossed the predeclared regression thresholds with nine verified GPU samples/mode. WebGPU has no GPU-time winner. `evidence.json` retains full distributions, source-build/compile wall times and shader sizes. Its source-size/build distributions explicitly describe two different extents with shared caches, not repeated cold compilation. API capture wall times were1.23s WebGPU/4.15s WebGL. Root's next specialization can avoid unrequested native Color work; it must pass the same independent gates and receive a fresh measurement. The generic baseline remains unchanged.

```sh
node experiments/port-throughput-benchmark/verify.mjs /tmp/scenetoweb-port-throughput-metal-r3-config.json /tmp/scenetoweb-port-throughput-metal-r3/report.json /tmp/new-benchmark-recheck.json
```

## Output-aware scalar trial

The new independent trial used the **same plan, gates, native authority, input bytes, extents, hand runtime and timers**. Fourteen config fields match; all eight hand fragment shader files are byte-identical between trials. Only the native scalar adapter/module changed: Noise disables unrequested Color; F1 uses its reviewed Detail0/Normalizefalse leaf. Both APIs passed all18,874,368 full-frame words **exactly**, versus generic WebGL F1's previously accepted1ULP differences. The frozen generic report/evidence remains unchanged.

Metal WebGL paired native/hand median ratios were **1.59×/1.74× for Noise** and **3.58×/5.35× for F1** at256²/1024×512. All still crossed the predeclared regression thresholds. These are separately paired trials; cross-run differences do not establish an isolated specialization speedup. Source size decreased to roughly33KB WGSL/37–38KB ES, but that did not establish a GPU-performance win. WebGPU GPU timing remains unavailable. See `specialized-evidence.json` for distributions and source hashes; nine samples mean reported p95 is the maximum.

**Timing-label correction for both frozen raw reports:** pinned Three `Renderer.js:717–730` shows `getShaderAsync` calls `compileAsync` internally at719. The legacy `sourceBuildMs` field therefore measures that combined API wall time, not pure CPU source generation. The following explicit `pipelineCompileAwaitMs` is already warm. Neither is an isolated GPU compiler measurement; raw files were preserved.

```sh
node experiments/port-throughput-benchmark/verify.mjs /tmp/scenetoweb-port-throughput-metal-specialized-r1-config.json /tmp/scenetoweb-port-throughput-metal-specialized-r1/report.json /tmp/new-specialized-recheck.json
```
