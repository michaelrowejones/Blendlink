# Animation + deformation browser differential (prototype)

Question: does one scene exported by Blendlink preserve Blender-evaluated object
transforms, a two-bone skin, and an animated morph target when loaded, played,
rendered, and disposed through Blendlink’s production Three.js installer?

Run:

```powershell
node experiments/animation-deformation-browser/run.mjs
```

The command generates `output/animation-deformation-fixture.blend`, samples a
nine-time Blender 5.2 dependency-graph oracle (five keys plus four fractional
subframes), exports the same file with the production Blendlink exporter,
loads it through `installThreeCompiledScene()` in Chromium, and writes
screenshots plus `output/evidence.json`.

The fixture compares a bidirectional world-space point-set Hausdorff distance
instead of vertex indices. That is deliberate: Blender’s official glTF manual
notes that triangulation and attribute seams may duplicate exported vertices.
It reports authored-key maxima separately from fractional-subframe maxima:
Blender’s component-curve quaternion evaluation and glTF `LINEAR` quaternion
interpolation are a small bounded approximation between sampled keys, not a
byte-identical operation.

Primary contracts used:

- [Blender 5.0 glTF animation/export manual](https://docs.blender.org/manual/en/5.0/addons/import_export/scene_gltf2.html):
  core exportable animation is object transforms, pose bones, and shape-key
  values; skinning and morph-target export are explicit data options.
- [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html):
  skinning is joint-hierarchy animation plus weighted joint transforms, and a
  morph animation channel targets the mesh’s target weights.
- [Three.js `AnimationMixer`](https://threejs.org/docs/pages/AnimationMixer.html):
  `update(deltaTime)` advances every scheduled action on the mixer.
- [Three.js `Mesh.getVertexPosition()`](https://threejs.org/docs/pages/Mesh.html):
  `getVertexPosition()` returns the transformed vertex position after morph and
  skinning, which is the runtime-side deformation oracle used here.

This is Blendlink-side evidence, not Needle parity evidence. A coherent Needle
stack must run the same GLB independently before any Match/Improvement claim.
