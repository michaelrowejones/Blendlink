# Blendlink showcases

Real Blender scenes shipped to three.js through the full Blendlink
pipeline — fidelity routing, appearance atlas bakes, per-channel
Material bakes with TSL IR evidence, meshopt, WebP/KTX2 delivery, and
the generated typed runtime.

## cube-diorama (working)

The classic Blender "cube diorama" atelier. `mark_fidelity.py` applies
the fidelity decisions headlessly on the copied scene:

- 15 Principled-rooted materials → per-channel Material bake
  (+ `blendlink_tsl_ir` evidence riding the plan).
- Everything else → the Appearance atlas (1024², density 24, Cycles
  16-sample denoised), including the furniture frozen into the still
  diorama.
- Curated out, each for a compiler-named reason the gate is RIGHT to
  enforce: the porcelain/glass pieces (Layer Weight/alpha are
  view-dependent — no honest static carrier), the potted bluebell
  (transmission + multi-slot receiver), the cat (view-dependent blanket
  + subdivision), the books (degenerate polygon defeats planar atlas
  rescue), the ladder (displace modifier).

Result: 41 nodes, 2.31M triangles, ~11 MB delivered. Run it:

```bash
cd showcases/cube-diorama && npx vite
```

To regenerate from the source copy:

```bash
blender --background scene/cube_diorama.blend --python mark_fidelity.py
node ../../packages/blendlink/dist/cli.js compile --force
```

## ellie (scaffolded — needs Phase 4)

The Ellie character scene is scaffolded but deliberately not compiled:
an animated, armature-deformed character cannot take the appearance
atlas (deforming meshes), and her 27 paint-stroke Mix-Shader materials
with 2048² textures are exactly the population the Phase 4 TSL runtime
(Track C: texture_ref transport + tslMaterialRuntime application) is
designed to carry. Shipping her through a lossy route today would
contradict the fidelity gate this product is built on. She is the
Phase 4 acceptance scene.
