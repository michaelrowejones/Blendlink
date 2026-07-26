# Build Blendlink as the artist-first scene compiler

Status: accepted on 2026-07-19; supersedes ADR 0003

Blendlink is the primary Blender-to-Three.js publishing product. Its promise is
to let a technical artist make a beautiful web-ready scene in Blender and
compile it into portable, efficient, developer-friendly artifacts without
adopting a proprietary engine or cloud.

The `.blend` owns Web Presentation, per-object Baked/Realtime intent, atlas
design, target density, quality profiles, and lighting states. Project config
owns paths, URLs, collection scope, and exporter escape hatches. Hybrid is the
flagship mode. Main is the default undeletable atlas; additional atlases are
intentional exceptions created from a selection. Automatic layout is a proposal
that can be inspected, materialized, edited, and pinned. A final build blocks
when a target cannot be met unless the artist explicitly chooses Scale to Fit.

The external interface is one deep operation: compile a Blender project into a
deployable web scene. GLB export, Cycles baking, atlas construction,
optimization, manifests, and type generation remain behind it. Plain Three.js
and React Three Fiber adapters stay thin and optional. Multiplayer, Unity,
hosting, cloud transforms, and an owned runtime are out of scope.
