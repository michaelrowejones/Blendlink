# Hierarchical atlas packing differential

Status: prototype evidence, 2026-07-22. This directory does not implement the
production allocator.

## Question

The Cube Diorama Final plan has 38 separate native bake receivers in one
4096px atlas with 16px artist padding. The hierarchical allocator preserved
receiver ownership, but repeated plans reported only 0.2034–0.2094 occupancy
and 0.8822–0.8949 target achievement. Is that a truthful capacity limit, an
inner-chart problem, or an outer rectangle-allocation problem?

## Needle baseline

The inspected Needle Engine Blender add-on is 1.4.2. The exact cached source is:

`C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\.cache\needle-spike\addon\Needle Engine Exporter for Blender\lightmapping\lightmapping_pack.py`

SHA-256: `242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3`.

- Lines 38–145 create one proxy plane per receiver and transfer its packed
  scale/offset back to that receiver.
- Lines 163–223 pack the receiver proxies, disable rotation for the final pass,
  and reserve `2 * bake_margin + 4px` between receivers.
- Lines 335–465 Smart Project each receiver locally with an adaptive margin.

Needle's proxy side length is the sum of the source object AABB dimensions
times its Lightmap Scale (lines 65–90), rather than measured surface area or a
density target. Its ownership hierarchy and gutter are the baseline; its proxy
size formula is not a capacity proof for Blendlink.

## Measurements

`analyze-plan.cjs` executes the actual packed consumer plan, decodes the exact
float32 corner UV evidence, and compares covered UV area with receiver AABBs.
One representative run measured:

| Quantity | Measurement |
| --- | ---: |
| Covered UV area | 0.209370 |
| Sum of receiver AABB areas | 0.721601 |
| Usable atlas area after the 20px edge gutter | 0.980564 |
| Local chart area / receiver AABB area | 29.01% |
| Receiver AABB area / usable atlas area | 73.59% |
| Perfect-outer-layout upper-bound gain | 1.3589× |

The upper bound is approximately 0.2845 occupancy, matching the older global
island pack's approximately 0.2841 occupancy. The scene therefore fits; the
current failure is not truthful atlas capacity.

The largest inner envelopes explain why rectangle quality matters:

| Receiver | UV area | AABB area | Local fill |
| --- | ---: | ---: | ---: |
| Potted Plant - Bracken | 0.00199 | 0.10271 | 1.94% |
| Dresser | 0.03111 | 0.09853 | 31.57% |
| Bird Cage | 0.00127 | 0.05355 | 2.37% |
| Computer | 0.00110 | 0.04540 | 2.42% |
| Table | 0.02726 | 0.06659 | 40.93% |

Most of the worst envelopes are already nearly square. Enabling 90-degree
outer rotation is therefore not the primary lever. The fixed-orientation outer
Blender pack also changed between fresh runs, producing the occupancy/target
ranges above from unchanged input.

## Rejected local-only change

`blender_variant_probe.py` replaces only the local receiver packing shape in
memory, never saves, and runs the real plan. Both `CONVEX` and `CONCAVE` let
island AABBs interlock. The current exact published spacing contract is
conservatively verified at the island-AABB seam, so both variants correctly
failed that validator on the real Cube fixture (`Table` reached a 0px AABB
gap; `Shelf` reached 17.3px versus the required 20px).

An exact triangle-distance validator could make this design viable, but that
adds a second deep change and is unnecessary to clear the target. Keep the
validated inner AABB layout for now.

## Safest improvement

Replace only the outer Blender proxy-quad `pack_islands` call with a
deterministic, fixed-orientation rectangle allocator behind the existing
receiver-packing seam. Preserve:

- exact inner chart coordinates and `margin + 4px` same-owner spacing;
- one rectangle per native receiver;
- 20px atlas-edge and 36px cross-receiver gaps;
- uniform per-receiver transforms and aspect ratio;
- measured surface/camera/artist density ratios;
- transactional rollback and the final spacing validator.

