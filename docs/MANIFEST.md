# The blendlink manifest contract (schemaVersion 2)

`<scene>.manifest.json` is the machine contract between blendlink and any
runtime. Policy: **additive-only within a schemaVersion; reshape bumps the
version; every reader enforces the version on read** (blind-casting old
manifests once meant silent misreads).

## Identity and drift

- `hash` — content hash of the GLB; cache-busting key and drift signal.
- `blendBytesHash` — sha256 (first 16 hex) of the .blend bytes; lets
  Blender-free CI and the addon detect drift without opening Blender.
- `syncHint` — the command that regenerates these artifacts.

## Baked-mode runtime contract

State and light-group textures are **8-bit sRGB-encoded PNGs** saved
through Blender's Standard view transform (a bare linear→sRGB encode; no
AgX/Filmic — a graded layer would break the additive math below). A
runtime must:

1. Load every texture with `colorSpace = SRGBColorSpace` (three.js) so
   sampling decodes back to linear.
2. Compose in **linear** space:

   ```
   color = state + Σ lightGroup(url) × maxValue × tint × strength
   ```

- `states` — `{ name: { url, default? } }`. The entry with `default: true`
  is the state already baked into the GLB's materials; other states are
  full alternative atlases to swap or blend. States are NOT peak-
  normalized: baked values above 1.0 clip at save (the sync warns with the
  clipped-texel percentage).
- `lightGroups` — `{ name: { url, maxValue } }`. Layers ARE normalized (to
  the 99.9th-percentile peak); multiply the decoded sample by `maxValue`
  to recover linear light before tinting and adding.
- Atlas textures use `ClampToEdge` wrapping; the atlas background is a
  constant (mean island color) so mip tails never halo — do not "clean it
  up".

## Authored properties

All blendlink-authored custom properties are namespaced `blendlink_*`
(`blendlink_role`, `blendlink_mass`, `blendlink_texel_weight`, …). Bare
legacy names are still read with a deprecation warning until 1.0.

## Node names

`nodes` keys are the names **three.js reports after load** (the loader
sanitizes: whitespace → `_`; `[ ] % $ . : /` stripped). Duplicate
post-sanitization names keep the last entry, matching drei's `useGraph`.
The vocabulary (colliders, anchors, LODs) parses the authored names, so
`.NNN` duplicate tolerance still applies at parse time.

## Diagnostics

`bakePlan`, `lastSyncDurationMs`, `draft` are tooling state riding along
for the addon; runtimes should ignore them.
