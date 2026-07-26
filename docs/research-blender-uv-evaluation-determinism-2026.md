# Blender 5.2 evaluated-UV and packing determinism audit

Status: primary-source audit and differential probes complete; root cause verified
for a direct-Bevel receiver. No production behavior changed by this note.

Date: 2026-07-22

## Executive conclusion

The Cube Diorama atlas-plan drift begins before Blendlink's outer packer. The
same evaluated topology can contain different UV float32 values in different
evaluations. On Blender 5.2.0 LTS the Bevel modifier has a concrete source-level
ordering seam: UV-connected loops are stored in unordered, pointer-hashed
containers, then reduced with an order-sensitive float sum. A Bevel-only
receiver reproduced two exact UV hashes with identical topology; its 11 changed
scalars differed by exactly one float32 ULP.

That upstream seam is large enough to invalidate a whole-atlas byte-stability
claim. Two independent current packed-consumer Cube plans produced atlas-layout
SHA-256 values `330cce2ff9603e2f908227feff6766faffed3f1a24296b1353be9380b134fee6`
and `bf7d8bc92582f400664f8f964cfd2e21bf5640f0de351f1b78f62c85e0d4cff1`.
Occupancy moved from `0.2439` to `0.2460`, and target achievement moved from
`0.9660` to `0.9701`. Both clear the quality gate, but neither exact UV bytes nor
the reported density result are reproducible yet.

Blendlink's MaxRects outer allocator remains deterministic for identical input
rectangles. It is not, by itself, a deterministic compiler barrier: the
evaluated/local UV stages own the rectangle dimensions passed across that seam.

`preserve_all_data_layers=False` is not a determinism control. It avoids the
second evaluation within one process by copying Blender's cached result, but the
cached result still varied across fresh processes. `True` remains necessary when
the compiler must preserve every authored UV layer; Blender's API explicitly
says the default computes only the subset needed for display and rendering.

Blendlink's deterministic MaxRects outer pack is still an evidence-backed
improvement over Needle 1.4.2. Needle's lightmap operator first constructs a
mesh list from a Python `set`, and Blender's box pack invoked by that operator
explicitly uses a non-deterministic sort. Blender's own `pack_islands` path has
no random seed or threaded reduction, but equal-size and exact geometric ties
still inherit input order. Smart Project likewise has no RNG, but uses C
`qsort` with an equality-returning face-area comparator before greedy grouping.

## Exact provenance

The installed binary reported:

- Blender `5.2.0 LTS`
- build hash and full upstream revision
  `fbe6228777e7d9afefcd61a413844e790ae75db7`
- build date `2026-07-14`; revision date `2026-07-13`
- branch `blender-v5.2-release`

The source was read at the exact [official Blender revision][blender-revision]
through Blender's official Git repository / official GitHub mirror. Relevant
file hashes are:

