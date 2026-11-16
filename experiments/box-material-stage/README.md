# Original Plaster material staging

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
