# Cube Area-light portability, 2026

Research date: 2026-07-22

## Decision

Use an **automatic, engine-aware policy** for Blender Area lights, with two
artist overrides. Missing `blendlink_area_light_mode` metadata on an `AREA`
object selects Automatic; missing metadata on Point, Spot, and Sun does not
enter this policy. The add-on normally represents Automatic by removing the
property. The two persistent overrides are:

```python
light_object["blendlink_area_light_mode"] = "bake-only"
light_object["blendlink_area_light_mode"] = "three-rect-area"
```

Automatic is not an unconditional conversion. It compiles only the proven
static Square/Rectangle subset into a Three `RectAreaLight` for direct lighting
of live PBR receivers. Invalid source facts, engine semantics that Three cannot
represent safely, and ambiguous finalized artifacts retain the baked result and
produce a named bake-only reason. **Bake Only** preserves that result by artist
choice. **Three Rect Area** knowingly accepts the reported semantic
approximations, but still fails loudly when the source descriptor cannot be
computed truthfully. Point, Spot, and Sun remain the portability recommendation:
they use standard `KHR_lights_punctual`, work in non-Blendlink viewers, and keep
Three's available shadow path.

Compile the selected light into an ordinary glTF node extra, not a fake
`KHR_lights_punctual` type and not a manifest field:

```json
{
  "blendlink_rect_area_light": {
    "schemaVersion": 1,
    "color": [1.0, 0.8328028, 0.6855429],
    "size": [0.49, 0.49],
    "power": 3.92699075
  }
}
```

`size` is the unscaled rectangle width and height in the finalized glTF
node's local length units. Exactly one of `power` or `intensity` is present:

- `power` is emitted for Blender lights with `normalize=true`. It maps
  numerically to Three's `RectAreaLight.power`, so total strength stays
  constant when the node or scene is scaled.
- `intensity` is emitted for `normalize=false`. It maps numerically to Three's
  `RectAreaLight.intensity`, so surface intensity stays constant and total
  power grows with the scaled area.

Both strength forms use `energy * 2 ** exposure * direct_scale`, where
`direct_scale` is Eevee's static finite non-negative
`scene.eevee.direct_light_intensity` and is `1` for Cycles. The distinction is
compiled output, not Blender vocabulary leaking into the website. The runtime
derives current world width and height from the marker node's world transform.
This is important because Three 0.184 deliberately removes object scale when
it prepares a `RectAreaLight`; copying the Blender node transform alone
produces the wrong rectangle.

The implemented deep package module, `threeRectAreaLights.ts`, owns the runtime
mechanics behind this narrow interface:

```ts
interface InstalledThreeRectAreaLights {
  readonly report: ThreeRectAreaLightReport
  sync(): void
  auditReceivers(): void
  dispose(): void
}

function installThreeRectAreaLights(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  options?: {
    signal?: AbortSignal
    prewarm?: boolean
    onWarning?: (message: string) => unknown
  },
): Promise<InstalledThreeRectAreaLights>
```

`installLoadedThreeCompiledScene` owns that module. Applications and generated
R3F bindings should not initialize LTC textures, compute dimensions, create
lights, or sequence shader compilation. The installed-scene and R3F handles
may expose only the read-only report. Their existing `update()` path calls
`sync()` before each rendered frame, which makes authored or application-owned
transform changes work without forcing continuous rendering.

This is additive to the existing manifest contract. The generated node-extra
payload has its own enforced `schemaVersion`; the scene manifest schema does
not change.

## Evidence status

The following separation is intentional:

- **Implemented:** `weblights.py` owns one engine-aware plan used by the add-on
  and exporter. Missing metadata selects Automatic for `AREA` only; explicit
  Bake Only and Three Rect Area remain persistent overrides. The completed-GLB
  pass attaches one validated v1 descriptor or records an Automatic artifact
  fallback. `threeRectAreaLights.ts` owns parsing, LTC initialization and
  selected-pair upload, transactional attachment, receiver audit, transform
  sync, cancellation boundaries, and disposal before the final scene compile.
- **Covered by package/add-on tests:** bpy-free policy tests exercise Eevee
  Direct Light scale and animation, engine-specific Spread/node behavior,
  Normalize algebra, source refusals, Eevee micro cull/clamp, Cycles Emission
  color and non-default Strength, closure-factor fallback, the named Eevee LTC
  horizon limitation, and both explicit overrides. Headless tests
  cover the UI's missing-property Automatic state, finalized descriptors, and
  the Collection Instance artifact fallback. TypeScript tests cover descriptor
  validation, LTC ownership, receiver classification, transaction/Strict Mode
  lifecycle, and installer ordering.
- **Verified in installed primary source:** Blender 5.2 omits Area from
  `KHR_lights_punctual` but still exports its transformed object node. Eevee
  consumes data-block color/temperature and scene Direct Light scale, ignores
  Area Spread and the light node graph, and applies the documented micro-light
  cull/clamp boundaries. Cycles is the engine for which the supported constant
  Emission route and Spread matter. Three 0.184 supports one-sided rectangular
  direct lighting for Standard/Physical materials, removes world scale, has no
  RectArea shadows or Eevee cutoff field, and uses globally shared LTC lookup
  textures. The detailed Eevee source audit is recorded in
  [`research-eevee-area-light-parity-2026.md`](research-eevee-area-light-parity-2026.md).