| Source path at `fbe6228777e7d9afefcd61a413844e790ae75db7` | SHA-256 |
| --- | --- |
| `source/blender/makesrna/intern/rna_main_api.cc` | `bbf3a4d5b1b44812b24ae9a383e5e71d7cfe3176f1ae2ca38e65095cde181257` |
| `source/blender/blenkernel/intern/mesh_convert.cc` | `249b9ceb156b9b5238899d4853d274c1aafacf87560bc7802308831fca297bf9` |
| `source/blender/blenkernel/intern/mesh_data_update.cc` | `27d9f5dad35d51ad03ca7433aa30111954c6c35f1b72af6c8a693105d8d490ce` |
| `source/blender/modifiers/intern/MOD_bevel.cc` | `6e63831e7bce74dcd053824d5998cbaaa2a8f448097c837dd2032ca9d800d291` |
| `source/blender/bmesh/tools/bmesh_bevel.cc` | `fc2ec3608dbf657ea62a972b6a7da27cfcdd18aa28a89f9d031fb7a771a35fd3` |
| `source/blender/blenlib/BLI_hash.hh` | `7f6b3c65703da2bea8afbc7303194db626ed89ee776079913f4d9894d2e1d15f` |
| `source/blender/blenlib/BLI_set.hh` | `c7b4a167fbbc3db175e51373abb85bd0cbe1263e2bd68cc31cd9717a24ce0b09` |
| `source/blender/blenlib/BLI_map.hh` | `236ceadf1c36a6e452538529f550bb9a61c4d2efc16cbb8419861fdd638bd5c7` |
| `source/blender/modifiers/intern/MOD_subsurf.cc` | `9a427137e981b10726d769b2cc8e493f03024d8acddad5b524bb201374f778c1` |
| `source/blender/modifiers/intern/MOD_nodes.cc` | `52266d75dcc465413bb8b5cffe832e2ff89a78441757d14a57c530c7d3ec20b4` |
| `source/blender/modifiers/intern/MOD_solidify_extrude.cc` | `8fe0a32352683d711e9b46ccb2ef4a82c4f3f039724e34cf95858b2224fddb1e` |
| `source/blender/modifiers/intern/MOD_solidify_nonmanifold.cc` | `36d8ce0ce40f2d28939c8fb9b72b7571c7069b62061f779c623131cc79974dd7` |
| `source/blender/editors/uvedit/uvedit_unwrap_ops.cc` | `5fcbf1874f777051b8aa59d0d9ae0a2e102487bbb30580f3d525cde9da1a6907` |
| `source/blender/geometry/intern/uv_pack.cc` | `fceea2703186616b506e2dac16d47ed49e83362104447f5f2a1a77554b4d94aa` |
| `source/blender/geometry/intern/uv_parametrizer.cc` | `e32889ab9ba344267437fdc7ce8589b357cb0989896e17fbc49bae75019fc6b7` |
| `source/blender/blenlib/intern/boxpack_2d.cc` | `6b22eded5671fbabd3f832b73085a98797e76ecaaae2c318c77de9eb3800a589` |
| `source/blender/blenlib/intern/sort.cc` | `734371b50bfc4bb6ccede2a79693f17bcfa39c4357eda25b41134cc63663b071` |
| `source/blender/blenkernel/intern/layer_utils.cc` | `2e97c60369c13420567c235b58cf347d567cf4b559e72fc899322e69423af124` |
| `scripts/startup/bl_operators/uvcalc_lightmap.py` | `91343cff52f6a6bd1dcba4e77efec481a2dfd5bc9e7cb83d455cd364015b9b65` |
| `source/blender/python/mathutils/mathutils_geometry.cc` | `856608aa63e9d79d4928b8a15124114533434ef1c5d0ddecc518fd83e7930a70` |

Needle baseline:

- package/add-on version: `1.4.2`
- normalized local source path:
  `.cache/needle-spike/addon/Needle Engine Exporter for Blender/lightmapping/lightmapping_pack.py`
- SHA-256:
  `242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3`

## Why `new_from_object(..., preserve_all_data_layers=True)` evaluates twice

The public RNA function calls `BKE_mesh_new_from_object_to_bmain` and describes
an evaluated object as producing its final geometry. It also states that
preserving all layers retains UV maps and vertex groups, while the default only
computes layers required for viewport display/rendering
([`rna_main_api.cc:355-379`][rna-call],
[`rna_main_api.cc:1159-1184`][rna-contract]).

For an evaluated mesh, `preserve_all_data_layers` selects
`mesh_new_from_mesh_object_with_layers`, rather than copying the already cached
evaluated mesh ([`mesh_convert.cc:884-908`][mesh-branch]). That function shallow
copies the evaluated object/runtime, points it back at `data_orig`, asks for
`CD_MASK_MESH`, and calls `mesh_create_eval_final`
([`mesh_convert.cc:831-881`][mesh-reeval]). The latter calls the modifier
calculation again ([`mesh_data_update.cc:1215-1223`][mesh-final]). The Python
binding hardcodes `preserve_origindex=false`; it offers no original-index or
evaluation-order control ([`mesh_convert.cc:986-993`][mesh-bmain]).

Consequently:

- `True` performs another modifier-stack evaluation with all data layers.
- `False` copies the process's existing evaluated result for this mesh path.
- Neither option promises identical UV floating-point bytes across fresh
  processes.
