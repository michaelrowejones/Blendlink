# EEVEE look regression suite

Run from the repository root:

```powershell
$env:BLENDLINK_BLENDER_PATH = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
npm run test:eevee-look
```

The runner creates disposable Blender reference scenes, evaluates the shipped
Python extractors and TypeScript builders, and compares float render targets on
native WebGPU and Three's WebGL2 backend. It requires Blender's bundled NumPy
and PyOpenColorIO, a working browser GPU, and the `agent-browser` CLI (resolved
through npx). Blender 5.2 LTS `fbe6228777e7` supplied the reference measurements.
The modern compositor socket schema is version-specific; this is not a claim
of identical support across every Blender release.

Use `npm run test:eevee-look -- --reuse` to reuse generated references while
iterating on browser code. Results and all generated assets stay under
`artifacts/verification-look`; originals are never opened or saved by the suite.
The temporary Vite server and test browser session close when the runner exits.

## Gates

Each backend runs 93 cases: 91 numerical comparisons and two expected named
Fog Glow refusals. A refusal is not counted as a successful image translation.

| Fixture | Cases per backend | Maximum absolute error allowed |
| --- | ---: | ---: |
| OCIO display, 4,096 HDR/negative/gray inputs each | 3 | 0.00003 after display clamping |
| Blender PNG transparency, including alpha-zero emission | 3 | 0.00003 |
| Connected compositor color/math/mix/alpha and derived constant images | 20 | 0.000004 |
| Gaussian/Bloom, quality levels, odd dimensions | 43 numerical + 2 refusals | 0.00004 in linear HDR |
| Tangent normal fields, attribute and derivative bases | 20 | 0.0005 |
| Perspective/orthographic Depth, off-axis and background | 2 | 0.0001 in scene units |

The display gate also records unbounded HDR error. Standard display can exceed
one, where larger float errors do not change the clamped display result. The
normal tolerance includes Blender's stored half-float normal precision. Depth
tests sample interior and background pixels; they do not certify matching edge
coverage, transparent depth or antialiasing. WebGPU readback row padding and the
WebGL framebuffer orientation are handled explicitly.

The 27 Bloom quality cases include all three quality levels and multiple sizes
at 8×8, 31×23 and 32×24. The implementation follows Blender's downsample,
Karis weighting and upsample chain. Fog Glow requires a different kernel and
must remain an explicit refusal until independently implemented and measured.

## Preview failure and recovery

Start Preview Studio with a disposable compiled scene, then run:

```powershell
node experiments/eevee-look-differential/preview-recovery.mjs http://127.0.0.1:5173
```

This checks initial shader failure, recovery, retaining the working canvas after
a failed candidate, replacement after a corrected candidate, and graphics-loss
recovery through **Retry preview**, without another Blender save, on both
backends. Test-only initialization hooks corrupt shader source
and intercept acknowledgements without changing the compiled files or writing
Preview Studio status. The WebGPU loss test destroys the real device and changes
the loss reason to exercise Three's unexpected-loss callback; ordinary deliberate
device destruction is ignored by Three. The WebGL test uses `WEBGL_lose_context`.
Saved evidence contains counts and assertions, never the local acknowledgement
token. Canvas counts verify candidate cleanup, not complete GPU heap accounting.

## Boundaries

Numeric node tests do not establish whole-scene EEVEE identity. Shadows, indirect
lighting, refraction and multi-closure BRDF response can still differ. Normal
tests cover supported tangent fields, including mirrored objects and strength;
named-UV, object/world Normal Map and Bump remain explicit refusals. Scene-pass
Normal, emission, masks and named AOV extraction remain future work; the pass
oracle retains reference measurements to support it. Logarithmic/reversed depth
buffers do not use the source Depth mapping.

The headless addon tests `automatic_material_translation_check.py` and
`compositor_graph_check.py` cover hybrid export restoration, separate engine
outputs, animation refusals, groups, shared branches and muted/rerouted inputs.
The package's existing dynamic object-attribute and scene animation paths remain
separate from unsupported shader/compositor F-curve transport.