The independent MaxRects prototype on these same receiver rectangles measured
0.24920 predicted occupancy and 0.97761 target achievement without rotation;
a bottom-left alternative measured 0.24766 and 0.97459. Both clear the 0.95
gate, while rotation was negligible. This is a measured improvement over
Needle/Blender's nondeterministic outer call without changing artistic intent.

Required promotion tests:

1. Pure deterministic rectangle cases, including identical dimensions and
   adversarial skinny/square mixtures.
2. Registered Blender headless proof of exact edge/cross-owner/same-owner
   gutters, density ratio, uniform transforms, cleanup, and rollback.
3. Repeat the same pack at least three times and compare byte-identical UV
   coordinates/hashes.
4. Run the real Cube plan and require target achievement at least 0.95 before
   the expensive Final bake.

`check-plan-determinism.cjs` is the unattended high-fidelity gate for item 3.
Run it from a packed consumer fixture; it executes two independent plans and
fails unless their decoded atlas-layout evidence has the same SHA-256 hash.
`local-pack-determinism.py` narrows that gate to one evaluated receiver and
also compares two reset-and-repack calls inside one Blender process.

## Current Cube result: quality passes, exact determinism does not

The promoted outer allocator cleared the quality gate on two independent
current Cube plans, but the complete plan did not clear the exact-hash gate:

| Run | Atlas-layout SHA-256 | Occupancy | Target achievement |
| --- | --- | ---: | ---: |
| 1 | `330cce2ff9603e2f908227feff6766faffed3f1a24296b1353be9380b134fee6` | `0.2439` | `0.9660` |
| 2 | `bf7d8bc92582f400664f8f964cfd2e21bf5640f0de351f1b78f62c85e0d4cff1` | `0.2460` | `0.9701` |

The first different stage is `freeze_evaluated_meshes`, not MaxRects. All 38
receivers kept byte-identical topology, while evaluated UV bytes differed on 16
receivers and every one had Bevel in its modifier stack. Replaying one captured
float32 snapshot produced 12 byte-identical Dresser local packs and six
byte-identical complete 38-receiver packs in one process. The supported claim
is therefore conditional: the pure allocator is deterministic for identical
rectangle inputs; it is not a whole-compiler determinism barrier.

The primary-source cause and full receiver list are recorded in
[`docs/research-blender-uv-evaluation-determinism-2026.md`](../../docs/research-blender-uv-evaluation-determinism-2026.md).
Blender 5.2 Bevel stores connected UV loops in pointer-hashed unordered sets,
then averages them with an order-sensitive float32 sum.

## Candidate policies tested and rejected

Every policy below was limited to disposable automatic atlas workspaces;
material UV maps and explicit `BLENDLINK_ATLAS_AUTHORED` data were left alone.

- Fixed decimal rounding through `1e-6` left cross-process differences; the
  full `1e-7` pair still differed in 11 receiver workspaces and all 38 final
  layouts.
- Guarded float32 16-ULP/2-ULP and 32-ULP/4-ULP buckets retained good capacity
  (`0.96785..0.97117` target achievement), but both still produced different
  final hashes and allocator routes.
- Needle-style Smart Project on every automatic receiver failed the exact
  20px gutter validator.
- Smart Project only on automatic pre-freeze Bevel receivers made one tested
  pair's allocator inputs exact, but 70, 80, and 89 degree variants achieved
  only `0.93008`, `0.92461`, and `0.93281` of target density.

No production canonicalization was promoted. The preferred repair is stable
iteration in Blender's Bevel UV average. A compiler-owned alternative remains
Future Work until fresh-process exact hashes, at least `0.95` target density,
exact gutters, authored-UV preservation, and two-state bake pixels all pass.

## Small-atlas regression differential — 2026-07-23

The retained baked-e2e source
`C:\Users\micha\AppData\Local\Temp\blendlink-baked-e2e-I258Xg\hero.blend`
(95,741 bytes, SHA-256
`f2751c4a71ebd6025f930af591e4e411c06549ad1d1b8f3647c88fa55bf81cf1`)
exposed a different hierarchy cost. It has three receivers in a 128px atlas,
8px bake margin, 4px guard, and a 12px/m target.

