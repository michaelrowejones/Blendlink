# Native material Curve Mapping parity

This suite renders actual Blender Float Curve, Vector Curves and RGB Curves graphs, exports their production IR, and evaluates that IR through the production TSL builder on WebGPURenderer's WebGPU and WebGL2 backends. These are live node translations. The transported native curve tables contain the artist's curve definition; they are not baked scene textures.

The 191 graphs cover Cycles and EEVEE, native constants and object-attribute shader inputs, negative and HDR values, Factor 0/0.35/1/negative/>1, linked Factor, horizontal and extrapolated extension, clipping, non-unit and unequal channel domains, Standard and Film Like tone, ignored shader black/white levels, identity-channel optimization, nested curves, and dense nearest-image inputs. The image control compares the exact input carrier independently. Dense input values are representable in both float32 and half; nearest sampling at texel centers removes UV rasterization from the numerical budget.

The shader evaluation models are intentionally distinct:

- Cycles uses its native 257-entry table, shared first/last-point domain, and endpoint-table extrapolation. RGB composition is sampled as Channel(Combined(x)).
- Blender 5.0+ folds eligible constant material subgraphs before either Cycles or EEVEE export. This path uses native per-curve tables and analytic extrapolation; Float Curve clips Y when enabled. RGB evaluates Combined then Channel separately. Shader-stage inputs retain the live shader path even when an object property is uniform.
- EEVEE shader evaluation uses native per-channel GPU color bands, independent channel ranges/slopes and the identity-RGB shortcut. Blender 4.2/5.2 use RGBA16F tables; 5.3 uses RGBA32F. The shared color-band helper preserves the native upload, interpolation and sample precision metadata. On 4.2, a native cache-span inconsistency for points outside the clip rectangle is reproduced explicitly; the source implementation changes in 4.3.

Native shader RGB Curves ignores the Curve Mapping tone and black/white settings; the actual Standard/Film Like and black/white cases prove this behavior. This does not describe compositor RGB Curves, which has a separate coupled Film Like implementation.

Extraction reads an owned copy of Curve Mapping and releases it in `finally`. It does not change the artist's points, clipping, tone, selection or node-tree IDs. The source engine follows the selected Material Output target; an ALL target follows the source scene. Unknown engines, opaque constant-evaluation eligibility, nonfinite tables and collapsed domains refuse explicitly. Animated curve definitions retain the existing animation refusal. Old published `curve_rgb` documents remain readable by the runtime compatibility handler.

Every run captures immutable TypeScript/JavaScript and native Python module snapshots before invoking Blender. The report records the tested runtime and native module hashes. Native Cycles is CPU-only in this suite. EEVEE runs its native GPU material graph; local evidence uses Metal. The hosted Linux gate covers its available GPU backend separately.

## Running

From the repository root, with dependencies installed:

```sh
BLENDLINK_BLENDER=/path/to/Blender \
BLENDLINK_CURVE_EVIDENCE=artifacts/verification-curve-nodes \
npm exec --yes --package=node@24 -- node experiments/curve-node-differential/run.mjs
```

Use `--built` after a coordinated package build to test emitted modules. `BLENDLINK_TEST_CHROMIUM_ARGS` accepts a JSON array of additional Chromium arguments. `--reuse-reference` reuses the recorded native IR/pixels and their original native-module hashes, while taking a fresh runtime snapshot. It is useful for diagnosis; a release proof should generate fresh native references.

The numerical budget is `6e-6` for Cycles fixed/dense inputs. EEVEE adds at most one independently verified half-float scene-render-target ULP per reference value. That allowance concerns the native final scene target; the curve node's own table/filter precision is modeled inside the production shader. No UV allowance is used.

Additional read-only and package seams are checked with:

```sh
/path/to/Blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/curve_translation_check.py
```

The native test exercises both ordinary source modules and package-qualified modules staged with the actual flat extension layout. `tslCurveNodes.test.ts` covers model/schema refusal, table resource ownership, deduplication and compatibility with old documents. `node_mode_refusal_check.py` retains the separate native legacy compositor alpha test and now checks shader-tone transport.
