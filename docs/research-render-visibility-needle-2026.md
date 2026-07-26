# Render scope: Blender, Needle 1.4.2, and Blendlink

- Research date: 2026-07-22
- Blender exercised: 5.2.0 LTS, build `fbe6228777e7`
- Needle add-on inspected: installed 1.4.2 for Blender 5.2
- Status: direct/path visibility **Verified**; mixed Collection Instance export
  **Blocked loudly**; occurrence-aware export and generic render-scope snapshot
  remain **Recommended design**

## Decision

Blendlink should use Blender's **render** intent, not viewport visibility, as
the source of truth for publishing and baking. One unblocked root-to-membership
path makes a direct object or light render-participating. Object, Collection,
and LayerCollection viewport switches must not remove a render participant;
they may be cleared temporarily when Blender's selection-based bake operator
needs access, then restored exactly.

`weblights.render_visibility()` implements and explains the direct path rule
correctly. Before this audit, the duplicate
`export_scene.object_hidden_by_collections()` did not: a collection datablock
linked beneath one render-hidden parent and one visible parent was treated as
hidden even though Blender renders it. That helper has now been removed and
the bake/state/light call sites consume the canonical module directly.

Do not deepen the duplicate helper. Extract the generic logic into one render
scope module and have light diagnostics, validation, bake planning, state
planning, grouped lights, dependency fingerprints, and the glTF transaction
consume that module. Keep `bakelib.bake_objects_to_image()` mechanical: its
caller supplies already-scoped receiver objects.

Collection Instances require occurrence-level decisions. An object can have a
hidden direct occurrence and a visible instanced occurrence at the same time.
An object-level `hide_render` mutation cannot keep one and remove the other.
Until Blendlink materializes an occurrence-aware throwaway export graph, mixed
visibility in one source object should block loudly rather than silently ship
extra or missing geometry/lights.

## Primary-source anchors

### Blender

- Blender's Python interface defines `Object.hide_render` as global render
  disable, `Object.hide_viewport` as viewport-only, `Object.hide_get()` as
  per-View-Layer viewport editing state, and `Object.visible_get()` as a 3D
  viewport query. [Blender Object Python interface][blender-object-api]
- Blender's Outliner manual distinguishes Exclude from View Layer (viewport
  and render), Hide/Disable in Viewports (viewport only), and Disable in
  Renders (render only). It also defines Holdout and Indirect Only as distinct
  contribution roles rather than ordinary visibility switches.
  [Blender Outliner restriction toggles][blender-outliner]
- Blender's View Layer manual says an excluded collection's objects are not
  rendered in that View Layer; Holdout masks, while Cycles Indirect Only keeps
  shadow/reflection contribution. [Blender View Layers][blender-view-layers]
- Installed Blender glTF exporter:
  `C:\Program Files\Blender Foundation\Blender 5.2\5.2\scripts\addons_core\io_scene_gltf2\blender\exp\tree.py`
  SHA-256 `A7CDAEBF55836CE2CB466B7AB4F48A66490AACD2FC0CB45DCB0BCDA8A18080F6`.
  Lines 649-773 show that renderability is tested from an object's own
  `hide_render` plus its immediate `users_collection` links. Under a kept
  Collection Instance, inheritable filters are intentionally skipped for
  source children. This explains both the hidden-ancestor and hidden-instance-
  source export gaps; it is not an inference from marketing documentation.
- The glTF export operator declares `use_visible=False` and
  `use_renderable=False` by default at installed `io_scene_gltf2/__init__.py`
  lines 624-634.

### Installed Needle 1.4.2

Needle version anchor:
`C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\.cache\needle-spike\addon\Needle Engine Exporter for Blender\__init__.py:43-49`
reports `(1, 4, 2)`. The inspected file SHA-256 is
`980226A628182E9E0B1D443C0E294F799162C76E06C5F599DACC20C614A8C96E`.

