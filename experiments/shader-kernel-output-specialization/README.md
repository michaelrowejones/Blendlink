# Output-aware scalar kernel specialization

Research only. This adds no SDK admission, node support or production precision change. The generic compiler library, adapter and benchmark artifacts remain frozen.

The Noise wrapper requests only Fac: it calls the retained `node_noise_tex_fbm_3d` with `compute_color = 0`, initializes the unused Color argument and returns the scalar value without reading Color. Blender's native `noise_fractal_distorted` already guards both additional color evaluations with that flag. Parameters remain 3D normalized FBM, Scale 5, Detail 2, Roughness 0.5, Lacunarity 2 and Distortion 0.

The Voronoi wrapper returns the retained 3D `voronoi_f1(...).Distance`. Preconditions are F1, Euclidean, Detail 0, Normalize false, Scale 5, Randomness 1 and the recorded remaining defaults. In the original fractal wrapper, Detail 0 makes `zero_input` true; the first iteration evaluates F1 at coordinate × 1, copies its result and breaks. Normalization is disabled, and final position division does not affect Distance. No neighbor search, hash or distance equation is rewritten.

`adapter-specialized.mjs` requires explicit `projection: 'scalar'`. Only lane 3 carries qualified Fac/Distance; other lanes have no Color contract. Both implementation modes expose the same scalar semantic metadata. Hand mode delegates to the unchanged existing-production builder. Implementation-specific output selection is separate metadata.

The original canonical library SHA is unchanged. Naga's retained internal functions shrink from 43 to 28; WGSL from 64,609 to 31,517 bytes and GLSL ES from 72,657 to 35,405 bytes. These are source metrics, not execution timings. The approved exact FLT_MAX spelling compatibility rule remains, with one occurrence in this smaller module.

Generate into a fresh namespace:

```sh
python3 experiments/shader-kernel-output-specialization/generate.py --canonical /tmp/scenetoweb-shader-kernel-next-build/generated-r5 --naga /tmp/scenetoweb-shader-kernel-build/naga/naga-cli/30.0.2/bin/naga --out /tmp/new-output-aware-module
```

The current module is `/tmp/scenetoweb-shader-output-specialization-r1/module.json`. The separate throughput benchmark owns numerical closure and timing evidence against the unchanged native 64-input references and gates. This source checkpoint makes no independent timing claim.

Original Blender shader bodies and notices remain intact, including Voronoi's `MIT AND GPL-2.0-or-later` attribution. Generated shader derivatives are not relabelled MIT.
