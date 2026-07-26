# Migrations

Blendlink is pre-1.0. There are no migrations from a published release yet.
This document is the required home for every future compatibility change.

## Compatibility surfaces

A migration note is required when a release changes any of these public
interfaces:

- CLI commands, flags, exit behavior, or output consumed by automation;
- `blendlink.config.*` keys or defaults;
- npm exports, TypeScript types, Three.js/R3F installation behavior, loading
  state, or error behavior;
- generated binding names or shapes;
- manifest schema or published asset layout;
- Blender `blendlink_*` properties, operators, vocabulary, panels, or stored
  scene data;
- supported Node, Blender, Three.js, React, R3F, browser, or OS ranges.

Manifest readers continue to enforce `schemaVersion`. Additive changes may stay
within a schema version; a reshape requires a schema bump and a loud reader
failure or an explicit migrator. Vocabulary changes must remain synchronized
across the conformance file and all three parsers.

## Required release entry

For each breaking or action-requiring release, add a newest-first section:

```markdown
## Migrating from 0.x to 0.y

### Who is affected

### Why it changed

### Before

### After

### Automatic steps

### Manual steps

### Backup and rollback

### Verification
```

The entry must distinguish generated files that may be regenerated from artist
or application files that must be preserved. It must state whether Blendlink
creates a backup, whether the operation is idempotent, how to verify success,
and how to recover. Do not tell users to delete or reset their worktree as a
migration strategy.

## First public release

The planned 0.8.0 artifacts are an initial public-release candidate, not an
upgrade from an npm or Blender Extensions release. Before publishing, replace
this paragraph with the exact installation instructions and any migration from
local/file-linked development installs.

### Local development: Node 22.15 is the minimum Node 22 release

File-linked development consumers on Node 22.12 through 22.14 must upgrade to
Node 22.15 or newer on the Node 22 line, or use Node 24. Blendlink reads the
saved Blender version before export so it can refuse newer-file data loss;
Blender's optional file compression uses Zstandard, whose required built-in
Node API first exists in Node 22.15. No `.blend`, generated scene, manifest, or
website migration is required. Run `node --version` and `blendlink doctor`
after upgrading. Rollback means using the previous local development commit;
there is no published 0.8.0 package to downgrade.

### Local development: React helpers use the React subpath

File-linked development consumers that imported `createUseBlendlink` from the
package root must import it from `blendlink/react` instead. The root entry is
now renderer-neutral so CLI, compiler, and Vanilla consumers do not require the
optional React or React Three Fiber peers merely to evaluate `blendlink`.

```ts
// Before
import { createUseBlendlink } from 'blendlink'

// After
import { createUseBlendlink } from 'blendlink/react'
```

No generated scene, manifest, `.blend`, or asset migration is required. The
React subpath was already public; change the import and run the application's
normal TypeScript and production build gates. Reverting the import is only safe
with an older matching local package and restores the eager optional-peer
requirement.

### Local development: regenerate path-bearing generated artifacts

Local consumers whose generated manifest or TypeScript comment still contains
an absolute `.blend` or linked-dependency path should regenerate it with the
matching current compiler. Project-owned paths become slash-normalized
project-relative locators. Paths outside the project become basename-free
opaque labels whose exact value is available only to Blendlink's per-user
local cache; that cache is intentionally not copied into source control or a
deployment.

Custom automation must stop treating `sourceBlend` or every external
dependency `path` as an absolute filesystem path. These are provenance and
drift fields, not runtime asset URLs; use the configured scene source through
Blendlink's compiler/sync commands. Missing private cache state is repaired by
running a local sync, not by committing a cache record. No `.blend`, website
source, or runtime asset needs mutation. To roll back a local experiment,
restore the matching older package and generated artifacts together.

### Local development: Three.js support is pinned to r184

Source-development websites that previously used Blendlink's provisional
`>=0.180.0 <0.186.0` peer range must resolve the executable runtime to exact
`three@0.184.0`. A declaration-only `@types/three` patch may remain within
`>=0.184.0 <0.185.0`; those bytes do not implement loader extensions. The
compiler and runtime now use an r184 source-audited capability profile;
accepting a neighboring Three runtime release without equivalent evidence
could silently change loader extension or animation behavior.

