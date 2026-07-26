# Installed Blendlink component UI ground truth (2026-07-21)

Status: pre-reinstall evidence complete. No extension reinstall, source replacement, saved `.blend`, or production-source edit was performed during this investigation.

## Result

The user's “only Bloom and Vignette” report is exactly reproducible. Blender 5.2 is loading an enabled but stale, mixed-snapshot Blendlink extension. Its live catalog contains exactly two scene effects (Bloom and Vignette) and eight object behaviors. This is not only a discoverability problem: the other nine claimed scene effects are absent from the Python catalog Blender imports.

The installed manifest and current compiler both say `0.8.0`, so version equality is not enough to detect this drift. `blendlink doctor` reports the add-on as installed and enabled even though its catalog and files do not match the bundled add-on.

## Live module and installation identity

Observed with Blender 5.2.0 LTS (`fbe6228777e7`) in background mode while normal user preferences were active:

- Enabled module: `bl_ext.user_default.blendlink`
- Package `__file__`: `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\extensions\user_default\blendlink\__init__.py`
- Catalog `__file__`: `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\extensions\user_default\blendlink\component_schema.py`
- Manifest: `schema_version = "1.0.0"`, `version = "0.8.0"`
- Extension data/log directory: `C:\Users\micha\AppData\Roaming\Blender Foundation\Blender\5.2\extensions\.user\user_default\blendlink`

The normal startup loaded 22 `bl_ext.user_default.blendlink...` modules. Every reported `__file__` was under the extension directory above; Blender was not importing the repository checkout or `dist/addon`.

## Catalog evidence

| Source | Scene effects | Object behaviors |
| --- | ---: | ---: |
| Live installed `component_schema.py` | 2 | 8 |
| Current repository and `dist/addon` | 11 | 8 |

Installed scene types:

- `blendlink.bloom`
- `blendlink.vignette`

Installed object types:

- `blendlink.see-through`
- `blendlink.open-url`
- `blendlink.hover`
- `blendlink.hide-on-start`
- `blendlink.look-at`
- `blendlink.play-animation-on-click`
- `blendlink.audio-source`
- `blendlink.play-audio-on-click`

The current repository adds Chromatic Aberration, Pixelation, Contrast-Adaptive Sharpen, Tilt Shift, Ambient Occlusion, Outline, Color Grade, Depth of Field, and Kuwahara to the scene catalog.

## File-integrity comparison

Compared by SHA-256 against `packages/blendlink/dist/addon` before any reinstall:

- Installed directory: 25 files.
- Current built directory: 30 files.
- Exact matches: 9 files.
- Same-name but divergent: 16 files.
- Missing from installed: `component_validation.py`, `consequence_gizmos.py`, `nla_sequence.py`, `probe_authoring.py`, and `weblights.py`.
- Repository authoring files and `dist/addon` matched for all 29 repository-sourced files at the time of inspection; `bakelib.py` is added from its canonical package source during the build.

The installed manifest text also differs from the current manifest despite sharing version `0.8.0`. Git blob lookup did not locate the installed `component_schema.py`, `components_ui.py`, `ops.py`, `props.py`, `ui.py`, or manifest in repository history, which is consistent with a locally installed dirty snapshot rather than a reproducible commit.

The checked-in `packages/blender-addon/blendlink-addon.zip` is not the current install artifact: it was dated 2026-07-19, contains only 13 files, and predates the component UI. The supported installer instead builds a fresh archive from `packages/blendlink/dist/addon`.

## UI reproduction

Steps, before reinstall:

1. Launch Blender 5.2 normally with user preferences.
2. Dismiss the startup splash.
3. Select the default Cube.
4. Open the 3D View sidebar (`N`) and select the `Blendlink` tab.
5. Click `Set Up Blendlink Scene` in the disposable unsaved scene.
6. Expand `Effects & Behaviors`.
7. Observe the empty text: `No scene effects yet. Add Bloom or Vignette with +.`
8. Click the Scene `+`. The complete menu contains only Bloom and Vignette.
9. Click the Cube `+`. The behavior menu contains all eight behavior types; Rigid Body and Collider appear under a separate `Physics Designations` heading.

### Surface-by-surface findings

**3D View N-panel (approximately 245 px wide)**

