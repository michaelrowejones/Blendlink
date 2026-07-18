# Blendlink — Blender companion addon

Authoring-only companion for [blendlink](../../README.md). It never exports and
never syncs — `blendlink sync` on the npm side owns that. What it does:

- **Tag Selected** — one-click vocabulary authoring on every selected object:
  collider suffixes (`-col` / `-convcol` / `-colonly` / `-convcolonly`),
  `-rigid` with mass/friction sliders, `_LODn` with switch distance,
  `-noimp` exclusion, and typed anchor empties (`SOCKET_` / `HOTSPOT_` /
  `AUDIO_`) parented to the active object. Every operator is one undo step
  and adjustable in the F9 redo panel.
- **Checks** — the same lint blendlink's parser runs, live in the sidebar:
  near-miss tokens (`-collonly`), LOD gaps, anchors with geometry, and
  Blender's `.001` duplicate numbering that silently hides a suffix tag
  (with a one-click fix that moves the number into the base name).
- **Sync status + Sync Now** — whether the saved `.blend` matches the last
  `blendlink sync` (manifest `blendBytesHash` vs the file on disk; discovery
  walks up to `blendlink.config.mjs`). When out of sync, a **Sync Now**
  button saves the file and runs `npx blendlink sync` as a background
  subprocess — Blender stays fully usable, a progress bar tracks the
  `##blendlink` progress lines the pipeline emits, and failures surface an
  open-log button. The addon still never implements export logic; it only
  invokes the CLI the project already uses.
- **Viewport overlay** — draws what blendlink sees: collider proxies as green
  wireframes, sockets as RGB axes, hotspots and audio anchors as labeled
  crosses. Respects the global overlay toggle; X-ray mode in preferences.

Find it in the 3D viewport sidebar (N) under the **Blendlink** tab. The tab
name is editable in the addon preferences.

## Install

Build and install from this directory (Blender 4.2+):

```
blender --command extension build --output-filepath blendlink-addon.zip
```

then Blender → Preferences → Get Extensions → Install from Disk, or headless:

```
blender --background --python tests/install_check.py --python-exit-code 1
```

## Development

```
# pure-Python vocabulary tests (no bpy required)
python tests/vocab_test.py

# full operator suite inside Blender
blender --background --factory-startup --python tests/run_headless.py --python-exit-code 1

# overlay shader validation offscreen (Blender 5.2+)
blender --background --factory-startup --python tests/overlay_gpu_check.py --python-exit-code 1

# sync-status e2e against a synced project
blender --background --python tests/sync_status_check.py --python-exit-code 1 -- <project-dir> <name>.blend

# manifest sanity
blender --command extension validate
```

`vocab.py` mirrors `packages/blendlink/src/vocabulary.ts` — keep the regexes
in sync when the vocabulary grows.

## License

GPL-3.0-or-later (required for Blender extensions; the npm packages remain MIT).
