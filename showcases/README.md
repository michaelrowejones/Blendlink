# Blendlink showcases

Real Blender scenes shipped to three.js through the full Blendlink
pipeline — fidelity routing, appearance atlas bakes, per-channel
Material bakes with TSL IR evidence, meshopt, WebP/KTX2 delivery, and
the generated typed runtime.

## cube-diorama (working)

The classic Blender "cube diorama" atelier. `mark_fidelity.py` applies
the fidelity decisions headlessly on the copied scene:

- 6 Principled-rooted materials → per-channel Material bake with
  `blendlink_tsl_ir` programs, published as the
  `cubeDiorama.materials.json` sidecar the descriptor points at. Their
  host objects (Bird Cage, Computer, Ground Plate) are Realtime:
  Appearance baking owns the COMPLETE surface of every static mesh, so
  per-material routes only exist on objects the atlas does not claim —
  a host goes Realtime only when every slot is bake-marked or portable
  live PBR, and marked materials without an eligible host demote back
  to the atlas by name (Plant.Dirt, Plant.Pot, curtains.bar).
- Everything else → the Appearance atlas (1024², density 24, Cycles
  16-sample denoised), including the furniture frozen into the still
  diorama.
- Curated out, each for a compiler-named reason the gate is RIGHT to
  enforce: the porcelain/glass pieces (Layer Weight/alpha are
  view-dependent — no honest static carrier), the potted bluebell
  (transmission + multi-slot receiver), the cat (view-dependent blanket
  + subdivision), the books (degenerate polygon defeats planar atlas
  rescue), the ladder (displace modifier).

The entry point opts into viewer navigation (orbit + zoom around the
authored framing) and shows a performance readout (fps, frame ms, draw
calls, triangles). New scaffolds carry the same navigation as an
`ORBIT_PREVIEW` flag, off by default — interactivity stays a
per-application choice, never a Blendlink default.

Result: 41 nodes, 2.31M triangles, ~11 MB delivered. Run it:

```bash
cd showcases/cube-diorama && npx vite
```

To regenerate from the source copy:

```bash
blender --background scene/cube_diorama.blend --python mark_fidelity.py
node ../../packages/blendlink/dist/cli.js compile --force
```

## ellie (working — the Phase 4 acceptance scene)

The Ellie character scene compiles through the TSL program route: an
animated, armature-deformed character cannot take the appearance atlas
(deforming meshes), so her paint-stroke Mix-Shader materials ship as
per-channel TSL IR programs in the `ellieAnimation.materials.json`
sidecar — 36 of 49 materials lowered, the 2048² dirt map riding as an
exact hash-pinned `texture_ref` image beside the sidecar. The measured
Phase 2 verdict that picked this route over baking: 64 MiB delivered
against the 201 MiB texture baseline, 8 draws at 130,810 triangles.

`mark_fidelity.py` records the route decisions into the `.blend`
headlessly: the program opt-ins, the extras-conflict resolution that
precomputes install-time refusals (largest agreeing set per shared
mesh), and the fannypack-zipper exclusion (its geometry waits on the
Phase 3 runtime-deformer route). Run it with Blender's `--python`, then
compile:

```bash
blender --background scene/ellie_animation.blend --python mark_fidelity.py
node ../../packages/blendlink/dist/cli.js compile --force
```

## Scene provenance and licenses

Both scenes derive from official Blender demo assets whose pristine
source bytes are pinned in `docs/demo-corpus-inventory.json`; the
committed working copies additionally carry Blendlink's saved fidelity
marks (`blendlink_*` custom properties). Blender's `.blend1` backup
files are not committed.

- **cube-diorama** — `scene/cube_diorama.blend`, from the official
  Blender 3.0 asset demo bundle
  (`download.blender.org/demo/bundles/bundles-3.0/asset-demo-bundle-3.0-cube-diorama.zip`).
  By **Blender Studio**. License: **CC0**, per the bundle's embedded
  README and the listing at blender.org/download/demo-files.
- **ellie** — `scene/ellie_animation.blend`, from the official Blender
  3.0 asset demo bundle ("Ellie Pose Library",
  `download.blender.org/demo/bundles/bundles-3.0/asset-demo-bundle-3.0-ellie-animation.zip`).
  By **Blender Studio**. License: **CC-BY**, per the `.blend`'s embedded
  `README Animation` / `README Pose Library` text blocks and the listing
  at blender.org/download/demo-files (neither source states a CC-BY
  version number). The compiled artifacts under `showcases/ellie/` are
  derivatives of that work and carry the same attribution: *"Ellie Pose
  Library" by Blender Studio, licensed CC-BY.* The showcase's marks and
  compiled outputs are Blendlink's; the character, rig, animation, and
  textures are Blender Studio's.
