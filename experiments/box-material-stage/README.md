# Original Plaster material staging

**Public checkpoint: experiments only; the private BOX candidate failed its
strict four-tuple gate.** No SDK/addon/catalog/support implementation is enabled
by this folder. The complete candidate is retained as `sdk-candidate.patch`,
with exact file hashes in `candidate-sdk-files.json`. See reproduction below.

Research only: no SDK admission, port/material/scene support credit. The original
Archviz source stays byte-identical, and both production BOX guards and all
normal-frame/range guards remain unchanged.

`extract.py` loads the entire original file (including Blender versioning),
then temporarily intercepts only the two identified BOX Image outputs in this
process. All other nodes use the current real emitter. This produces the actual
Object → TEXTURE Mapping → BOX → OVERLAY color graph, and the original tangent
Normal Map expression. It is not an accepted export plan.

The CPU native result `/tmp/scenetoweb-box-material-schema-r3.json` (and exact
`.extract.py` snapshot) reports an expected hard refusal: Walls has 193/2731
Plaster triangles below the existing UV area bound; Plane.021 has 243/2198.
These are the actual Plaster faces, not unrelated material slots. Walls also has
n-gons that the public `calc_tangents` API refuses. Plane.021's calculated Mikk
vectors are finite and approximately unit length, but this observation does
not replace the existing UV/frame certificate or qualify fallback tangents.
The full original material and scene remain refused.

The next bounded vertical slice is the authored **color graph**. It will retain
the original Normal Map refusal and will not claim the whole material or scene.

`simplex-model.mjs` and `simplex-candidate.mjs` are independently written MIT
mathematical constructions: normalize positive axis magnitudes to the unit
simplex; shrink its interior by `(1-b)/(3-b)`; outside that interior project to
the remaining edge using a centered transition of width `b`. Signed projection
chart coordinates follow the existing measured public behavior. They do not
transcribe the GPL research kernel or fit any captured output.

The first CPU comparison against all 26 frozen direct native weight cases is
retained at `/tmp/scenetoweb-box-simplex-weights-cpu-r1.json`: maximum absolute
error 7.152557373046875e-7 passes 2^-20, but 384/6656 words violate the separate
8-ULP gate. The near-zero edge case differs by 1.1920928955078125e-7 and millions
of ULP. This raw-weight precision test **fails**. There is no precision/kernel
credit, and its thresholds are unchanged. The actual complete color graph will
use a separate predeclared 2^-10 film gate, retaining all original failed proof.

CPU extraction (expected exit1, refusal JSON retained):

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH /Applications/Blender.app/Contents/MacOS/Blender \
  -b --python-exit-code 1 --python experiments/box-material-stage/extract.py -- \
  /tmp/scenetoweb-v1-demo-selection/artifacts/v1-corpus/sources/archiviz.blend \
  /tmp/scenetoweb-box-material-schema-r3.json
```

## Frozen complete-color signal R1

Frozen source `a4024fb7c33ac113c6c5b3ec95b19b2e30c183ba` captures eighteen
actual native renders from the full-file-loaded original material, using only
owned emission copies to observe its color signal. The four calibration planes
and original Walls/Plane.021 geometry/cameras are byte-identical to the retained
sampler inputs. All original source bytes and the NormalMap refusal are retained.

Both actual Metal APIs pass all 36,864 positive words at the predeclared gates:
12,288 mask words exact; 12,288 encoded Mapping words maxAbs0.00048810243606567383;
12,288 complete color words maxAbs0.0005244612693786621, under 2^-10.
Omitting Mapping yields4,684 violations; omitting OVERLAY yields7,272. Every
negative row is retained. The shared strict mip/sampler gate also passes with
the independently written geometric blend; this does not repair its separate
failed raw-weight8ULP precision gate.

`/tmp/scenetoweb-box-color-closed-r1.json` and independent replay are byte-identical,
SHA256 `6266db8f213a4e17680aa11edc91a5ea439969fd9e543a5a402f7f88c54a2dc1`.
See `color-evidence-r1.json` for archive identities and all row results.

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-material-stage/check.mjs \
  /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-color-browser-r1 \
  /tmp/scenetoweb-v1-box-storage-stage /tmp/scenetoweb-box-color-native-r1 \
  /tmp/scenetoweb-v1-materials-checkpoint/experiments/box-image-storage-stage/paired-stage-gate.mjs \
  /tmp/scenetoweb-box-color-another-close.json
```

This is a color-signal stage pass, not a saved Final, installed SDK or complete
original material/scene acceptance. Production color sampling and its decoded
byte verification/cache/resource lifecycle are still absent. All credits stay0.

## Cold headless mip transport feasibility

Frozen `c4afa15320989cfa64e6d88ff860198842de8f01` runs the actual background
worker with `bpy.app.background=true` and zero render calls. Blender5.3's
`gpu.init()` initializes its offscreen context; `from_image` initializes the
native mip chain. Explicit-LOD normalized texel-center sampling into a new
actual SRGB8_A8 attachment, followed by UBYTE readback, extracts stored bytes
without inverse-transfer approximations or native implementation transcription.

