# Qualified Blender 5.3 CPU Displace slice

The fresh automatic `next52` transaction qualified this partial route on source commit `08306e5a857aa0e1ef7f8f9d3f8aecd1931eb050`. The outer wrapper reports `productionCredit=true`, `workspaceStable=true`, and `supportPromotion=false`; classification is a separate reviewed metadata change. Both authoritative readers produced byte-identical receipts with SHA-256 `6fab97ac06af40f2554ca423c47c93ee41906ca53ded9657beb0344ba59c442c` and runtime fingerprint `9d64b4e4f40f0e795a5594e20d5115c94df8740cd1fd6afd54449cb0fed81a69`. [evidence.json](./evidence.json) retains the exact closed receipt, wrapper digests and failed-run lineage.

The supported source slice is pinned Blender 5.3.0 build `02f0899d78e3`, macOS arm64, CPU compositor AUTO/FULL. The numerical captures explicitly request FULL. One terminal actual `CompositorNodeDisplace` accepts unlinked native float2 Displacement: positive zero or signed normal Float32 components with magnitude from `2^-16` through `8192`. Interpolation is Nearest or Bilinear, with Clip on both axes. The Image is direct Render Layers Image or a native single RGBA value from unlinked defaults/RGB, with alpha one and positive zero or normal RGB magnitude from `2^-16` through `16`. Whole-node groups and reroutes preserve the actual source class and bindings.

The native schema has Image, Displacement and three sampling menus; it has no legacy Scale X/Y sockets. A single Image copies unchanged. A single Displacement translates the finite image domain before realization. Source and output require square pixels, zero-origin full frames, dimensions `4..8192` and at most `4,194,304` pixels. Linked displacement/menu controls, fields and casts, animation/drivers/NLA, muted producers, arbitrary Image producers/windows, mixed/spatial chains, downstream consumers, borders/crop and other sampling modes remain unqualified. Older Blender versions remain unsupported.

The qualification keeps these counts distinct:

| Stage | Actual count |
| --- | ---: |
| Admitted saved source graphs / built Final exports | 16 / 16 |
| Injected same-pixel native reference frames / CPU renders | 160 / 320 |
| Browser frame cases, four actual API/profile tuples | 160 |
| Comparison installations / frame cycles | 192 / 480 |
| Unique owned Python prefixes | 19 |
| Direct linear Float32 words, exact | 4,344,064 |
| Installed/repeated linear Float32 words, exact | 26,064,384 |
| Separate display projection words | 26,064,384 |

The 192 comparison installations are 16 scenes × three cycles × four tuples. Baseline, detached and cancellation preparations are separate controls. The source-only policy also passes 19 positives, 20 named refusals and one disabled-root omission with zero render calls or GPU initialization.

The browser first captures the actual installed HalfFloat/MSAA-zero scene-pass inputs. A fresh independent CPU compositor then copies those pinned words through an owned Image and evaluates native Displace. This Image is deliberately source-unadmitted: the oracle grants no new Image producer, Render Layers beauty, EEVEE shader/material, Cycles-versus-Three or whole-scene appearance credit. It proves the Displace arithmetic for the held inputs, separately from source admission and actual saved Final installation.

All four actual Metal/SwiftShader WebGPU/WebGL2 tuples pass exact pre-display RGBA comparisons, including alpha. Direct and public-installed linear outputs retain the unchanged native word gate. The installed display and linear readbacks are queued synchronously in the same animation callback before either map/fence is awaited; probes retain the actual scene-pass frame ID. Actual Raw display has its separate existing clamp-to-[0,1] absolute RGB gate of `3e-5`, with alpha words/nonfinite classes exact. It retains **3,702 word differences**, maximum clamped absolute error `2.9802322387695312e-8`; there is no bit-exact display claim.

Displace clones raw texel loads without changing borrowed PassTexture sampler/UV/reference/value. Actual FRAME producers are scheduled under caller clear/tone/render-hook state before an owned RTT reset, using the native NodeFrame cache. The CPU RGBA path preserves native weight/product/horizontal-pair Float32 rounding through private integer/bitcast boundaries; no epsilon, quantization, pixel mask or output repair is used. Other image samplers keep their existing arithmetic. The precision work and retained counterexamples are documented in [the separate research record](../compositor-displace-precision/README.md).

A finite field owns at most one additional RGBA32F RTT: **64 MiB logical color bytes** at the enforced pixel cap. Resampling adds two 256×32 RGBA32F mapping tables: **256 KiB persistent logical CPU data and nominal texture bytes**. Mapping refresh is bounded `O(width+height)`; transient maps, driver overhead, caller targets and the wider installation are separate. Filtered Displace uses at most one private uint-zero rounding uniform. The additional staging ALU/bitcasts are not free or independently benchmarked; staging adds no RTT or draw pass. Single constant RGBA input needs no resampling RTT. The cap is a structural bound, not a full-cap allocation/performance benchmark.

The proof checks physical resize/DPR, pixel-budget refusal before growth, invalid target/viewport/scissor recovery, preparation/commit/cancellation/reapply, source/caller mesh/material/geometry/callback preservation, and exact owned texture identity restoration. Saved-original renderer disposal must retire all three original fractional-path handles once while retaining borrowed replacements. Imported private light resources are separately owned. Whole installed frames stay within the predeclared 16-draw bound; same-frame diagnostic probes require two draws for a field and one for a single value. These are measured controls, not a whole-pipeline zero-resource claim.

Readbacks stream as exact binary Uint32 bytes to exclusive owned files after comparisons. The endpoint validates the active API, fixed frame/role, byte count and SHA. All 13 original roles and 2,080 raw files retain their filenames and independent reader census. This removes a browser-automation payload bottleneck; no serialized pixels or readback transport is shipped as product behavior.

The earlier `next45`, `next46`, `next48`, `next50` and `next51` failures remain unchanged with zero qualification credit. They exposed, respectively, caller-geometry baseline setup, imported shadow lifetime, producer clear-alpha state, interpolation contraction, and oversized automation response transport. Their fixes preserve the native oracle and exact pixel gate. The initial source-unadmitted feasibility control—48 Displace/Translate pairs, 96 CPU renders, 3,156,960 exact words—also remains research-only.

A new full proof must use a fresh automatic transaction:

```sh
PATH=/tmp/mrj-tooling:$PATH node scripts/test-node-port.mjs \
  compositor-displace-single --profile mac-53 \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --evidence artifacts/verification-displace-fresh
```

The authoritative next52 artifacts are machine-local under `artifacts/verification-displace-next52-manifest`. Primary native source hashes and licenses are in [sources.json](./sources.json). Other ports keep their own source snapshots; this record makes no all-ports freshness claim.