- **Verified in a focused real-browser fixture:** the retained packed-consumer fixture in
  `artifacts/release-dogfood/rectarea-browser-evidence` passed under Chrome
  150/WebGL 2 with no console, page, request, HTTP, or WebGL errors. It measured
  a visible Standard/Physical response, zero Basic-material delta, the
  one-sided front/back result, clean dispose/remount, native float-LTC GPU
  upload, and a forced half-float upload/fallback. That fixture used the earlier
  dynamic initializer import and verifies material/direction behavior, not the
  current bundle-scheduling choice or Blender calibration.
- **Verified with current packed bytes in Cube:** after the static initializer
  fix, both current Cube tuned and Appearance GLBs contain exactly the three
  expected v1 descriptors. Their production Vite pages passed exact response
  hash, WebGL 2, nonzero/nonblank Canvas, and browser-error gates at 1440x900.
  The matched visual matrix records tuned MAE/RMSE
  `0.16598489999`/`0.23768085938` and Appearance
  `0.06720738093`/`0.11718815175`. Those measurements prove current package
  integration and preserve scene evidence; without an otherwise-identical Bake
  Only A/B they do not isolate Area-light calibration or establish image parity.

No claim below means Three can reproduce Blender's Area-light shadows,
multi-bounce indirect light, Eevee/Cycles sampling, or every light-node setting.

## Exact implementations inspected

The installed Blender is **5.2.0 LTS**, build hash `fbe6228777e7`, built
2026-07-14. Its bundled official glTF exporter reports **5.2.39**. The package
and retained Cube consumer both use Three **0.184.0**; the R3F integration uses
React **19.0.0** and `@react-three/fiber` **9.6.1**.