Every byte of all eleven levels (5,592,404bytes) exactly matches the previously
qualified sRGB chain on both frozenR6 APIs. The first cold capture takes210.56ms
including image setup and all eleven readbacks. No visible window, beauty render
or warm-up workaround is needed. Native archive identity validates; original
source bytes stay unchanged. This closes feasibility only, not SDK admission.
See `native-mips-evidence-r1.json` and `/tmp/scenetoweb-box-native-mips-r1`.

Levels1–10 total1,398,100raw bytes; a single lossless deflate companion is550,045
bytes for this original image. The source PNG can remain the base image. This
makes the prospective browser path decode/verify/upload only and lets the Node
compiled-material audit use the same immutable bytes without a GPU context.
Native capture is exporter-side GPL Python using public APIs; the MIT runtime
will consume data and independently written mathematical BOX sampling only.

## Bounded production candidate (qualification pending)

The candidate adds a dedicated `texture_box_ref` operation; historical flat
`texture_ref` behavior is unchanged. Its first material scope is **Base Color
only**, on a direct ungrouped Principled surface, with constant opaque Alpha1,
all five core channel programs, and zero source/runtime skips. Only the pinned
5.3.0 Metal EEVEE source profile, SNORM10 normals, anisotropy2, the original
blend0.09966777265071869, Linear/Repeat, and saved opaque1024-square RGB8 sRGB
PNG bytes are admitted. NormalMap composition remains refused. Original camera
shifts and whole original material/scene acceptance are outside this fixture.

Saved `.blend` fixtures preserve the authored BSDF and color graph, explicitly
disconnect Normal in an owned material copy, and explicitly derive zero-shift
camera controls. The actual Final export privately neutralizes Base Color and
Alpha on its generated carrier, preventing Blender stock export's invalid
BOX `texCoord=-1`. The original graph/bindings are restored even after an emit
failure. The public builder returns a discriminated opaque material state;
the installer validates all five actual built nodes and uses the existing
complete-RGB material owner. A poisoned COLOR0 control tests both RGB and Alpha.

Production mip extraction uses only Blender public GPU/FBO/readback APIs, in
its ordinary headless worker, without a render or visible window. The actual
Python deflate companion is552,096bytes (the earlier550,045byte number is the
Node-zlib feasibility encoding of the same1,398,100raw mip bytes). Source PNG,
decoded RGBA, compressed companion, and every level are SHA256-bound. Browser
preparation only decodes/verifies/uploads the immutable bytes; it works with
WebGPU physically absent for forcedGL2. Hash/decompression run once per image
per preparation, never per draw. Draw guards check immutable identity/layout,
versions and actual renderer anisotropy support. Eleven levels need5,592,404
raw bytes per prepared image; eight distinct BOX images is the bounded census.
The source PNG/artist image is never mutated. Private texture Sources isolate
clone versions, and scoped disposal restores materials and releases owned maps.

License boundary: exporter Python remains GPL-3.0-or-later. It invokes public
Blender APIs and contains no copied native shader kernel. The MIT TypeScript
sampler uses the independently derived unit-simplex geometry described above,
not the GPL research transcription. Source references motivated separate
validation, not expression/comment/control-flow copying. Runtime sampling is
Three/TSL algebra over exported data; no Blender implementation is shipped in
the MIT SDK. The failed8ULP research comparison remains failed. A successful
complete-color film proof would only establish the declared2^-10 domain.

`read-installed.mjs` independently requires three actual saved Finals, their
native launcher receipts, eighteen native observations, packed public SDK
provenance, all four Metal/SwiftShader×WebGPU/nodeGL2 tuples, all204 raw rows,
245,760 numeric words, exact mask/Alpha, fixed2^-10 Mapping/color, physical
missing/corrupt/abort recovery, ordinary material/COLOR0 negatives, resize,
dispose/remount, legacy refusal, and resource/bitmap balance. No capability
credit is given until that entire transaction and independent replay close.

### Fresh installed R3: strict gate failed

Frozen candidate `71a464a23e79bae48720ba524c21fb903c525805` exported all three
actual saved Finals (complete five channels, fresh primitive declaration,
opaque neutral carrier, no stock BOX image/UV transport), captured eighteen
native observations, and completed all204 installed browser rows and physical
recovery controls. The independent full reader rejects that capture: of
245,760 numeric words, both SwiftShader APIs have25 violations each. Two
silhouette pixels contribute24 words per API across mask/Alpha/Mapping/color;
one interior Walls blue word reaches0.00110024, above the fixed2^-10 gate.
Both Metal APIs have zero numeric violations. The promised four-tuple gate
**fails**, without excluding pixels, adjusting thresholds, or narrowing claims.
All source/material/scene credit stays0. See `installed-evidence-r3.json` for
the immutable receipts, exact failed rows and raw evidence locations.

