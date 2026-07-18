# Blender addon — design notes and research constraints

Condensed from three research passes (July 2026): Blender HIG + beloved-addon
teardowns, the 4.2→5.2 Python API dossier, and the extensions.blender.org
platform rules. Full reports live in the session archive; this is the working
reference for maintaining `packages/blender-addon`.

## Shape decisions (settled)

- **Thin, authoring-only.** The addon never exports, never syncs, never owns
  the pipeline. It writes only artist-authored names and custom properties
  into the .blend. Rationale: the extensions platform's "self-contained" rule
  (an addon whose only function is bridging to external tooling gets
  rejected — see Needle Engine, unapproved after 2 years) and blendlink's own
  no-lock-in thesis. The addon is fully useful offline.
- **GPL-3.0-or-later.** Mandatory for extensions.blender.org (blocked both
  Needle and Skein, who chose MIT). The npm side stays MIT — separate
  programs communicating through files, the inverse of Skein's split.
- **`vocab.py` mirrors `vocabulary.ts`.** Same regexes, pure Python, no bpy
  import, unit-testable anywhere. Single source of truth per language; keep
  in sync by hand (the file headers say so).

## Rules we follow (with reasons)

**Operators** (HIG "adjust after execution" paradigm):
- `{'REGISTER', 'UNDO'}` on everything that modifies data — the RNA source
  calls UNDO "mandatory if the operator modifies Blender data".
- No dialogs; sensible defaults + F9 redo panel. Multi-object: act on all
  `selected_editable_objects`, report counts via `self.report({'INFO'})`.
- `poll()` + `poll_message_set()` so disabled buttons explain themselves.
- Plumbing operators (`select_issue`, `fix_numbered`, refreshes) carry
  `'INTERNAL'` to stay out of F3 search.

**The `.001` trap:** Blender silently renames on collision, and
`Crate-colonly.001` no longer matches any `$`-anchored suffix regex. Two
defenses: our rename helper pre-checks `bpy.data.objects.get()` and skips
with a warning instead of letting Blender append a number; the linter
recognizes numbered names hiding a token and offers a one-click fix
(`Crate-colonly.001` → `Crate.001-colonly`).

**Custom properties:** pipeline-facing values (mass, friction, lod_distance,
hotspot title/body) are raw id-properties with `id_properties_ui().update()`
metadata — that's what makes them native-feeling sliders with tooltips AND
what the glTF exporter can write to extras. Registered PropertyGroups are for
addon-internal state only (session settings live on WindowManager so they
never dirty the file). Never touch `_RNA_UI`; Blender 5.0 split registered
props from custom props (`bl_system_properties_get()` for migrations).

**Events:** `depsgraph_update_post` only sets a dirty flag (it fires on every
evaluation); a 1-second `bpy.app.timers` timer does the actual rescan and
redraws only on change; msgbus `(Object, "name")` is a rename hint,
re-subscribed in a `@persistent load_post` handler because file load clears
subscriptions. Nothing heavy ever runs in `draw()`.

**Registration:** `register()` may run in Blender's *restricted* context
(enable-at-install) where `bpy.data` access raises — this bit us: no eager
sync refresh at register; the first timer tick does it. Draw handlers,
timers, msgbus owners, and handler-list entries are all removed in
`unregister()` or extension updates leak callbacks.

**GPU overlay:** `POLYLINE_UNIFORM_COLOR` / `POLYLINE_FLAT_COLOR` builtins
(wide lines require POLYLINE variants since 4.5; `bgl` is gone in 5.0), unit
box/sphere/cross/axes batches built once and re-drawn per object via
`gpu.matrix`, gated on `space.overlay.show_overlays` (respect the user's
global overlay toggle — the Jiggle Physics precedent). Background mode never
registers the handlers; the offscreen test uses `gpu.init()` (5.2+).

**Extensions platform gotchas** (for the eventual listing):
- Tagline ≤64 chars, no trailing punctuation. No "Blender" in the name.
- `[permissions] files = "<reason ≤64 chars>"` — expected for I/O addons.
- No analytics, no auto-updater, no `eval`/`exec`, no writes into the addon
  directory (use `bpy.utils.extension_path_user`), `__package__` not
  `__name__`, relative imports only.
- `blender --command extension validate` and `build` are the CI steps; a
  self-hosted `server-generate` repo JSON can give auto-updates outside the
  platform (Install-from-Disk installs never get updates).

## Sync Now (added 0.3.0 — boundary refined, not broken)

The original rule was "the addon never syncs". The refined rule: the addon
never *implements* sync — but it may *invoke* the project's own CLI on an
explicit user click. Sync Now runs `npx blendlink sync` via
`subprocess.Popen` (never blocking the UI): a worker thread that touches no
bpy forwards stdout into a `queue.Queue`, a `bpy.app.timers` pump drains it
on the main thread — the exact thread pattern from the Blender docs. The
pipeline emits `##blendlink {"fraction","label"}` lines when
`BLENDLINK_PROGRESS=1` (set by the runner; silent for humans), which drive a
`layout.progress()` bar (4.0+). Cancel kills the process tree (taskkill /T
on Windows); unregister cancels and removes the pump timer. Output lands in
`extension_path_user` (`sync-log.txt`) with an open-log button on failure.
Platform posture: still self-contained (fully useful offline), subprocess is
user-initiated and local-only.

## Not built (deliberately)

- **glTF export hooks** (`glTF2ExportUserExtension`): blendlink's exporter
  runs headless with its own script — the hook system solves a problem we
  don't have. Revisit only if users want blendlink data surviving *their own*
  File → Export flows.
- **Component/schema UIs** (Skein/Blenvy-style dynamic PropertyGroups from a
  registry): blendlink's vocabulary is names + a handful of props; a
  table-driven form generator would be machinery without a payload. Revisit
  with vocabulary v2.
- **Custom keymaps/pies**: nothing here is high-frequency enough to spend
  the user's muscle-memory tax. The panel is the product surface; Node
  Wrangler-style shortcuts only if daily-driver usage proves out.