- Switching to `False` globally could silently drop authored UV layers that are
  not currently demanded by Blender's display/render dependency mask.

## Verified Bevel source seam

The modifier converts the mesh and its CustomData to BMesh, executes
`BM_mesh_bevel`, converts back to an evaluated mesh, and returns it
([`MOD_bevel.cc:145-269`][bevel-modifier]). The final
`debug_randomize_mesh_order` call is Blender's global opt-in debugging hook, not
ordinary production randomness ([`MOD_bevel.cc:269-294`][bevel-debug]). No
threaded reduction or RNG is required to explain this defect.

Inside the bevel operation:

1. `UVVertBucket` is `Set<BMLoop *>`, and the vertex map is
   `Map<BMVert *, Vector<UVVertBucket>>`
   ([`bmesh_bevel.cc:332-336`][bevel-types]). Blender documents both `Set` and
   `Map` as unordered open-addressing containers
   ([`BLI_set.hh:7-18`][set-doc], [`BLI_map.hh:7-19`][map-doc]).
2. Blender's default pointer hash is the pointer address shifted right by four
   bits ([`BLI_hash.hh:216-225`][pointer-hash]). Allocation addresses therefore
   affect bucket and iteration order.
3. Bevel groups source loops whose UV deltas are below
   `STD_UV_CONNECT_LIMIT` into those sets
   ([`bmesh_bevel.cc:1085-1129`][bevel-connectivity]).
4. New-face CustomData, including loop UVs, is initially interpolated with
   `BM_loop_interp_from_face`
   ([`bmesh_bevel.cc:1226-1305`][bevel-interpolation]).
5. The source explicitly says interpolation has imperfections, so
   `bevel_merge_uvs` iterates each unordered set, adds its UVs into a float32
   accumulator, divides, and writes the average back
   ([`bmesh_bevel.cc:1132-1163`][bevel-merge]). Float addition is not
   associative. A different pointer-driven iteration order can therefore
   change the rounded result while topology and the multiset of inputs remain
   identical.

This is a causal explanation, not merely correlation: the observed output
changes are exactly the size and shape this reduction predicts.

## Differential experiments

Research-only probes live in
`experiments/blender-uv-source-audit/bevel_evaluation_probe.py` and
`experiments/blender-uv-source-audit/needle_lightmap_order_probe.py`. The
whole-Cube stage trace and candidate-policy probes live in
`experiments/atlas-packing-probe/repeat_local_pack.py`,
`compare-stage-probes.cjs`, `compare-freeze-one.cjs`, and
`portfolio-stage-probes.cjs`.

### Direct Bevel receiver

Source scene: downloaded Cube Diorama `cube_diorama.blend`, SHA-256
`a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e`.

Object `Cube.003` has one Bevel modifier. Thirty preserve-all evaluations in
one process retained exactly 56 vertices, 216 loops, 54 polygons, and one
`UVMap`, but produced two hashes:

- `1e90d5121626e004ae799f9d120ef0a4581f7db43bff71a2a8e6b08536af85d4`
- `ab474c1fc0cb1e6ae07b6f412a3e5ddbbde6baeecd79f5f40fc43f0d238f86d4`

Exactly 11 UV scalar values changed. Every nonzero absolute delta was
`5.960464477539063e-08`, one float32 ULP near these values. Ten fresh
preserve-all processes produced both hashes (4/6 split).

`preserve_all_data_layers=False` stayed at one hash for 30 calls inside one
process, confirming the cached-copy branch, but ten fresh processes still
produced both hashes (8/2 split). It is therefore not a cross-process fix.

### Controls and scope

- Subdivision-only `Potted Plant - Bracken`: 30 repeated evaluations and five
  fresh processes all produced
  `7b01cf945b7ee8beef2c700f10c100d6b3ee334f0ef5caf3cca0a216015a2e78`,
  preserving `UVMap`, `Stem`, and `Leaf`.
- Geometry-Nodes-only `Computer`: five fresh processes all produced
  `dd8ac59ccb2f67370827127eb61927dc2c641a1f481adc0b8c8a20a0104d0e67`.
