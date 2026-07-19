# UV control: propose → inspect → commit (next build)

Research-backed design (two web-research passes, July 2026; citations in
the session notes). The pattern every engine ships is two-tier — auto
lightmap UVs by default, "provide your own channel" as the escape hatch —
and the population that hits auto's ceiling is fully-baked hero scenes,
i.e. blendlink's users. The loudest artist complaints: unpredictable
density, wasted space, and layouts that churn every bake so there is
nothing stable to tune (Unity's removed Lock Atlas is the cautionary
tale). Blender 3.6+ `pack_islands` natively supports pinned islands
(`pin`, `pin_method`: keep position/scale, pack the rest around them).

## The flow

1. **Propose** — the addon's Preview Atlas UVs operator (shipped, 0.6.x)
   replays the manifest plan into `BLENDLINK_ATLAS` layers.
2. **Inspect** — a checker toggle scaled to REAL atlas texels:
   TexTools-style geometry-nodes modifier override named
   `BLENDLINK-checker-override` (`show_render=False`, node group does Set
   Material to a shared checker sampling Blender's UV Grid through a UV
   Map node pinned to `BLENDLINK_ATLAS`, Mapping scale =
   atlas_size / cell_px). Never touches user materials; cleanup operator
   strips strays; cycle OFF → DENSITY → UVGRID → OFF. Density must be
   judged POST-pack (packing rescales islands).
3. **Materialize** — new operator: persist the proposed layout as an
   authored UV layer the artist may edit and pin. This bridge (auto
   result → editable layer) is what no engine offers in-DCC.
4. **Commit** — the exporter honors it: when a mesh carries an authored
   atlas layer (opt-in by presence, SimpleBake-style), reuse those
   islands instead of re-deriving; pass `pin=True` + a `pin_method` so
   pinned islands keep their place and the rest packs around them.

## Rules

- NEVER silently overwrite an authored layer (Godot's top UV2 bug class).
- Unchanged inputs → identical pack (the Lock Atlas lesson; the bake
  cache already depends on this).
- Exporter-side changes land in bakelib/export_scene once; the addon
  only REPLAYS plans (no packing logic of its own beyond the preview,
  which mirrors the pack contract).

## Also queued

- Bake-table polish per the UI research: filter/sort in `filter_items`,
  master-detail active-row box, msgbus reverse-sync (scene selection →
  row), token-gated rebuild in handlers._tick instead of manual refresh.
- Recipe compile-check inside a real Vite+R3F example project; populate
  examples/.
- DX tail: TTY progress streaming, watch inputs/config, addon node-path
  preference, no-manifest-writes on skipped syncs.
