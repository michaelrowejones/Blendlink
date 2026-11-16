# Independent upstream Three shadow observation

This experiment diagnoses the frozen shadow candidate43ccb92 without importing or installing SceneToWeb runtime code. It changes no production source and grants no node/scene support credit.

## Frozen result

Producer: `browser.mjs`. Retained source: `/tmp/scenetoweb-shadow-native-r3/shadow.glb`, SHA256 `8a1953721aae2929ac769d1a0b36caffd39612648964abc38987afc74ea80a8f`. Readbacks/report/producer: `/tmp/scenetoweb-shadow-basic-control-r1`. The report pins all12 raw Float32 readbacks. Gate was declared in the producer before capture: opaque-versus-disabled caster must differ by >100 words and the opaque repeat must be bit-identical. No numerical tolerance.

| Actual backend/adapter | Basic box→plane changed words | Untouched stock GLB changed words | Repeat changes |
| --- | ---: | ---: | ---: |
| WebGPU, Apple metal-3 | 3873 | 3465 | 0 |
| WebGL2, ANGLE Metal Apple M5 Pro | 3873 | 3465 | 0 |

All4 tuples pass, with no page/HTTP/shader errors. Both backend identity and actual device/GL identity are asserted. Each tuple owns a fresh renderer/light/scene, uses public setAnimationLoop ticks and preserves all3 raw readbacks. The GLB clear hash is `5a063598fdffee731713ef1b5d3f3311de1dfd25e7f5f22e48588c5bebac6b69`, exactly the constant clear image in the earlier failed rootr5 negative. Geometry, lights, camera and ordinary stock material can therefore observe shadows; this does not validate compiled masking, dynamic material replacement or mixed casters.

## Source-derived cache hypothesis

Pinned installed Three0.184.0 source:

- `src/nodes/lighting/ShadowFilterNode.js` getShadowMaterial creates one override NodeMaterial per light.
- `src/renderers/common/Renderer.js` renderObject temporarily replaces that override's colorNode using `_getShadowNodes(sourceMaterial)` and then restores it. It does not increment the override material version in that path.
- `src/renderers/common/RenderObjects.js` keys a RenderObject by object, override material, render context and lights. It recomputes the material cache key only when material.version or the dynamic cache changes.
- `src/renderers/common/RenderObject.js` dynamic shadow-pass key ignores environment/light-node cache and includes receiveShadow/context. The source material replacement is not among those fields.

Consequently the same object's shadow RenderObject may retain the first compiled discard shader after a later source-material swap, despite a different source material identity and advancing animation frame. This is source-derived diagnosis, not an instrumented confirmation of actual internal pipeline reuse. Distinct caster objects have separate RenderObjects, so shared override identity alone does not establish cross-object contamination. A fresh mixed-caster control is required before admission. Fresh controls must also establish mask behavior independently of whichever shader compiled first. Do not simply call the earlier all-clear negative a passing gate.

## Replay

After coordinating GPU ownership, produce a fresh unique directory:

```
node experiments/shadow-basic-control/browser.mjs /tmp/scenetoweb-shadow-native-r3 NEW_DIRECTORY --gpu-lease
```

CPU-only independent replay verifies producer hash, backend/adapter, raw hashes, word metrics and exact repeats:

```
node experiments/shadow-basic-control/read.mjs /tmp/scenetoweb-shadow-basic-control-r1
```