The expanded resource audit also finds a harness-owned uploaded poison color
attribute retained after the test removed it from geometry. The subsequent
harness-only repair uses a disposable geometry clone and checks every attribute
cache counter, in addition to textures/geometries/bitmaps. This repair has not
been captured yet and does not change the failed numeric result or SDK math.

## Reproduce the private candidate without changing the public SDK

This experiments-only bundle is based on public
`70a60a9c616f3da43eebf3aa92c9cf84976043b4`. The patch itself is relative to the
candidate's actual source base `751dcffec11256f0b6347d833eef4bb9f8525f47`, not to
the newer public checkpoint, so it cannot accidentally remove subsequent
Shadow or other public changes. Use a **new isolated checkout** of751dcff and
copy this experiment folder into it. Do not apply the patch to a working artist
installation or interpret it as a supported SDK option.

```sh
git apply --unidiff-zero --check /ABSOLUTE/PATH/sdk-candidate.patch
git apply --unidiff-zero --index /ABSOLUTE/PATH/sdk-candidate.patch
node experiments/box-material-stage/candidate-sdk.mjs --check-sdk
```

The patch reproduces all17 SDK/addon/conformance/test files byte-for-byte from
private capture commit `71a464a23e79bae48720ba524c21fb903c525805`, patch SHA256
`3d35630c3d0bdae9a3a3c25eba2832707ad8b006e7e6894fdf239d937c4380d2`.
The checkpoint retains the subsequent **harness-only** owned poison-geometry
repair from `72a333227c00a600be3cb762a638f2d6cb2c7169`. That repair has no GPU
capture and must not be presented as a passing lifecycle result.

Every new export/native/browser entrypoint calls the exact17-file guard before
reading scene inputs, launching Blender/a browser, or creating output. The
ordinary public checkout deliberately rejects these commands with an absent
private-patch error, including check-only invocations; the guard never applies
patches, writes files, builds the SDK, or opens GPU:

```sh
node experiments/box-material-stage/candidate-sdk.mjs --check-sdk
node experiments/box-material-stage/export-colors.mjs --check-sdk
node experiments/box-material-stage/native-color-references.mjs --check-sdk
node experiments/box-material-stage/installed.mjs --check-sdk
node experiments/box-material-stage/read-installed.mjs --check-sdk
node --test experiments/box-material-stage/candidate-sdk.test.mjs
```

After applying the patch in its isolated base, install the lockfile's pinned
dependencies, build the package, and run the five focused files used in the
frozen candidate (80 tests):

```sh
node node_modules/typescript/bin/tsc -p packages/blendlink/tsconfig.json
node packages/blendlink/scripts/copy-assets.mjs
node node_modules/vitest/vitest.mjs run packages/blendlink/src/tslBoxImage.test.ts \
  packages/blendlink/src/tslMaterialRuntime.test.ts \
  packages/blendlink/src/compiledMaterialPrograms.test.ts \
  packages/blendlink/src/materialProgramRendererRequirements.test.ts \
  packages/blendlink/src/stagedPublication.test.ts --maxWorkers=2
```

The existing `/tmp` sources, saved fixtures, native archives, generated Finals,
and installed package bytes are local evidence, not included demo assets or
distributable release evidence. Their exact source/asset/report SHA256 pins and
all50 strict violations are retained in `installed-evidence-r3.json`. Historical
R3 used the exact producer/reader bytes archived in `frozen-r3-source/`; those
`.source` files are byte snapshots, not relocated executable entrypoints. The
captured source paths remain bound to the original private worktree/receipts.
Both private71/72 commits and all raw receipts remain untouched.

Fresh hardware runs require the same immutable original Archviz file, the
pinned native build and an exclusive GPU lease. Use new output directories.
After saving the declared owned fixtures, put their `fixtures.json` in a new
Final directory, then run the guarded commands (the `--gpu-lease` argument is a
coordination assertion, never permission to overlap another hardware job):

```sh
node experiments/box-material-stage/export-colors.mjs NEW_FINAL_DIR --gpu-lease
node experiments/box-material-stage/native-color-references.mjs \
  NEW_FINAL_DIR NEW_NATIVE_DIR /tmp/scenetoweb-box-storage-native-r3 --gpu-lease
node experiments/box-material-stage/installed.mjs NEW_FINAL_DIR NEW_BROWSER_DIR --gpu-lease
node experiments/box-material-stage/read-installed.mjs \
  NEW_FINAL_DIR NEW_NATIVE_DIR NEW_BROWSER_DIR NEW_CLOSED_JSON
```

The updated harness/guard bytes differ from historicalR3, so fresh reports must
pin those bytes. Reusing old reports as if produced by this bundle is refused.
The strict reader, fixed gates, SwiftShader failures, prior8ULP failure and
original NormalMap/scene refusals are preserved; no visual-vs-strict policy
decision is implied by preserving this research.
