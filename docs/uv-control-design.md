# UV control: propose → inspect → materialize → commit (SHIPPED)

Research-backed design (two web-research passes, July 2026; citations in
the session notes), built in exporter slice bc3db7a + addon 0.7.0. The
pattern every engine ships is two-tier — auto lightmap UVs by default,
"provide your own channel" as the escape hatch — and the population that
hits auto's ceiling is fully-baked hero scenes, i.e. blendlink's users.
The loudest artist complaints: unpredictable density, wasted space, and
layouts that churn every bake so there is nothing stable to tune (Unity's
removed Lock Atlas is the cautionary tale). Blender 3.6+ `pack_islands`
natively supports pinned islands (`pin`, `pin_method`).

## The flow (as shipped)

1. **Plan** — **Check Atlas Fit** runs the exporter's final-quality pack and
   validation path without Cycles. **Load Published Atlas UVs** does not rerun
   or replay that pack: it loads only the exact loop-ordered snapshot from the
   last successful build after its distinct Float32 values were attested in the
   decoded final post-Meshopt GLB. Topology or attestation mismatch refuses an
   approximation and leaves saved-pixel inspection available. In **Texture
   Atlases**, **Select Assigned Meshes** follows the live authoring assignment;
   in **Baked Textures & UVs**, **Select Last-Build Members** follows the
   manifest-recorded membership inspected by this flow.
2. **Inspect** — Toggle Atlas Checker cycles OFF → DENSITY → UVGRID → OFF.
   Geometry-nodes modifier `BLENDLINK-checker-override`
   (`show_render=False`) does Set Material to a shared checker sampling
   through `BLENDLINK_ATLAS` — user material slots are never touched.
   DENSITY: Blender's generated UV grid has fixed 32px cells (measured on
   5.2), so mapping scale `atlas_size / (32-cells-per-repeat × cell_px)`
   makes one checker cell exactly `cell_px` REAL atlas texels (default 8,
   adjustable in the redo panel). UVGRID: one lettered COLOR_GRID across
   the whole atlas — the letters say WHERE an island landed. Density is
   judged POST-pack (packing rescales islands). The material rides as the
   Set Material socket default because 5.2 rejects material id-props on
   the modifier. Cleanup operator sweeps strays.
3. **Materialize** — persists the previewed pack as
   `BLENDLINK_ATLAS_AUTHORED`, the artist's editable layer. NEVER
   silently overwrites an existing authored layer (kept + reported;
   explicit Overwrite in the redo panel). The selection is transactional:
   UV-layer capacity and exact name ownership are preflighted, Blender-suffixed
   allocations are refused, and any creation/write failure restores every mesh,
   generic attribute, and active layer. Pre-pins nothing: **pinning is the
   artist's commit gesture** — "the artist may edit and pin".
4. **Commit** — the exporter honors it, opt-in by presence
   (SimpleBake-style): the authored layer's islands AND pin flags are
   staged into `BLENDLINK_ATLAS` instead of re-deriving from the first
   UV map. Pinned islands skip averaging and weight pre-scales entirely
   and `pack_islands(pin=True, pin_method='LOCKED')` locks them in place;
   everything unpinned — authored or not — stays on the plan-driven
   density path and packs around them. The plan records the trail
   (`objects[].authored` / `pinned`). Before scaling or packing, finite/bounds
   checks and true triangulated intersection tests block collapsed or
   out-of-bounds pins, overlap between islands or objects, and folded/stacked
   self-overlap. Exact
   triangle distances also enforce the configured bake/mipmap gutter between
   distinct locked islands and from the atlas edge; shared triangle boundaries
   remain legal inside one valid island.

## Contract decisions the doc left open (now fixed)

- **Unpinned islands of an authored mesh rejoin the auto flow fully**
  (averaged + weighted). Density always comes from one place — the plan —
  unless the artist pins; an authored-but-unpinned island keeps seam and
  island-topology edits but not hand-set scale. This avoids mixing two
  scale spaces in one pack, where the global fit factor would make
  hand-set densities arbitrary.
- **Island membership uses Blender's own resolution**: select_pinned +
  select_linked, then `uv.pin` expands the flags over each held island
  (idempotent for the packer, and it makes the held mask readable
  per-loop). A hand-rolled island walk could drift from the packer's.
- **Pins are sanitized when staging from a working layer** — artists pin
  UVs for live-unwrap; a stale pin must never lock the atlas.
- **`pin=True` with zero pins packs byte-identically to `pin=False`**
  (verified on 5.2), so unchanged inputs still pack identically and the
  bake cache stays valid.
- **Pinned validation uses geometry, not bounding boxes**: UV polygons are
  triangulated once. Collapsed triangles block immediately. A consistently
  oriented, simple-boundary manifold disk proves the common dense island
  injective with linear topology checks plus a balanced boundary-event tree;
  complex islands fall back to a balanced per-island hierarchy.
  Island bounds then enter a separate 2D hierarchy whose exact leaf
  clips/distances decide every nearby candidate, so neither dense radial fans
  nor many wide-but-vertically-separated islands degrade to a pair scan.
  Positive intersection area blocks, and
  exact boundary distance blocks distinct islands that cannot preserve the
  configured padding; errors are deduplicated per island pair, and both plan
  and final-bake entry points stop before Cycles.
- **The checker must be stripped before any evaluation**:
  `show_render=False` does NOT keep a modifier out of freeze/glTF paths —
  both evaluate the VIEWPORT depsgraph (verified: the checker material
  lands in `new_from_object` results). `bakelib.remove_checker_overrides`
  runs at the top of the exporter and of the site's
  `prepare_export_geometry`; the addon's cleanup operator and OFF cycle
  sweep datablocks too.

## Rules (unchanged)

- NEVER silently overwrite an authored layer (Godot's top UV2 bug class).
- Unchanged inputs → identical pack (the Lock Atlas lesson; the bake
  cache already depends on this).
- Exporter-side UV mechanics land in `bakelib.py` once; the addon imports that
  canonical distributed module through `bakelib_loader`. The addon owns only
  interaction and display, and the headless test asserts its imported constants
  are the canonical ones.

## Interaction completion

- Bake-table search/sort, active-row consequences, authored/pinned plan flags,
  and two-way row/scene selection are shipped. Msgbus gives scene-selection
  reverse sync immediately; the shared timer has an O(1) fallback and rebuilds
  only when a live-authoring or published-plan/status token advances. Failed
  rebuilds stay pending, retry, and print the cause instead of leaving a stale
  table silently. The refresh icon is now only an explicit recovery action.

## Also queued

- Real Vanilla and R3F consumer compile-checks now run against both the
  workspace and packed npm artifact. A checked-in visual example remains an
  optional documentation asset, not an unverified release dependency.
- DX tail: TTY progress streaming, addon node-path preference, and
  no-manifest-writes on skipped syncs.
