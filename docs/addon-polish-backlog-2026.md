# Add-on polish backlog (2026-08-04)

An audit of every add-on surface against `addon-design-notes.md` produced 170
findings. The crashing, data-losing and artist-misleading tier was fixed in
the same session (see the `fix:`/`feat:`/`perf:` commits touching
`packages/blender-addon` on 2026-08-04). This file is the measured residue:
85 findings that were verified against the code and deliberately left.

Nothing here is speculative. Each entry names the artist-visible consequence
and a concrete fix; the ones that are only clarity wins were dropped rather
than recorded, because a backlog nobody can finish is not a backlog.

Severities: **BROKEN** does the wrong thing, **MISLEADING** tells the artist
something untrue, **ROUGH** works but the interaction is poor, **INCONSISTENT**
disagrees with the settled design or with a sibling surface.


## 3D View sidebar (N-panel) publishing workspace

### ROUGH - The published-atlas summary packs four items into one row above 380 px, where none of them fit

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:3530-3547: `row = atlas_box.column(align=True) if _is_compact(context, 380) else atlas_box.row(align=True)`, then `row.label(text=f"{display_name}: {atlas.get('size','?')}px · {occupancy*100:.0f}% full · {atlas.get('objects','?')} objects")`, plus `row.label(text=f"needs {required*100:.0f}% at target")`, plus `row.label(text=f"quality {achievement*100:.0f}%")`, plus `row.operator("blendlink.select_atlas_objects", text="", ...)`.

**Why:** A Blender row divides its width evenly among children. At a 400 px sidebar those four children get roughly 100 px each, while the first label ("Main: 2048px · 87% full · 34 objects", 36 characters) needs about 260 px — so the atlas name, its resolution, its occupancy and its object count are all clipped to "Main: 2048p…" precisely in the width band the 380 px threshold declares safe. The capacity evidence the atlas workflow depends on is unreadable between roughly 380 and 600 px.

**Fix:** Either raise this threshold to the width the four-item row actually needs (`_is_compact(context, 560)`), or keep the row and split the content: `display_name` and size on the first label, occupancy/needs/quality in a second aligned row underneath. Do not add width to the label alone — the operator and the two optional labels still take their quarter each.

### INCONSISTENT - Scene Properties duplicates the whole publishing state card and the setup prompt, with different words for the same states

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:1005-1006 duplicates the setup prompt (`"This scene is not set up for Blendlink yet."` + `blendlink.setup_website_export`) that the N-panel already owns at ui.py:198-200 ("Next · Set up this scene"). ui.py:1018-1141 then rebuilds the entire card: its own `_PreviewSessionState`, its own syncrun/starting/updating progress bars with cancel, its own stale-preview box, its own update-failure box, and its own dominant `blendlink.browser_preview` button.

**Why:** The settled rule is that setup, browser preview, build, cancel and failure recovery share one workflow surface with no repeated setup prompts or competing build buttons. The two copies also disagree in the same state: "Open Website" (ui.py:773) vs "Open Website Preview" (ui.py:1112); "Preview Website will stop the previous Blendlink session…" (ui.py:680) vs "Preview Website safely replaces the previous Blendlink session." (ui.py:1089); and the Scene copy has no "Check & Update Website" or "Retry Website Preview" variants, so after a failure the two panels label the identical action differently. An artist who works in Properties learns one vocabulary and an artist who works in the sidebar learns another.

**Fix:** Reduce ui.py:995-1141 to what Scene Properties actually owns: the not-configured case becomes a short line plus the Set Up action (or defers entirely to the N-panel), and the Website Preview box becomes a one-line status summary plus a route back to the sidebar. Delete the duplicated progress bars, stale box, failure box and `browser_preview` button; the N-panel already renders all four.

### INCONSISTENT - Three of the four sub-panels take a header row on a scene that is not set up yet

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:3445 (BLENDLINK_PT_bake), ui.py:3610 (BLENDLINK_PT_checks) and ui.py:3690 (BLENDLINK_PT_fidelity) declare no `poll`. The fourth sibling does: `BLENDLINK_PT_components_sidebar.poll` returns `_configured(context)` (components_ui.py:1633-1635).

**Why:** On first run the parent returns straight after `_draw_next_setup_step` (ui.py:619-620), so the moment the workspace is supposed to present exactly one next action the artist also sees "Web Checks", "Baked Textures & UVs" and "Geometry Conversion" headers. Opening any of them yields "No published bake details yet" or "No mesh compile routes to report" — three header rows and three dead ends that make an un-set-up scene look like a broken one. The Effects panel already gets this right, so the surface is internally inconsistent.

**Fix:** Add the same guard to all three: `@classmethod def poll(cls, context): project = getattr(context.scene, "blendlink_project", None); return project is not None and project.configured`. This is not the poll-gating that BLENDLINK_PT_bake's docstring warns about — that concerned gating on the presence of a bake plan for external scenes, which stays unchanged.


## Artist-visible strings and summary truthfulness across ui.py, ops.py, 

### MISLEADING - Web Behaviors in Object Properties shows one object's cards while claiming the selection scope

**Evidence:** components_ui.py:1593-1620: `_wrap(layout, f"Add affects all {selection_count} selected objects." if selection_count > 1 else f"Behaviors on {obj.name}")`, then `entries = [… if _matches_object(component, obj)]` and `_draw_cards(…, "No website behaviors on this object yet.")`. The N-panel sibling gets this right — components_ui.py:1684-1689 `_wrap(layout, f"Cards show the active object. Add affects all {selection_count} selected objects.")`.

**Why:** With five objects selected, Object Properties says "Add affects all 5 selected objects" and then lists cards belonging only to the active object, with no note that the other four are unrepresented. An artist who sees "Open Link" listed once assumes the selection has one; deleting it with the X removes it from the active object only. This is the case the design notes forbid: detail views appear only when their subject is unambiguous.

**Fix:** Reuse the sidebar's wording in `BLENDLINK_PT_object_components.draw`: when `selection_count > 1`, draw "Cards show {obj.name}. Add affects all {selection_count} selected objects." Better, extract the shared header into one helper so the two panels cannot drift again.

### MISLEADING - Web Checks presents a stale cache as a fresh result while the sibling light panel labels it

**Evidence:** ui.py:3620-3632: `checking = validation.is_dirty()` … `if checking and not issues: header.label(text="Checking scene…")` — when the cache is dirty *and* non-empty, execution falls to `elif issues:` and the stale list is drawn with no marker. Contrast ui.py:523-529 in `BLENDLINK_PT_web_light`, which reads the same cache and draws `text="Updating web-light result…" if diagnostic is None else "From the last Web Check"`. `BLENDLINK_PT_fidelity` (ui.py:3700-3704) has the same gap.

**Why:** After an artist renames an object or changes its role, the checks panel keeps showing the pre-edit issue list — including issues that no longer exist and omitting new ones — with a clean-looking count and no indication it is out of date. Two panels reading the same cache one screen apart disagree about whether the data is current.

**Fix:** In both `BLENDLINK_PT_checks.draw` and `BLENDLINK_PT_fidelity.draw`, when `validation.is_dirty()` and results exist, draw the same "From the last Web Check" row with the TIME icon that `BLENDLINK_PT_web_light` already uses, next to the existing refresh button.

### ROUGH - Remove Atlas and Remove Lighting State are pre-disabled, suppressing the reasons their poll() already writes

**Evidence:** ui.py:1973-1975 `remove.enabled = len(project.atlases) > 1 and project.atlas_index > 0` then `remove.operator("blendlink.remove_atlas", text="", icon="REMOVE")`; ui.py:2108-2110 the same for `blendlink.remove_state`; presentation_ui.py:759-761 `restore.enabled = settings.preview_active`. The explanations that can now never fire: ops.py:626 "Main is undeletable; select an additional atlas", ops.py:629 "Make this linked scene local before removing an atlas", ops.py:961 "Every published scene needs at least one lighting state".

**Why:** Blender skips `poll()` on a layout element whose `enabled` is False, so no tooltip appears. The artist gets a greyed icon-only "–" button with zero explanation of why Main cannot be removed — the design notes' stated purpose for `poll_message_set`. The good copy is written and dead.

**Fix:** Delete the three `row.enabled = …` guards and draw the operators directly; `poll()` already returns False in exactly those cases and Blender will surface the message.

### ROUGH - Web Checks tells artists to rename raw custom properties "before 1.0", with no route to the one-click Migrate action

**Evidence:** validation.py:760-780: `message=(f'"{node.name}" — bare texel_weight is deprecated; rename it to blendlink_texel_weight before 1.0')` and `message=(f'"{node.name}" uses deprecated bare {bare}; rename it to {namespaced} before 1.0')` for `mass, friction, lod_distance, title, body`. A safe fixer exists — ops.py:2214 `BLENDLINK_OT_migrate_legacy_property`, offered at ui.py:2932-2936 — but the check row only offers Select (ui.py:3644-3648) because `issue.fixable_numbered` is False.

**Why:** The check names two internal Python identifiers and a release milestone the artist has no visibility into, then asks them to hand-rename a custom property — while a tested one-click migration sits a panel away. Artists who follow the instruction literally risk typos in a key nothing validates.

**Fix:** Reword to "{name} still stores {bare} the old way. Migrate it so Blendlink and the exporter read the same value." Add a `fixable_migration` flag to `LintIssue` and draw a `blendlink.migrate_legacy_property` button on those rows the way `fix_numbered` is drawn today.

### ROUGH - Unknown components show their internal type ID and a raw JSON blob to the artist

**Evidence:** components_ui.py:911-912 `else: _wrap(content, component.component_type, icon="PLUGIN", width=64)` — renders e.g. `blendlink.play-audio-on-click`. components_ui.py:934-939 `raw = json.dumps(json.loads(component.raw_values or "{}"), separators=(",", ":"))` … `_wrap(content, f"Stored values: {raw}", …)`, with `raw = component.raw_values or "<invalid JSON>"` on parse failure. Both render under the heading "Imported Records Needing Attention" (components_ui.py:1562).

**Why:** This is the surface an artist reaches after opening a .blend authored by a newer Blendlink or a collaborator. The panel's answer is a dotted internal identifier and a minified JSON string — the two least actionable things it could show — with no statement of what will happen at publish time and no next step.

**Fix:** Replace the type line with a sentence: "This behavior was authored by a newer version of Blendlink. It is preserved in the file and republished unchanged, but cannot be edited here." Put the raw values behind a "Show stored values" expander, and never surface the literal string `<invalid JSON>`.

### ROUGH - Incompatible entries in the Add Behavior menu are greyed with no reason

**Evidence:** components_ui.py:982-994 (`_draw_catalog`): `row = layout.row()` … `row.enabled = any(component_schema.supports_target(component_type, _target_type(obj)) for obj in selection)` then `row.operator("blendlink.add_component", text=definition["label"], …)`. `BLENDLINK_OT_add_component.poll` (components_ui.py:1360-1365) only checks `_configured`, so it never sets a compatibility message. The popup catalog gets this right — components_ui.py:1044-1050 puts the reason in the button text ("No compatible selection").

**Why:** An artist with an Empty selected opens "Add Behavior to Selection" and sees half the catalog greyed out with no tooltip. `row.enabled = False` suppresses `poll()` entirely, so hovering shows nothing. They cannot learn that these behaviors need a mesh.

**Fix:** Leave the rows enabled and move the check into `BLENDLINK_OT_add_component.poll` with `poll_message_set(f"{definition['label']} needs a mesh in the selection")` — the operator already computes the same predicate in `execute` at components_ui.py:1396-1403.

### ROUGH - Website Ownership wraps at a fixed 46 characters and ignores panel width

**Evidence:** ownership.py:136-147 `def draw_summary(layout, project): def wrapped(container, value, width=46):` — a hand-rolled greedy wrapper with a hardcoded width. Every other wrapper measures the region: ui.py:44-48 `_responsive_wrap_width` divides `_logical_region_width(context) - 32.0` by 7.2, and components_ui.py:116-128 `_wrap` takes `min(width, max(20, int(available / 7.0)))`.

**Why:** Website Ownership is a Scene Properties sub-panel and Properties editors are routinely docked narrow. At those widths all eleven reason paragraphs run past the panel edge and clip mid-word, and the header row (ownership.py:150-157) puts `decision.label` and "Owned by: …" side by side so both truncate. The panel whose job is to state who owns each decision becomes unreadable.

**Fix:** Delete the local `wrapped` and call `ui._draw_wrapped(box, decision.reason)`; switch the header to a single column (or `_is_compact`-gated row) so the label and owner stack at narrow widths.

### ROUGH - Select Last-Build Members shows its label only when the panel is too narrow to fit it

**Evidence:** ui.py:3542-3546 `op = row.operator("blendlink.select_atlas_objects", text="Select Last Build" if _is_compact(context, 380) else "", icon="RESTRICT_SELECT_OFF")`. The condition is inverted relative to every other responsive call in the file — ui.py:1942-1946 `text="Select Worst" if compact else "Select Worst Object"`, ui.py:1949-1952 `text="Fix in Atlases" if compact else "Fix in Texture Atlases"`.