`blender_variant_probe.py` now records individual UV-boundary distance for
fixtures with at most eight receivers and exhausts every outer-rectangle
permutation and 90-degree receiver rotation. The probe never saves.

| Variant | Occupancy | Target | Edge | Cross-receiver evidence |
| --- | ---: | ---: | ---: | ---: |
| Production hierarchy | `0.196153` | `0.9333` | `12.000px` | receiver AABB and boundary both `20.000px` |
| Every fixed MaxRects permutation | same | same | same | best scale `0.885783537895`; production is `0.885783537806` |
| Every permutation plus receiver rotation | same | same | same | rotation gives no scale gain |
| Local `CONVEX` or `CONCAVE` shape flag | same | same | same | the source is already one connected concave island per receiver |
| Prior global `AABB`, `(margin + guard) / size` | `0.177917` | `0.8917` | `12.000px` | `24.000px` |
| Prior global `CONCAVE`, `(margin + guard) / size` | `0.250694` | `1.0583` | `12.005px` | exact UV-boundary distance `24.114px` |
| Global `CONCAVE`, `(2 × margin + guard) / size` | `0.072291` | `0.5657` | `20.000px` | exact UV-boundary distance `46.799px` |

The production outer heuristic is not the cause. Gallery and Day Decor consume
`67.2px + 16.8px + 20px = 104px`, exactly the 104px edge-usable width. At the
0.95 gate they need 105.5px, so the all-rectangle contract misses by 1.5px.
Each receiver's one concave cube-net island fills only 50% of its AABB.

The prior global concave pass interleaves those shapes while leaving
`24.114px`, above the required `2 × 8 + 4 = 20px`. Two independent Blender
processes produced the same UV hash
`b35c4d1cedb92e44048b27d359f2fac7622940401d133cf60851fa872ad6a542`.
It also preserves the original 16:1 and 200:1 receiver area ratios.

The current Cube Appearance source
`artifacts/release-dogfood/cube-diorama/fixtures/cube-diorama-web-appearance.blend`
(SHA-256
`d445e6f3f261163b4b779a787346872b461ec344b90a643a128b69aed91dbc01`)
did not justify keeping the weaker layout: the hierarchy measured
`0.248056` occupancy and `0.9742` target achievement, while the prior global
concave pass measured `0.284098` and `1.0426`. Its 20px edge, approximately
40px same-/cross-owner island AABB gaps, and density ratios remained safe.

Prototype conclusion: for fully unpinned derived atlas UVs, an ordinary
multi-object global concave candidate is a valid Blendlink-specific improvement
over Needle's proxy rectangles because Blendlink serializes the final packed
UVs and does not need Needle's per-object runtime scale/offset. Promotion
requires replacing the receiver-envelope validator with a bounded exact
island/triangle distance check, retaining transactional rollback, and testing
both candidates or a justified selection policy. Do not merely lower the
0.95 gate or pass `2 × margin + guard` as Blender's per-island margin; the
latter double-charges the native gap.

## Research commands

From the repository root, the high-fidelity and stage probes are:

```powershell
node experiments/atlas-packing-probe/check-plan-determinism.cjs
node experiments/atlas-packing-probe/compare-stage-probes.cjs
node experiments/atlas-packing-probe/compare-freeze-one.cjs
node experiments/atlas-packing-probe/portfolio-stage-probes.cjs
```

The small-atlas variants use one Blender command, for example:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  'C:\Users\micha\AppData\Local\Temp\blendlink-baked-e2e-I258Xg\hero.blend' `
  --background --python experiments/atlas-packing-probe/blender_variant_probe.py `
  -- prior-global-concave
```

`repeat_local_pack.py` is injected by the stage harness to replay captured
workspaces. These are research probes with fixture/tool paths documented in
their source; they are not production regression gates.
