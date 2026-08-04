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

## UI ownership and interaction model (settled July 2026)

The 3D View sidebar is a **compact, state-driven publishing workspace**, not a
second home for every persistent setting. It answers three questions in order:

1. What state is this scene in: not configured, needs attention, ready,
   building, preview running, or failed?
2. What is the single best next action?
3. What changed, what blocks publishing, and where should the artist go to fix
   it?

Setup, browser preview, final build, cancel, and failure recovery therefore
share one workflow surface. Do not repeat setup prompts or competing build
buttons in separate panels. Once the scene is ready, **Preview Website** is
the visually dominant action; **Check Atlas Fit** and **Build Final** are its
visible secondary actions. Preview Website remains active and rebuilds after
each Blender save; the status must say that this is save-driven rather than
implying unsaved viewport synchronization. A failed update keeps the last good
preview visible and exposes its log. The separate **Auto-build on Save** tool is
for compilation without a browser session; logs and folders live under **More
Tools** as explicit actions such as **Open Website Folder**. Long explanations
belong in tooltips or an issue detail
view, not as permanently wrapped sidebar prose.

Persistent authoring data belongs to Blender's native Properties contexts:

- **Scene:** website recipe, Website Camera and Responsive Frames, build
  policy, atlas collection, bake profiles, states, scene Effects & Behaviors,
  optimization defaults, and scene-wide checks.
- **World:** environment lighting, visible background, grounding, and
  environment-output settings.
- **Object:** export inclusion, Automatic/Realtime/Baked intent, atlas
  assignment and weight, runtime visibility, shadows, probes, and semantic
  designation, plus object-targeted Web Behaviors.
- **Material:** stock-glTF portability (**Exact glTF**, **Approximated**, or
  **Needs Bake**), bake participation, texture semantics, compression policy,
  and per-material exceptions. Compatibility analysis reads only the active
  Surface branch, never rewrites the artist's graph, and must not imply that an
  unsupported procedural graph has a hidden runtime translation.

The publishing workspace may summarize these values and provide a focused
route to the owning context, but it must not maintain a second stored copy.
Effects & Behaviors is the deliberate exception to summary-only presentation:
its contextual cards edit the same Scene-owned component collection shown in
Scene and Object Properties. This is one canonical data model with multiple
views, not competing project forms. Blender's selection and data-block model
therefore remains useful while large scenes stay navigable as Blendlink grows.

Pointer-authored behaviors use the existing cached consequence-overlay seam.
Every enabled interaction target gets one small viewport marker, even when it
is not selected; behaviors on the same object share that marker and its label.
The label names the object, its behaviors, and any authored Accessible Label.
It also states the real runtime picking priority: the nearest visible rendered
hit wins (with an interactive descendant preferred over its ancestor). This is
an observation of runtime policy, not a separate artist-authored priority field.
Selected markers are emphasized, and each object-targeted component card offers
an explicit **Select** action. Click actions with an empty Accessible Label are
loud in the marker, component card, Web Checks, and publish preflight; disabled
drafts remain visible as non-blocking authoring warnings. Overlay drawing reads
only the cached guide snapshot and never scans components per frame.

The current native Properties hierarchy is intentional. In Scene Properties,
the artist encounters **Website Camera & Frames**, **Website Effects &
Behaviors**, **Texture Atlases**, **Bake Quality**, **Lighting States**,
**Animation**, **Realtime Shadows**, **Reflection Probes**, **Optimization**,
then the less-frequent **Website Ownership** diagnostics. World Properties owns
**Blendlink Web World** and **HDR Environment**; Object Properties owns
**Blendlink Web Object**, **Semantic Designation**, and **Web Behaviors**;
Material Properties owns **Blendlink Web Material**.
Do not drift back to older labels such as Scene Rendering, Derived Assets,
Geometry Fidelity, or Ownership & Diagnostics. The N-panel routes to these
owners with **Scene & Atlases**, **World & Environment**, and
**Selected Object** / **Edit N Selected** actions. Its supporting panels remain
ordered **Web Checks**, **Effects & Behaviors**, **Baked Textures & UVs**, then
**Geometry Conversion**: problems first, contextual behavior authoring second,
published bake evidence third, and advanced conversion evidence last.