The exact local sources used for the conclusions were:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/blender-addon/weblights.py` | 84,876 | `E1965E87E24F54BF8F42DF354FF448EE7D0B772AFC1DD73248A79B314227971D` |
| `packages/blendlink/blender/export_scene.py` | 218,038 | `2029DD358D8F42DC9A9B368C0FE944FBFD8C32569A2E5815A8334BCE5A93C255` |
| `packages/blendlink/src/threeRuntime.ts` | 71,098 | `8FE38239D5F01060A7815D0DD965820F78F61B51E46EA6E61905C6370C7F5286` |
| `packages/blendlink/src/threeRectAreaLights.ts` | 24,699 | `A177B69755309D17F721C9A31827FC0E9C177BC5BDE86ED1F2F59490C648B70C` |
| Blender exporter `blender/exp/lights.py` | 10,045 | `431E02F42711DE7DBBD896B564A7ACA18987C28D0A6B625665DFFD15A0FF6446` |
| Blender exporter `blender/exp/nodes.py` | 25,850 | `43E09E51A9D200CEEE03E97881769F061AB5AD6D706EABA6B2CEC4F3D3B278EE` |
| Three `RectAreaLight.js` | 2,612 | `3D602AFB9AF5A0D62CC94D2C6DF050DE1778711EFA9312566006E14FA0029D11` |
| Three `WebGLLights.js` | 13,548 | `43C3EDBA697CBD764A82B42901960813BC04A0BE6D6B5B5442E9D592AE43F3A0` |
| Three physical-light shader chunk | 22,120 | `93C6FBB624F9ADBC0AC6EA0B01180A980ED11EEED7686BCADE07B631270E8A9B` |
| Three `RectAreaLightUniformsLib.js` | 1,014 | `494FEF2D731FF1689050CC6040AD78D927C22B9125A12F532BEB0374C2811C6E` |
| Three `RectAreaLightTexturesLib.js` | 314,764 | `6DD4043BB052594357A5EEFF13DC0519F0A80B100B97EC80C12808F887897BC1` |
| Three `GLTFLoader.js` | 114,959 | `97642D720F16CC9A0C9844934198E4D0C023BEA8E89576D0F7545D03B2D103D2` |

The hashes make this record reproducible even if upstream `main` changes.
Primary upstream links are collected at the end of this note.

## What the standards and implementations actually guarantee

### glTF has no Area-light type

`KHR_lights_punctual` defines only directional, point, and spot lights. Light
nodes inherit translation and rotation; the local light direction is `-Z`;
node scale does not affect the light properties. The standard contains no area
shape, source dimensions, surface-normalization mode, or shadow field.
[KHR_lights_punctual][khr-punctual]

Blender 5.2's official exporter enforces this boundary before it gathers a
light: `__filter_lights_punctual` warns and returns false for `AREA`. The node
gatherer still emits the Blender light object as an ordinary node with its
translation, rotation, scale, and children. That is exactly what the Cube GLB
contains. Inventing a private `type: "area"` inside `KHR_lights_punctual` would
produce invalid glTF and mislead every generic loader.

glTF permits application data in `extras`; Khronos recommends extensions for
broadly interoperable behavior and `extras` for application-specific data.
Blendlink's renderer-specific, guarded lowering is the latter. A namespaced node
extra is therefore the smallest standards-honest seam. [glTF extension
registry guidance][khr-extensions]

### Blender's relevant source contract

Direct RNA introspection in Blender 5.2 reports:

- `energy`: light energy emitted over the entire area, expressed as radiant
  power in watts;
- `exposure`: a `2 ** exposure` multiplier;
- `normalize`: divide by light area so total output remains consistent across
  size and shape; and
- `Light.area(matrix_world=...)`: compute area from shape and transform.

The [Blender light manual][blender-lights] describes the same artist-facing
relationship: Area Power is in watts, source shape and size distribute that
power, and larger emitters create broader, softer illumination.

Although the exporter rejects Area before serialization, its installed
intensity implementation is still useful calibration evidence because it owns
the package's current Point/Spot/Sun `COMPAT` contract. It computes:

```text
effective = source energy
effective *= world area                  when normalize is false
effective *= 2 ** exposure
point-or-spot intensity = effective / (4 * pi)
sun intensity = effective
```

In `SPEC` mode the exporter additionally converts watts to lumens; Blendlink
deliberately selects `COMPAT`, avoiding that 683x conversion and matching its
existing presentation fixtures. The implemented adapter follows the same
**numeric COMPAT convention**. It does not claim that a Blender watt is
physically identical to a Three lumen.

Blender's exporter also computes effective color as light-data color multiplied
by the supported constant Emission color and, when enabled, temperature color.
For Eevee it currently ignores the Emission node. The compiler must use the
same engine-aware color policy already diagnosed by `weblights.py`; the runtime
must not try to interpret Blender node graphs.

The subsequent Eevee 5.2 source audit sharpened that policy. Eevee does not
consume Area Spread or the light node graph, but it does multiply the final
direct surface result by `scene.eevee.direct_light_intensity`. Blendlink folds a
static finite non-negative value into descriptor strength and ignores
animation that affects only Eevee-unused Spread/node switches; animation of the
direct scale or effective light data keeps Automatic bake-only. Eevee also
culls a light when the scaled half-width times half-height is below `1e-5` and
clamps each half extent to at least `0.003 m`. Automatic preserves those source
results instead of letting Three illuminate with different dimensions, and the
explicit Three mode cannot force that unproven divergence.

Eevee and Three both use LTC-based rectangle evaluation, but the pinned sources
do not have identical horizon clipping and receiver-facing fades. Blendlink
therefore records `rect-area-eevee-ltc-horizon-approximation` even for an
otherwise safe Automatic descriptor. Grazing angles and rough highlights can
differ; this is an allowed named approximation, not calibration evidence.

Cycles does consume Area Spread and its active light surface. V1 accepts
nodes-off data-block semantics or a direct constant Emission route. Constant
Emission color can be composed with the data/temperature color, but linked,
grouped, or indirect routes are not a closed static fact. Blendlink has not
established the exact Area algebra for a Cycles Emission Strength other than
the default `1`; Automatic therefore falls back to baked output and explicit
Three fails rather than multiplying by an assumed factor. Non-default Cycles
Spread is an intentional Automatic fallback, while explicit Three can accept
it as a named approximation. Non-default diffuse/specular factors also keep
Automatic bake-only. For transmission/volume, zero agrees with Three's absent
direct closure path, the default positive endpoint remains a named limitation,
and an intermediate nonzero authored factor becomes an Automatic fallback.

### Three's RectAreaLight is useful but narrower

Three 0.184 documents `RectAreaLight` as working only with
`MeshStandardMaterial` and `MeshPhysicalMaterial`, requiring
`RectAreaLightUniformsLib.init()`, and not supporting shadows. Its source
defines:

```text
power = intensity * width * height * pi
```

The physical shader's rectangle winding shows that it shines from local `-Z`.
That agrees with Blender and `KHR_lights_punctual`; no correction quaternion is
needed.

The transform detail is less obvious. `WebGLLights.setupView` calls
`extractRotation(light.matrixWorld)` before constructing the two half-width
vectors. Translation and rotation survive, but scale is intentionally removed.
Therefore this is wrong:

```ts
marker.add(new THREE.RectAreaLight(color, intensity, localWidth, localHeight))
// The marker's non-uniform scale will not enlarge the actual light rectangle.
```

The runtime must measure the marker's current world X and Y axes and set the
light's numeric `width` and `height` itself. This behavior also explains why
the descriptor should retain node-local dimensions instead of baking only one
world-size snapshot.

`WebGLLights` includes the RectArea count in its lighting-state hash. A scene
compiled before its RectArea children exist can therefore precompile the wrong
shader variants. The [WebGLRenderer contract][three-renderer] says that target
lighting and environment must be configured before `compileAsync`.

### LTC initialization is a shared resource, not scene ownership

Three's initializer creates four global 64x64 RGBA `DataTexture` objects: two
float textures and two half-float textures. The raw typed arrays total about
192 KiB, while the source module carrying the lookup data is 314,764 bytes in
0.184.0. `WebGLLights` selects the float pair when
`OES_texture_float_linear` exists and the half-float pair otherwise.

`RectAreaLightUniformsLib.init()` is not idempotent. Every call invokes
`RectAreaLightTexturesLib.init()`, allocates four new textures, and replaces
the global `UniformsLib` references. Scene mount/unmount code must not call it
blindly.

The first Vite browser harness reproduced a module-graph failure: a top-level
await of scene installation could wait on a dynamically split LTC chunk that
itself imported shared Three bindings from the still-evaluating entry. The
current production module therefore statically imports Three's official
`RectAreaLightUniformsLib`. It still returns before initializer/allocation/GPU
work when no valid descriptor exists, and a module-level promise serializes the
first real initialization. Inside that promise it re-checks all four
`UniformsLib` slots:

- all four present: reuse them;
- all four absent: initialize once, then verify all four;
- a partial set: throw an artist/developer-readable incompatibility error.

The second check after the async initializer-provider boundary makes concurrent
module copies and hot reload safer: JavaScript promise continuations run
serially, so the later continuation observes the first complete initialization.
The installer then calls `renderer.initTexture()` for the pair the renderer
will actually use. That is a targeted GPU-upload barrier. `compileAsync`
prepares shader programs; it is not a promise that every texture in a scene has
reached the GPU.

The reliability fix has a real scheduling cost. The current Cube Vite build
measured a 1,507.66 kB raw / 455.48 kB gzip main chunk. Total Area payload is
similar to the split design, but the official LTC source is now eagerly
resident with the runtime rather than fetched on first descriptor. That is not
a claim that no-Area consumers are optimized. Measure the Splash/no-Area
penalty before choosing a safer separate entry point or non-cyclic async
boundary; do not restore the reproduced deadlock merely to improve one bundle
number.

The four LTC textures belong to the Three process/application, not an installed
Blendlink scene. Scene disposal must never dispose or clear them. Renderer
disposal remains application-owned.

### Strict Mode exposes lifecycle mistakes

React [StrictMode][react-strict] deliberately performs an extra development
setup/cleanup cycle for Effects. Blendlink's R3F adapter already serializes
installations per Canvas through `slot.tail`, and a stale installation disposes
instead of committing. The RectArea module adds its own idempotent ownership
contract so Vanilla and direct Three consumers do not depend on the R3F guard.

## Cube evidence

The retained tuned fixture is
[`cube-diorama-web-tuned.blend`](../artifacts/release-dogfood/cube-diorama/fixtures/cube-diorama-web-tuned.blend),
11,179,709 bytes, SHA-256
`0200fce4ceb8cf9876d5ddc4386c4d2e95c3d69fbdef943cac9fc7fce0b17280`.
Its current tuned GLB is 10,017,264 bytes, SHA-256
`bc45dd04e56b0b94ed4f85ea73adae48aa0a023d4726cf0a71bc0dc2e86a374e`.
The retained [visual reference matrix](../artifacts/release-dogfood/cube-diorama/visual-reference-matrix.json)
ties that source hash to the [Blender reference](../artifacts/release-dogfood/cube-diorama/blender-reference.png)
and browser captures.

The tuned GLB has 60 nodes and exactly one `KHR_lights_punctual` node,
`Spot_Outside` (light record `Point.003`). Its 2,000 Blender energy becomes
`159.154943` in `COMPAT`, or
`2000 / (4 * pi)`. The three interior Area-light objects remain ordinary
transformed nodes rather than KHR punctual lights, and now carry v1 extras:

| Blender object | GLB node | Shape | Local size | World width x height | `normalize` | COMPAT power | Implied Three intensity |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| `Bounce Light` | `Bounce Light` | square | 0.49 | 1.15718691 x 0.87440204 | true | 3.92699075 | 1.23536511 |
| `Fill Light` | `Fill Light` | square | 0.49 | 0.85555856 x 0.85555856 | true | 3.92699075 | 1.70769586 |
| `Fill Light.001` | `Fill Light.001` | square | 0.49 | 1.41969374 x 1.41969374 | true | 3.14159274 | 0.49614735 |

All three use linear color `[1, 0.8328028, 0.6855429]`, default simple light
nodes, temperature disabled, `spread=pi`, and default diffuse/specular
contribution. None is parented or animated. Their differing non-uniform object
scales are the concrete reason scale handling belongs in the conformance
fixture.

The generated object surface still treats the three sources as sanitized
`Object3D` markers (`Bounce_Light`, `Fill_Light`, and `Fill_Light001`); the
outside Spot is a `Light`. No manifest reshape was needed: Three's
`GLTFLoader.assignExtrasToUserData` copies each node extra into the matching
marker's `Object3D.userData`, where the package runtime consumes it.

An earlier read-only Blender probe rendered the same Studio view layer and camera twice
at 360x225 in Cycles, 32 samples, CPU. With the three Area lights enabled, mean
display RGB was `(60.9078, 50.4599, 38.9795)` and Rec.709 display luma was
`51.8522`. Hiding only those three lights, leaving the outside Spot, produced
`(36.4884, 32.6750, 26.8719)` and luma `33.0667`: a **36.23% luma loss**. This
probe is evidence that the Area direct/indirect contribution is material;
it is not a calibration target for Three, whose model lacks the same bounces
and shadows.

The earlier pre-Automatic browser baseline was correspondingly dark. The tuned
comparison reports MAE `0.1360108` and RMSE `0.1970969` against the Blender
reference. The Hybrid Appearance pass improves those to MAE `0.1184820` and
RMSE `0.1697804`. Those superseded whole-frame values are historical baselines,
not a promise that a RectArea adapter alone closes the gap; current captures
are recorded separately below.

Hybrid Appearance is a particularly good controlled test. Its baked/static
targets use unlit `MeshBasicMaterial`, while exactly three recipe exceptions
remain live PBR objects: `Bird Cage`, `Computer`, and
`Potted Plant - Bracken`. Current Automatic RectArea lowering installs in this
Appearance build while the Basic artwork remains an unsupported receiver by
contract. A masked Automatic-versus-Bake-Only comparison is still required to
measure those three live receivers and rule out accidental global change; the
passing whole-frame capture alone is not that proof.

## Designs compared

| Design | Benefits | Costs and failure modes | Decision |
| --- | --- | --- | --- |
| Artist authors Point/Spot/Sun | Standard glTF, other viewers understand it, Three shadows available, no RectArea initialization or GPU upload | Does not preserve a broad rectangular source; artist may tune a second web light; the current combined runtime still schedules the static LTC source payload | Remains the portability/shadow recommendation |
| Package-owned, guarded Automatic RectArea lowering with two overrides | Preserves broad direct diffuse/specular response for the engine-proven Three PBR subset; unsupported semantics retain baked artwork; compiler owns calibration; tiny site binding | Three-only, PBR-only, shadowless, no indirect bounce; needs engine/source policy, artifact fallback, global LTC lifecycle, and explicit diagnostics | Implemented; missing Area metadata selects this policy, not unconditional conversion |
| Application adapter creates RectArea lights | Website has full control | Every site must rediscover source dimensions, COMPAT math, node lookup, LTC singleton behavior, cancellation, prewarm order, and disposal; generated bindings cease to be tiny | Keep only as an escape hatch for unrelated application-authored lights |
| Convert every Blender Area light unconditionally | No new artist control | Double-lights baked artwork, invents unsupported shadows/links/spread/distance, diverges on micro emitters and ambiguous instances, installs lights/LTC work without a valid descriptor, and is not portable glTF | Rejected; this is not what Automatic does |

The selected design has the best **depth** and **locality**. One Blender-side
**Module** turns engine-aware artist intent into a closed compiled fact; one Three-side
**Module** owns all runtime mechanics. Their node-extra **Interface** is much
smaller than either **Implementation**. The existing finalized-GLB normalizer
is the natural export **Seam**, and `installLoadedThreeCompiledScene` is the
runtime seam. The add-on UI and generated R3F binding remain shallow
**Adapters**. Automatic source/artifact fallback belongs inside those deep
modules rather than every consumer. Fixing LTC or calibration once has high
**leverage** across every consumer.

## Additive authoring and compiled contract

### Authoring property

The object-level custom property stores only an override:

```text
blendlink_area_light_mode = "bake-only"
blendlink_area_light_mode = "three-rect-area"
```

Absence means Automatic for a Blender `AREA` object. The parser also accepts
`"auto"` for compatibility, but the add-on's Automatic action removes the
property so default artist scenes stay unconfigured. The UI presents:

- **Automatic (Default)**
- **Bake Only**
- **Three Rect Area (Approximation)**

The object, rather than shared light data, owns the choice because dimensions
and publication identity belong to an object instance. The add-on never writes
a bare alias. Missing metadata on a non-Area light does not opt it into RectArea
handling; a stale or bad authored value on a non-Area source is a loud
conformance error, not a fallback.

Automatic emits only the proven subset, or keeps the light bake-only with a
named reason. Bake Only is a stable artist override. Three Rect Area is a force
request for the diagnosed approximation, not permission to invent invalid
color, strength, dimensions, transform, or final-node identity. The UI shows
the losses and offers Point/Spot/Sun when portability or realtime shadows are
required; it never calls the result "exact".

### Supported v1 source subset

V1 accepts:

- light type `AREA`;
- shape `SQUARE` or `RECTANGLE`;
- finite positive local `size` and `size_y`;
- finite non-negative effective color and strength;
- a transform whose current local X/Y axes are non-degenerate and orthogonal;
  non-uniform positive scale is supported; and
- Eevee data-block color/temperature, energy, exposure, Normalize, and static
  Direct Light scale (Eevee-unused Spread/light nodes do not participate); or
- a Cycles light with nodes disabled or a directly routed constant Emission
  surface, default Emission Strength `1` when present, and otherwise provable
  constant color/strength.

V1 cannot produce a descriptor when:

- shape is `DISK` or `ELLIPSE` (a rectangle with the same bounding box is not
  the same emitter);
- the transform is singular, sheared, or reflected by a negative determinant;
- light color, energy, exposure, size, shape, temperature, or relevant node
  values are animated but cannot be represented by the static descriptor;
- authored Blender object transform animation has not passed the finalized-node
  conformance fixture (runtime/application transform changes remain supported);
- a routed/grouped/linked Cycles light graph prevents constant extraction, or
  Cycles Emission Strength differs from the proven default `1`;
- an Eevee emitter crosses the engine's scaled micro-light cull or clamp
  boundary;
- the finalized GLB has no unique ordinary node for the source light, including
  an ambiguous collection-instance expansion; or
- the node already contains a conflicting descriptor or unsupported descriptor
  version.

For Automatic, source-policy failures and an unproven Collection Instance or
ambiguous final node become named `bakeOnly` fallbacks. For explicit Three Rect
Area, those same conditions are blocking `notPublished` errors. Conflicting or
invalid extras and impossible source facts always fail loudly. The runtime's
`sync()` does follow ordinary application-owned translation, rotation, and
positive scale changes after installation, but that does not prove arbitrary
Blender-authored transform animation survived the export pipeline.

The following are always named limitations, never silently preserved controls:

- Area-light shadows;
- indirect bounce and volumetric contribution;
- light linking and collection membership masks;
- non-default Cycles Spread;
- non-default diffuse/specular factors and Blender direct
  transmission/volume closure behavior;
- Eevee finite distance fade, Custom Distance, and nonlinear direct clamp;
- custom shader behavior; and
- Eevee/Cycles sampling and contact-shadow controls.

Automatic permits the standing PBR-only/direct-only/no-indirect warning, the
shadowless result, Eevee's default finite Light Threshold fade, the named Eevee
LTC horizon/facing mismatch, and the default positive transmission/volume
closure limitation as approximations. Non-default Cycles Spread,
diffuse/specular factors, intermediate nonzero transmission/volume factors,
linking, Eevee Custom Distance, and Eevee direct clamp are intentional
Automatic fallbacks because they can change receivers or energy domains.
Explicit Three Rect Area can accept those diagnosed semantic losses, but cannot
override the uncomputable source conditions above. Eevee Spread is absent from
both lists because the pinned Eevee renderer does not consume it.

The runtime adds one final double-lighting gate that cannot be decided from one
light object: if the compiled root contains a Lighting atlas and lacks
per-light bake-exclusion evidence, RectArea installation fails before LTC
allocation. Appearance atlases with explicit live PBR exceptions remain the
supported hybrid path. This loud refusal is neither an Automatic source
fallback nor permission to layer direct light over already baked lighting.

### Node-extra schema

The complete v1 schema is intentionally small:

```ts
type BlendlinkRectAreaLightV1 = {
  readonly schemaVersion: 1
  /** Linear RGB after supported Blender color/temperature composition. */
  readonly color: readonly [number, number, number]
  /** Unscaled width and height in the finalized node's local glTF units. */
  readonly size: readonly [number, number]
  /** Exactly one strength form is present. */
  readonly power: number
  readonly intensity?: never
} | {
  readonly schemaVersion: 1
  readonly color: readonly [number, number, number]
  readonly size: readonly [number, number]
  readonly intensity: number
  readonly power?: never
}
```

Every number must be finite. Color and strength are non-negative; size is
strictly positive. Color is not clamped at 1 because HDR light colors are valid
runtime inputs. Unknown fields may be ignored within v1 only under the
repository's additive-schema rule; unknown `schemaVersion` values are refused.

For a normalized light:

```text
effective_strength = supported_source_energy * 2 ** exposure * direct_scale
descriptor.power = effective_strength
world_width = size[0] * length(marker.matrixWorld X axis)
world_height = size[1] * length(marker.matrixWorld Y axis)
light.width = world_width
light.height = world_height
light.power = descriptor.power
```

For an unnormalized light:

```text
effective_strength = supported_source_energy * 2 ** exposure * direct_scale
descriptor.intensity = effective_strength / pi
light.width = world_width
light.height = world_height
light.intensity = descriptor.intensity
```

`direct_scale` is Eevee's static `scene.eevee.direct_light_intensity`, or `1`
for Cycles. The latter form follows from Three's
`power = intensity * area * pi`: its runtime power becomes
`source_energy * world_area * 2 ** exposure * direct_scale`, matching the
supported Blender area scaling under the established numeric COMPAT convention.

The descriptor carries final effective linear color rather than source color,
temperature, and node settings separately. That keeps the runtime interface
deep and lets Blender-side policy evolve without changing every website.

### Export seam

`weblights.py` owns the bpy-free policy and calibration functions. That keeps
add-on diagnostics and headless export on one contract. It produces a closed
plan with a descriptor, Automatic fallback reasons, or explicit refusal
reasons.

`export_scene.py` extends the existing completed-GLB normalization pass rather
than adding a second independent JSON rewrite. The pass reads and
atomically replaces the GLB JSON chunk to attach `blendlink_cast_shadow` after
the stock exporter has established the real selection and collection scope.
In the same transaction it:

1. indexes finalized nodes by exact source name;
2. resolves each planned Area descriptor to one finalized node;
3. compares any existing descriptor and rejects a conflict;
4. attaches the planned descriptor;
5. turns an unproven Collection Instance transform or ambiguous final-node match
   into a named Automatic fallback, while blocking an explicit Three request;
6. returns per-light outcomes to the existing light diagnostic report; and
7. writes the GLB once if anything changed.

The stock Area object node is the source of position, rotation, scale, name,
and animation. The extra adds only information the glTF standard cannot carry.
Because the bytes live inside the GLB, existing artifact hashing and complete
scene content addressing naturally invalidate when the light contract changes.
There is no new companion asset.

## Runtime algorithm and ownership

### Parse, prepare, then commit

The runtime installation is transactional:

1. Traverse `root` for own `userData.blendlink_rect_area_light` values.
2. Parse and validate **all** descriptors before mutating the scene.
3. Refuse two active installations on the same marker using a private symbol or
   `WeakMap` token.
4. If there are no descriptors, return an empty handle without initializing,
   allocating, or uploading LTC textures (the official module is already in
   the statically scheduled runtime bundle).
5. Refuse a Lighting-atlas root without compiled per-light bake-exclusion
   evidence before any LTC allocation.
6. Check cancellation, initialize/reuse the global LTC library, and upload the
   renderer-selected pair with `renderer.initTexture()`.
7. Check cancellation again.
8. Create all RectArea children, register their cleanup immediately, call
   `sync()`, and commit only after every marker succeeds.

If the shared LTC initialization finishes after cancellation, it remains as a
valid shared cache; claiming that static module evaluation, shared texture
allocation, or a completed GPU upload was aborted would be false. No scene
light may remain committed. A later install reuses the cache.

`installLoadedThreeCompiledScene` prepares LTC before making a root
visible, then attaches/syncs the children in the same synchronous commit as the
root. With `addToScene=false`, the application owns visibility and must keep
its already-attached root hidden until the installation promise resolves. This
matches the existing cache-owning-application seam.

### Transform synchronization

For each marker, `sync()` calls `updateWorldMatrix(true, false)` and reads the
upper-left 3x3 columns:

```text
x = matrix column 0
y = matrix column 1
z = matrix column 2
sx = length(x)
sy = length(y)
```

It rejects a non-finite or near-zero axis, normalized X/Y dot product outside a
small tolerance, or non-positive determinant. It assigns
`width = localWidth * sx` and `height = localHeight * sy`, then assigns the
compiled power or intensity. The child has identity local transform and
inherits marker position and rotation; Three removes scale when it constructs
the light-plane basis, so the explicit dimensions are applied exactly once.

Call `sync()` after animation/components update and before rendering. In R3F
demand mode it runs on an invalidated frame; RectArea lights do not by
themselves make `requiresContinuousFrames` true. Developers can translate,
rotate, or positively scale the compiled scene using normal Three/R3F
transforms. As with every demand-mode mutation, they must request a frame.

### Ordering with the existing installer

The implemented integration order is:

```text
load GLB and baked resources
parse RectArea descriptors and prepare LTC
commit root and RectArea children
environment, look, fog, and shadow policy
camera, animation, LOD, and instances
reflection-probe capture/assignment
components and their material changes
sync RectArea dimensions
renderer.initTexture(selected LTC pair)
renderer.compileAsync(scene-with-final-light-count, camera)
report ready
```

The exact location of environment/look setup may stay as today, provided no
awaited gap can expose an unlit committed root and RectArea lights exist before
reflection capture and `compileAsync`. Probe capture otherwise records a scene
that differs from the first presented scene. Components must still precede the
final compile because they can introduce supported PBR materials or
post-processing.

`compileAsync` is a shader-program barrier only. The targeted LTC
`initTexture` calls are what prevent first-use LTC upload. Blendlink must not
rename either claim to "the complete scene is GPU ready."

### Materials and report

Traverse the installed root after baked/material/component setup and count:

- `MeshStandardMaterial` and `MeshPhysicalMaterial` instances as supported
  receivers;
- visible mesh materials of all other types as unsupported receivers.

Material arrays count each unique material once. A scene with configured
RectArea lights but zero supported receivers warns loudly; it is usually
an accidental opt-in or a fully baked scene. `MeshBasicMaterial` is an expected
unsupported receiver in Hybrid mode and must remain visually unchanged.
Lambert, Phong, Toon, Normal, Depth, Matcap, Shader, RawShader, and custom
NodeMaterials are outside the v1 promise even if a particular custom shader
happens to consume compatible uniforms.

### Disposal and reinstall

`dispose()` is idempotent and runs in reverse ownership order. For every light
created by this installation it:

1. removes the light only if it is still parented to the expected marker;
2. calls `light.dispose()`;
3. clears the marker token only if the token still belongs to this install; and
4. retains all global LTC textures.

An install failure performs the same cleanup for already-created lights. A
fresh install after disposal succeeds. A concurrent install against an active
marker fails before mutation. This contract is sufficient for React Strict
Mode's setup-cleanup-setup sequence and for direct Three consumers.

`RectAreaLight` has no shadow resource. The runtime sets `castShadow=false` and
does not allocate a helper mesh. The existing Blendlink shadow adapter already
ignores lights without a `.shadow` implementation, while the compiler
diagnostic states that an authored Area shadow request is not represented.

## Conformance and acceptance status

### Implemented policy and artifact evidence

`packages/blender-addon/tests/weblights_test.py` now asserts the bpy-free policy
with exact numeric doubles:

- missing Area metadata selects Automatic, explicit Bake Only emits no
  descriptor, and explicit Three Rect Area uses the same schema path;
- normalized output uses
  `power = energy * 2 ** exposure * direct_scale`; unnormalized output uses
  `intensity = energy * 2 ** exposure * direct_scale / pi`;
- Eevee Direct Light scale and relevant animation, ignored Eevee Spread/nodes,
  engine-specific effective color, Cycles constant Emission/default Strength,
  non-default Cycles Spread, closure-factor fallback, and the named Eevee LTC
  horizon limitation follow the policy above;
- Eevee micro cull/clamp, invalid dimensions/transform/data, routed graphs, and
  unsupported controls produce the expected fallback or refusal; and
- outcomes reuse `approximated`, `bakeOnly`, and `notPublished` rather than a
  parallel vocabulary.

The headless add-on fixture verifies the three UI choices, including that
Automatic removes the custom property. Finalized-GLB tests verify ordinary node
extras, exact descriptor attachment, Point-light/shadow metadata independence,
and the Automatic Collection Instance fallback
`rect-area-instance-transform-unproven`. The exporter also handles an
ambiguous final node as `rect-area-final-node-ambiguous`; the explicit Three
mode blocks both artifact conditions.

### Implemented runtime evidence

TypeScript tests cover the deep module rather than generated bindings:

- no descriptor avoids LTC initialization/allocation/upload and returns a zero
  report, while the official initializer module remains statically scheduled;
- schema, one-sided local `-Z` orientation, transformed dimensions,
  power/intensity, and `castShadow=false` are validated;
- all markers validate before commit; conflicts and cancellation roll back;
- positive runtime transform changes synchronize without demanding continuous
  frames;
- shared LTC initialization survives concurrency/hot reload, uploads only the
  renderer-selected pair, and is never disposed with one scene;
- unsupported/partial LTC states fail loudly; and
- duplicate install, dispose twice, reinstall, and Strict Mode-style lifecycle
  sequences preserve ownership.

The runtime suite also proves that a Lighting-atlas receiver fails before the
initializer provider is called, with an actionable probable-double-lighting
message.

Installer-order tests place RectArea preparation before visibility, automatic
probe capture, and the final `compileAsync`; component material changes settle
before the receiver audit. `compileAsync` remains a shader barrier, while the
selected `renderer.initTexture()` calls are the narrower LTC upload evidence.

### Retained focused real-browser evidence

`artifacts/release-dogfood/rectarea-browser-evidence/evidence/evidence.json`
records a passing Chrome 150/WebGL 2 run against a freshly packed
`blendlink-0.8.0.tgz` and real `WebGLRenderer`. Each install reported one light,
two supported Standard/Physical materials, and one unsupported Basic material.
The enabled/disabled mean absolute deltas were `144.30245` and `148.59094` in
the two PBR masks and exactly `0` in the Basic mask. The back-facing PBR delta
was `101.53638`, proving the one-sided direction. Dispose/remount reproduced the
enabled pixels exactly; forced half-float LTC fallback differed by only
`0.00008974` mean absolute value. Both selected native-float and forced-half LTC
pairs had real GPU handles, and console, page, request, HTTP, WebGL error, and
context-loss arrays were clean.

This pre-static-import fixture verifies runtime material selection, direction,
GPU upload/fallback, and lifecycle. It does not verify the current module
scheduling choice, compare Blender pixels, prove Eevee/Cycles distance or
shadow semantics, establish a strict-CSP result, or freeze a performance
budget. It is not image-parity evidence.

### Current Cube production-browser evidence

The static-import fix was then packed into the current Cube Vite consumer.
`browser-evidence-cube-tuned.json` and
`browser-evidence-cube-appearance.json` each pass at 1440x900 with HTTP 200,
WebGL 2, a nonzero/nonblank Canvas, the exact browser-response GLB hash, and no
relevant console, page, request, or HTTP errors. The tuned response is
10,017,264 bytes / SHA-256
`bc45dd04e56b0b94ed4f85ea73adae48aa0a023d4726cf0a71bc0dc2e86a374e`;
Appearance is 8,595,572 bytes /
`c6901015757007256c82c313baef28ad05b00d6da9985fbe333cf2de673df30c`.
Direct GLB inspection finds exactly the expected `Bounce Light`, `Fill Light`,
and `Fill Light.001` v1 descriptors in both artifacts.

The matched visual matrix records tuned MAE/RMSE
`0.16598489999394822`/`0.23768085938082123` and Appearance
`0.06720738093076736`/`0.11718815174616998` against the retained Blender
reference. This verifies that current static-import bytes build, load, and
render, and it records the resulting scene error. It does not isolate the Area
policy: no otherwise-identical Bake Only capture exists in this run, and the
large difference between tuned and Appearance also includes their different
material/bake contracts.

The build log measured a 1,507.66 kB raw / 455.48 kB gzip main chunk. The total
Area payload is similar to the earlier split design but now eagerly resident.
That is the accepted reliability tradeoff for the reproduced Vite deadlock,
not evidence that no-Area consumers are optimized.

### Remaining scene-level acceptance

Current Cube tuned and Appearance artifacts now satisfy the three-descriptor
structural and production-browser integration gates. Preserve that retained
source/evidence. The next disposable derivative should change only the three
Area choices to explicit Bake Only, then capture the same camera/build so the
light contribution can be isolated. Runtime evidence should also retain the
one punctual outside Spot, exact RectArea report, supported live PBR receivers,
and unchanged baked Basic receivers.

Visual evidence remains a future gate. Use fixed masks for `Bird Cage`,
`Computer`, and `Potted Plant - Bracken`; require a real enabled/disabled change
inside each receiver mask, no material change outside supported receivers, and
movement toward—not merely greater brightness than—the matching Blender engine
reference. Record CPU/GPU time, draw calls, program count, and ready latency
before setting a regression threshold. Repeat across distance, roughness,
occlusion, normalized-size, Eevee micro-boundary, and Cycles fixtures before
making any Blender-to-browser calibration or image-parity claim.

## Implementation status

The policy/schema module, add-on UI, finalized-GLB seam, deep Three runtime,
transactional installer integration, unit/headless tests, focused
material/direction browser fixture, current static-import Cube production
browser run, and feature/migration documentation are implemented. The remaining
work is an isolated Cube Automatic-versus-Bake-Only matrix, the broader
cross-scene image matrix, a no-Area Splash bundle measurement/architecture
decision, and measured runtime performance evidence. Keeping those pending
claims explicit preserves the small public interface without overstating visual
equivalence.

## Primary sources

- [Khronos `KHR_lights_punctual` specification][khr-punctual]
- [Khronos guidance on extensions and `extras`][khr-extensions]
- [Blender light-object manual][blender-lights]
- [Official Blender/Khronos exporter light source][blender-exporter-lights]
- [Three 0.184 `RectAreaLight` documentation][three-rect-doc]
- [Three 0.184 `RectAreaLight.js`][three-rect-source]
- [Three 0.184 `WebGLLights.js`][three-webgl-lights]
- [Three 0.184 physical-light shader chunk][three-physical-shader]
- [Three 0.184 `RectAreaLightUniformsLib.js`][three-ltc-uniforms]
- [Three 0.184 `RectAreaLightTexturesLib.js`][three-ltc-textures]
- [Three 0.184 `GLTFLoader.js`][three-gltf-loader]
- [Three `WebGLRenderer` documentation][three-renderer]
- [React `StrictMode` reference][react-strict]

[khr-punctual]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md
[khr-extensions]: https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
[blender-lights]: https://docs.blender.org/manual/en/4.3/render/lights/light_object.html
[blender-exporter-lights]: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/addons/io_scene_gltf2/blender/exp/lights.py
[three-rect-doc]: https://threejs.org/docs/pages/RectAreaLight.html
[three-rect-source]: https://github.com/mrdoob/three.js/blob/r184/src/lights/RectAreaLight.js
[three-webgl-lights]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/webgl/WebGLLights.js
[three-physical-shader]: https://github.com/mrdoob/three.js/blob/r184/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js
[three-ltc-uniforms]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/lights/RectAreaLightUniformsLib.js
[three-ltc-textures]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/lights/RectAreaLightTexturesLib.js
[three-gltf-loader]: https://github.com/mrdoob/three.js/blob/r184/examples/jsm/loaders/GLTFLoader.js
[three-renderer]: https://threejs.org/docs/pages/WebGLRenderer.html
[react-strict]: https://react.dev/reference/react/StrictMode
