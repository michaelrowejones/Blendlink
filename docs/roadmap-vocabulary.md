# blendlink roadmap: the vocabulary and the masters' manual labor

Synthesis of three research passes (July 2026): 16 master-tier case studies
mined for recurring manual glue, community unmet-asks at the Blender↔web
seam, and game-engine importer conventions. Features below are ranked by
**three-way agreement** — a pattern had to recur across shipped projects,
be asked for by name in the community, and/or have a proven engine
precedent.

## The headline validation

Every mature practitioner converges on building this tool privately:
Merci-Michel wrote a custom Blender export plugin + JSON manifest for
Coastal World; ZERO built an internal KTX2 preview dashboard; Active
Theory gave up on the seam and built an entire engine; and **Bruno
Simon's 2025 portfolio runs on a hand-rolled naming-convention compiler**
("an object named `refLandingPhysicalFixed` is automatically converted
into a fixed physics body and exposed in JavaScript as `landing`").
Soloists without the resources to build this eat the manual cost instead.
blendlink is the public version of the tool the masters keep writing
privately.

## Vocabulary v1 (extends the shipped typegen/manifest — near-term)

Principle: **suffixes for structural verbs, custom properties for values,
collections for scoping** — the split every engine converged on
independently. Matching is case-insensitive with `-`/`_` interchangeable
(Godot's ergonomics). And the one thing no engine ships: **a lint pass.**
Near-miss suffixes, orphaned sockets, LOD gaps, non-serializable
properties become build warnings — the universal criticism of every
naming convention is silent typo failure, and a build step can fix that.

| Token | Meaning | Emitted |
| --- | --- | --- |
| `-col` / `-convcol` | keep visual, add trimesh/convex collider | `colliders[]` in manifest + literal-typed union |
| `-colonly` / `-convcolonly` | collision proxy, stripped from render GLB | same; geometry to a physics section |
| Empty + `-colonly` | primitive collider from empty display type (box/sphere) | shape + transform |
| `_LOD0…_LODn` | LOD chain (Unity's convention); `lod_distance` prop for switch distances | `lods[]` + runtime `THREE.LOD` assembly helper |
| `SOCKET_<name>` empty | attach point, bound by parenting (not name-matching — kills Unreal's UCX typo class) | **typed sockets**: `getSocket(scene, 'Gun', 'Muzzle')` compile-checked |
| `HOTSPOT_<name>` empty | annotation anchor; `title`/`body`/data props ride along; normal from empty axis | `hotspots[]` for drei `<Html>`/DOM overlays |
| `AUDIO_<name>` empty | spatial-audio emitter position (glTF's audio ext is a perpetual draft) | `audio[]` anchors |
| `-noimp` (+ collections) | excluded from export; also honors "disable in renders" | listed in the build report (never silently) |
| `-rigid` + `mass`/`friction`/`restitution` props | dynamic body hint (verb by suffix, numbers by property) | `physics[]`, renderer-agnostic (rapier/cannon) |
| any custom property | passed through, **typed** | per-object `userData` interfaces in the .d.ts |

Evidence anchors: Godot's `-col` family docs + community love for
`-colonly`; Unreal's `UCX_`/`SOCKET_` (and its documented silent-typo
failure mode, which parenting-based binding eliminates); Unity `_LODn`;
Bevy/Skein's properties-as-components lineage; 5+ case-study projects
hand-rolling collision proxies and name-based event routing.

## v1.x — the two killer features (highest demand × lowest lift)

1. **Curves → typed three.js paths.** glTF has no curve primitive (spec
   ask open since 2018). basement.studio hand-rolled a Bezier exporter;
   Codrops' July 2026 tutorial canonizes "paste a Python snippet, swizzle
   axes by hand, dump JSON." blendlink samples curves in the existing
   headless script (no addon — beating every partial solution) and emits
   typed `CatmullRomCurve3`/Bezier constructors, Z-up conversion done.
   Camera paths for scroll experiences are the #1 use.
2. **Scroll-scrub bindings.** The most-recurrent question pattern at the
   seam: Blender clips scrubbed by scroll. Emit typed clip names,
   durations, and **timeline markers as named waypoints** with a
   `scrub(clip, t)` helper that owns the per-object mixer bookkeeping
   (the documented shared-mixer footgun). GSAP/ScrollTrigger stays the
   user's; blendlink supplies the typed binding surface.

## v2 — the looks module (validated harder than expected)

The **bake-and-rebind loop appeared in 8+ of 16 case studies** — bake in
Cycles, compress by hand, re-bind to unlit materials in code — and no
public tool spans it. blendlink's exporter already emits
`KHR_materials_unlit`; v2 adds the flagship-site bake machinery
(join-proxy GPU bakes, dithered saves, margin contracts) plus:

- **Lighting states**: multi-bake sets blended by uniform (Windland,
  ZERO, Lusion all hand-built this; Bruno's day/night is the canon).
- **Compression feedback**: per-asset before/after preview with size
  stats (ZERO built precisely this internally because "there is no easy
  way to preview it locally"); extends the existing manifest stats.
- **Scatter → InstancedMesh**: read GN/particle instance transforms
  directly (the exporter path is version-fragile per glTF-Blender-IO's
  own maintainers), with per-instance custom data.

## v3 / exploratory

- Data-texture authoring helpers (splat/FX/palette maps — 5 projects
  hand-paint channels and re-derive readers every time).
- Registry-driven Blender UI for typed properties (the Skein/Needle
  pattern) — the proven fix for free-text property typos.
- Atlas membership management across the seam (UV2 + bake-group identity).

## Deliberately not doing

- Runtime engine features, scene editors, device-tier quality systems
  (runtime-side; pmndrs territory), terrain editors. The scope stays:
  *things an artist can say in Blender that become typed, working web
  artifacts.*