- Bevel then Subdivision `Dresser`: 30 repeated and five isolated fresh
  evaluations happened to be stable at
  `5a30e58f08bd3ff9e59eddc18bc223c47b6e9297e8d64c4abec22b4a6bdbcc83`.
  This does not exonerate Bevel: pointer allocation is context-sensitive, and
  the full compiler probe found the shared Bevel correlation across the 16
  differing receivers. It does show the seam is not guaranteed to manifest for
  every object or allocation history.
- `MOD_nodes.cc` conservatively requests generic property data
  ([`MOD_nodes.cc:123-128`][nodes-mask]). The stable control only says the
  particular Auto Smooth node graph is not implicated; Geometry Nodes in
  general can contain order-, ID-, time-, or simulation-dependent operations.
- No independent Solidify-only differential fixture was present in this scene.
  The Solidify and Subdivision sources were pinned above, but this audit does
  not claim universal determinism for those modifiers.

### Full Cube compiler trace

Two clean Blender 5.2 processes were fingerprinted after evaluated freeze,
authored-UV fallback, atlas staging, evaluated-UV repair, Average Islands
Scale, weight scaling, receiver-local packing, and outer allocation. The first
different seam was the evaluated freeze:

- topology was byte-identical for every receiver;
- evaluated UV bytes differed on 16 receivers: `Beam2`, `Beam2.001`, `Beam3`,
  `Beam4`, `Beam5`, `Bench`, `Cube.003`, `Cube.004`, `Cube.006`, `Cube.007`,
  `Cube.008`, `Desk`, `Dresser`, `Shelf`, `Window Board`, and `Wooden_Chair`;
- every one of those receivers has Bevel in its evaluated modifier stack;
- the authored, staged, and pre-pack traces retained that exact divergence;
- the first receiver pack amplified it to all 38 atlas receivers and changed
  the MaxRects ordering/scale choice.

The negative control was equally important. Starting from one captured
float32 UV snapshot, `_pack_receiver_groups` was byte-identical for 12 Dresser
replays and six complete 38-receiver replays inside one Blender process. The
pure allocator and same-input local pack are not the origin.

A smaller fresh-process pair made the magnitude concrete. Dresser's authored
`UVMap` was identical at 4,260 loops and its frozen topology was identical at
41,280 loops, but four active/render UV coordinates differed by
`3.725290298461914e-9` each. The Geometry-Nodes Auto Smooth `Computer` control
was byte-identical at all 19,756 source/frozen loops. Other Bevel stacks reached
one to three float32 ULPs: Beam4 changed 351 coordinates with a maximum
`1.7881393432617188e-7`; Beam2.001 changed 607 coordinates with a maximum
`1.1920928955078125e-7`.

Direct source-loop transfer is not a general repair. Dresser grows from 4,260
source loops to 41,280 evaluated loops, and Blender's Python conversion does
not expose a stable corner-origin mapping for generated Bevel/Subdivision
corners. Nearest-face interpolation would invent ambiguous values on bevel
faces and across authored seams. It remains a prototype question, not a safe
compiler default.

### Rejected compiler-side canonicalization designs

All candidates below changed only the disposable automatic atlas workspace.
Material UV layers and an explicit `BLENDLINK_ATLAS_AUTHORED` layer remained
out of scope.

