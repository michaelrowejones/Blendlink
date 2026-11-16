# Real Mikk frame / native Normal Map diagnostic preparation

Experiments only: no SDK change, guard relaxation, node support, draw certificate or original-scene acceptance.

Current frozen observation: six pure-B boundary fields remain unqualified; Plane/zero-UV produce 3528 nonfinite browser words against a finite native EXR carrier. This establishes no native kernel fallback and does not invalidate independently nonzero mixed/original-image inputs. Separately, **34 finite NormalMap diagnostic fields** (2,228,224 RGBA words; 474480 covered words) meet the unchanged 2^-10 bound with exact alpha. All eight masks and fixed asymmetric Window quadrant controls match. See `browser-observation.json`; no production admission follows.
 This joins the frozen portable WASM Mikk pilot2538e93b, lossless custom CORNER transport785a3460 and source mathematical audit0cbbe73f.

The CPU producer freshly executes the pinned270662-byte WASI module on each private Main mesh, using original positions/corner normals/named UVs, authored quads and native loop triangulation for n-gons. Repeated callback writes must agree in every Float32 word; no averaging. Real tangent/sign values replace the earlier dummy payload. No source/private triangulation or split-normal reassignment occurs. Actual custom N/T/sign/loop-ID accessors, original oriented loop triangles and both axis conventions close exactly for Walls, Plane.021, a discontinuous seam control and an explicitly zero-UV triangle. Original artist file/mesh bytes remain unchanged.

CPU preparation r4 lives in `/tmp/scenetoweb-real-mikk-frame-prepare-r4`. It has eight actual GLBs, zero renders and one guarded native Python invocation. `read-transport.mjs` verifies the archive and every field/triangle; it also checks actual NormalMap schema and original frozen source-normal references. Custom vector semantics remain raw Blender XYZ even when built-in POSITION is exported Y-up.

`native_fixture.py` constructs an actual ShaderNodeNormalMap TANGENT/OPENGL/ORIGINAL/Strength1 on the preserved active named UV and records that Material Output Displacement is unlinked. The actual original Walls/Plane model matrices, inverse-transpose normal matrices and source camera are copied into the isolated field scene and metadata. Seam is a separately labelled derived negative/nonuniform transform control. No original-scene visibility/lighting interpretation is claimed.

`contract.json` declares five literal RGB probes before GPU observations: T/B/N axes, mandatory(.8,.7,.9) relative-length control and a signed mixed input. Actual RNA Float32 RGB words are recorded for later uniform transport. Mask, Geometry Normal and Window XY are independent controls. Four cases x8fields give a bounded32-render initial Metal diagnostic at128x128,1sample, Raw EXR32 transport. It does not claim EEVEE film is full Float32: the existing half-film witness motivates the unchanged2^-10 diagnostic field bound, with exact masks/alpha/nonfinite classes. API-fixed origin handling must pass Window XY; no fitted flips/pixel selection.

The separate GPL research preflight uses the independently authored mathematical reference, not a GPU oracle. It records one Walls corner,120Plane corners and all3zero-UV corners where pure-B has an undefined zero final vector. No fallback is invented. These pure-B boundaries do not imply that an actual positive-qz/mixed input is invalid. Finite encoded EXR values cannot alone certify a frame. The seam has no parallel corners, but even that is not an interpolated-field certificate.

The source ordering for the later browser candidate is pinned by `../eevee-tangent-frame-spec`: pack N/T, inverse-transpose and normalize at vertices (ordinary N, safe T), smooth perspective interpolate N/T/sign; use unnormalized fragment Ni, front-facing flip of the entire tangent4, distinct negative-object-scale bit, then the original ordered linear combination and ordinary final normalization. No fragment tangent/Ni normalization, Gram-Schmidt or generic fallback. No GPL shader text is copied into a runtime kernel. The later independent graph in `candidate.mjs` and `browser.js` implements this order; `browser-observation.json` records its finite matches and explicit pure-B failures. It remains diagnostic rather than production qualification.

```
node experiments/mikk-normal-map-field/prepare.mjs ORIGINAL_BLEND NEW_CPU_DIRECTORY
node experiments/mikk-normal-map-field/read-transport.mjs NEW_CPU_DIRECTORY/capture NEW_CLOSED_JSON
python3 experiments/mikk-normal-map-field/preflight.py NEW_CPU_DIRECTORY/capture
```

Only after the shared GPU lease is granted, the same frozen producer can capture the first native matrix:

```
node experiments/mikk-normal-map-field/prepare.mjs ORIGINAL_BLEND NEW_NATIVE_DIRECTORY --gpu-lease
```

Failed/earlier preparations remain immutable. r1 established real WASM transport; r2/r3 added source-frame/material schema. The tiny zero-UV control was corrected for r4 because Blender auto-initialized a newly created UV layer; its previous nonzero UV control is retained without pretending to be a zero-UV negative. The original preparation commit made no GPU observations; the later native/browser results are recorded separately above.
