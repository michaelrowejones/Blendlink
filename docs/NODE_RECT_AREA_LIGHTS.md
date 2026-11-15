# Rect Area lights with translated materials

Generated websites, Preview Studio and generated Three/R3F integrations enable renderer-local Area lighting with an initialized Three r184 `WebGPURenderer`. This works on its WebGPU and WebGL2 backends. Existing direct SDK callers opt in explicitly:

```ts
const installed = await installThreeCompiledScene({
  renderer, scene, descriptor, createBakedScene,
  nodeRectAreaLights: 'renderer-local',
})
```

The option owns private LTC textures for that renderer. It creates a unique private RectAreaLight subclass and registers its matching node class through the renderer's light-node library. The node uses private tables instead of Three's write-only `RectAreaLightNode.setLTC` state. The initializer is bound to a private table receiver: it never replaces application-owned `RectAreaLightTexturesLib.LTC_*`, `UniformsLib.LTC_*`, or the existing RectAreaLight node mapping.

Concurrent installed scenes on one renderer share four private tables. The last scene release disposes those tables after its private light children have been disposed. Remount creates fresh tables and reuses the same private registration, so repeated scene installation does not accumulate registrations. Other renderers have independent tables and classes. The same evaluated Three peer is required. A replaced private registration, cancellation, failed allocation or upload fails explicitly and releases owned resources.

Without this option, authored Area descriptors on a node renderer retain a named refusal. Existing legacy WebGLRenderer behavior remains available. No authored descriptors means no LTC work. Node PBR materials count as supported receivers; unlit Appearance/Basic carriers remain unchanged and do not receive these lights. Lighting-atlas double-illumination guards also remain in force.

This implements Three's rectangular LTC approximation. It does not claim Blender/EEVEE numeric identity, emitted-light shadows, or indirect bounce. After integration, the original Impact scene exported and its generated website rendered on actual WebGPU and node WebGL2 contexts with 281 translated assignments and zero skips. [The baseline receipt](release-scene-browser-baseline.json) retains the artifact/browser/native evidence and the still-open camera DOF, fidelity and startup-performance gates. The small fixture checks LTC wiring and resource ownership only.

Validation for the initial change:

- Focused unit checks cover default refusal, two renderers, shared leases, last-release disposal, remount, cancellation, failed initialization, replaced mapping, and node PBR receivers.
- The small actual Metal WebGPU and node-WebGL2 fixture renders a lit PBR plane, verifies a dark control, and checks untouched application globals/base mapping, disposal and remount. Both APIs pass without page, HTTP or shader errors. Local evidence: `/tmp/scenetoweb-node-area-browser-r1/result.json`; repro: `/tmp/scenetoweb-node-area-browser.mjs`.
- Example/first-scene snippets compile for both Three and R3F. The historical exact legacy preview template remains unchanged because it identifies managed sessions during migration; the current live template initializes the node renderer.
