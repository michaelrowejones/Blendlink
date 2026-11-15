# Actual Noise Color export and installed-preview pilot

**Current production path works; no SDK fix was needed.** This experiment owns one saved Blender scene and tests its actual default Final export/public Three installer. It adds no opcode, compiler admission, support promotion or runtime replacement. Base: `c185db3`.

## Production offset finding

For this Blender5.3 EEVEE/Metal **varying UV**, normalized3D FBM Color graph, `tsl_ir.py` chooses `evaluationModel:shader`, `perlinModel:eevee-metal-periodic-f32`, and `offsetModel:shader-folded`. `_noise_shader_offset_profile` returnsNone on Metal; the fused helper selector is Cycles-specific. The production emitter serializes its original double-folded constants, which become these Float32 words in TSL:

```
seed3:1126527486 1126352042 1128360077
seed4:1125881015 1127294870 1124738009
```

All six already match the independently captured native Metal offset table. The experimental staged compiler branch produced1128360078 for seed3/lane2; production emits1128360077. `audit.py` executes the actual pure helper AST bodies, and the saved-scene/source-plan and published sidecar independently confirm the exact production values. This does **not** establish a general FMA law, or transfer to MF/Cycles/4D contexts.

Trace: source `packages/blender-addon/tsl_ir.py:207,233,2617–2740` → `material_compiler.plan_materials(automatic_programs=True)` → built `syncAll` default Meshopt export → pinned `materialPrograms` sidecar → `tslMaterialRuntime` → `tslNodeRecipe.ts:1133` → actual `startThreeCompiledScenePreparation(...).commit()` installation. Existing source admission stays unchanged; no custom experimental TSL operation is injected.

## Owned scene and measured outcome

`fixture.py` authors an opaque UV plane, default3D normalized FBM (Scale5, Detail2, Roughness.5, Lacunarity2, Distortion0), Noise **Color**→Principled Emission Color, strength1/base0, Raw view, orthographic camera and explicit realtime intent. The source is saved before planning; source bytes remain unchanged through export, reference capture and browser checks. The no-render planning pass guards GPU initialization/render APIs and records zero calls. Default publication retains the emitted Noise IR exactly; all canonical packaged Python/addon source bytes match the own build.

Native reference: four actual M5 Pro EEVEE renders—Color and independent UV control at64²/128². Browser: both actual Metal WebGPU and WebGL2 load the generated descriptor/assets through the public installer, apply one actual NodeMaterial/emissive graph with zero skipped channels, and render the real imported mesh/camera. Independent UV calibration temporarily uses its own material, restores the installed material before Noise comparison, and changes no expected pixels.

CPU reader recomputation passed **327,680 Float32 words** (163,840 Color +163,840 UV). Both UV sizes and Color64 are exact. Color128 differs at four single-channel pixels/API; maxAbs **.00048828125**, within the unchanged existing EEVEE field/half-film gate2^-10. Alpha is exact1. No pixel cropping, masks, gamma fitting or expected-value repair.

The live default128² canvas is separately captured using its **actual `toDataURL`**, not CPU-blitted validated data. Both APIs pass131,072 total RGBA8 channels against the native Raw Float32 reference under the predeclared one-byte quantization+2^-10 float allowance; max normalized error.0023265165, zero violations/alpha differences. Native-reference display PNGs are plainly generated from the actual native EXR32 words. Both presentation panes use320CSSpx,128² source extent, pixelated scaling. Live screenshots are taken before cleanup; actual scene restoration then passes.

This is an opaque emissive material/UV/Raw pipeline proof. It earns no wider PBR lighting, world, transparency, engine, platform, parameter-range or whole-scene equivalence claim. Numerical and presentation evidence remain distinct.

## Retained artifacts and failures

- Owned source/export: `/tmp/scenetoweb-noise-color-preview-source-r1` (`noise-color.blend`, source plan, actual generated descriptor, GLB, sidecar, separate guarded archives).
- Native refs: `/tmp/scenetoweb-noise-color-preview-native-r1`.
- Successful raw R5 and final R6: `/tmp/scenetoweb-noise-color-preview-browser-r5` /`...-r6`; R6 includes actual canvas PNGs, live comparison screenshots and `closed.json`.
- Browser R1/R2 retain strict Vite alias/canonical allow-list failures. `paths.mjs` admits only each exact logical/physical root, not arbitrary `/tmp`.
- R3/R4 retain the128² mismatch. The initial frame-cache hypothesis was **refuted**: actual frame IDs advanced. The plain research host had used detached preparation's documented `resizeRenderer:false` default, then called `installed.resize` without owning renderer sizing; the drawing buffer stayed64 while the readback target was128. Explicit `resizeRenderer:true` is correct for this owned plain host. The artist one-call installer already defaults true; framework callers intentionally own sizing. No SDK resize bug was fixed.
- R5 numerical checks passed but the canvas's inline64CSSpx differed from the native pane's320CSSpx. R6 fixes presentation only and validates the actual visible canvas, preserving R5.

The global temporary npm launcher was broken; it was left untouched. The isolated build ran the package's declared commands directly (`tsc -p packages/blendlink/tsconfig.json`, then `node packages/blendlink/scripts/copy-assets.mjs`). Dependency entries link installed tools, while `scenetoweb` resolves to this worktree's own package and Vite cache is owned.

## Reproduce

Run CPU audit/tests first. Native renders/browser require a coordinated GPU lease. Outputs must be fresh; existing failures are never overwritten.

```sh
node --test experiments/noise-color-export-preview-pilot/audit.test.mjs
node experiments/noise-color-export-preview-pilot/source.mjs /tmp/new-owned-source
node experiments/noise-color-export-preview-pilot/export.mjs /tmp/new-owned-source
node experiments/noise-color-export-preview-pilot/reference.mjs /tmp/new-owned-source/noise-color.blend /tmp/new-native --render-lease
node experiments/noise-color-export-preview-pilot/run.mjs /tmp/new-owned-source /tmp/new-native /tmp/new-browser --gpu-lease
node experiments/noise-color-export-preview-pilot/verify.mjs /tmp/new-owned-source /tmp/new-native /tmp/new-browser /tmp/new-closed.json
```

Retained CPU replay:

```sh
node experiments/noise-color-export-preview-pilot/verify.mjs /tmp/scenetoweb-noise-color-preview-source-r1 /tmp/scenetoweb-noise-color-preview-native-r1 /tmp/scenetoweb-noise-color-preview-browser-r6 /tmp/new-noise-color-preview-close.json
```
