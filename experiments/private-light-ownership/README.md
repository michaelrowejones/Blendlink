# Private imported light ownership

Resource-only evidence for `5a7b415`. The failed Displace `next46` baseline retained real `PointShadowMap` and `PointShadowDepthTexture` allocations after installation disposal. The private glTF cleanup collected meshes/materials/textures/skeletons but omitted light disposal.

The fix snapshots imported light identities immediately after a private load, excludes preexisting host lights and deduplicates multiple scene roots. Only WebGPURenderer (including its WebGL backend) dispatches the base public `Light.dispose` event for those captured lights. Three's actual `AnalyticLightNode` listener then releases its original `ShadowNode` target. Calling subclass `PointLight`/`SpotLight`/`DirectionalLight.dispose()` would also dispose the **current** `light.shadow.map`, potentially a later borrowed replacement. Legacy WebGLRenderer shadow cleanup remains unchanged and receives no new claim. Already-loaded cache seams retain caller ownership.

The actual four-tuple public-install control uses an unchanged retained saved Cube/Sphere/PointLight Final from `verification-displace-single-next46`. All eight normal/borrowed-map-and-late-light installations pass: 16 original imported point-shadow color/depth handles and all 88 private texture handles retire exactly once. Independently warmed caller shadow resources, a physically allocated borrowed replacement target and late-added light maps survive installation disposal; fixture-owned cleanup retires them afterward. No source light, castShadow flag, sampler or pixel gate was disabled. GPU jobs are closed and the lease released.

Fourteen focused host tests use actual Three analytic/shadow classes to cover all three shadow-light subclasses, replacement map/mapPass/shadow objects, preexisting and late-added lights, duplicate roots, private detached/cancel/failure/reapply, the borrowed already-loaded seam and unchanged legacy behavior. The runtime/atomic/focused group passes 93 tests, and TypeScript compilation passes.

`evidence.json` pins the exact failed and successful reports, tested fixture bytes, runtime emission and unchanged Final assets. This is zero native-render, numerical-node and saved-Final qualification credit. The full Displace matrix still needs a fresh SDK source snapshot after integration.

The diagnostic runner retains its tested machine-local input path intentionally. After building the isolated package, reproduce into a **fresh** namespace with:

```sh
node experiments/private-light-ownership/run.mjs artifacts/private-light-control-fresh
```
