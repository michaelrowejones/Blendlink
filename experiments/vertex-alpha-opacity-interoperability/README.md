This proof checks the opt-in `vertex-alpha-explicit-opacity-v1` material adapter. Four authored Blender sources cover named FLOAT_COLOR POINT/CORNER Color + Alpha and RGBA texture Base Color + raw scalar Alpha. Default Final publication and Meshopt must preserve source files and raw scalar/position associations. Both actual APIs on Metal and SwiftShader measure `outputNode=diffuseColor` on the actual installed Standard/Physical node material; no fragment replacement or native transparency/dithering parity is claimed.

Seventy-two synthetic controls per API cover raw Alpha 0, .1, .25, 1/3, .5 and 1 with COLOR0 RGBA, texture RGBA, combined fallback RGB, complete program RGB, alpha-test and opaque handling. Exact Float32 words are declared before execution. Each Final source has three install/draw/dispose cycles, exact source material/callback restoration and actual renderer texture-identity restoration. The adapter adds no passes, textures or readbacks; readbacks belong only to this test. Runtime leaf validation retains O(1) draw guards.

Run from one frozen built checkout using Node24:

```
PATH=/tmp/mrj-tooling:$PATH node experiments/vertex-alpha-opacity-interoperability/matrix.mjs artifacts/verification-alpha-opacity-unique-run
```

The native setup is a source/GLB ownership check; the independently qualified VertexColor Alpha EEVEE field proof remains separate. Untagged/malformed model and atomic preflight refusal controls live in the production unit/native policy tests. The complete r4 closed reader passed: four saved Finals, 48 actual Final install/draw/dispose cycles and 288 synthetic controls across both actual APIs/profiles, totaling 344064 exact Float32 words with zero differences. This grants only the scoped adapter/diffuse behavior described here.

The unchanged authored float Non-Color image stores `[1,0,1,.125]`. Existing pinned EEVEE image upload staging (`tsl_ir.py` unassociation before rgba16f upload) gives complete program RGB `[8,0,8]`. This expectation is derived from raw authored inputs and every published texel/schema/profile is asserted before browser work; it is not derived from observed output. Failed r2 retained the earlier mistaken RGB1 fixture expectation. The current sources embed image texels, so external-image pin checks have zero exercised assets.

`evidence.json` embeds the exact immutable r4 receipt and pins each measured draw report. It derives the 48-sample source/installed draw histogram without adding a GPU run; only observed draw counts receive coverage. R1/r2 failures and r3’s earlier runtime fingerprint remain separate history. R4 includes ordinary material clone/copy ownership preservation. The existing native Alpha field proof and Attribute field proof retain their own source/runtime snapshots; no all-port freshness claim is made.