- `lightmapping/lightmapping.py:250-310` chooses marked meshes and lights from
  object viewport state (`hide_get`, `hide_viewport`). It hides unmarked
  meshes/lights from the render. Lines 362-371 select the receivers and clear
  a receiver's `hide_render` for the bake. It does not resolve render-hidden
  collection ancestors or active View Layer exclusion. File SHA-256:
  `4E69F0934D9329B2D8480B097BAA1D903AA31BED9337C7A2AE0630CBC900B4F1`.
- `blender_export.py:377-416` sets `use_visible=False` but does not enable
  `use_renderable`. File SHA-256:
  `6272997CFB4F1D740EA33A7C2512983B9993DEDF93C9C8240CA0FF7F82925D77`.
- `__init__.py:580-593` removes an object only when its render switch is off
  **and** Needle's viewport helper also calls it invisible. Thus a viewport-
  visible, render-disabled object remains exportable by Needle.
- `utils_blender.py:4-39` is viewport-specific and treats any hidden direct
  membership as hidden; it traverses LayerCollections by name. It therefore
  cannot express Blender's identity-based, one-visible-path multi-link rule.
  File SHA-256:
  `C4165224511B93F9F50A7FFC4018F3704BE64BABC9EE09A3CB23325D98E95F92`.

This is a justified Blendlink deviation from Needle: render truth is the
artist's Final intent, while viewport switches are workspace ergonomics.
Blendlink's path-aware approach is measurably more faithful and can still make
viewport-hidden receivers temporarily selectable without changing the bake.

## Executed differential evidence

### Render pixels

The registered prototype is
`experiments/render-visibility-probe/probe.py`. It builds small scenes and
reads pixels from real 32x32 Blender 5.2 Eevee renders. Run:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\render-visibility-probe\probe.py
```

The 2026-07-22 run passed in 20.8 seconds. Its binary scope decisions covered
22 cases and matched all final pixels:

| Case | Blender result | Consequence |
| --- | --- | --- |
| Shared child beneath one hidden and one visible parent | rendered | one visible complete path wins |
| Every complete parent path render-hidden | absent | all paths must be blocked |
| One View Layer path excluded, one included | rendered | one included complete path wins |
| One path render-hidden, the other excluded | absent | different blockers may jointly hide all occurrences |
| `Object.hide_render` | absent while `visible_get()` stayed true | viewport query is not render truth |
| Object `hide_viewport`, `hide_set`, Collection `hide_viewport`, LayerCollection `hide_viewport` | rendered while `visible_get()` was false | viewport state must not filter Final/bake scope |
| Point light through one hidden and one visible path | illuminated receiver | identical path rule applies to lights/contributors |
| External Collection Instance source/root `hide_render` or root exclusion | absent | root and every source path participate in instance scope |
| Instance source/root viewport switches | rendered | viewport-only remains viewport-only for instances |

`weblights.render_visibility()` matched every direct mesh/light pixel and
`collect_instance_source_occurrences()` matched every instance pixel in this
fixture.

### Contribution roles are not a boolean

The same probe set `holdout` and `indirect_only` on only one of two duplicate
LayerCollection paths. Blender reported `Object.holdout_get()` or
`Object.indirect_only_get()` true even though the second path was normal; the
holdout emission surface was absent from the final color. Thus the visibility
rule (any unblocked path participates) cannot silently stand in for surface
transport. Blendlink should diagnose/block unsupported Holdout and Indirect
Only publishing until their intended bake/runtime treatment is explicit.

### Mixed direct/instance glTF occurrence

`experiments/render-visibility-probe/gltf_instance_probe.py` creates one source
mesh with a render-hidden direct ancestor and one visible Collection Instance.
Blender renders one occurrence. Run:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\render-visibility-probe\gltf_instance_probe.py
```

The 2026-07-22 characterization passed in 18.6 seconds and reported:

```text
directVisibility=false
instanceOccurrenceVisibility=[true]
stockSourceNodeCount=2
blendlinkSourceNodeCount=2
```

At characterization time, both stock Blender and Blendlink enforcement emitted
the hidden direct node plus the visible instance child. Production enforcement
now preflights this mixed state before any datablock mutation and blocks with
an artist-readable realize/visibility remedy; the registered headless fixture
verifies that journal-free failure. Occurrence-aware export remains a gap, but
Blendlink no longer silently claims or ships the wrong multiplicity.

## Designs considered

### 1. Call `weblights.render_visibility()` everywhere

This is the smallest safe correction for direct receivers, direct lights,
emissive contributor diagnostics, and hidden-collection state calculations.
It deletes the known incorrect helper and centralizes direct path logic.

It is not the final seam. A generic renderer rule living in a light module is
poor locality, one boolean loses direct-versus-instance occurrences and
Holdout/Indirect Only, and repeated calls rebuild the collection path index.

### 2. Build one generic render-scope snapshot — recommended

Create a non-mutating module such as `render_scope.py`, shared by the addon and
headless exporter. Keep its interface small:

```python
scope = analyze_render_scope(scene, view_layer, hidden_collections=())
decision = scope.for_object(obj)
```

`decision` should retain direct and instanced occurrences, complete identity
paths, blockers, root instance, render participation, Holdout, and Indirect
Only. `scope` is a snapshot and must be rebuilt after a lighting state mutates
collection visibility. Cycles ray switches (`visible_shadow`,
`visible_diffuse`, etc.) remain native object state, not reasons to drop an
occurrence.

This is a deep module: callers learn one analysis operation and one query;
multi-link traversal, cycle protection, View Layer matching, instance
recursion, diagnostic text, and caching remain inside. Deleting it would
recreate the same complexity across validation, lights, bake, fingerprints,
and glTF export.

`bakelib.py` should not import policy. Bake orchestration asks the scope for
receivers/contributors and passes exact objects to `bake_objects_to_image()`.

### 3. Derive scope from `visible_get()`, `view_layer.objects`, or the viewport depsgraph — rejected

The pixel differential disproves `visible_get()`. `view_layer.objects` catches
full exclusion but not `hide_render` or hidden collection ancestors. The
readily available depsgraph is viewport-evaluated, so viewport-hidden
Collection Instances may be missing even though a Final/Cycles render includes
them. These APIs can be corroborating evidence but cannot own the interface.

## Required implementation order and fixtures

1. Replace the local collection predicate and every direct bake/light scope
   filter with the canonical path-aware result. Cover a shared child beneath
   hidden+visible parents, not merely an object linked to two sibling
   collections.
2. Make grouped-light discovery path-aware. Include or loudly block visible
   Collection Instance light sources; otherwise an instanced group remains in
   the base bake and no truthful additive layer exists.
3. Make state prediction use the same resolver with a hidden-collection
   overlay. Test mixed hidden/excluded paths and exact restoration.
4. Fingerprint render-reachable Collection Instance sources by collection
   recursion, not only the viewport depsgraph. Test a viewport-hidden instance
   whose source material, mesh, or light changes.
5. Add the mixed direct/instance glTF fixture. Until occurrence materialization
   exists, assert a loud, artist-readable blocker rather than two nodes.
6. Add Holdout/Indirect Only diagnostics before using generic participation to
   classify mesh receivers or claim ordinary glTF parity.
7. Run the headless addon suite and the two-state baked browser gate after the
   direct correction; run artifact node-count and pixel comparisons for the
   occurrence-aware export change.

[blender-object-api]: https://docs.blender.org/api/current/bpy.types.Object.html
[blender-outliner]: https://docs.blender.org/manual/en/latest/editors/outliner/interface.html#restriction-toggles
[blender-view-layers]: https://docs.blender.org/manual/en/latest/render/layers/introduction.html
