# Independent shared-Quad baseline

The fresh World matrix first failed its newly strict geometry check at 0→1 after the first installation. A separate diagnostic preserved that failure and recorded the exact remaining `BufferGeometry`: its object was named `Render Pipeline`, and its creation stack was `QuadMesh.render → RenderPipeline.render → ThreeWebgpuPostPipelineService.render`. All generated PMREM, background and loaded-scene geometry had been retired. This is the cold public fullscreen geometry shared by every Three QuadMesh, rather than a per-install allocation.

The minimal fixture fix draws a public QuadMesh with a constant fragment node before the no-World baseline, then disposes only its newly owned material. It neither invokes the candidate compositor nor changes a cleanup allowance. The existing strict before/after geometry and exact texture identity checks remain unchanged.

A new diagnostic namespace replayed all five generated World cases, three installation/disposal cycles each, on both actual Metal APIs. All 30 cycles returned from 1 to exactly 1 geometry, across distinct caller Scenes. The sole active geometry identity matched the independently drawn QuadMesh in every cycle. Native-pixel, source/ready-PMREM, caller-adoption and texture checks passed unchanged.

This is research evidence with zero node or numerical qualification credit. The retained native/Final packet was reused. Root must run its fresh integrated complete matrix after the fixture change. `evidence.json` pins both diagnostic reports, exact invocation snapshots and current source. Original failed namespaces remain untouched. The retained host snapshot contains original machine-local paths and is not a registered proof entrypoint.
