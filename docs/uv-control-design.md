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

1. **Propose** — Preview Atlas UVs replays the manifest plan into
   `BLENDLINK_ATLAS` layers. Now authored-aware: materialized meshes
   contribute their authored islands and pins, exactly like the exporter.
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
   explicit Overwrite in the redo panel). Pre-pins nothing: **pinning is
   the artist's commit gesture** — "the artist may edit and pin".
4. **Commit** — the exporter honors it, opt-in by presence
   (SimpleBake-style): the authored layer's islands AND pin flags are
   staged into `BLENDLINK_ATLAS` instead of re-deriving from the first
   UV map. Pinned islands skip averaging and weight pre-scales entirely
   and `pack_islands(pin=True, pin_method='LOCKED')` locks them in place;
   everything unpinned — authored or not — stays on the plan-driven
   density path and packs around them. The plan records the trail
   (`objects[].authored` / `pinned`) and warns when pinned islands reach
   outside the 0..1 square.

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
- Exporter-side changes land in bakelib/export_scene once; the addon
  only REPLAYS plans. The addon mirrors the layer/modifier name constants
  and the headless test imports bakelib to assert they match (the
  vocabulary-conformance trick applied to the UV contract).

## Also queued

- Bake-table polish per the UI research: filter/sort in `filter_items`,
  master-detail active-row box, msgbus reverse-sync (scene selection →
  row), token-gated rebuild in handlers._tick instead of manual refresh.
  The table could also surface the plan's new authored/pinned flags.
- Recipe compile-check inside a real Vite+R3F example project; populate
  examples/.
- DX tail: TTY progress streaming, watch inputs/config, addon node-path
  preference, no-manifest-writes on skipped syncs.
- Overlap detection between locked islands materialized from different
  previews (stale pins can claim the same region; bbox-union checks were
  rejected as too noisy — needs real island-level geometry).
