# Native primary-surface geometry fields

This suite compares actual Blender camera renders with the production material
compiler, Final export, GLTFLoader, installer and browser shader. It certifies
the channel functions below, rather than a complete Blender lighting or BSDF look.

| Node | Live outputs in this batch |
| --- | --- |
| Geometry | Position, Normal, True Normal, Incoming, Backfacing |
| Texture Coordinate | Camera, Normal, Window, Reflection |

Texture Coordinate's existing UV, Object and Generated routes remain separate.
Geometry Parametric, Tangent, Pointiness and Random Per Island remain unsupported.

## Reproduce

Use Node 24 and an actual Blender executable. Run from the repository root:

```sh
npm run build
BLENDLINK_GEOMETRY_BLENDER=/path/to/blender \
BLENDLINK_GEOMETRY_NATIVE="$PWD/artifacts/verification-geometry" \
node experiments/geometry-context-differential/suite.mjs --built
```

The default profiles are `shared,single,flat,hq`; `--profiles shared` selects a
smaller complete integration check. `--reuse-native` retains measured references
and source scenes while repeating Final export and browser verification. It
requires the exact native fixture-script hash. Every built export also requires
byte-identical shipped/source Python, and the browser uses an immutable runtime
snapshot with whole-program TypeScript output equality checks. Edits cannot be
certified against a stale build. All native processes use factory startup and
leave the user's installed extension and preferences alone.

For the focused source/exporter safeguards:

```sh
/path/to/blender --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/geometry_export_check.py
node packages/blendlink/scripts/run-vitest.mjs \
  packages/blendlink/src/tslGeometryContext.test.ts
```

## Earned coverage

Blender 4.2.0, 5.2.0 LTS and 5.3.0 each passed all four profiles against actual
WebGPU and forced WebGL2 through Three's WebGPURenderer. Each version exports
64 real Final scenes and evaluates 3,360 RGB field/control cells per browser
backend: 960 shared smooth, 480 single-owner smooth, 960 flat and 960 HQ-normal
cells. Across the three versions this is 20,160 readbacks, including the
independent RGB calibration controls; these are not separate node-type counts.

The scenes cover parented nonuniform and reflected object transforms, animated
owners and camera, front/back faces, perspective/orthographic cameras, positive
nonuniform camera scale, custom split normals, and both glTF Y-up and raw Blender
Z-up exports. The third frame changes only one owner while the other owner and
camera remain fixed. Its exact native references and browser results verify
that a shared material's live transform uniforms do not leak between owners.

The retained reports are `artifacts/verification-geometry-final{42,52,53}/results.json`
and each profile's `browser-report.json`. Cycles' maximum absolute encoded RGB
error is 1.696e-5, within the fixed 2e-5 raster allowance for its independently
selected BOX filter of width 0.01. EEVEE adds one native final half-float ULP,
calibrated by an unrelated constant RGB control; the largest absolute error is
9.714e-4. No backend/fixture tolerance was widened to obtain these results.
Native EEVEE rendering here uses Metal; Linux/OpenGL and other native driver
certification are separate work, even though both browser backends pass.

## Native contracts

Blender's stock glTF exporter rounds normals before deduplication. A scoped,
version-checked exporter adapter reads exact native split normals before that
step, without modifying the source mesh, and restores the exporter even on
failure. Final tests check source `.blend` hashes and assert the actual loaded
Float32 position and normal components per material/corner. POSITION/NORMAL
quantization is skipped for scenes carrying these fields; lossless Meshopt
compression and exact UV transport continue.