- This is the exact source of the reported experience: the empty text names only Bloom and Vignette, and the tiny unlabeled `+` opens a two-item menu.
- The scene menu has a category heading but no search, descriptions, cost/support badges, disabled states, or documentation links.
- The object menu contains eight behaviors grouped by category.
- Rigid Body and Collider are shown in a separate Physics card and under a `Physics Designations` menu heading, but placing them in the same add menu can still imply bundled simulations.
- Clearing selection leaves an active Cube identity in the N-panel, including its `+`; the panel does not visually explain the target mismatch. This differs from Object Properties.

**Object Properties (approximately 430 px wide)**

- `Blendlink Web Object > Web Behaviors` uses the labeled control `Add Behavior to Selection`, which is more discoverable than the N-panel `+`.
- With the pinned Cube outside the editable selection, `Blendlink Web Object` gives a useful explanation and `Select This Object` recovery button.
- With the Cube selected, the panel has an honest empty state and a separate Physics box.

**Scene Properties (approximately 430 px wide)**

- `Blendlink Scene > Website Effects & Behaviors` uses the labeled `Add Scene Effect` control and the neutral empty text `No scene effects yet. The website keeps its normal renderer output.`
- Opening the control still proves that only Bloom and Vignette are installed.
- The panel is buried below a large third-party Needle panel in this profile, so the N-panel is substantially easier to find.

**Current repository UI, not installed during this investigation**

- The repository contains a full catalog browser with search, target filters, category filters, descriptions, compatibility counts, target/cost/support/adapter badges, disabled actions, and documentation URLs.
- The repository N-panel still contained the misleading `Add Bloom or Vignette with +` empty text at the time of this audit; a clean install alone would expose the larger browser but would not fix that copy.

## Screenshot artifacts

All screenshots are pre-reinstall captures from the live Blender 5.2 window:

1. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\00-preinstall-startup-object-properties.png`
2. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\01-preinstall-npanel-only-bloom-vignette.png`
3. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\02-preinstall-effect-menu-two-items.png`
4. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\03-preinstall-behavior-menu-eight-plus-physics.png`
5. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\04-preinstall-no-selection-target-mismatch.png`
6. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\05-preinstall-object-properties-behaviors.png`
7. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\06-preinstall-scene-properties-effects.png`
8. `C:\Users\micha\.codex\visualizations\2026\07\21\019f851b-38d7-7f51-8ca8-679d603688d\installed-component-ui\07-preinstall-scene-properties-two-effect-menu.png`

## Fast red-capable diagnostic

This command inspects what Blender actually imports and exits `42` unless the live catalog contains 11 scene effects and 8 object behaviors. On the preinstall state it deterministically emitted `sceneCount: 2`, `objectCount: 8`, `ok: false`, and exit code 42.

```powershell
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$expr = "import importlib,sys,json; m=importlib.import_module('bl_ext.user_default.blendlink.component_schema'); d=m.COMPONENT_DEFINITIONS; scene=sorted(k for k,v in d.items() if 'SCENE' in v['targets']); obj=sorted(k for k,v in d.items() if 'OBJECT' in v['targets']); ok=len(scene)==11 and len(obj)==8; print('BLENDLINK_COMPONENT_DIAGNOSTIC='+json.dumps({'module':m.__file__,'schemaVersion':m.COMPONENT_SCHEMA_VERSION,'sceneCount':len(scene),'objectCount':len(obj),'sceneTypes':scene,'objectTypes':obj,'ok':ok},sort_keys=True)); sys.exit(0 if ok else 42)"
& $blender --background --python-expr $expr
exit $LASTEXITCODE
```

The diagnostic is intentionally stronger than the current doctor check. The observed `npx blendlink doctor` output said `✓ Blendlink addon 0.8.0 installed and enabled (...)` and only failed later because no config exists in the repository root; it did not detect content drift.

## Required follow-up

- Make install health content-addressed or compare a bundled release/build fingerprint, not only the manifest version.
- Make `doctor` report live module path, catalog counts, and bundled-vs-installed drift.
- Generate/install from `dist/addon`; do not direct users to the stale checked-in zip.
- Replace the N-panel's Bloom/Vignette-specific empty copy and unlabeled primary action.
- Verify the current browser in all three Blender surfaces after a clean install, including narrow N-panel layout, search, filters, badges, disabled target states, and documentation actions.
- State explicitly that Rigid Body and Collider are export designations, not simulations or component behaviors.

