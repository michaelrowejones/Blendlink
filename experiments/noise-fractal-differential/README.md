# Native Noise fractal parity

This proof builds real Blender material graphs, records their emitted live IR,
and compares native Cycles CPU and EEVEE pixels with the production TSL builder
on WebGPU and the WebGL2 backend of WebGPURenderer. No browser material is baked.

```sh
BLENDLINK_BLENDER=/absolute/path/to/blender \
BLENDLINK_NOISE_EVIDENCE=artifacts/verification-noise \
node experiments/noise-fractal-differential/run.mjs
```

`--built` checks emitted package JavaScript after a coordinated build.
`--reuse-reference` replays native references. Every production module is frozen
before the test. The shared built guard independently emits the entire TypeScript
program and checks all modules, including dependency-inlined constants and the
reviewed package import rewrite. Reports retain module/native-helper hashes,
actual source snapshots, native version/device, per-case render/readback time,
measured errors and failures. Vite watching/HMR is disabled.
`BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON array of browser flags.

The first batch adds **unnormalized FBM**, using the new `noise_fractal` opcode so older runtimes refuse this capability.
Legacy `noise` documents retain their normalized interpretation, including their
previous handling of extra annotations. Both Factor and Color work
in 1D/2D/3D/4D; 4D scales Vector and W together. Static controls can fold through the
existing supported constant plumbing. Roughness above 1, dynamic fractal controls
and unsupported inputs retain explicit refusals. Native Noise clamps negative
Detail to 0 and negative Roughness to 0, unlike Wave's separate raw fBM call.

The newly proved raw domain is Detail 0..6 (negative values follow native zero
clamping), Roughness 0..1 (negative values follow native zero clamping),
|Lacunarity|<=2, |Distortion|<=1 and the existing effective-scale bound<=80.
Dimension-specific frequency approximation bands measured for normalized FBM
are not granted to this signed field. Nonfinite controls and unproved ranges
refuse in the emitter and runtime. The remaining four fractal modes are not
claimed by this first batch.

Native material constant evaluation and shader evaluation have different offset
rounding. Modern MF-eligible literal graphs use the native float-staged
uint/hash conversion, multiplication and addition. The four-dimensional native
path also uses separate float operations. Other shader graphs retain their
proven folded offset values; the IR carries the concrete offsets. Native stage
classification distinguishes image/object inputs from MF constants even when
these happen to be spatially uniform. Regression cells cover the high-octave
Color cases that exposed this distinction. Eight additional EEVEE residual
controls first capture a coarse half-target baseline, then subtract that exactly
half-representable baseline in the authored graph and amplify the residual 16x.
Their raw precision is about 3e-5 rather than the coarse target's approximately
0.008; the original primitive/target budget stays unchanged. This catches a
4D offset error that ordinary half-target output could hide. Old normalized exports retain their
prior behavior. The raw loop also reproduces float32 amplitude/frequency updates.
Reusable named 1D/4D Perlin functions avoid expanding their integer hash bodies
independently for every lane and octave.

The corpus of 334 graphs includes every dimension, Color/Factor, literal and
nearest-image-driven coordinates, integer/fractional/negative Detail, negative
linked Roughness, nonbinary/negative/zero lacunarity, both distortion signs and
scale-bound endpoints. Image inputs are exactly half-representable and an
independent carrier verifies them. Signed fields pass through an authored
positive affine transform (scale 1/16, bias 1/2) because native Emission/bake output
cannot carry negative values. That transform is part of both actual graphs.
Reports provide both mapped error and its derived raw-field error; they do not
mistake the mapped number for an unscaled HDR accuracy claim.

The mapped maximum absolute error budget is 2e-5. EEVEE additionally permits one
independently verified final-target half ULP; node arithmetic is separate from
that native target conversion. No UV rasterization allowance or generic browser
intrinsic allowance is added. Local native EEVEE evidence uses Metal; hosted
software OpenGL remains a separate platform gate. Legacy WebGLRenderer cannot
consume live TSL programs.

Admission regressions run with:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/noise_parameter_admission_check.py
```

The implementations follow Blender's primary
[fractal noise](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/fractal_noise.h)
and
[dimensional/color noise](https://github.com/blender/blender/blob/v5.3.0/intern/cycles/kernel/svm/noisetex.h).

All 334 graphs passed on each native Blender 4.2/5.2/5.3 and both browser backends. A fresh 5.3 native run against the built package also passed all 334 after the whole-program semantic byte guard checked 102 production modules. Cycles mapped maximum 9.358e-6; the report records the corresponding unscaled field error rather than reusing that number as a raw HDR claim.