Update both peers together, reinstall, regenerate the scene bindings, and run
the website's production build plus browser smoke. Application routes, Canvas
ownership, and authored `.blend` files do not change. To roll back a local
experiment, restore the prior matched Blendlink/Three/generated-artifact set;
do not mix an older Blendlink runtime with newly generated bindings.

### Local development: runtime diagnostics v1

File-linked and source-development installs that already generated scene
bindings must update the Blendlink package and regenerate those bindings as
one change. New `<scene>.gen.ts` files expose the browser-safe
`runtimeDiagnostics` v1 projection (`lodChains` and `instanceGroups`) instead
of embedding the manifest's complete `sceneDiagnostics` record. The exhaustive
procedural, material, camera, LOD, and instancing evidence remains in
`<scene>.manifest.json`.

A current runtime can still consume an older binding through its deprecated
full-`sceneDiagnostics` fallback. The reverse is not supported: an older
runtime does not know the new `runtimeDiagnostics` property and can therefore
miss LOD or optional instancing behavior. Install the matching package first,
then run `blendlink sync <scene> --force` for every generated scene and commit
the generated module and manifest together.

If both contracts are supplied, the current versioned property is
authoritative. An unsupported version or malformed v1 array fails with an
instruction to update the runtime and regenerate; Blendlink does not hide the
mismatch by reading legacy evidence. The operation rewrites generated
compiler-owned artifacts only and is safe to repeat. Artist `.blend` files and
application-owned adapters are not migration targets; preserve them normally
in source control. To roll back a local experiment, restore the previous
matched package, generated module, and manifest as one set. Verify the change
with the website's production build and browser scene gate.

### Local development: Area lights now default to Automatic

This is a deliberate pre-1.0 behavior change for source-development installs.
Previously, an `AREA` light without `blendlink_area_light_mode` stayed
bake-only. Missing metadata now means **Automatic** for Area lights only; Point,
Spot, and Sun retain their existing punctual-light behavior. Automatic emits a
versioned Three `RectAreaLight` node extra only for the engine-proven static
Square/Rectangle subset. Otherwise it keeps the source bake-only and records a
named source-policy or finalized-artifact reason. Blendlink does not write an
Automatic property into the artist's `.blend`; choosing Automatic in the UI
removes it.

Artists who need the previous result should select **Bake Only**, which writes
the namespaced value `"bake-only"`. **Three Rect Area** writes
`"three-rect-area"` and knowingly permits diagnosed semantic losses such as
shadowlessness, but it cannot force an invalid, animated, micro-divergent, or
uncomputable descriptor. Eevee uses the engine's data-block semantics, folds
its static Direct Light scale, and ignores unused Area Spread/light nodes.
Cycles accepts nodes-off data-block semantics or a supported direct constant
Emission route; when present, a non-default Emission Strength remains an
Automatic fallback and an explicit-Three error.
Collection Instance sources and ambiguous final GLB nodes likewise fall back
under Automatic and block the explicit override.

Non-default diffuse/specular factors and intermediate nonzero
transmission/volume factors are also intentional Automatic fallbacks. Default
positive transmission/volume closure, authored shadows, Eevee's finite fade,
and differing LTC horizon/facing behavior remain named approximations. A
Lighting atlas without compiled per-light bake-exclusion evidence fails before
LTC allocation to prevent probable double illumination; choose Bake Only or an
Appearance/static-plus-live-PBR contract before republishing.

No manifest schema or artist data is reshaped. Update the add-on and npm
package together, run a forced scene sync/publish, and review the Web Light
diagnostic plus the application's production browser gate. An Automatic result
may add live direct light to Standard/Physical PBR receivers and load Three's
shared LTC data; it remains one-sided, shadowless, direct-only, and is not an
image-parity promise. To roll back without changing the source scene, restore
the previous matched tool/runtime and generated artifacts. To retain the old
look on the current version, choose Bake Only and republish.

The current runtime statically imports Three's official LTC initializer. This
fixes a reproduced Vite top-level-await/split-chunk deadlock, while keeping LTC
initialization and GPU upload conditional on a real descriptor. It also makes
the similar total Area payload eagerly resident in the runtime bundle. Review
the application's production bundle when upgrading; the no-Area cost is still
an optimization question, not a solved or hidden migration guarantee.