| Candidate | Determinism result | Cube quality/capacity result | Decision |
| --- | --- | --- | --- |
| Decimal rounding at `1e-8`, `1e-7`, or `1e-6` | A fixed pointwise grid can straddle. Beam2.001 retained `575`, `159`, and `11` unequal scalar values at those grids; Beam4 retained `327`, `196`, and `28`. The full `1e-7` pair left 11 receiver workspaces different and spread to all 38 final layouts. | The first outer route could match, but the repaired pack still diverged. | **Rejected.** No exact stability guarantee. |
| Guarded monotonic-float32 buckets, 16 ULP / 2 ULP guard | Final atlas hashes and second allocator routes differed. | Occupancy `0.2455720` / `0.2448150`; target `0.96951` / `0.96785`; maximum displacement 5 ULP / `5.96e-7`. | **Rejected.** Capacity passes, determinism fails. |
| Guarded monotonic-float32 buckets, 32 ULP / 4 ULP guard | Final atlas hashes differed; one process required two receiver packs and the other three. | Occupancy `0.2465339` / `0.2465342`; target `0.97116697` in both; maximum displacement 11 ULP / `1.073e-6`. | **Rejected.** A finite pointwise partition still has transitions. |
| Needle-style Smart Project on every automatic receiver | Both processes reached the same existing exact failure. | `Mirror islands 52/53 leave 0px; need 20px`. | **Rejected as-is.** It weakens the validated gutter contract. |
| Smart Project only automatic pre-freeze Bevel receivers | Exact allocator rectangle hashes, scales, and routes matched across the tested fresh-process pair. | At 70 degrees, 80 degrees, and 89 degrees, occupancy was `0.22603`, `0.22339`, and `0.22740`; target achievement was `0.93008`, `0.92461`, and `0.93281`. | **Rejected.** Deterministic but below the non-negotiable `0.95` target gate. |

These experiments compare two credible deep-interface choices. Canonicalizing
the automatic workspace preserves the current local-chart policy but no tested
pointwise mapping guarantees stable bytes. Regenerating a source-independent
automatic workspace removes the Bevel input, but the tested Smart Project
adapters either violated the spacing validator or lost too much density. No
production canonicalizer was promoted.

## Blender UV operators

### Pack Islands and Average Islands Scale

No RNG, seed, or threaded reduction appears in the 5.2 Pack Islands path.
Islands are accumulated in editor/object order and then `std::stable_sort`ed by
size. Exact size ties therefore preserve incoming order. `CARDINAL` suppresses
the arbitrary initial pre-rotation, but the packer may still choose 0/90-degree
orientation and tie outcomes still depend on incoming order. `rotate=False`
removes rotation decisions; it does not canonicalize island order.

The UV path calls `BLI_box_pack_2d(..., sort_boxes=false)`. Candidate placement
still contains exact-comparison/tie behavior; `BLI_qsort_r` is not a stable-sort
contract. Average Islands Scale performs its chart accumulation sequentially;
it has no seed or parallel reduction, but remains conditional on its chart and
face iteration order.

A real Cube receiver (`Potted Plant - Bracken`) was reset and repacked twice in
each of ten fresh processes; its local normalized result was stable at
`13b15976992a8e3be331d13b8c5281d4fdfb46afec1a45293a0314f5a871f3a4`.
That verifies this fixture, not a universal deterministic API promise.

Runtime RNA introspection found no seed, island key, stable-order, or thread
property. Pack exposes UDIM source, rotate/rotate method, scale, overlap merge,
margin, pin, and shape controls. Average exposes scale/shear. Those controls
cannot repair UV bytes already changed by modifier evaluation.

### Smart Project

Smart Project has no RNG in this revision and runs its relevant grouping
sequentially. It first uses C `qsort` on face area with a comparator that returns
zero for equal areas, then greedily chooses projection normals and groups faces
from that order (`uvedit_unwrap_ops.cc:3133-3249`, call near line 3316). C
`qsort` does not preserve equal-element order. Smart Project is therefore a
reasonable explicit re-unwrap policy for selected receivers, but not an exact
preservation barrier or a universal stable-order guarantee. Applying it to all
authored receivers would also discard artist UV intent.

## Needle 1.4.2 comparison

Needle's `lightmapping_pack.py` builds proxy quads, invokes Average Islands
Scale, calls Blender's Lightmap Pack, then runs a final Pack Islands with
rotation disabled (source lines 163-223 in the pinned local file).

Blender's Lightmap Pack script constructs its mesh list with a Python set
(`uvcalc_lightmap.py:559-573`). A ten-process probe observed one swapped pair in
that set-derived order. It then calls `mathutils.geometry.box_pack_2d`
(`uvcalc_lightmap.py:533`). Blender's binding passes `sort_boxes=true` and
contains the exact warning that BLI box sorting is non-deterministic
(`mathutils_geometry.cc:1584`); `boxpack_2d.cc:278-282` independently labels
that qsort ordering non-deterministic.