Atlas authoring follows the same consequence-first rule. **Main (default)** is
permanent, receives baked meshes without an override, and is the only default
atlas term shown to artists; internal atlas IDs stay out of labels. Additional
named atlases are created with **Add Atlas from Selection**. Their detail view
exposes **Move Selection Here**, **Move Selection to Main**, **Select Assigned
Meshes**, and the last cached capacity check: occupancy, **Minimum Detail**
preservation, or the amount of capacity required. **Check Atlas Fit** refreshes
that evidence without running a full Cycles bake. **Baked Textures & UVs** uses
**Select Last-Build Members** for the separate, manifest-recorded membership;
the two selection actions must never be described as interchangeable.

The same cached plan also shows the active-set and per-atlas **RGBA8 mipmapped
GPU estimate**. This is decoded/uploaded residency, never transfer size.
Projection evidence is labeled **Worst screen detail** and names the object,
responsive frame, atlas texels per CSS pixel, and DPR 2 device-pixel ratio.
The published-evidence panel offers **Select Worst Object** and **Fix in Texture
Atlases**; the latter only navigates to the artist-owned Scene settings. Draw
code never recalculates density, guesses a fix, or mutates atlas membership.

Lighting-state membership is collection-authored, not a comma-separated text
convention. Each state lists its hidden collections, says **Full scene** when
the list is empty, and provides a searchable **Add Hidden Collection** action,
selection of a collection's objects, and per-row removal. The stored recipe is
still the portable list contract, including collection names that contain
commas.

Layouts are responsive rather than merely usable at the developer's sidebar
width. At narrow widths, use one-column rows, short action labels, compact
status summaries, and icon actions with descriptive tooltips. At wider widths,
label/control pairs and safe side-by-side actions may expand. The primary action
must remain legible at ordinary narrow N-panel widths; implementation details
and CLI commands never belong in its visible label.

Selection summaries must be truthful. With multiple objects selected, show
counts and `Mixed` for genuinely mixed values rather than presenting the active
object as representative. Mesh batch controls derive their scope from all
compatible `selected_editable_objects`, even when the active object is a light,
camera, or Empty. Mesh routing edits distinguish changed, unchanged, and
incompatible/skipped objects; every multi-edit reports its affected count.
Object- or material-specific detail views appear only when their subject is
unambiguous. If pinned Properties show an object outside the editable
selection, explain the mismatch and offer **Select This Object** instead of
silently editing a different owner.

Checks use a compact list/detail pattern: an errors-first count summary; terse
rows with severity, subject, and consequence; then the selected issue's reason,
evidence, and remedies. Select, reveal, and safe fix actions sit on the relevant
row or detail. Repeating a paragraph for every issue is not an acceptable
diagnostics UI.

Finally, `draw()` remains a pure presentation step. It may read a cached UI
snapshot and cheap RNA values, but it must not scan the project, hydrate the
legacy scene recipe, parse the manifest, inspect every mesh or material,
calculate an atlas, load thumbnail files, or start work. Load/timer handlers
hydrate saved recipe data and prepare cheap material previews; published-asset
previews are prepared only after explicit selection. Depsgraph/msgbus handlers
only invalidate state, and explicit operators refresh expensive results. Empty
validation caches render as **Checking...**, never as a false success. A redraw
should be cheap and deterministic regardless of scene size.

## Rules we follow (with reasons)

**Operators** (HIG "adjust after execution" paradigm):
- `{'REGISTER', 'UNDO'}` on everything that modifies data — the RNA source
  calls UNDO "mandatory if the operator modifies Blender data".
- Prefer direct actions with sensible defaults and an F9 redo panel. Use a
  small focused properties dialog only when a value must be chosen before the
  action, as with **Lightmap Scale**; never show an empty confirmation dialog.
  Multi-object actions operate on compatible `selected_editable_objects` and
  report useful affected/already-set/skipped counts via
  `self.report({'INFO'})`.
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

## Website builds (added 0.3.0 — boundary refined, not broken)

The original rule was "the addon never syncs". The refined rule: the addon
never *implements* sync — but it may *invoke* the project's own CLI on an
explicit user click. Blendlink's build actions run `npx blendlink compile` via
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