**Why:** At an ordinary or wide N-panel the button is a bare icon with no text, so the artist cannot see the action exists — and this is the action the design notes single out as needing to stay verbally distinct from Select Assigned Meshes. The narrow label also drops the settled noun ("Select Last-Build Members", the operator's own `bl_label` at ops.py:2771).

**Fix:** Invert it: `text="Select Members" if _is_compact(context, 380) else "Select Last-Build Members"`, keeping the wide label identical to `bl_label`.

### ROUGH - Bake Quality, Optimization, camera, and environment controls have no tooltips at all

**Evidence:** 100 of 195 `bpy.props.*` declarations in props.py omit `description=`. Artist-visible ones include the entire Bake Quality panel — props.py:956 `final_samples`, 959 `final_supersample`, 962 `final_denoise`, 963 `preview_samples`, 966 `preview_scale` (drawn at ui.py:2084-2088) — plus props.py:946 `presentation`, 987 `camera_behavior`, 1004 `camera_framing`, 1016 `animation_start`, 1032 `animation_loop`, 1101 `tone_mapping`, 1123 `background_mode`, 1143 `fog_mode`, 1172 `shadow_preset`, 1186 `shadow_filter`, 1196 `shadow_map_size`, 1221 `environment_source`, 1234 `environment_lighting`, 1243 `environment_background`, 1253-1271 the environment strength/rotation/blur floats, 1281 `geometry_optimization`, 1290 `texture_optimization`, 80 `size` (atlas Resolution) and 96 `fit_policy` (When Full).

**Why:** Hovering any of these gives nothing beyond the label already visible. "Preview Resolution 0.25" and "Final Supersample 2" are precisely the values that need a sentence of consequence, and the add-on's own thesis is consequence-first authoring. Enum *item* descriptions do not fill the gap — they appear only once the dropdown is open.

**Fix:** Add a one-sentence `description=` stating the consequence to each drawn property, e.g. `preview_scale`: "Fraction of the Final atlas resolution used for Preview bakes; lower iterates faster"; `final_supersample`: "Render each atlas at this multiple and downsample, reducing bake noise at the cost of time"; `fit_policy`: "What happens when the packed islands do not fit at the Minimum Detail"; `size`: "Square atlas resolution in pixels for every baked image in this atlas".

### ROUGH - The composition preview error names a web-renderer concept and offers no next step

**Evidence:** presentation_ui.py:563-565 `if max(width, height) > presentation.MAX_CAPTURE_DIMENSION: self.report({"ERROR"}, f"Backing buffer exceeds {presentation.MAX_CAPTURE_DIMENSION}px per edge")`. The two inputs that produced the failure are `composition.width/height` (labelled Width/Height on the Responsive Frame) and `settings.device_pixel_ratio` (labelled "Reference Pixel Ratio").

**Why:** "Backing buffer" appears nowhere else in the add-on and is a browser-implementation term. The artist is told a number is too large but not which of the two controls to change, or by how much — while the panel directly above already computes and shows the exact arithmetic (presentation_ui.py:750-756).

**Fix:** Report `f"{composition.name} at {settings.device_pixel_ratio:g}× needs {width}×{height} pixels, over the {presentation.MAX_CAPTURE_DIMENSION}px limit. Lower Reference Pixel Ratio or the frame's Width/Height."`

### ROUGH - Operator failure reports paste Python exception text and filesystem paths into the status bar

**Evidence:** ops.py:3021-3025 `self.report({"ERROR"}, "Materialize Editable UVs failed; every selected mesh was restored: " f"{type(error).__name__}: {error}")`; ops.py:3807-3809 `raise RuntimeError(f"Blender could not save the scene: {type(error).__name__}: {error}")`, surfaced verbatim at ops.py:3920; ui.py:292 `_draw_wrapped(box, str(error))`. Raw paths: presentation_ui.py:657-658 `f"Comparison plan: … -> {path}"`, presentation_ui.py:690 `f"browser captures remain required in {path}"`, and syncstatus.py:1079-1083 which builds `f"manifest {Path(...)} could not be read: {type(error).__name__}: {error}"` into `manifest_read_failure`, drawn in the N-panel via `integrity_failures()`.

**Why:** The artist gets `RuntimeError: loop count changed during materialization` or `PermissionError: [Errno 13] …` in the status bar. Exception class names are noise, and a bare absolute path in a report is not clickable — there is an Open Website Folder operator for exactly this.

**Fix:** Drop `type(error).__name__` from every artist-facing `self.report`/label (keep it in the `print()` that already precedes several, e.g. ops.py:3919). Replace inline paths with a sentence plus the existing folder operator: "Comparison plan written: {N} Blender references, {M} browser comparisons" beside Open Reference Folder.

### INCONSISTENT - The scene's render policy is "Publishing Mode" where it is edited and "Web Presentation" everywhere it is explained

**Evidence:** props.py:946-947 declares `presentation: bpy.props.EnumProperty(name="Web Presentation", …)`, but the only place it is editable overrides that: ui.py:1009 `layout.prop(project, "presentation", text="Publishing Mode")`. Every reference elsewhere uses the RNA name: ui.py:2864-2866 "The scene's Web Presentation is Realtime. This object choice is retained for Hybrid or Fully Baked presentation."; the `BLENDLINK_PT_bake` docstring at ui.py:3449; docs/research-needle-addon-ui-parity.md:203.

**Why:** The Blendlink Web Object panel tells the artist to go change "Web Presentation", and no control by that name exists anywhere in the add-on. They have to guess that the row labelled Publishing Mode in Scene Properties is the same thing.

**Fix:** Pick one. "Web Presentation" is what the RNA, the docs and every cross-reference already use — delete the `text="Publishing Mode"` override at ui.py:1009.

### INCONSISTENT - "Component" and "Effect / Behavior" name the same thing across every surface

**Evidence:** Panels use one vocabulary: components_ui.py:1513 "Website Effects & Behaviors", 1569 "Web Behaviors", 1627 "Effects & Behaviors". Operators and checks use another: components_ui.py:1088 and 1347 `bl_label = "Add Website Component"`, 1444 "Remove Website Component", 1197 "Copy Component Values", 1276/1289 "Component Actions", 1166 "Clear Component Search", 1464 "That website component no longer exists", 1340 "Paste Values requires the same component type"; and validation.py:611 emits check rows reading `f"Website Component {issue.component_label}: {issue.message}"`. The design notes never use "Component".

**Why:** A Web Check reading "Website Component Click: needs an Accessible Label" sends the artist looking for a Components panel that does not exist. The right-click menu on a card is titled "Component Actions" while the card sits under "Web Behaviors". Two nouns for one object, split cleanly along the panel/operator line, is the largest vocabulary fracture in the add-on.

**Fix:** Adopt one artist term: **Effect** for scene-scoped, **Behavior** for object-scoped, "Effects & Behaviors" collectively. Rename visible labels and reports accordingly ("Remove Behavior", "Copy Values", "Behavior Actions") and change validation.py:611 to prefix "Effect"/"Behavior" based on `target_kind`. Internal identifiers (`component_id`, `component_schema`) can stay.

### INCONSISTENT - One catalog action is labelled "Browse …" in the sidebar and "Add …" in Properties

**Evidence:** `blendlink.browse_components` is drawn with four labels and its `bl_label` is a fifth: components_ui.py:1649 `SCENE_CATALOG_ACTION_LABEL` = "Browse Scene Effects" (line 98); 1675 `BEHAVIOR_CATALOG_ACTION_LABEL` = "Browse Object Behaviors" (line 99); 1532 `text="Add Scene Effect"`; 1604 `text="Add Behavior to Selection"`; `bl_label = "Add Website Component"` (line 1088). The empty-state hints disagree too — "No scene effects yet. Browse the complete catalog above." (line 100) sits above a button reading "Add Scene Effect".

**Why:** The artist learns the action in the sidebar as "Browse Object Behaviors", then cannot find it in Object Properties where it is "Add Behavior to Selection". The verb also changes meaning: Browse implies a chooser, Add implies immediate effect — but both open the same search popup.

**Fix:** Use the `Browse …` form in both surfaces, since the operator opens a searchable catalog. Replace the two Properties-side literals at components_ui.py:1532 and 1604 with the existing constants, and set `bl_label = "Browse Effects & Behaviors"`.

### INCONSISTENT - "Publish" and "build" alternate for the same operation inside one panel

**Evidence:** The primary action is ui.py:806 "Publish Website" (ops.py:3856 `bl_label`). Within the same panel and menu: ui.py:828 `text="Open Build Log"`, ui.py:887 "Auto-build on Save", ui.py:898 "Open Build Log", ui.py:901 "Copy Build Command", ui.py:632 "Building website scene", ui.py:3471 "From the last build — preview again to refresh", ops.py:3889 "Save this .blend before building the website". The sharpest case is ui.py:826-828: the body says "Publish Website again before deploying the site." and the button under it says "Open Build Log".

**Why:** The artist is asked to Publish, told the record of it is a Build Log, and offered a Build Command that in fact runs the publish workflow (`WEBSITE_PUBLISH_COMMAND`, ops.py:3842). Nothing tells them these are one thing, so the More Tools menu reads as a second, separate pipeline.

**Fix:** Pick "Publish" for the Final action and its artifacts: "Open Publish Log", "Copy Publish Command", "Publishing website scene", "Save this .blend before publishing the website". If "Auto-build on Save" compiles Preview quality, rename it "Compile on Save" to match the Preview vocabulary.

### INCONSISTENT - The no-shadows option is "No Realtime Shadows" in the menu and "None" in the panel and report

**Evidence:** ops.py:1906 `("NONE", "No Realtime Shadows", "Neither cast nor receive realtime shadows")` is what the dropdown shows. ui.py:3123 `_SHADOW_LABELS = {… "NONE": "None"}` is what the panel row shows (ui.py:3180-3187), and ops.py:1943-1946 re-declares a third local dict mapping `"NONE": "None"` for the report at ops.py:1948. The scene-level preset uses a fourth spelling, props.py:1176 `("OFF", "Off", …)`.

**Why:** The artist picks "No Realtime Shadows" and the panel immediately reads "Shadows: None" — which in a mixed selection sits beside "Application Default" and is easy to misread as "no override set".

**Fix:** Delete the duplicate label dict in `BLENDLINK_OT_set_shadows.execute` and import `ui._SHADOW_LABELS` (or move it to a shared module), then use a single label — "No Shadows" — in both the enum item and the map. Align props.py:1176 to the same wording.

### INCONSISTENT - The WebGPU material path is "TSL Program" in Material Properties and "WebGPU" on component cards

**Evidence:** ui.py:2508-2536 draws "TSL Program ready to compile" / "TSL Program needs attention" / "TSL Program has no proven channel" plus the button "TSL Program — translate the nodes" (ui.py:2587-2591); ops.py:2685 `bl_label = "TSL Program"`. components_ui.py:902 maps the same internal adapter key to a different word: `for adapter, label in (("webgl", "WebGL"), ("tsl", "WebGPU")):`, producing card text like "WebGPU preview: …".

**Why:** "TSL" is a Three.js shading-language acronym with no meaning to an artist, and the add-on demonstrates a better word one panel over. Someone told on a component card that WebGPU support is in preview cannot connect that to the "TSL Program" button offered on their material.

**Fix:** Use "WebGPU" (or "WebGPU material") in all artist-visible strings and keep `tsl` as the internal key, exactly as components_ui.py already does. Rename the material headings to "WebGPU material ready to compile" and the button to "Translate nodes for WebGPU".

### INCONSISTENT - The connect action carries a shell command in its label on two of four surfaces

**Evidence:** `blendlink.copy_connect_command` (`bl_label = "Copy Website Connect Command"`, ops.py:4241) is drawn as: ui.py:148-151 `text="Copy: npx blendlink connect"`, ui.py:276 `text="Copy: npx blendlink connect"`, ui.py:253 `text="Copy Connect Command"`, ui.py:812 `text="Copy Connect Command"`. The related hookup copier is likewise split — ui.py:256 "Copy Website Hookup" vs ui.py:280 "Copy Hookup".

**Why:** Four labels for one button. Two put a raw CLI invocation in the visible label, which the design notes rule out, and "Copy: npx blendlink connect" is long enough to clip at ordinary N-panel widths — the artist sees "Copy: npx blendlink co…" and cannot tell what it copies.

**Fix:** Use "Copy Connect Command" at all four sites and move `npx blendlink connect` into the operator's `bl_description` or the adjacent explanatory paragraph, which already has room. Do the same for the hookup copier.

### INCONSISTENT - Stopping and opening the preview each have several different button labels

**Evidence:** `blendlink.stop_preview` (`bl_label = "Stop Website Preview"`) is drawn as: ui.py:685 and 1095 "Stop Previous Preview"; ui.py:800 "Stop"; ui.py:892-894 "Stop Website Preview" / "Stop Previous File Preview"; ui.py:1140 "Stop Live Preview". `blendlink.open_preview` (`bl_label = "Open Website"`) is drawn as ui.py:773 "Open Website" and ui.py:1112 "Open Website Preview".

**Why:** "Stop Previous Preview" and "Stop Previous File Preview" describe the identical situation with different words in two panels. "Stop" alone (ui.py:800) sits next to "Watching this saved .blend for changes" and does not say what it stops. The artist cannot build a stable model of which control ends the session.

**Fix:** Settle on two strings: "Stop Live Preview" for the current file's session and "Stop Previous File's Preview" for a stale one, used at all five sites (bare "Stop" only in an aligned row where the adjacent label supplies the noun). Use "Open Website Preview" for `open_preview` in both places and set `bl_label` to match.


## Blender add-on operators: all 67 in packages/blender-addon/ops.py, 9 i

### ROUGH - The component catalog is hidden from search while a broken plumbing operator squats on its label

**Evidence:** components_ui.py:1088-1089: `bl_label = "Add Website Component"` with `bl_options = {"REGISTER", "INTERNAL"}` on BLENDLINK_OT_browse_components — the popup catalog that every panel button opens (components_ui.py:1532, :1604, :1649, :1675). components_ui.py:1347-1348: `bl_label = "Add Website Component"` with `bl_options = {"REGISTER", "UNDO"}` on BLENDLINK_OT_add_component, which is only ever called with an explicit `component_type` from a catalog row (components_ui.py:989, :1052).

**Why:** F3 → "Add Website Component" shows exactly one entry, and it is the wrong one: `add_component` with an empty `component_type` reports `No component definition for ''` (components_ui.py:1376). The one action an artist would actually search for — the searchable effect/behavior catalog — cannot be found in F3 at all. Two registered operators also sharing a bl_label makes the search result indistinguishable even after the flags are fixed.

**Fix:** Drop `"INTERNAL"` from `browse_components` and add it to `add_component`, then give `add_component` a distinct label such as `"Add Website Component by Type"` so the two are never confused in any list.

### INCONSISTENT - Open Website Folder is the only "open" action with no failure branch

**Evidence:** ops.py:4146-4149 — `def execute(self, context): from . import syncstatus; bpy.ops.wm.path_open(filepath=syncstatus.project_root()); return {"FINISHED"}`. `project_root()` returns a cached value (syncstatus.py:155-157 `return str(_state["root"]) if _state["root"] else None`), and the poll (ops.py:4139-4144) only checks that the cache is non-None. Compare `open_sync_log` (ops.py:4208-4215), `open_preview_log` (ops.py:4166-4173) and `open_reference_folder` (presentation_ui.py:715-718), which all re-verify the path in execute and report a clean `{'ERROR'}` first.

**Why:** The artist moves or renames the website folder in Explorer — an ordinary thing to do — then clicks More Tools → Open Website Folder. Nothing happens, or a raw Python error appears. Either way there is no message telling them the connection is stale or what to do about it, and the same button will keep failing silently until something else forces a status refresh.

**Fix:** Guard it like its siblings: `root = syncstatus.project_root(); if not root or not os.path.isdir(root): self.report({"ERROR"}, "The connected website folder is no longer there; re-run Copy Website Connect Command in its new location"); return {"CANCELLED"}`. Apply the same re-check to `open_derived_asset` (ops.py:3523-3525), which also calls `wm.path_open` with no execute-time verification.

### INCONSISTENT - The design notes still call the final build "Build Final"; every code path and the parity doc call it "Publish Website"

**Evidence:** docs/addon-design-notes.md:37 — "**Check Atlas Fit** and **Build Final** are its visible secondary actions". Against that: ops.py:3856 `bl_label = "Publish Website"`, ops.py:3861 the FINAL enum item is `"Publish Website"`, ui.py:806 `text="Publish Website"`, and docs/FEATURE_PARITY.md:257 lists "Preview Website, Check Atlas Fit, Publish Website". "Build Final" appears nowhere in the add-on.

**Why:** The document the team treats as the settled standard names a button that does not exist, so the next person auditing or extending the publish surface has to guess which of two names is canonical — and "Build" is already spoken for elsewhere in the same surface (Open Build Log, Copy Build Command), which is why the code moved off it.

**Fix:** Update docs/addon-design-notes.md:37 to "**Check Atlas Fit** and **Publish Website** are its visible secondary actions" — the code and FEATURE_PARITY.md already agree, so the doc is the stale surface here.

## Deliberate (do not change)
- `_rename` (ops.py:222-231) deliberately refuses a rename rather than letting Blender append `.001` — this is the `.001` trap defence the design notes require. The resulting "skipped name collisions: …" WARNING in tag_collider/tag_rigid/set_lod/tag_noimp is the intended loud failure, not a missing bulk-rename feature. Do not "fix" it by falling back to Blender's auto-numbering.
- `set_texel_weight` (ops.py:2299) is the only operator using `invoke_props_dialog`, and it pre-seeds `self.weight` from the selection when the values agree (ops.py:2322-2330). The design notes bless exactly this case: "a small focused properties dialog only when a value must be chosen before the action, as with **Lightmap Scale**".
- `materialize_atlas_uvs.overwrite` defaults to False (ops.py:2877-2881) and the operator reports "kept N existing authored layer(s) untouched (enable Overwrite to replace)" (ops.py:3039-3043). It deliberately does the safe thing and points at the F9 redo panel instead of asking up front — that is the "adjust after execution" paradigm, not a missing confirmation.
- `_select_only` (ops.py:3631-3656) refuses to clear the artist's current selection unless at least one candidate proves eligible. A navigation action that finds nothing leaves the viewport as it was, which is why every Select… operator reports a WARNING with a "N unavailable in this view" count rather than emptying the selection.
- The long execute bodies in `remove_atlas` (ops.py:633-720), `add_reflection_probe` (ops.py:1034-1120), `toggle_checker` (ops.py:3354-3448) and `materialize_atlas_uvs` (ops.py:2893-3047) are long because each one snapshots, rolls back partial mutations, and names the linked/read-only objects that blocked it. That is deliberate transactional behaviour, not bloat.
- `toggle_checker`'s row renders as "Checker: Checking…" with `row.enabled = mode is not None` (ui.py:3577-3586) when the cached mode is unknown — the design notes' "Empty validation caches render as **Checking...**, never as a false success" rule, correctly implemented.
- `poll()` bodies read only cached state: `syncstatus.bake_plan()` (syncstatus.py:128-132) and `project_root()` (syncstatus.py:155-157) are plain dict reads, so `toggle_checker.poll` and `preview_atlas_uvs.poll` do not parse the manifest on every redraw. The draw()-purity rule holds across the operator surface.
- probe_authoring.py registering no operators is correct, not an omission: every probe action lives in ops.py and delegates the mechanics, keeping the bake/hash logic unit-testable without bpy operator registration.

## Notes
- I could not run Blender, so I did not confirm the exact placeholder string Blender 4.2/5.2 substitutes when an operator has neither `bl_description` nor a docstring. Either way the two lighting-state operators have no explanatory tooltip; only the wording of the placeholder is unverified.
- `browse_components.invoke` uses `context.window_manager.invoke_popup(self, width=880)` (components_ui.py:1114). 880 UI units at 1.5–2.0 UI scale would cover most of a 1080p display. Whether that is acceptable needs a running Blender at a realistic UI scale; the two-column catalog may genuinely need the width.
- `_finish_component_operator` prints `##blendlink-component-action {json}` to the console on every artist copy/paste (components_ui.py:1183). The `##blendlink` prefix matches the progress protocol described in the design notes, so this looks like a deliberate e2e-test hook rather than leftover debugging — confirm before removing.
- `materialize_atlas_uvs` reports `f"a {reserved.domain}/{reserved.data_type} mesh attribute already uses {AUTHORED_UV}"` (ops.py:2921-2923), which renders raw RNA identifiers such as `CORNER/FLOAT2` rather than Blender's own UI names ("Face Corner", "2D Vector"). Real but a rare path; I left it out of the findings as low value relative to the churn.
- `clear_tag.poll` (ops.py:2049-2052) builds a full custom-property dict per selected object on every redraw of any panel containing the button. `any()` short-circuits, so it is cheap whenever something is tagged and O(selection × properties) when nothing is. Whether that is measurable on a several-thousand-object selection needs profiling in a running Blender.
- `open_workspace`'s tooltip says "Open the website workspace in the system file browser" (ops.py:4133) while its only button says "Open Website Folder" (ui.py:895). "Workspace" is already Blender's own top-bar concept, so the tooltip mildly contradicts the button; folding it into the finding-9 fix would be natural.
- I did not verify at runtime whether `bpy.ops.wm.path_open` raises or silently no-ops on Windows for a missing path. Finding 9 does not depend on which it is — there is no `{'ERROR'}` branch either way.


## Effects & Behaviors component authoring UI

### MISLEADING - Contact Shadows claims "Already on selection" / "Already on Scene" for a record that lives somewhere else

**Evidence:** `_has_component` short-circuits on cardinality and ignores its `obj` argument — components_ui.py:161-168: `if definition is not None and definition.get("cardinality") == "one-per-scene": return any(item.component_type == component_type for item in project.components)`. `_catalog_target_counts` then counts that as per-object truth: components_ui.py:1021-1023 `existing = sum(1 for obj in compatible if _has_component(project, component_type, obj=obj))`. `blendlink.contact-shadows` is the one component that is both `"cardinality": "one-per-scene"` and `"targets": {"SCENE", "OBJECT"}` (component_schema.py:306-312). The button text comes from components_ui.py:1044-1050 (`"Already on Scene" … "Already on selection"`), the skip line from components_ui.py:1069-1070 (`f"{counts['existing']} existing skipped"`), and the operator repeats it at components_ui.py:1384 (`f"{definition['label']} is already on this Scene"`).

**Why:** Place Contact Shadows on an Empty, then select two meshes and open Browse Object Behaviors: the entry reads "Already on selection" with a checkmark and "2 existing skipped", none of which is true — neither mesh has the component. The mirror case is worse: with Contact Shadows on an Empty, Browse Scene Effects reports "Already on Scene", so the artist believes a scene effect exists that they cannot find in the Scene Effects list. The design notes require truthful selection summaries and consequence-first catalog copy; this states a placement fact that is simply false.

**Fix:** Split the two questions in `_catalog_target_counts`. Keep `existing` meaning "this exact target already has it" (call `_has_component` with the cardinality short-circuit bypassed), and add `placed_elsewhere` for the one-per-scene case, carrying the owning target's label from `_component_target_label`. When `placed_elsewhere` is set, label the disabled button "Already added (Ground)" and add a Select/reveal action next to it rather than a bare checkmark; make `BLENDLINK_OT_add_component` report the same wording instead of "is already on this Scene".

### MISLEADING - Paste failures show artists JSON field paths and raw UUIDs

**Evidence:** `_hydrate_component_atomic` validates with a machine path — components_ui.py:494-497 `props._validate_component_values(component.component_type, hydrated, "Pasted component values", require_complete=bool(component.enabled))` — and props.py raises messages built from it: props.py:2259 `f"{path}.pixelSize must be a whole number of CSS pixels"`, props.py:2242 `f"{path}.{url_key} uses an unsupported scheme; use {allowed} or a site-relative path"`, props.py:2247 `f"{path}.maxDistance must be greater than minDistance"`. components_ui.py:485-488 raises `f"copied {reference_key} {expected!r} does not resolve to exactly one object in this Scene"`. All of these reach `self.report()` through `result.add("errors", …, str(error))` (components_ui.py:686) and `ComponentActionResult.summary()` (components_ui.py:300-314).

**Why:** Copy a Look At Object behavior in one file and paste it where the target does not exist — an entirely ordinary move — and the status bar says `Paste Values Look At Object: 0 changed, 0 skipped, 1 error(s); Cube: copied targetId '9f3c1a2e-…' does not resolve to exactly one object in this Scene`. The artist is shown an internal JSON key and a UUID and told nothing actionable. `Pasted component values.maxDistance must be greater than minDistance` names two camelCase keys that appear nowhere in the UI; the fields are labelled "Full Volume" and "Silent Beyond" (components_ui.py:829-830).

**Fix:** Translate at the boundary. In `_hydrate_component_atomic`, catch the ValueError and re-raise with artist wording keyed off the failing field — map the camelCase key to its `_FIELD_LABELS`/RNA `name` (e.g. `maxDistance` → "Silent Beyond"), and pass a human path such as the component label instead of the literal string "Pasted component values". For the reference case, replace the UUID with the copied `targetName`/`sourceName` already stored in the payload: "the copied Target 'Hero' is not in this Scene — choose a Target on the pasted card".

### MISLEADING - "Imported Records Needing Attention" flags healthy custom-namespace records as errors, using a target rule that disagrees with the validator

**Evidence:** components_ui.py:1551-1563 collects `component_schema.definition(component.component_type) is None or _component_target(component) is None` under `layout.label(text="Imported Records Needing Attention", icon="ERROR")`. But the validator classifies a record with no built-in editor as non-blocking and benign — component_validation.py:236-241: `"No built-in editor or website adapter is installed. The stored record is preserved for a custom adapter."`, `blocking=False`. The two modules also resolve targets differently: components_ui.py:147-149 `_component_target` returns `component.target_object` only, while component_validation.py:145-159 `target_for` falls back to a unique `blendlink_id` match and additionally requires scene containment.

**Why:** A correctly preserved third-party record — the exact case the schema and validator go out of their way to keep round-trippable — is presented under a red ERROR heading titled "Needing Attention", while its own card two lines below says it is fine. The divergent target rule produces the same contradiction for built-in components: a record whose pointer is empty but whose `target_id` resolves is listed as needing attention even though its card resolves the object and shows no issue; conversely a pointer to an object outside the scene is drawn as healthy in the object panel while the validator reports "Target missing".

**Fix:** Split the section in two. List records whose target does not resolve under "Records with a missing target" with `icon="ERROR"`, and records with no installed editor under "Records from another adapter" with `icon="PLUGIN"` and neutral copy ("Preserved and published unchanged; no Blendlink editor is installed"). Use `component_validation.target_for(context.scene, component)` for the membership test in both, and change `_component_target`/`_matches_object` (components_ui.py:147-158) to delegate to `component_validation.target_for`/`matches_object` so one rule decides target identity everywhere.

### ROUGH - The system clipboard is read, parsed and validated on every panel redraw

**Evidence:** `_read_component_clipboard` (components_ui.py:411-423) does `str(getattr(context.window_manager, "clipboard", "") or "")`, then `json.loads(...)` and `_validate_clipboard_payload`, which itself calls `props._validate_component_values`. It is called from three panel `draw()` bodies: components_ui.py:1535 (Scene Properties), components_ui.py:1607 (Object Properties), and twice in the N-panel — components_ui.py:1652 and components_ui.py:1678.

**Why:** Reading `window_manager.clipboard` is a host OS call (on X11 a round trip to whichever application owns the selection), and it happens twice per N-panel repaint plus once per Properties repaint, each followed by a JSON parse and a full schema validation. This is exactly the "draw() must not parse or start work" rule, and the cost is paid constantly just to decide whether to show one small Paste button. It also means an unrelated large clipboard payload (say, a copied spreadsheet) is fetched into Blender on every mouse move over the sidebar.

**Fix:** Stop conditioning the button on the clipboard. Always draw the `blendlink.paste_component_as_new` button and let the operator explain itself — `run_component_action` already reports `"Copy a Blendlink component first"` through the normal error path — or, if the conditional button is worth keeping, memoize the parse: keep `(raw_string, parsed_payload)` in a module global and re-validate only when the raw string differs, so a repaint with an unchanged clipboard costs one string compare.

### ROUGH - Catalog results in the default All view are neither grouped nor labelled by category

**Evidence:** `search_catalog` iterates `COMPONENT_DEFINITIONS` in declaration order (component_schema.py:711), which runs Effects → Rendering → Effects → Rendering → Interaction → Motion → Animation → Audio (bloom…ambient-occlusion, shadow-catcher, contact-shadows, outline…kuwahara, see-through, open-url…). The popup renders that order flat — components_ui.py:1156-1159 `for component_type, definition in matches: _draw_catalog_entry(...)` — and `_draw_catalog_entry` never prints `definition["category"]` (components_ui.py:1031-1075 shows label, description, target badge, cost badge, support, adapters, consequence, cost). The category sidebar is only a filter (components_ui.py:1132-1135).

**Why:** "All" is the default (`self.category = "ALL"` at components_ui.py:1113) and is what the artist sees first: twenty-two unlabelled boxes whose grouping visibly stutters — two Rendering entries in the middle of the Effects run, another after Kuwahara. There is no way to tell from an entry which category it belongs to, so the sidebar filter can only be used blind. Both source docs call for progressive, grouped disclosure rather than one long list.

**Fix:** Sort matches by `(COMPONENT_CATEGORIES.index(value["category"]), value["label"])` inside `search_catalog` (keeping it a pure function so the schema test can assert the order), and in the popup draw a `results_layout.label(text=category, icon=_CATEGORY_ICONS[category])` heading whenever the category changes between entries — `_CATEGORY_ICONS` already exists at components_ui.py:22-29. Optionally append per-category match counts to the sidebar enum labels.

### ROUGH - Clearing the search box silently throws away the category filter

**Evidence:** components_ui.py:1129-1131 draws the clear button, which runs `BLENDLINK_OT_clear_component_search` — components_ui.py:1171-1175 `bpy.ops.blendlink.browse_components("INVOKE_DEFAULT", target_mode=self.target_mode)`. That re-enters `invoke`, which resets both properties: components_ui.py:1111-1114 `self.search = ""` and `self.category = "ALL"`.

**Why:** The artist narrows to Audio, types "click", finds it too narrow, and presses the X next to the search field expecting to see all Audio components. Instead the filter jumps back to All and the popup closes and reopens at the current mouse position, losing its place. The X is labelled and iconed as a text-clear, so silently resetting a second, separate control is a broken expectation.

**Fix:** Carry the category through the re-invoke: add a `category: bpy.props.StringProperty(default="ALL", options={"HIDDEN"})` to `BLENDLINK_OT_clear_component_search`, set `clear.category = self.category` at the call site (components_ui.py:1129-1131), pass it in the `bpy.ops` call, and have `invoke` only default `self.category` when it was not supplied — Blender leaves explicitly-passed properties set, so guard the reset with a `SKIP_SAVE`-free sentinel or move `self.category = "ALL"` out of `invoke` entirely and reset it only from the panel buttons.

### ROUGH - Cards are laid out for a wide panel: fixed multi-item rows truncate and prose wraps to ~24 characters at N-panel width

**Evidence:** `_draw_component_card` puts three items in one row (components_ui.py:884-890: target badge label, cost badge label, and the Docs operator) and two in another (components_ui.py:895-901: `adapter_row.label(text=component_schema.adapter_badge(definition, adapter), …)` for both webgl and tsl). Nothing in components_ui.py consults panel width for layout — the only width awareness is text wrapping in `_wrap` (components_ui.py:116-137), whose estimate is `available = (region_width / ui_scale) - 72.0; width = min(width, max(20, int(available / 7.0)))`; at a default ~240 px N-panel that yields 24 characters per line. ui.py already has the responsive helpers this needs: ui.py:40-41 `_is_compact(context, threshold=300.0)` and the pattern at ui.py:250 `actions = box.column(align=True) if _is_compact(context) else box.row(align=True)`.

**Why:** At ordinary N-panel width one expanded card stacks roughly twenty label rows — description, compatibility, fallback note, consequence, cost all wrapped at 24 characters — which is precisely the "permanently wrapped sidebar prose" the notes rule out. Worse, the honesty content is the part that truncates: "WebGL Preview" and "WebGPU/TSL Unavailable" share one row and both clip to a few characters, so the per-renderer support claim the design leans on is unreadable exactly where it matters. Two Scene Effects cards fill the sidebar before any control appears.

**Fix:** Import ui's `_is_compact` (or duplicate the threshold check locally to avoid the cycle) and, when compact: draw the badge and adapter rows as `content.column(align=True)` one item per line; drop the Docs button to an icon-only operator (`text=""`, `icon="HELP"`) on the header row; and show `compatibility`, the fallback notes and `consequence` only in the wide layout, moving their text into the card's tooltips or behind a small "Details" expand. Keep `cost` and the target badge, which are the two the artist reads while scanning.

### ROUGH - Paste Values across a multi-selection copies the Website Surface identity name, producing duplicate-name blockers while reporting full success

**Evidence:** `_component_values_for_clipboard` copies every bound field including the identity one — component_schema.py:89-92 binds `"name": "website_surface_name"`. `_hydrate_component_atomic` validates only the single record it is writing (components_ui.py:456-511; `props._validate_component_values` has no cross-component awareness), while the uniqueness rule lives in the project validator: component_validation.py:355-365 `"Another Website Surface already uses {surface_name!r}; every application name must be unique."` with `blocking=active`. The multi-target loop at components_ui.py:649-686 then reports `"applied all N value field(s)"` for each object.

**Why:** Select three screen meshes that each already have a Website Surface, copy from one and Paste Values: the report reads "3 changed, 0 skipped, 0 error(s)" while every surface now carries the same `name`, producing two blocking duplicate-name issues and a blocked publish. `_new_component` goes to real trouble to de-duplicate this exact field on creation (components_ui.py:234-246), so paste is the one path that undoes that care — and it does so while claiming success.

**Fix:** Treat identity fields as non-pasteable. Add an `_IDENTITY_FIELDS = {"blendlink.website-surface": ("name",)}` map and strip those keys in `_hydrate_component_atomic` before hydrating (keeping them in the clipboard payload so Paste as New can still seed a de-duplicated value through the existing `_new_component` naming loop). Report the omission per target so the artist knows: `result.add("skipped", obj.name, "identity_preserved", "kept its own Website Name")`.

### ROUGH - A collapsed card hides its blocking error completely

**Evidence:** `_draw_component_card` returns before any diagnostics when collapsed — components_ui.py:872-873 `if not component.expanded: return` — and the header built at components_ui.py:853-871 carries no severity: `box = layout.box()` with no `box.alert`, and the only icon is the component type icon in `header.label(text=label, icon=_component_icon(...))`. Blocking issues are drawn only in the expanded body at components_ui.py:926-932.

**Why:** The notes require missing Accessible Labels and similar problems to be "loud in … the component card". A collapsed Open Link on Click with an empty Accessible Label, or an Audio Source whose target went missing, looks identical to a healthy one — and collapsing cards is the natural response to how tall they are. The artist's first sign of trouble becomes a blocked publish.

**Fix:** Once card issues come from the cached snapshot (see the draw() finding), set `box.alert = any(issue.blocking for issue in issues)` and swap the header icon to `"ERROR"` (or add a trailing `header.label(text="", icon="ERROR")`) whenever the card holds a blocking issue, regardless of expansion state. Use `"INFO"` for non-blocking-only cards so disabled drafts stay quiet.

### INCONSISTENT - Pinned or deselected Object Properties hides everything instead of offering Select This Object

**Evidence:** components_ui.py:1584-1592: `if obj not in selected: warning = layout.box(); warning.alert = True; _wrap(warning, "Select this object before adding or editing website behaviors.", icon="ERROR"); return`. No operator is offered, and the return suppresses the existing cards. The add-on already has the button this needs — `blendlink.select_issue` with `object_name` — and uses it inside the card at components_ui.py:921-924.

**Why:** The design notes are explicit: "If pinned Properties show an object outside the editable selection, explain the mismatch and offer Select This Object instead of silently editing a different owner." Here the mismatch is explained but the remedy is manual, and the artist also loses read access to the behaviors already on that object — a pinned Properties tab is exactly how an artist reviews an object while working on another one. A red alert box with no action reads as a malfunction rather than a state.

**Fix:** Replace the bare early return with an explanatory row plus an action: keep the message, add `op = warning.operator("blendlink.select_issue", text="Select This Object", icon="RESTRICT_SELECT_OFF"); op.object_name = obj.name`, then continue to `_draw_cards(...)` with the card contents wrapped in a `column` whose `.enabled = False` so the existing behaviors stay readable but not editable. Drop `warning.alert` — this is a state, not an error.

### INCONSISTENT - "Website Component" means two different things in the same add-on

**Evidence:** Web Checks prefixes every component issue with it — validation.py:612 `f"Website Component {issue.component_label}: {issue.message}"` — while the site-hookup copy uses the same phrase for the generated React/site file: ui.py:246-247 `"Create this scene's website component before the first preview."` and `"The generated website component is missing. Run connect to recreate it."`. The authoring surfaces meanwhile use four different names for one dialog: "Add Scene Effect" (components_ui.py:1532), "Browse Scene Effects" (SCENE_CATALOG_ACTION_LABEL, components_ui.py:98), "Add Behavior to Selection" (components_ui.py:1604), "Browse Object Behaviors" (BEHAVIOR_CATALOG_ACTION_LABEL, components_ui.py:99); the operators artists see in Adjust Last Operation are "Add Website Component" and "Remove Website Component" (components_ui.py:1347, 1444).

**Why:** An artist whose Web Checks says "Website Component Bloom: Enter an Accessible Label" and whose status card says "The generated website component is missing" has no way to know these are unrelated subsystems — one is a bloom effect, the other is a source file created by `npx blendlink connect`. The panel titles the notes settled on ("Website Effects & Behaviors", "Web Behaviors", "Effects & Behaviors") never use the word "component" at all, so it appears only in the places where it can confuse.

**Fix:** Reserve "component" for the generated site file and drop it from the authoring vocabulary artists see. Change validation.py:612 to `f"{issue.component_label}: {issue.message}"` prefixed with "Scene Effect" or "Web Behavior" chosen from `issue`'s target kind; retitle the operators to "Add Web Effect or Behavior" / "Remove Web Effect or Behavior"; and settle on one verb for the dialog — use "Add Scene Effect" / "Add Behavior to Selection" in all four places (the N-panel labels are longer than the Properties ones today, so the short-label argument does not favour "Browse").

### INCONSISTENT - Tag Rigid Body and Tag Collider are duplicated inside Web Behaviors, one panel below the panel that owns them

**Evidence:** `_draw_physics_shortcuts` (components_ui.py:998-1010) draws `blendlink.tag_rigid` and an `operator_menu_enum` for `blendlink.tag_collider` under the heading `PHYSICS_DESIGNATION_TITLE = "Physics Export Designations"`; it is called from the Object Properties Web Behaviors panel (components_ui.py:1621) and again from the N-panel sidebar (components_ui.py:1699), and repeated a third time in the unused `BLENDLINK_MT_add_object_component` (components_ui.py:1490-1495). The owning panel is `BLENDLINK_PT_tag` ("Semantic Designation", ui.py:2210-2236), a sibling of Web Behaviors under the same `BLENDLINK_PT_designation` parent, which offers all four actions: `tag_collider`, `tag_rigid`, `set_lod`, `clear_tag`.

**Why:** In one Object Properties tab the artist sees Tag Collider and Tag Rigid Body twice, a few rows apart, under two different headings ("Semantic Designation" and "Physics Export Designations") — and the copy inside Web Behaviors is the incomplete one: no Set LOD and, critically, no Clear Tag, so an artist who tags from there cannot untag from there. The notes' ownership model gives Semantic Designation its own section precisely so these do not compete, and colliders are not components — they are name-vocabulary tags, which is why the panel needs a disclaimer explaining they are not components.

**Fix:** Delete `_draw_physics_shortcuts` from `BLENDLINK_PT_object_components` (components_ui.py:1621) — Semantic Designation is directly above it in the same tab and already owns the actions. In the N-panel, replace the duplicated buttons with a single route consistent with the rest of the sidebar (a labelled action that opens Object Properties, as "Selected Object" / "Edit N Selected" already do). Keep `PHYSICS_DESIGNATION_NOTE` ("Export tags only — not a bundled physics simulation.") by moving it into the Semantic Designation panel, where the collider/rigid controls actually live.


## Native Properties-context panels (Scene, World, Object, Material)

### MISLEADING - "Pinned to an object outside the editable selection" fires when nothing is pinned, and its remedy is a dead end for linked objects

**Evidence:** `ui.py:2323-2333` in `BLENDLINK_PT_designation.draw`: `if obj not in getattr(context, "selected_editable_objects", ()):` → "This Properties editor is pinned to an object outside the editable selection. Select it before changing Blendlink settings." plus a Select This Object button wired to `blendlink.select_issue`. `obj` is `context.object or context.active_object`, which in an unpinned Properties editor is simply the active object.

**Why:** Two false cases. (1) Press Alt+A to deselect all: the active object stays active and stays shown in Properties, so Blendlink Web Object announces that the editor is "pinned" when the artist never pinned anything — and the Semantic Designation and Web Behaviors sub-panels vanish at the same moment, which reads as the add-on breaking. (2) For a library-linked object, `selected_editable_objects` excludes it even when it is selected, so Select This Object runs, selects it, and the identical message comes straight back — the button can never resolve its own complaint. The design notes ask for this message only in the pinned case: "If pinned Properties show an object outside the editable selection, explain the mismatch and offer Select This Object".

**Fix:** Split the three cases. Detect real pinning via `context.space_data.use_pin_id` (or `space_data.pin_id is not None`) and keep the current wording plus Select This Object only there. When the object is merely deselected, say "Select this object to edit its Blendlink settings" and keep the Select This Object button — that one does work. When `getattr(obj, "is_editable", True)` is False, say the object is linked from another .blend and cannot be edited here, and drop the button entirely (or replace it with the existing guidance to open the source .blend, matching the linked-image note at ui.py:2765).

### ROUGH - Effects & Behaviors cards re-validate, re-scan the scene, and read the OS clipboard on every redraw

**Evidence:** `components_ui.py:926` `for issue in _component_issues(project, component):` → `components_ui.py:698-702` → `component_validation.validate_component(...)`, which JSON-parses `component.raw_values` (`component_validation.py:205`) and does an O(components) duplicate-ID scan (`:219-222`) — per visible card, per redraw. `components_ui.py:919` `target = component_validation.target_for(context.scene, component)` → `component_validation.py:155-158` iterates every `scene.objects` reading `obj.get("blendlink_id")` whenever the component's `target_object` pointer is not resolvable in the scene. And `components_ui.py:1535` (Scene → Website Effects & Behaviors), `:1607` (Object → Web Behaviors) and `:1652` (sidebar) each call `_read_component_clipboard(context)` in `draw()`, which reads `context.window_manager.clipboard` and `json.loads` it (`components_ui.py:411-423`).

**Why:** The design notes are explicit: "draw() remains a pure presentation step… A redraw should be cheap and deterministic regardless of scene size." Here the cost is O(cards x scene objects) plus a JSON parse per card plus up to three system-clipboard round-trips per redraw. On a large scene with a handful of object behaviors whose pointers went stale (append/link, deleted target), Properties and the sidebar become visibly sluggish while merely mousing over them, and the clipboard read can stall on platforms where the clipboard owner is another process.

**Fix:** Compute component issues once in `validation.recompute` and store them on `ScanResult` keyed by `component_id` (it already carries `material_compatibility`, `light_diagnostics`, `rendering_analysis`); have `_draw_component_card` read `validation.result()` and render "Checking…" when the cache is empty, matching the existing convention. Resolve and cache the component-to-object mapping in the same pass instead of calling `target_for` from draw. Move the clipboard read to the operator/timer: cache the parsed payload's `targetKind` in a module global refreshed by the existing 1-second timer, and have `draw()` read only that flag to decide whether to show Paste as New.

### ROUGH - Website Ownership is the one panel that ignores the responsive wrap helpers

**Evidence:** `ownership.py:137` `def wrapped(container, value, width=46):` — a fixed 46-character wrap with no region-width clamp, unlike `ui._draw_wrapped`/`_responsive_wrap_width` (ui.py:44-78), which derive the width from `region.width / ui_scale`, and unlike `components_ui._wrap` (components_ui.py:116-128), which clamps its explicit width the same way. `ownership.py:150-157` also puts two labels in one `box.row(align=True)`: `decision.label` and `f"Owned by: {OWNER_LABELS[...]}"`.

**Why:** Blender labels do not wrap; they clip. The Website Ownership panel is a sub-panel inside a box, so it already loses roughly 40px of gutter, and it renders eleven decisions each with a full sentence. At an ordinary docked Properties width the reason text is cut mid-word, and the header row splits its space between "Tone mapping & exposure" (23 chars) and "Owned by: Website code" (22 chars) so both truncate. The design notes require "one-column rows, short action labels, compact status summaries" at narrow widths, and this panel's whole value is prose an artist can read.

**Fix:** Delete the local `wrapped` closure and call `ui._draw_wrapped(box, decision.reason)` (accept a `context` argument in `draw_summary`, as `_draw_atlas_recipe` does). Split the header when narrow: `header = box.column(align=True) if ui._is_compact(context, 300) else box.row(align=True)`.

### ROUGH - Every control in the Bake Quality panel is missing a description, so none of them has a tooltip

**Evidence:** `_draw_bake_quality_recipe` (ui.py:2080-2093) draws exactly five properties, and none declares `description=`: `preview_samples` (props.py:963), `preview_scale` ("Preview Resolution", :966), `final_samples` (:956), `final_supersample` (:959), `final_denoise` (:962). Compare the neighbouring atlas properties, which all carry one: `target_density` (props.py:84-90), `margin` (:92-94), `bake_output` (:105-110).

**Why:** Hovering any Bake Quality control shows only its label. "Preview Resolution 0.25" does not say it is a linear scale on the atlas edge (so a sixteenth of the texels); "Final Supersample 2" does not say the bake renders at 2x and downsamples; "Preview Samples 16 / Final Samples 128" does not say these are Cycles samples per bake job. These are the numbers that decide whether a bake takes twenty seconds or twenty minutes, and the panel's only explanatory text is one line about which action uses which set.

**Fix:** Add `description=` to all five in `props.py`, in the consequence-first voice used elsewhere — e.g. `preview_scale`: "Fraction of each atlas edge used while previewing; 0.25 bakes at a sixteenth of the final texel count"; `final_supersample`: "Renders each bake at this multiple of the atlas size, then downsamples to reduce edge aliasing"; `final_samples`/`preview_samples`: "Cycles samples per bake job…". While in `ops.py`, give `BLENDLINK_OT_add_state` (:723) and `BLENDLINK_OT_remove_state` (:948) class docstrings — they are the only two operators in the whole file without one, so the Lighting States Add/Remove buttons also have no tooltip.

### INCONSISTENT - Scene Properties carries a second, diverged copy of the publishing workflow the N-panel owns

**Evidence:** `ui.py:1018-1141` in `BLENDLINK_PT_project.draw` ("Blendlink Scene") draws a full `Website Preview` box: a `scale_y = 1.35` dominant action, the save-first prompt (`wm.save_as_mainfile`, "Save Scene to Preview..."), a build progress bar with cancel, a preview progress bar with stop, the stale-session box, the update-failure box with Open Preview Log, and Stop Live Preview. The design notes: "Setup, browser preview, final build, cancel, and failure recovery therefore share one workflow surface. Do not repeat setup prompts or competing build buttons in separate panels." The two copies already disagree: for the identical state `previewrun.is_ready_for_current_file() and status == "IN_SYNC"` the N-panel button reads "Open Website" (`ui.py:773`) and the Scene panel reads "Open Website Preview" (`ui.py:1110-1114`); and the Scene copy's label chain (`ui.py:1116-1126`) omits both "Check & Update Website" (non-owned server) and "Retry Website Preview" (after a failure) that the N-panel chain has at `ui.py:775-782`.

**Why:** With the 3D View sidebar and Properties editor both open — the default Layout workspace — an artist sees two large primary buttons that describe the same session differently. After a failed preview the sidebar says "Retry Website Preview" while Scene Properties still says "Preview Website"; against a website-owned dev server the sidebar says "Check & Update Website" while Scene Properties says "Update Website Preview", which is a false claim about who owns the server. There is no way to tell which surface is authoritative, and every future state added to the machine has to be re-implemented in two places or silently drift again.

**Fix:** Delete the `Website Preview` box from `BLENDLINK_PT_project.draw` (ui.py:1018-1141) so the panel keeps only Publishing Mode and its consequence line. Replace it with a single route back to the owner, e.g. a row that reads "Preview and publishing live in the 3D View sidebar". If a status echo is wanted here, echo it read-only (headline text from `syncstatus.status()`), with no action buttons, no progress bar, and no cancel.

### INCONSISTENT - Website Effects & Behaviors is ordered after Texture Atlases, not before it

**Evidence:** `components_ui.py:1515` `bl_order = 20` on `BLENDLINK_PT_scene_components` ("Website Effects & Behaviors"), the same value as `ui.py:2167` `bl_order = 20` on `BLENDLINK_PT_atlases` ("Texture Atlases"). The design notes fix the Scene order as "Website Camera & Frames, Website Effects & Behaviors, Texture Atlases, Bake Quality…". The tie is broken by registration order, and `__init__.py:15-22` registers `*ui.classes` before `*components_ui.classes`, so Texture Atlases takes the earlier slot. Every other Scene sub-panel has a unique order (10/30/40/50/60/70/80/90).

**Why:** The settled hierarchy puts contextual behavior authoring immediately after the camera and before the bake machinery, because that is the order an artist works in. As written the panel lands one slot late, and its position depends on an incidental import order in `__init__.py` rather than on a declared value — any future reshuffle of that tuple moves it again with no visible cause.

**Fix:** Set `bl_order = 15` on `BLENDLINK_PT_scene_components` (components_ui.py:1515), and add an assertion to the existing panel-hierarchy block in `tests/run_headless.py` (near line 1043) that the Scene sub-panel `bl_order` values are strictly increasing in the documented sequence.

### INCONSISTENT - A .blend that was never set up still gets a complete atlas/bake/shadow authoring UI in Object Properties

**Evidence:** `BLENDLINK_PT_designation.poll` (`ui.py:2309-2311`) checks only that an object exists — unlike every Scene sub-panel and unlike its own sibling `BLENDLINK_PT_object_components.poll`, which requires `project.configured` (`components_ui.py:1577`). With `configured == False`, `draw` still reaches `_draw_atlas_controls` (ui.py:2381) → `_atlas_labels(project)` returns `{"AUTO": "Main", ...}` unconditionally (ui.py:2956) even though `project.atlases` is empty, so the panel prints "Atlas: Main (default)" (ui.py:3057), a Lightmap Scale button, and `_draw_runtime_controls` prints "Reflections: Scene Environment" (ui.py:3208). Meanwhile Scene Properties says "This scene is not set up for Blendlink yet." (ui.py:1005).

**Why:** On a fresh file the two Properties tabs contradict each other: Object Properties offers to move a mesh into an atlas called "Main" and assign it a lightmap budget, while Scene Properties says nothing is set up and no Main exists. The artist can click Baked, set a Lightmap Scale, and open the atlas menu without ever being told that none of it has anywhere to go — and the Object tab offers no route to Set Up Blendlink Scene. Inside one context the gating is also inconsistent: Semantic Designation shows, Web Behaviors correctly hides.

**Fix:** Keep the identity/inclusion/designation block ungated (name-vocabulary authoring genuinely works offline), but gate the `_draw_atlas_controls` and `_draw_runtime_controls` calls (ui.py:2381-2386 and 2417-2422) on `project is not None and project.configured`. When unconfigured, draw one row in their place: "Set up this scene to author web rendering and atlases" plus the `blendlink.setup_website_export` operator (which already carries its own poll message), or a `blendlink.open_properties_context` button with `target = "SCENE"`.

### INCONSISTENT - Scene Properties calls it "Publishing Mode"; Object Properties calls the same control "Web Presentation"

**Evidence:** `ui.py:1009` `layout.prop(project, "presentation", text="Publishing Mode")` overrides the property's own name, which is `"Web Presentation"` (props.py:947). `ui.py:2865`, drawn in Blendlink Web Object, tells the artist: "The scene's Web Presentation is Realtime. This object choice is retained for Hybrid or Fully Baked presentation." `ui.py:3449` also refers to "the scene-owned Web Presentation above."

**Why:** An artist reading the Object panel is told to go change "Web Presentation", switches to Scene Properties, and finds a control labelled "Publishing Mode" — the term "Web Presentation" appears on no visible label in the add-on. This is the single most consequential scene-level choice (it decides whether the object-level Realtime/Baked buttons do anything at all), so the mis-pointer costs real time.

**Fix:** Pick one name and use it in both places. Simplest: drop the `text=` override at ui.py:1009 so the panel shows the property's registered name, and leave ui.py:2865 as is. If "Publishing Mode" is the preferred term, rename `props.py:947` to `name="Publishing Mode"` and update ui.py:2865 and the `BLENDLINK_PT_bake` docstring at ui.py:3449.

### INCONSISTENT - The Optimization panel uses "GPU Textures" for a compression setting and "GPU textures" for a memory readout

**Evidence:** `ui.py:1790` `layout.prop(project, "texture_optimization")` renders the label "GPU Textures" (props.py:1291) with values "Original"/"KTX2 Auto"; twenty-four lines later, `ui.py:1813-1816` draws `f"GPU textures {_format_bytes(stats.get('gpuTextureBytes'))} | animation …"` in the same panel, where it means decoded residency. The row directly above the control is labelled `text="Geometry"` (ui.py:1777), overriding its registered name "Geometry Compression" (props.py:1282). The matching per-image control in Blendlink Web Material is labelled "Compression: Scene Default / Uncompressed / Compact / High Fidelity" (ui.py:2751-2756).

**Why:** In one short panel "GPU Textures" is a policy and "GPU textures" is a byte count, so an artist reading "GPU textures 42.1 MB" reasonably concludes it is the result of the control above it — it is not; it is residency for the whole build regardless of the setting. The asymmetric "Geometry" / "GPU Textures" pair also breaks the label parallel, and neither matches the "Compression" wording the artist just used per-image in Material Properties.

**Fix:** Label the control "Texture Compression" (rename `props.py:1291` or pass `text="Textures"` to match `text="Geometry"` at ui.py:1777 — pick one convention for both rows), and change the stats line at ui.py:1814 to "Texture memory" or "Decoded texture residency" so the two never collide.


## Viewport overlays and gizmos

### MISLEADING - Labels ignore the depth decision that governs their own markers, so text floats with no marker behind walls

**Evidence:** overlay.py:147-148 — `gpu.state.depth_test_set("NONE" if xray else "LESS_EQUAL")` in `_draw_view`, versus `_draw_pixel` (overlay.py:180-212), a POST_PIXEL handler that draws every label unconditionally with no depth consideration.

**Why:** `overlay_xray` defaults to False, so by default a hotspot, socket, audio anchor or interaction marker behind geometry has its wireframe correctly hidden — but its text still reads over the wall. The artist sees a name hovering in mid-air with nothing attached to it and cannot tell which side of the geometry the anchor is on. The X-Ray preference silently applies to half the overlay.

**Fix:** Make the marker always visible so the label is never orphaned: in `_draw_view`, when `xray` is False, draw each shape twice — once with `depth_test_set("LESS_EQUAL")` at full colour, then once with `depth_test_set("NONE")` at `(*item.color[:3], item.color[3] * 0.25)`. That is the standard occluded-ghost treatment and costs one extra pass over batches that already exist.

### MISLEADING - A schema bug in our own component definitions is reported to the artist as a scene warning

**Evidence:** consequence_gizmos.py:261-265 — `issues.append(GizmoIssue(f"{definition['label']} declares unsupported viewport guide kind {gizmo.get('kind')!r}.", ...))`, which validation.py:620-627 turns into `vocab.LintIssue(severity="WARNING", message=f"Viewport Guide: {issue.message}", ...)` and lands in Web Checks.

**Why:** The artist gets a warning row reading "Viewport Guide: Open Link on Click declares unsupported viewport guide kind 'cone'." — words about our schema table, in Python repr quotes, describing a condition they did not cause and cannot fix. Every unactionable row in a checks list dilutes the ones that matter.

**Fix:** Route definition-level errors away from the artist: `print(f"blendlink addon: component {component_type!r} declares unsupported gizmo kind {kind!r}")` and add an assertion to tests/component_schema_check.py so it fails in CI instead. Keep `GizmoIssue` for conditions the artist authored (missing distances, zero influence).

### ROUGH - Label placement collides with Blender's own Text Info overlay in the top-left corner

**Evidence:** overlay.py:343 — `text_x, text_y = 16.0, region.height - 28.0`; and in the exact branch, overlay.py:335-336 — `text_x = max(12.0, state["frame"][0] + 10.0)`, `text_y = min(region.height - 22.0, state["frame"][3] - 20.0)`.

**Why:** Blender's Text Info overlay draws the view name ("User Perspective") and the collection | active-object line in exactly that corner, starting a few pixels below the region top. At `region.height - 22` and `region.height - 28` the Blendlink label and its second message line land on top of Blender's two lines. The result is two sets of text overprinting each other — neither readable — and it happens by default whenever the camera frame extends past the top of the region (i.e. any time the artist zooms into the frame).

**Fix:** Anchor the composition text to the bottom-left inside the camera frame instead: `text_y = max(12.0, state["frame"][1] + 34.0)`, with the message line 17 px below it. If the top-left is preferred, offset by Blender's info block — roughly `region.height - (3 * 20.0 * ui_scale)` — and only when `context.space_data.overlay.show_text` is False can the smaller offset be used.

### ROUGH - Composition guides build fresh GPU batches on every redraw, against the module's own stated rule

**Evidence:** overlay.py:306-321 — `_draw_screen_rect` calls `batch = batch_for_shader(shader, "TRIS", {"pos": _rect_triangles(rect)})` and `batch = batch_for_shader(shader, "LINES", {"pos": _rect_lines(rect)})` on every invocation. `_draw_composition_guides` (overlay.py:328-333) calls it up to six times per frame: four crop bars, the frame, and the safe rect. The module docstring at overlay.py:6-7 promises "Unit-primitive batches are built once and re-drawn per object through gpu.matrix — never rebuilt or rediscovered per frame."

**Why:** While the artist orbits, scrubs or drags anything in camera view, six GPU vertex buffers are allocated and thrown away per viewport per frame — several hundred per second with two viewports open. It is the one place in this file that does exactly what the design notes forbid, and the cost lands on the interaction the guides exist to support.

**Fix:** Add two cached batches in `_ensure_batches()`: a unit quad `TRIS` batch over `(0,0)-(1,1)` and a unit rect `LINES` batch over the same corners. In `_draw_screen_rect`, wrap the draw in `gpu.matrix.push_pop()` with `gpu.matrix.translate((left, bottom, 0))` and `gpu.matrix.scale((right-left, top-bottom, 1))`, then draw the cached batch — identical to how the 3D shapes are already handled.

### ROUGH - Label stacking only separates anchors within 12 px; anything further apart overlaps

**Evidence:** overlay.py:205-207 — `bucket = (round(screen.x / 12.0), round(screen.y / 12.0))`, `row = label_rows.get(bucket, 0)`, then `blf.position(font_id, screen.x + 8.0, screen.y + 4.0 + row * 15.0, 0.0)`. The bucket is keyed on the unshifted anchor position, and the comment at overlay.py:202-204 only claims to handle "different consequences on the same selected object".

**Why:** Two hotspot empties 20 px apart on screen fall into different buckets, so both draw at row 0 — and since a label is 100-300 px wide but the bucket is 12 px, the two strings overprint and neither is readable. This is the common case (a row of sockets on a prop, several anchors along a wall), not an edge case; only exactly co-located anchors get the stacking treatment.

**Fix:** Replace the bucket dictionary with a placed-rectangle list. For each label compute `width, height = blf.dimensions(font_id, item.label)`, then walk down in 15 px steps from `screen.y + 4.0` until the candidate rect `(screen.x + 8, y, width, height)` intersects nothing already placed, append it, and draw. Bounded by the label cap from the previous finding, this stays cheap.

### ROUGH - Label text inherits the wireframe's transparency and ignores the theme, so some labels are barely readable

**Evidence:** overlay.py:211 — `blf.color(font_id, *item.color)` passes the marker's four-component colour, alpha included. consequence_gizmos.py:54 — `_AUDIO_FAR = (0.15, 0.55, 1.0, 0.55)` is the colour carrying the combined audio-range label (consequence_gizmos.py:291-301 puts the combined text on the outer sphere). Also `_SHADOW = (1.0, 0.67, 0.16, 0.72)` at overlay/gizmo line 58. No `blf.enable(font_id, blf.SHADOW)` anywhere, and the socket axis colours (overlay.py:88-92) are hard-coded rather than read from `context.preferences.themes[0].user_interface.axis_x/y/z`.

**Why:** Alpha that exists so overlapping wireframes read through each other is the wrong alpha for text. The audio-range label draws at 55 % opacity in saturated blue; over a light-theme viewport background or a bright render it is close to illegible, and the shadow-reach label at 72 % is not much better. Without a text shadow, no label survives being drawn over a busy or light-coloured surface.

**Fix:** Draw text opaque and shadowed: `blf.color(font_id, *item.color[:3], 1.0)`; before the loop `blf.enable(font_id, blf.SHADOW)` and `blf.shadow(font_id, 3, 0.0, 0.0, 0.0, 0.9)` with `blf.shadow_offset(font_id, 1, -1)`, and `blf.disable(font_id, blf.SHADOW)` after (font id 0 is Blender's shared font — leaving it enabled affects other drawers). Source the socket axis colours from the theme's `axis_x/axis_y/axis_z` at batch-build time.

### ROUGH - Interaction markers are a fixed 8 cm in world space and encode selection in a size nobody can see

**Evidence:** consequence_gizmos.py:217 — `scale = 0.24 if selected else 0.16`, fed to `_cross_matrix` (consequence_gizmos.py:116-118), whose unit cross spans ±0.5 — so the marker is 0.12 m or 0.08 m half-extent regardless of view distance. By contrast the shadow-off marker uses the default `_cross_matrix(obj)` at scale 1.0 (consequence_gizmos.py:417), a 0.5 m half-extent.

**Why:** In an architectural or product-hall scene the interaction marker is sub-pixel at working zoom, so "every enabled interaction target gets one small viewport marker" silently fails to deliver anything visible; inside a small prop the same marker is comically large. And because selection is signalled by a 1.5x size difference, that cue disappears entirely at any distance where the marker is already small. The two marker families also disagree by 3x on what "small marker" means.

**Fix:** Draw interaction markers at a constant screen size. Either compute a per-item scale in `_draw_view` from the view (`(rv3d.view_matrix @ world_position).z` for perspective, `rv3d.view_distance` for ortho) so the cross is ~14 px regardless of distance, or move the marker into the POST_PIXEL pass as a fixed-pixel glyph next to the label. Keep the selection emphasis in colour (already distinct via `_INTERACTION_SELECTED`) and add a ring rather than relying on scale.

### INCONSISTENT - The picking-priority sentence states half the rule the design notes require

**Evidence:** consequence_gizmos.py:211 — `f"{' + '.join(entry['labels'])} | Pick priority: nearest visible hit"`. The other half exists only in the docstring at consequence_gizmos.py:174-176: "The website resolves pointer priority from the nearest visible rendered hit, then prefers a registered descendant over its interactive ancestor." `grep` finds no artist-visible surface anywhere in the addon that states the descendant rule. addon-design-notes.md:75-77 specifies the marker label must state "the nearest visible rendered hit wins (with an interactive descendant preferred over its ancestor)".

**Why:** The nesting case is precisely the one an artist cannot reason about on their own: a clickable button parented inside a clickable panel. "Nearest visible hit" does not tell them which one fires, so the marker answers the easy question and stays silent on the hard one — and the answer exists, documented, three lines above in a comment.

**Fix:** On the selected marker, use the full rule: `"Pick: nearest visible surface; a clickable child wins over its clickable parent"`. Keep the short form on unselected markers so the unbounded-label problem is not made worse.

### INCONSISTENT - One overlay has three names across three surfaces

**Evidence:** props.py:1364 — the toggle is `name="Web Guides"`. validation.py:623 — its checks rows are prefixed `f"Viewport Guide: {issue.message}"`. prefs.py:23-24 — the preference is `name="Overlay X-Ray"`, `description="Draw vocabulary overlays through geometry instead of depth-tested"`. overlay.py:2 calls them "Viewport guides".

**Why:** An artist who sees a warning row starting "Viewport Guide:" has no way to connect it to the checkbox labelled "Web Guides" or the preference labelled "Overlay X-Ray" — three names for one feature across three panels, and none of them are the same word.

**Fix:** Settle on "Web Guides" (the artist-facing toggle) and use it everywhere: change the validation prefix to `f"Web Guides: {issue.message}"` and the preference to `name="Show Web Guides Through Geometry"`. "Responsive Frame Guides" can stay distinct — it names a genuinely different sub-feature.


## Web Checks and the diagnostics presentation

### ROUGH - The remedy ladder routes to the wrong owner, or to nowhere

**Evidence:** ui.py:3678-3687 — four fallbacks only: linked-object text, "Fix duplicate numbering …", `"Select the affected object and review its Blendlink Web Object settings."`, `"Correct the named scene setting, then refresh Web Checks."`

**Why:** A blocked Web Light sends the artist to Blendlink Web Object, but the control that fixes it ("Website Area Light") lives in Light Data Properties (ui.py:431-488). A duplicate atlas name gets "Correct the named scene setting" with no button, even though `blendlink.open_properties_context` with `target="SCENE"` is used elsewhere in the same file. `LOD chain "Tree" has gaps: [0, 2]` gets that same sentence although it is not a scene setting at all — a dead end.

**Fix:** Add optional `remedy: str` and `route: tuple[str, dict] | None` to `vocab.LintIssue`, populated by each producer (web-light issues → Light Data; atlas/state/frame issues → `blendlink.open_properties_context` target SCENE). Draw the route as a button in the detail box; fall back to the current text only when a producer supplies none.

### ROUGH - Deprecated-property warnings have a one-click fix that Web Checks never offers

**Evidence:** validation.py:760-780 emits `'"Crate" uses deprecated bare mass; rename it to blendlink_mass before 1.0'`; `BLENDLINK_OT_migrate_legacy_property` (ops.py:2214-2266) does exactly that rename, and is surfaced only inside `_draw_prop` (ui.py:2932-2936).

**Why:** The check tells the artist to hand-rename a custom property while a working Migrate button exists on another panel. This is an issue the artist cannot act on from the surface that raised it.

**Fix:** Carry the bare property name on the issue and draw a Migrate action on the row (mirroring the `fixable_numbered` treatment at ui.py:3649-3654), passing `object_name` and `property_name` to `blendlink.migrate_legacy_property`.

### ROUGH - The greyed Fix button never explains itself

**Evidence:** ui.py:3650-3652 `fix.enabled = candidate is not None and getattr(candidate, "is_editable", True)`; `BLENDLINK_OT_fix_numbered` (ops.py:2181-2211) declares no `poll()` at all.

**Why:** On a linked/library object the Fix icon is dead with no reason attached. The explanation ("Make the linked object local, or rename it in its source .blend") exists only in the detail box, and only for whichever single issue is currently selected. The design notes make poll()+poll_message_set() the rule precisely so disabled buttons explain themselves.

**Fix:** Move the test into `BLENDLINK_OT_fix_numbered.poll()` keyed off the operator's `object_name`, with `cls.poll_message_set("This object is linked from another .blend; make it local or rename it there")`, and delete the `fix.enabled` assignment.

### ROUGH - Check rows truncate away the consequence at ordinary N-panel width

**Evidence:** ui.py:3643 `row.label(text=_shorten(subject + issue.message, context, reserve=8), icon=icon)`; `_responsive_wrap_width` (ui.py:44-48) returns `int((width-32)/7.2)` capped at 84, so a ~250px logical sidebar yields ~30 characters, minus `reserve=8` leaves ~22.

**Why:** A row reads `Crate-colonly.001: "Cr…` — severity icon plus a truncated object name, no consequence at all. The standard asks for terse rows carrying severity, subject and consequence; there is no short form to fall back on because `LintIssue` only has a full-sentence `message`. `reserve=8` is also too small when both the select and fix buttons are drawn.

**Fix:** Add a `summary: str` (≤40 chars, e.g. "Duplicate numbering hides the tag") to `LintIssue`, authored at each producer alongside the long `message`. Draw subject and summary as separate elements in the UIList row and reserve 16 when two icon buttons are present.

### ROUGH - draw() cost scales with scene size in both diagnostics panels

**Evidence:** ui.py:3633-3636 sorts the entire issue list on every redraw; ui.py:3706-3719 builds `route_counts` over every fidelity item and then sorts all of them. `_fidelity_for` returns a `Preserve` item for every plain mesh (validation.py:237-240), so `fidelity` has at least one entry per mesh object.

**Why:** A 10,000-mesh scene sorts 10,000 FidelityItems and walks them to build a count dict on every single sidebar redraw once Geometry Conversion is opened — and Blender redraws the region on mouse move. The design notes require a redraw to be cheap and deterministic regardless of scene size.

**Fix:** Compute `ordered_issues`, `severity_counts`, `ordered_fidelity` and `route_counts` once inside `validation.recompute()` and store them on `ScanResult`; have both panels read the precomputed lists.

### ROUGH - The integrity box has exact evidence, discards it, and points at a log that cannot contain it

**Evidence:** `syncstatus.integrity_failures()` returns per-asset strings built at syncstatus.py:749-794 (e.g. `"atlas 'Main' is missing"`, `"… bytes changed (expected …)"`); ui.py:817-828 uses it only as a truthiness test and offers `blendlink.open_sync_log`. Those strings are computed in Blender and are never written to `sync-log.txt` (syncrun.py writes only subprocess output).

**Why:** The artist is told "one or more website files are missing or no longer match" and sent to a build log that will not mention any of them. The add-on already knows exactly which files and why.

**Fix:** List the first 4-5 failure strings in the box with a "+N more", and drop the Open Build Log button from this box (or keep it as a secondary action). Separately, sanitize the strings for artists: replace the trailing `"; resync"` with "Publish Website again", and stop surfacing the manifest key name in `"cannot resolve without sourceBlend"` (syncstatus.py:826).

### ROUGH - The workspace headline can tell the artist to open Blender's system console

**Evidence:** syncrun.py:90-94 and previewrun.py:184-188 both set `_state["label"] = "… output needs attention — see console/log"`; ui.py:630-641 uses `syncrun.progress()` / `previewrun.progress()`'s label directly as `headline`, and ui.py:692/700/711 as the progress-bar text.

**Why:** The single most prominent line of the publishing workspace becomes a developer instruction. On Windows the system console is hidden until the artist finds Window ▸ Toggle System Console — a dead end, and it contradicts the design note that implementation details never belong in the primary surface's visible label.

**Fix:** Keep the full diagnostic in the tail and the log file, but set a short artist label from `_remember_diagnostic` — e.g. "Website task hit a problem" / "Preview hit a problem" — and rely on the existing Open Log buttons for detail.

### ROUGH - The failure box prints the raw last process line, including internal protocol diagnostics

**Evidence:** ui.py:751-755 `last_message = previewrun.last_message() if preview_failed else syncrun.last_message()` then `_draw_wrapped(failure, last_message)`. `last_message()` is documented as "Last non-protocol process line" (previewrun.py:145-147), but `_remember_diagnostic` (previewrun.py:184-198) pushes strings like `blendlink preview: malformed progress protocol (ValueError: …); raw line: ##blendlink {…}` into the same deque, and previewrun.py:460-464 does so on any malformed line.

**Why:** The artist reads raw npm output, a stack-trace fragment, or a JSON protocol line prefixed with a Python module name, with no framing to say what it is.

**Fix:** Label the block ("Last output from the build tool") and have `last_message()` skip entries written by `_remember_diagnostic` — tag them (e.g. a parallel `internal` deque) so only genuine CLI output reaches the panel.

### ROUGH - Geometry Conversion detail has no remedy section, unlike its sibling surfaces

**Evidence:** ui.py:3737-3744 draws only `detail.source` and `detail.detail`. The bake panel next door splits the same kind of prose into labelled Consequence / How to fix sections via `_message_sections` (ui.py:3493-3505), and the Web Light panel has a "Recommended next step" box (ui.py:585-593).

**Why:** A Block detail such as the KHR_animation_pointer text buries its remedy in the middle of a paragraph, while two neighbouring diagnostics surfaces present remedies as a distinct, labelled step. The artist has to re-read to find the action.

**Fix:** Run `detail.detail` through `_message_sections` with a route-specific fallback remedy ("Choose an explicit route in Blendlink Web Object, or simplify the source"), draw "Consequence" / "How to fix" headings as the bake panel does, and keep a Select action in the detail box.

### INCONSISTENT - "Vocabulary looks good" understates a check set that is mostly not vocabulary

**Evidence:** ui.py:3627 `header.label(text="Vocabulary looks good", icon="CHECKMARK")` on the panel titled "Web Checks" (ui.py:3613). The same list carries component, atlas, lighting-state, responsive-frame, camera, persistent-identity, web-light and geometry-route checks (validation.py:607-787). `BLENDLINK_OT_refresh_checks` repeats it: `"""Re-run the vocabulary checks now"""` (ops.py:4283), which is the tooltip on the refresh button in this very header.

**Why:** An artist who has just fixed a lighting-state problem sees "Vocabulary looks good" and cannot tell whether the thing they fixed was actually re-checked. The refresh button's tooltip tells them it only re-runs vocabulary checks, which is false.

**Fix:** Header: "No problems found". Operator docstring: "Re-run Web Checks now". Keep `bl_label = "Refresh Web Checks"` consistent with the panel name.

### INCONSISTENT - "Website Component" is a fourth name for Effects & Behaviors

**Evidence:** validation.py:611-614 `message=(f"Website Component {issue.component_label}: {issue.message}")`, versus the panel labels "Website Effects & Behaviors" (components_ui.py:1513), "Web Behaviors" (components_ui.py:1569) and "Effects & Behaviors" (components_ui.py:1627) — the three names the design notes settle on.

**Why:** The check names a thing the artist cannot find in any panel title, so the row does not tell them where to go.

**Fix:** Use the owning surface's term: "Website Effect" for `target_kind == "SCENE"`, "Web Behavior" for `OBJECT`. If one term is preferred, use the N-panel's "Effects & Behaviors".

### INCONSISTENT - Geometry Conversion leads with the least important route and can hide blocking ones

**Evidence:** ui.py:3709 `summary = " | ".join(f"{route} {count}" for route, count in sorted(route_counts.items()))`; ui.py:3719-3720 `ordered = sorted(items, key=lambda item: (item.route == "Preserve", item.object_name))` then `visible = ordered[:8]`.

**Why:** The summary reads "Bake 3 | Block 2 | Preserve 120 | Runtime 4" — alphabetical, so Block is never first. Worse, the row ordering only demotes Preserve: a Block on "Zebra" sorts behind non-blocking Bake and Runtime rows on "Apple"…"Iris", so with the 8-row cap the blocking route can vanish from the list while harmless ones fill it.

**Fix:** Rank routes explicitly — Block, Runtime, Cache, Bake, Realize, Preserve — and use that rank in both the summary string and as the primary sort key (with `item.blocking` ahead of it), before falling back to `object_name`.


## draw-time cost and the event/handler machinery

### ROUGH - The status refresh stats every published file every second, forever

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/handlers.py:343 `changed = syncstatus.refresh() or changed` in the 1-second `_tick`. C:/…/syncstatus.py:1090-1098 runs unconditionally whenever a manifest is loaded: `_verify_declared_assets(manifest, …)`, `_verify_external_dependencies(…)`, `_collect_derived_assets(manifest)`. Per declared asset, syncstatus.py:764 `candidates = [Path(check["path"])] if Path(check["path"]).is_file() else []`, syncstatus.py:776 `_cached_hash(candidate, …)` whose first line is syncstatus.py:623 `stat = path.stat()`, and syncstatus.py:790-792 `resolved.stat().st_size` twice more.

**Why:** A build with a couple of hundred published textures issues roughly a thousand filesystem stats per second for as long as Blender is open, whether or not any Blendlink panel is visible. On a network share, a OneDrive/Dropbox-synced project folder, or a spinning disk each stat costs milliseconds, so the tick can exceed its own interval and stall the main thread — the artist feels periodic viewport hitches with no visible cause. The hashes themselves are already stat-cached; only the stat storm is unbudgeted.

**Fix:** Skip asset re-verification when nothing could have changed: keep the last `(manifest_mtime, asset_signature)` and only re-run `_verify_declared_assets` / `_verify_external_dependencies` / `_collect_derived_assets` when `force`, `rehash_assets`, the manifest mtime moved, or the blend was just saved. Leave a full re-verify on the explicit **Refresh** button (`blendlink.refresh_sync`) so a restored file still heals the UI.

### ROUGH - Disabled Remove buttons suppress the poll messages the operators already wrote

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:1973-1975 `remove = row.row(align=True)` / `remove.enabled = len(project.atlases) > 1 and project.atlas_index > 0` / `remove.operator("blendlink.remove_atlas", text="", icon="REMOVE")`, and ui.py:2108-2110 the same shape with `remove.enabled = len(project.states) > 1`. Meanwhile ops.py:625-627 already does `cls.poll_message_set("Main is undeletable; select an additional atlas")` and ops.py:960-962 `cls.poll_message_set("Every published scene needs at least one lighting state")`.

**Why:** A layout element with `enabled = False` is inert in Blender: the operator's `poll()` never runs, so the carefully worded reason never reaches the tooltip. The artist sees a greyed X on the permanent Main atlas and on the last lighting state with no explanation at all — the one case the design notes call out ("poll() + poll_message_set() so disabled buttons explain themselves"). The UI also duplicates the poll predicate, so the two can drift.

**Fix:** Delete both `remove.enabled = …` lines and draw the operator directly on `row` / `state_buttons`; `poll()` already greys the button *and* supplies the message. Nothing else changes visually.

### ROUGH - Every Ctrl+S SHA-256s the entire .blend on the main thread

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/handlers.py:240-245 `@persistent def _save_post(_filepath): … syncstatus.refresh(force=True)`. C:/…/syncstatus.py:1024-1026 `if rehash_blend or blend_mtime != _state["blend_mtime"]: _state["blend_hash"] = _hash_file(blend_path)`, and syncstatus.py:614-619 `_hash_file` reads the whole file in 1 MB chunks. The mtime always changes on save, so this always fires.

**Why:** Blendlink adds a full read-and-hash of the .blend to the tail of every save. On the large production files this add-on is aimed at, that is a visible extra freeze after Blender's own write, every single time the artist saves — and Live Preview's save-driven loop makes saving the highest-frequency action in the workflow. Nothing in the UI attributes the pause to Blendlink.

**Fix:** Do not hash from `_save_post`. Clear `_state["blend_hash"]` there, let the status read "Checking published match…", and hash on the next `_tick`; better still, hash in the existing `syncrun`/`previewrun` worker-thread pattern (worker computes, `bpy.app.timers` pump publishes) so the main thread never blocks. At minimum, skip the hash above a size threshold and report `NEEDS_SYNC` with "integrity not verified for large files" rather than paying it on every save.

### INCONSISTENT - Website Effects & Behaviors sorts after Texture Atlases in Scene Properties

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/components_ui.py:1515 `bl_order = 20` on `BLENDLINK_PT_scene_components` ("Website Effects & Behaviors", parent `BLENDLINK_PT_project`) collides with C:/…/ui.py:2167 `bl_order = 20` on `BLENDLINK_PT_atlases` ("Texture Atlases", same parent). Ties fall back to registration order, and `__init__.py:19-21` registers `*ui.classes` before `*components_ui.classes`. Neighbours are `BLENDLINK_PT_camera` at ui.py:1169 `bl_order = 10` and `BLENDLINK_PT_bake_quality` at ui.py:2183 `bl_order = 30`.

**Why:** The design notes fix the Scene Properties order as Website Camera & Frames, **Website Effects & Behaviors**, Texture Atlases, Bake Quality, … — "The current native Properties hierarchy is intentional." The shipped order puts Texture Atlases first, so the one Scene panel that edits shared component data sits below the bake plumbing instead of beside the camera. The N-panel already gets this right (`BLENDLINK_PT_components_sidebar` is `bl_order = 15` at components_ui.py:1631), so the two surfaces disagree about the same content.

**Fix:** Set `BLENDLINK_PT_scene_components.bl_order = 15` (components_ui.py:1515). 15 is unused between camera (10) and atlases (20), so the result is deterministic regardless of registration order.

### INCONSISTENT - The published-atlas selection button drops its label at wide widths and keeps it when narrow — the responsive rule inverted

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:3542-3546: `op = row.operator("blendlink.select_atlas_objects", text="Select Last Build" if _is_compact(context, 380) else "", icon="RESTRICT_SELECT_OFF")`. Every other selection action in the same tree keeps its text at width (e.g. ui.py:2018-2021 `text="Select Assigned Meshes"`, ui.py:1691-1694 `text="Select Assigned Meshes"`).

**Why:** The settled rule is the opposite: "At narrow widths, use one-column rows, short action labels, and icon actions with descriptive tooltips. At wider widths, label/control pairs and safe side-by-side actions may expand." As written, an ordinary or wide sidebar shows a bare `RESTRICT_SELECT_OFF` icon — visually identical to the authored-membership **Select Assigned Meshes** action — while the narrow sidebar is the only one that labels it. That directly undercuts "the two selection actions must never be described as interchangeable".

**Fix:** Flip the condition: `text="Select Last Build" if not _is_compact(context, 380) else ""`. Consider `"Select Last-Build Members"` at wide widths to match the operator's own `bl_label` (ops.py:2771) and the wording in the design notes.

### INCONSISTENT - Three different paragraph-wrapping implementations, one of them not responsive at all

**Evidence:** C:/Users/micha/Documents/GitHub/blendlink/packages/blender-addon/ui.py:44-48 `_responsive_wrap_width` — `usable = max(160.0, _logical_region_width(context) - 32.0)` / `return max(22, min(84, int(usable / 7.2)))`. C:/…/components_ui.py:116-134 `_wrap(layout, message, *, icon="NONE", width=52)` — `available = (region_width / ui_scale) - 72.0` / `width = min(width, max(20, int(available / 7.0)))`. C:/…/ownership.py:137 `def wrapped(container, value, width=46):` — a fixed 46 characters that never reads the region at all.

**Why:** BLENDLINK_PT_main and BLENDLINK_PT_components_sidebar sit directly on top of each other in the same N-panel and wrap their prose at visibly different line lengths (up to 84 vs. capped at 52), which reads as a rendering bug. Worse, the Website Ownership panel's eleven explanation blocks are hard-wired to 46 characters: in a narrow Properties editor Blender truncates each line with an ellipsis (labels do not wrap or reflow), so the ownership reasons become unreadable exactly where the design notes require responsive behaviour.

**Fix:** Make `ui._draw_wrapped` / `ui._responsive_wrap_width` the single implementation. Replace `components_ui._wrap` with a thin shim that forwards to it (keeping the optional `width` as an upper bound only), and change `ownership.draw_summary` to take the layout's owning context and call `ui._draw_wrapped(box, decision.reason)` instead of its private `wrapped()`.


## packages/blender-addon/props.py (RNA property definitions, recipe seri

### ROUGH - Every property update re-serializes the entire scene recipe, on every tick of a slider drag

**Evidence:** props.py:43-61 — `_project_changed` is the `update=` for roughly ninety properties, and after two cheap invalidations it calls `write_recipe(context.scene)`. That runs `project_recipe`, which re-walks all atlases, states and probes, runs `serialized_components` (full per-component validation), calls `nla_sequence.collect_project_sequence`, and JSON-dumps the result. With an enabled Website Surface behavior it also iterates `obj.data.polygons` every time — props.py:1646 `if any(polygon.material_index != 0 for polygon in obj.data.polygons)`. `_stable_id` (props.py:1396 `obj["blendlink_id"] = current`) can write an ID-property onto scene objects from inside that callback.

**Why:** Dragging Bloom Intensity or Exposure does a full-project validation pass and a JSON encode per mouse-move sample, so sliders get progressively less responsive as the scene gains behaviors — the exact cost the design notes banned from draw() reappearing on the drag path. It also mutates object data (stamping UUIDs) mid-drag with no undo push.

**Fix:** Follow the pattern the same function already establishes for the bake table: bump a token / set a dirty flag and let the existing 1-second `bpy.app.timers` tick and the `save_pre` handler perform `write_recipe`. `handlers.mark_bake_table_changed()` and `validation.mark_dirty()` in this callback are correct and should stay.

### ROUGH - Clicking a bake-table row in the wrong mode does nothing, and the reason goes to the system console

**Evidence:** props.py:1318-1359 `_select_row_object`, reached from `bake_row_index`'s `update=_row_index_update` (props.py:1356-1359), reports every refusal with `print()`: `print(f"blendlink addon: switch to Object Mode to select bake-table object {obj.name!r}")`, `"... is outside the active view layer"`, `"... is hidden or selection-disabled"`, `"... no longer exists"`.

**Why:** An artist in Edit Mode (or with the object on a hidden collection) clicks a row in the bake table and gets no response at all — no selection, no message, nothing in the Info editor. The design notes require actions to explain themselves via poll_message_set/self.report; a property update callback structurally cannot report.

**Fix:** Make the row click an operator: keep `bake_row_index` as plain storage and add a `'INTERNAL'`, `{'REGISTER'}` operator (sibling to `select_issue`) invoked from the UIList row, which does the same checks and calls `self.report({'INFO'}, ...)` with each refusal reason.

### ROUGH - Bake Quality's whole panel, and about forty other drawn controls, have no description and therefore no tooltip

**Evidence:** Verified drawn with no `description=`: all five Bake Quality controls (props.py:956-969 `final_samples`, `final_supersample`, `final_denoise`, `preview_samples`, `preview_scale`, drawn at ui.py:2084-2088); atlas `name`/`size`/`fit_policy` (props.py:79, 80, 96; ui.py:2001, 2008); lighting-state `name` (props.py:137; ui.py:2116); responsive-frame `name`/`width`/`height` (props.py:210-216; ui.py:1255-1256); probe `name`/`shape` (props.py:374, 385; ui.py:1572); `presentation`, `camera_behavior`, `camera_framing`, `animation_start`, `animation_loop`, `animation_sequence_name`, `animation_sequence_loop`, `tone_mapping`, `background_mode`, `fog_mode`, `shadow_preset`, `shadow_filter`, `shadow_map_size`, `environment_source`, `environment_lighting`, `environment_background`, `environment_lighting_intensity`, `environment_background_intensity`, `environment_background_blur`, `geometry_optimization`, `texture_optimization`; and the behavior fields `enabled`, `intensity`, `radius` ("Scatter"), `softness`, `color`, `minimum_opacity`, `url`, `new_tab`, `hover_scale`, `duration`, `keep_up`, `animation_loop`, `audio_loop`, `volume`, `spatial`, `min_distance`, `max_distance`, `toggle`. Worst three: `enabled` is drawn as a bare checkbox with `text=""` (components_ui.py:862) so it has neither label nor tooltip; `radius` is labelled "Scatter" (props.py:552) with nothing explaining it is bloom spread; `final_supersample` (props.py:959) is Cycles jargon with no explanation of what it multiplies.

**Why:** Blender shows the description as the tooltip body — with none, hovering yields at most the bare property name, so an artist deciding between 16 and 128 samples, or wondering what the unlabelled checkbox at the top of a behavior card does, gets no help without leaving Blender. The file already proves it knows how to do this well (see `target_density`, `margin`, `threshold`).

**Fix:** Add a one-sentence, consequence-first `description=` to each. Priority order: `enabled` ("Turn this behavior off without deleting it; disabled drafts still export nothing"), the five Bake Quality props, `presentation`, `camera_behavior`, the atlas/state/frame `name` and `size` fields, then the component fields.

### ROUGH - Reflection probe names collide into one recipe id where every sibling list refuses duplicates

**Evidence:** props.py:1813 builds each probe with `"id": _slug(probe.name)` and the loop at props.py:1800-1828 never checks uniqueness, while atlases raise `f"Atlas identity {atlas_id!r} is used more than once"` (props.py:1770), lighting states raise at props.py:1792, responsive frames at props.py:1925 and Website Surfaces at props.py:1709. `probe.name` is a free StringProperty (props.py:374). `_slug` (props.py:1381-1383) maps "Studio 1" and "Studio-1" both to `studio-1`, and returns the literal `"atlas"` for a name with no alphanumerics.

**Why:** Rename two probes to anything that slugs the same and the published recipe carries two entries with one id; the runtime keeps one and the other probe silently stops affecting its assigned meshes, with no error in Blender or at build time. A probe named with symbols gets the id "atlas", which is confusing in any downstream log.

**Fix:** Add a `probe_ids` set to the loop at props.py:1800 and raise "Reflection Probe name {name!r} is used more than once" like the atlas loop; give `_slug` a caller-supplied fallback so probes fall back to "reflection-probe", not "atlas".

### ROUGH - The scene-level distance properties have no soft range, so they cannot be dragged to a usable value

**Evidence:** props.py:1159-1166 `fog_near` `min=0.0, max=1000000.0` and `fog_far` `min=0.001, max=1000000.0`; props.py:1200-1203 `shadow_max_distance` `min=0.1, max=100000.0`; props.py:1273-1280 `environment_ground_height` `min=0.01, max=100000.0` and `environment_ground_radius` `min=0.01, max=1000000.0` — none carries `soft_min`/`soft_max`, so Blender maps a million-unit span onto the widget. Every distance in the components block does it correctly: `ao_world_radius` `soft_max=10.0` (props.py:661), `dof_focus_distance` `soft_max=100.0` (props.py:804), `influence` `soft_max=100.0` (props.py:447), `fade_distance` `soft_max=10.0` (props.py:840).

**Why:** Fog Starts At / Fully Fogged At and shadow Reach are values an artist wants to nudge while watching the viewport; with the drag spanning a million units they have to click and type every time, which breaks the tweak loop for exactly the settings that need iteration. It is also internally inconsistent — half the file's distances feel right and half do not.

**Fix:** Add `soft_max` matching the plausible authoring range: 100 for `fog_near`, 500 for `fog_far`, 200 for `shadow_max_distance`, 10 for `environment_ground_height`, 200 for `environment_ground_radius`. Keep the hard `max` where it matches the recipe validator.

### ROUGH - A behavior card's expand/collapse triangle is Scene state, so twirling it marks the .blend modified

**Evidence:** props.py:523 `expanded: bpy.props.BoolProperty(default=False, options={"SKIP_SAVE"})` on `BlendlinkComponentSettings`, which lives in the Scene-owned `project.components` collection (props.py:978). It is drawn as the card disclosure at components_ui.py:855-861 `header.prop(component, "expanded", text="", emboss=False, icon="TRIA_DOWN" if component.expanded else "TRIA_RIGHT")`. The design notes: "session settings live on WindowManager so they never dirty the file", and the file gets it right elsewhere — `BlendlinkSessionSettings` is registered on `bpy.types.WindowManager` (props.py:3047).

**Why:** Opening a behavior card to read it pushes an undo step and puts the unsaved-changes asterisk on a file the artist did not change, and — because `SKIP_SAVE` does not exclude a registered PropertyGroup member from .blend serialization — the twirl state ships inside the file.

**Fix:** Move expansion to the session group: a `StringProperty` of expanded `component_id`s (or a small CollectionProperty) on `WindowManager.blendlink`, read by `_draw_component_card`, with an `'INTERNAL'` toggle operator behind the triangle.

## Deliberate (do not change)
- props.py:1726-1751 `_BAKE_OUTPUT_RECIPE_VALUES` is deliberately an exhaustive dict plus a loud `_recipe_bake_output` refusal, not a ternary, and the comment records the measured reason (the old two-way ternary rewrote unknown Bake Outputs as Appearance). The mirror table at props.py:2822-2827 is the same pattern. Do not 'simplify' either back into a conditional expression.
- props.py:56-61 — `_project_changed` swallowing `ValueError` from `write_recipe` looks like a hidden failure but is correct and commented: live editing passes through temporarily invalid states, the last valid embedded settings survive, and `recipe_error` plus publish preflight keep the problem visible and blocking.
- props.py:321-332 `_reflection_probe_index_changed` deliberately does NOT write the recipe — the active index is editor state, not publish intent — while still invalidating the shared validation/overlay cache so the consequence gizmo follows the selection. This is the model the other `update=` callbacks should follow.
- props.py:145-171 `hidden_collection_names` reads both the new JSON list and the legacy comma-separated string. Not redundant: the JSON form exists specifically so collection names containing commas survive, as the design notes require, and the comma path keeps existing .blend files loading.
- props.py:128-131 — `bake_output` defaulting to APPEARANCE reads like the wrong default, but it is the migration default for pre-lightmap .blend files whose Combined bake really was an appearance bake; every creation path sets LIGHTING explicitly (props.py:1985, ops.py:599).
- vocab.py:18-24 — SOCKET_/HOTSPOT_/AUDIO_ prefixes are exact-case while suffixes stay case-insensitive, and the comments record the measured failures (`Socket_2way` fixtures, `WallSocket`/`EyeSocket`). Do not 'fix' these into case-insensitive matches.
- ui.py:1422 already guards the fog inversion the recipe validator does not cross-check (`Fully Fogged At must be farther than Starts At`), so `fog_near`/`fog_far` needs a soft range but not a new correctness check.

## Notes
- `duration` (props.py:874-877) uses `subtype="TIME"`, which in RNA carries PROP_UNIT_TIME. I could not confirm from source alone whether Blender 4.2/5.2 renders 0.12 as "0.12 s" or converts it through the scene FPS into frames. If it shows frames, the Hover and See-Through "Transition" field is lying about a value the runtime reads as seconds. Needs a running Blender to decide.
- Whether `options={'SKIP_SAVE'}` keeps `expanded` (props.py:523) out of the written .blend needs a save/reload test; my reading is that it does not for a registered PropertyGroup member on Scene, but the finding stands on the undo/dirty-flag consequence either way.
- The soft-range finding assumes Blender's number-button drag maps the soft range across the widget. The internal inconsistency (component distances soft-ranged, scene distances not) is certain from the source; the exact drag feel is worth measuring on 4.2 and 5.2.
- props.py:138-142 `hide_collections` still describes the abandoned convention — "Comma-separated collection names hidden while this state bakes" — although `set_hidden_collection_names` (props.py:206) writes JSON and the design notes say membership is collection-authored. It is not drawn in any panel today, so no artist sees that tooltip; fix the string before it is ever exposed.
- `BlendlinkStateSettings.name` defaults to "state" (props.py:137) and `setup_project` names the first state "default" (props.py:1989); both are lowercase developer-looking strings shown in the Lighting States list (ui.py:2116). "default" is also the portable contract value written into the recipe (props.py:1854), so changing the display needs a contract decision rather than a rename.
- `atlas_id` (props.py:78) is a registered StringProperty with `name="ID"` and no HIDDEN option, but ui.py only ever reads it and never draws it, so the "internal atlas IDs stay out of labels" rule is not violated today. Adding `options={"HIDDEN"}` would make that guarantee structural.
- `_camera_poll` (props.py:265-271) silently omits linked cameras with no persistent web identity from the Website Camera picker. The explanation exists (`_require_scene_object`, props.py:258-262) but only fires on assignment, so at pick time the camera is simply absent with no reason given. I could not tell whether this is deliberate scope-limiting or an oversight.
- `environment_image` (props.py:1230-1233) has no `poll`, so a Render Result or Viewer Node is selectable — but ui.py:1479-1484 warns clearly when the format is not HDR/EXR, so this is covered and I did not raise it.
- props.py contains no layout code, so the narrow-N-panel and multi-object-truthfulness parts of the brief were out of scope for this surface; they belong with the ui.py audit.

### INCONSISTENT - The default "https://" passes props.py's completeness check while Web Checks calls the same value invalid

**Evidence:** props.py:847-849 — `url: bpy.props.StringProperty(name="Web Address", default="https://", ...)`, and component_schema.py:464 seeds a new behavior with `{"label": "Open link", "url": "https://", "newTab": True}`. props.py:1548-1552 only rejects an empty address: `if address.lower().startswith(("javascript:", "data:")) or (require_complete and not address)`. component_validation.py:176-179 disagrees: `if not address or address.lower() in {"http://", "https://"}: return False`, raising a blocking `invalid_url` issue.

**Why:** `write_recipe` embeds `url: "https://"` in the portable `blendlink_recipe` JSON. The .blend that is supposed to be fully meaningful without the addon therefore carries a dead link that only the addon's UI knows is dead, and the two surfaces state contradictory rules about the same field.

**Fix:** Reuse the bare-scheme rejection inside `component_values` (or import `component_validation._safe_address`) so the recipe writer refuses the placeholder for the same reason Web Checks does. Alternatively default `url` to `""` and let the existing required-field error fire.

### INCONSISTENT - The scene's route is called "Publishing Mode" on its control and "Web Presentation" everywhere it is explained

**Evidence:** props.py:946-947 `presentation: bpy.props.EnumProperty(name="Web Presentation", ...)` with no `description=`; ui.py:1009 draws it as `layout.prop(project, "presentation", text="Publishing Mode")`; ui.py:2865 explains an object with "The scene's Web Presentation is Realtime. This object choice is retained ..." and ui.py:3449 refers to "scene-owned Web Presentation above".

**Why:** The object panel tells the artist to go change "Web Presentation" and no control anywhere carries that name — they hunt for it and find "Publishing Mode". The single most consequential scene decision (which route every mesh takes) also has no tooltip at all.

**Fix:** Pick one term — the design notes' vocabulary favours "Web Presentation" — set it as the RNA `name`, drop the `text=` override at ui.py:1009, and add a description naming the consequence of each of the three routes.

### INCONSISTENT - "Website Camera" and "Web Camera" are two different controls two rows apart

**Evidence:** props.py:981 `main_camera: bpy.props.PointerProperty(name="Website Camera", ...)` and props.py:988 `camera_behavior: bpy.props.EnumProperty(name="Web Camera", ...)`, drawn consecutively in the same column at ui.py:1182 `controls.prop(project, "main_camera")` and ui.py:1202 `controls.prop(project, "camera_behavior")`.

**Why:** Two adjacent labels differing by one word name completely different things — which camera object is published, versus whether visitors can orbit it. An artist scanning the panel reads them as a pair or as a duplicate. `camera_behavior` also has no description, so the tooltip cannot disambiguate.

**Fix:** Rename `camera_behavior` to "Visitor Control" (or "Camera Motion") and give it a description such as "Whether the page keeps the authored view, orbits a target, or lets the visitor move the camera".


## packaging, registration and preferences

### ROUGH - Every build and preview assumes npx is on PATH; there is no preflight, no preference, and the failure is a raw shell message

**Evidence:** syncrun.py:118-133 and previewrun.py:210-225 both `subprocess.Popen(command, shell=True, ...)` with commands hardcoded to `npx`/`node` (ops.py:27-28, 121-123, 3842-3846, 3998-3999). No `shutil.which` check exists anywhere in the addon (verified by grep). `BLENDLINK_OT_browser_preview.poll` (ops.py:3947-3969) and `BLENDLINK_OT_sync_now.poll` (ops.py:3871-3891) check scene setup, save state and project root but never the toolchain. On failure ui.py:751-755 renders the last process line verbatim: `_draw_wrapped(failure, last_message)`. prefs.py has only `category` and `overlay_xray`.

**Why:** macOS Blender launched from the Dock inherits a minimal PATH, and `shell=True` uses `/bin/sh -c`, which does not read the artist's shell profile — so an nvm- or Homebrew-installed Node is invisible. The artist clicks an enabled Preview Website button and gets `/bin/sh: npx: command not found` (or `'npx' is not recognized as an internal or external command` on Windows) rendered in the panel as if it were a Blendlink diagnosis. There is nothing in preferences they can set to fix it, and nothing in either README that mentions Node.js as a prerequisite.

**Fix:** Add a `node_command: StringProperty(name="Node.js Location", subtype="FILE_PATH", description="Path to node or npx if Blendlink cannot find it on this machine — leave empty to use the system PATH")` to `BlendlinkPreferences` and prepend its directory to the child process PATH in `syncrun.start`/`previewrun.start`. Add a `shutil.which("npx")` check to both operators' `poll()` with `cls.poll_message_set("Node.js was not found. Install Node.js, or set its location in Blendlink preferences")`. Translate exit code 127 / `not recognized` in `_finish` into that same artist-facing sentence instead of echoing the shell. Add a "Requirements" line to packages/blender-addon/README.md naming the minimum Node version.

### INCONSISTENT - The preferences call the viewport overlay "Overlay X-Ray" over "vocabulary overlays"; the panel calls the same thing "Web Guides"

**Evidence:** prefs.py:22-26 — `overlay_xray: BoolProperty(name="Overlay X-Ray", description="Draw vocabulary overlays through geometry instead of depth-tested")`. props.py:1363-1368 — the toggle the artist actually uses is `show_overlay: BoolProperty(name="Web Guides", description="Draw web roles, composition guides, selected component ranges, reflection influence, and realtime shadow reach in the viewport")`, drawn at ui.py:875.

**Why:** An artist who wants their Web Guides to draw through geometry opens preferences and finds no setting with that name. "Vocabulary overlays" is an internal term that appears nowhere in the UI, and "depth-tested" is renderer jargon. The preference also never says it does nothing unless Web Guides are enabled.

**Fix:** Rename to `name="Web Guides X-Ray"` with `description="Draw Web Guides through solid objects instead of hiding them behind geometry. Only applies while Web Guides are on in the sidebar"`. Update `prefs.py:2`'s module docstring ("sidebar category and overlay behavior") to match.

### INCONSISTENT - The tagline positions the extension as a bridge to external tooling, the exact framing the design notes say gets rejected

**Evidence:** blender_manifest.toml:6 — `tagline = "Publish artist-authored Blender scenes to Three.js"` (50 chars, no trailing punctuation, so it clears the mechanical limits). docs/addon-design-notes.md:9-15 records the settled reason for the addon's shape: "the extensions platform's 'self-contained' rule (an addon whose only function is bridging to external tooling gets rejected — see Needle Engine, unapproved after 2 years)." The extension itself cannot publish anything — publishing runs through the npm CLI (ops.py:27-28, 3842-3846).

**Why:** The one sentence a reviewer and an artist read describes the add-on as a publisher to an external web framework, contradicting the self-contained positioning the whole architecture was built to defend, and promising a capability the zip does not contain. It also spends words on "Blender", which the platform's naming guidance treats as redundant.

**Fix:** Describe what the extension does inside Blender: `tagline = "Author web-ready scene data, atlases, and publish checks"` (56) or `"Prepare scenes for the web: atlases, states, and checks"` (54). Leave the Three.js relationship to the listing description and the website field.

## Deliberate (do not change)
- No eager `bpy.data` access at register time, and the reason is written down where it will survive: handlers.py:369-372 — "No eager syncstatus.refresh here: register() may run in Blender's restricted context (enable-at-install) where bpy.data is off-limits. The first timer tick performs the initial scan and refresh." This looks like a missing initialization and is not one.
- `overlay.register()`/`unregister()` (overlay.py:355-400) stash the draw handles in `bpy.app.driver_namespace` as well as a module global, with the comment "The driver namespace survives module reload. A newly imported module can therefore remove callbacks owned by its predecessor." The double bookkeeping looks redundant but is the only way a reloaded module can reclaim handles the previous instance leaked.
- `syncrun.py:118` and `previewrun.py:211` write `creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0`. `subprocess.CREATE_NO_WINDOW` does not exist on POSIX, so this reads like a portability bug — but Python's conditional expression is lazy and the attribute is only touched on Windows. Do not "fix" it with a getattr.
- `unregister()` in __init__.py:37-47 kills the subprocesses (`previewrun.shutdown()`, `syncrun.shutdown()`) and frees the preview collection before any class is unregistered, and every timer, app-handler entry, msgbus owner and draw handler I could find has a matching removal. This satisfies the design note that "extension updates leak callbacks" otherwise.
- `bakelib_loader._load()` narrows its exception on the module name (`if error.name != packaged_name: raise`, lines 21-22) rather than catching every ModuleNotFoundError. An import error raised from *inside* bakelib.py therefore propagates instead of being silently swallowed into the source-tree fallback.
- scripts/build-release-artifacts.mjs:22-30 refuses to build unless `blender_manifest.toml`'s version equals `package.json`'s and the SPDX license is exactly `GPL-3.0-or-later`. The addon/npm license split the design notes require (GPL for the extension, MIT for npm) is enforced mechanically, not by convention.

## Notes
- POLYLINE shaders at the 4.2 floor are unverified. overlay.py:99-100 calls `gpu.shader.from_builtin("POLYLINE_UNIFORM_COLOR")` and `"POLYLINE_FLAT_COLOR"` with no fallback and no version guard, and `_ensure_batches()` runs from inside a draw handler, so an unsupported name would raise every redraw. The repo's only GPU test (tests/overlay_gpu_check.py) is documented as Blender 5.2+. My recollection is that these builtins landed in 4.2, which would make this fine — but it needs a real 4.2.0 run to confirm, and it is the single riskiest thing at the declared floor.
- ui.py:114-234 (`_draw_export_setup`) and ui.py:260-284 (`_draw_website_handoff`) are unreachable — nothing calls either (verified by grep; only `_draw_handoff_alert` is called, from ui.py:622). They carry the two `text="Copy: npx blendlink connect"` labels (ui.py:149, 276) that would violate the design notes' rule against CLI commands in visible labels, plus the only fixed `box.row(align=True)` action pairs that lack the `_is_compact` column fallback their siblings use. Since no artist can reach them today I did not file them, but they are a live trap for whoever re-wires that code path.
- `known_issues.current()` (known_issues.py:114-121) will call `prime_cache()` — reading and JSON-parsing `blender_known_issues.json` from disk — if the cache is empty, and it is called from `_draw_known_issues` at the top of `BLENDLINK_PT_main.draw` (ui.py:602). `handlers.register()` primes it at line 354, so in a normally installed addon this never fires from draw(). Flagging only because it is a file read one branch away from a draw call, contrary to the draw()-purity rule.
- `bakelib_loader._load()` assigns `sys.modules[packaged_name] = module` (line 34) before `spec.loader.exec_module(module)` (line 35) and does not pop it if exec raises, so a later import would return a half-initialized module instead of re-raising. Not artist-visible in the current single-shot import, so not filed.
- `props.unregister_pointers()` (props.py:3050-3052) uses bare `del bpy.types.Scene.blendlink_project` while its sibling `presentation_ui.unregister_pointers()` (presentation_ui.py:824-830) guards with `hasattr`. If `register()` ever aborts partway (which the bakelib case above can cause), disabling the addon would raise a second exception on top of the first. Stylistic asymmetry rather than a confirmed defect.
- `__init__.py:2-8`'s module docstring still says the addon "shows whether the saved file matches the last `blendlink sync`" — `sync` is no longer a CLI verb (the commands are `compile`, `publish`, `plan`, `preview`, `connect`). Not shown in any UI, so not filed as a finding.
- I could not verify that `website = "https://github.com/michaelrowejones/Blendlink"` resolves, nor that the `#quick-start` anchor the in-panel Guide buttons use (ui.py:153, 815) matches the published README — the local root README.md:247 does have `## Quick start`, so the anchor is right for the current source.
- I did not evaluate whether `bl_options = {"REGISTER"}` without `UNDO` on `BLENDLINK_OT_sync_now` (ops.py:3856) and `BLENDLINK_OT_browser_preview` (ops.py:3947) is correct, even though both mutate scene data via `_ensure_scene_ids` and `props.write_recipe`. That belongs to the operators surface.
- Verified clean and worth recording as such: an AST scan of all 36 addon modules found 124 classes subclassing a registrable `bpy.types` base, and all 124 appear in the six `classes` tuples aggregated by `__init__.py:15-22`. None is registered without being unregistered, and none is defined-but-forgotten.