Blendlink should therefore retain its deterministic package-owned outer pack.
That is a measurable improvement over the pinned Needle path, not an
unsupported deviation. Needle does not add a control for Blender Bevel's
pointer-hashed UV merge; it receives the evaluated mesh as Blender supplies it.

## Design consequences and smallest useful gates

1. Do not switch preserve-all off globally. It weakens the artist-owned UV
   contract and still fails across fresh processes.
2. Do not claim Pack Islands, `CARDINAL`, Average Islands Scale, or Smart Project
   is a GPU-/process-ready determinism barrier. None fixes upstream evaluated UV
   bytes.
3. Do not use fixed-grid or finite-ULP pointwise quantization as a blanket fix.
   Either can straddle a bucket transition; both failed the fresh-process Cube
   comparison even when restricted to compiler-owned automatic atlas data.
4. Treat the package-owned MaxRects allocator as a deterministic interface only
   when its rectangle inputs are exact. Its focused tests and the captured-UV
   replay remain Verified. A complete atlas plan is not byte-reproducible until
   evaluated UVs, local receiver rectangles, and repaired second-pass inputs are
   stable too.
5. A bounded automatic re-unwrap for direct-Bevel receivers remains Future Work,
   not a chosen product policy. The tested Needle-style Smart Project variants
   either violated the exact gutter validator or fell below `0.95` target
   achievement. Any replacement must prove compiler ownership and compare
   geometry, UV, island count, density, packing, bake pixels, and diagnostics;
   it must not rewrite arbitrary authored UV maps.
6. The ideal upstream Blender repair is to make Bevel's UV averaging order
   stable: iterate loops by a stable element index (or use an insertion-ordered
   container) before the float reduction. Blendlink cannot assume users have a
   patched Blender, so this remains upstream/future work unless contributed and
   shipped by Blender.

Minimal regression gates that can distinguish these designs:

- a direct-Bevel `.blend` with an authored seam and at least one connected UV
  bucket whose mean is float-order-sensitive;
- at least ten fresh Blender processes, not merely repeated calls in one
  depsgraph;
- exact topology and UV-layer inventory assertions before comparing UV bytes;
- a Subdivision-only and Geometry-Nodes-only negative control;
- a multi-UV receiver whose unused authored layer proves why preserve-all is
  required;
- exact plan JSON, island geometry, atlas occupancy, and two-state bake-pixel
  hashes after the chosen policy;
- an intentional seam whose distinct sides must remain distinct.

[blender-revision]: https://github.com/blender/blender/commit/fbe6228777e7d9afefcd61a413844e790ae75db7
[rna-call]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/makesrna/intern/rna_main_api.cc#L355-L379
[rna-contract]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/makesrna/intern/rna_main_api.cc#L1159-L1184
[mesh-branch]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenkernel/intern/mesh_convert.cc#L884-L908
[mesh-reeval]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenkernel/intern/mesh_convert.cc#L831-L881
[mesh-final]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenkernel/intern/mesh_data_update.cc#L1215-L1223
[mesh-bmain]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenkernel/intern/mesh_convert.cc#L986-L993
[bevel-modifier]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/modifiers/intern/MOD_bevel.cc#L145-L269
[bevel-debug]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/modifiers/intern/MOD_bevel.cc#L269-L294
[bevel-types]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/bmesh/tools/bmesh_bevel.cc#L332-L336
[set-doc]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenlib/BLI_set.hh#L7-L18
[map-doc]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenlib/BLI_map.hh#L7-L19
[pointer-hash]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/blenlib/BLI_hash.hh#L216-L225
[bevel-connectivity]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/bmesh/tools/bmesh_bevel.cc#L1085-L1129
[bevel-interpolation]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/bmesh/tools/bmesh_bevel.cc#L1226-L1305
[bevel-merge]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/bmesh/tools/bmesh_bevel.cc#L1132-L1163
[nodes-mask]: https://github.com/blender/blender/blob/fbe6228777e7d9afefcd61a413844e790ae75db7/source/blender/modifiers/intern/MOD_nodes.cc#L123-L128
