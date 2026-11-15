# Actual EEVEE Noise Color material crosscheck

The working twelve-frame EEVEE fixture is reused with only its case contract changed from radial Gradient to normalized 3D default Noise. The fresh actual material agrees **bit for bit** with the independently closed native source-kernel reference: all64 R, G, B and Fac values,256 words total. The predeclared gate remains absolute error≤2^-20 **and**≤8ULP; actual errors and violations are zero. This is an experimental source/material relation, not a production port or support promotion.

The pinned native profile is Blender5.3.0 build `02f0899d78e3`, Metal on Apple M5 Pro. Noise settings are3D fBM, Scale5, Detail2, Roughness0.5, Lacunarity2, Distortion0, Normalize=true. Exact64 dyadic input vectors are unchanged from the original native-r4 corpus. A nearest Non-Color Float32 image supplies Window coordinates on an oversized orthographic emissive quad; the independent coordinate frame proves input/orientation before any Noise capture.

Three frames first validate coordinates and a two-plane HALF-safe digit carrier (zero, tiny normal, adjacent and ordinary values). One range guard and eight scalar digit planes then capture Color.r/g/b and Fac independently. Film alpha remains1 and is not mistaken for Fac. The arithmetic carrier admits only +0 or positive values≥2^-42 and<2; it cannot establish zero-sign parity. The reader independently reconstructs every scalar from the stored digit-plane raw files, checks the saved material/settings and source pins, and relates it to the exact native-r4 report/raw plus its pre-existing closed receipt. Invalid direct-r3 zero outputs are not inputs to this comparison.

The fresh namespace is `/tmp/scenetoweb-noise-color-material-eevee-r1`; its decoded `noise-fbm3-default.kernel-rgba32f` SHA256 is `24bb31fcc1d5a68a199dfa369542ab37fe5c2174b207066f4069a484a6f33de0`, identical to native-r4. Twelve renders sum to2601.59ms; the guarded process takes4143.16ms including startup, saving and extraction. These are wall times, not GPU performance measurements. GPU ownership was released immediately after the native process exited.

An additional **source-only** authored derivative is saved as `noise-warm-cool-ramp-emission.blend`: Noise Fac→linear ColorRamp→Emission, with dyadic blue/orange stops. It reuses the exact input image and default Noise settings. It consumes zero additional renders and grants zero composition, appearance or runtime credit. It is a concrete artist-style next integration scene; the present crosscheck proves the input Noise field only.

No SDK, old evidence, capability metadata or coverage changed. CPU mutation tests reject raw-byte tamper, reordered calibration/capture rows, and changed Noise settings. Generated browser targets can compare to these same raw words, but no browser/backend or saved Final acceptance is inferred here.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/noise-color-material-crosscheck/run.mjs \
  /tmp/FRESH-eevee-noise-color
PATH=/tmp/mrj-tooling:$PATH node experiments/noise-color-material-crosscheck/verify.mjs \
  /tmp/scenetoweb-noise-color-material-eevee-r1 /tmp/FRESH-noise-color-close.json
EEVEE_NOISE_COLOR_CORPUS=/tmp/scenetoweb-noise-color-material-eevee-r1 \
PATH=/tmp/mrj-tooling:$PATH node --test experiments/noise-color-material-crosscheck/verify.test.mjs
```

Replay the original owned capture from `/tmp/scenetoweb-noise-color-material-crosscheck`: native launcher receipts bind its absolute invoked script path. A different checkout must not claim to have been that original invocation. `evidence.json` pins source scripts, report, closed result and all captured files; outputs stay outside tracked source.