Cycles 5.2+ uses native two-component octahedral corner-normal storage, whereas
4.2 uses float normals. Cycles additionally transforms, normalizes and re-packs
single-user smooth vertex normals **before** interpolation; shared meshes keep
local normal interpolation and transform afterward. The compiler records that
source-scene model before private export copies can change mesh users. Flat
Cycles faces use geometric normals without corner packing. These models follow
[Cycles packed normals](https://github.com/blender/blender/blob/v5.2.0/intern/cycles/util/types_normal.h),
[mesh transforms](https://github.com/blender/blender/blob/v5.2.0/intern/cycles/scene/mesh.cpp),
and [single-user transform application](https://github.com/blender/blender/blob/v5.2.0/intern/cycles/scene/object.cpp).

EEVEE uses signed normalized 10-bit or HQ 16-bit corner storage, normalizes the
world-transformed result in the vertex stage, then normalizes the interpolation
in the fragment stage. Merely applying a normal matrix after interpolation is
incorrect under nonuniform transforms. See the native
[vertex stage](https://github.com/blender/blender/blob/v4.2.0/source/blender/draw/engines/eevee_next/shaders/eevee_geom_mesh_vert.glsl),
[fragment initialization](https://github.com/blender/blender/blob/v4.2.0/source/blender/draw/engines/eevee_next/shaders/eevee_surf_lib.glsl),
and [normal-buffer extraction](https://github.com/blender/blender/blob/v5.2.0/source/blender/draw/intern/mesh_extractors/extract_mesh_vbo_lnor.cc).

## Explicit remaining domains

- Primary, nondegenerate triangle surfaces only; no secondary ray, strand,
  volume, generated/GPU instance, skin, morph, animated mesh-data, enabled
  modifier, Simplify Normals or material-displacement binding.
- Normals must be unit length with outward triangle cosine above 0.05. Object
  matrices must be finite and invertible, with linear/inverse components at
  most 1e8 and Frobenius condition bound at most 100. These bounds keep packed
  interpolation away from undefined normalization. Source, Final, installer
  and live-draw checks enforce the corresponding binding requirements.
- Cycles normal outputs refuse mixed flat/smooth topology, mixed shared/single
  material bindings, subsurface/displacement geometry-key exceptions, motion
  blur and animated render visibility. Transform animation remains live.
- View-dependent outputs need a perspective/orthographic active camera. Native
  reflected/sheared camera projections and authored lens shift/render crop
  are not certified. Three's camera scale removal differs from Blender for
  reflected/sheared camera matrices; this batch preserves that separate gap
  instead of introducing a broad renderer change. The actual active browser
  camera is checked on every draw; no saved camera snapshot substitutes for it.
- A refusing primary geometry channel cannot silently fall back to an automatic
  UV bake: its bake-ray context changes these functions. The artist receives a
  named context diagnostic. Source node graphs remain intact.

These are partial node implementations with tested live routes, not claims of
all-output, arbitrary-scene, native-driver or whole-render parity.

## Source active-render UV

Set `BLENDLINK_GEOMETRY_ACTIVE_UV=1 BLENDLINK_GEOMETRY_ENGINE=EEVEE` to run
the dedicated source-UV corpus with `suite.mjs --built --profiles shared`.
Two meshes share four source materials but choose different active-render UV
slots; edit selection deliberately points elsewhere. Actual native RGB covers
Texture Coordinate UV, unnamed UV Map, named EditUV and unlinked Image Texture
coordinates. The independent RGB orientation marker is outside its mirrored
footprint and refuses ambiguous calibration.

Blender4.2/5.2/5.3 each pass eight actual Final GLBs and240 readbacks per
WebGPU/WebGL2 backend:1,440 total readbacks. These include both coordinate bases,
perspective/orthographic front/back and three owner/camera frames. Maximum
encoded RGB error is0.0004888773 within the unchanged2e-5 plus independently
verified native final-half-target ULP. Source files remain unchanged.

`active_uv_binding_check.py` additionally verifies missing/out-of-range render
UV refusal, read-only edit/render selection and a real hybrid export with baked
roughness plus a live source-UV Base Color channel. Legacy serialized `uv` stays
UV0; only fresh `uv_active` requires the explicit owner binding.
