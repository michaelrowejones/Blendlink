# Source-static Noise Color specialization

Research only: no production admission, Sheet change or node support promotion.

The source model is fixed 3D normalized FBM with Scale 5, Detail 2, Roughness 0.5, Lacunarity 2 and Distortion 0. Six native offset words for seeds 3/4 are bound to the closed Blender 5.3, build `02f0899d78e3`, Apple M5 Pro Metal helper profile. The table is re-exported from its native closure and checked against the original raw data, source library, report and exporter pins before generation.

The generic library remains byte-identical. A derived clone changes exactly two `random_offsetTfloat3(seed_base + 0/1)` call spans into exact bit-pattern constants. The source fixes `color_seed_offset(vec3)` to 3. A derived entry changes only its name and helper callee. No global regex, kernel equation rewrite, pixel repair, per-fragment software FMA or extra render target is used. The reader independently reconstructs the permitted edits and checks the original byte prefix.

Results use the original 64 raw inputs and native reference packets with the unchanged conjunctive `abs ≤ 2^-20 AND ULP ≤ 8` gate:

| Graph | Metal WebGPU | Metal WebGL2 |
| --- | --- | --- |
| Full Noise RGB + Fac | Pass, maximum 1 ULP | Bit-exact |
| Noise → Noise | Pass, maximum 4 ULP | Bit-exact |
| Noise → Voronoi F1 | **Fail: one Distance word, 13 ULP** | Bit-exact |

All eight draws completed with exact input controls and zero retained textures. There are 1,536 primary words, 83 word differences and one gate violation; maximum absolute difference is `3.8743019104003906e-7`. No gate was widened. This aggregate remains failed. Actual EEVEE full Noise Color is independently tied to the native reference by a separate 256-word exact material crosscheck. It does not qualify arbitrary field inputs or error propagation through other graphs.

Six CPU source-mutation tests passed. An initial CPU assertion expected one FLT_MAX occurrence but the unchanged general Voronoi closure retained three; the known exact spelling adapter now checks that census. The failed attempt remains retained.

CPU replay (expected nonzero exit and a failed result):

```sh
node experiments/shader-static-noise-color/verify.mjs /tmp/scenetoweb-shader-static-noise-color-r2 /tmp/scenetoweb-shader-static-noise-color-browser-r1 /tmp/scenetoweb-native-kernel-direct-r4 /tmp/new-static-color-close.json
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s experiments/shader-static-noise-color -p '*_test.py'
```

`generate.py` documents required canonical/table/authority/tool arguments through `--help`. GPU capture requires a serialized lease. Original shader notices and GPL-derived attribution are retained; generated bodies are not relabelled MIT. `evidence.json` records exact sources and retained outcomes.
