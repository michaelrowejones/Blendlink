# Reflection-probe parity: Needle 1.4.2, Engine 5.1.7, and Blendlink

Date: 2026-07-23  
Status: implementation plus focused Blender, TypeScript, and runtime
CubeCamera/PMREM Chromium evidence are current. Published panorama loading and
cross-browser/device pixels remain future work.

## Decision summary

Blendlink now follows Needle's sound core choice for offline probes: render one
equirectangular panorama with Cycles and use GPU compute when available, with a
truthful CPU fallback. This is the one approved exception to the rule that
Eevee owns an Eevee-authored scene's appearance.

Blendlink deliberately differs where the evidence supports a safer contract:

- a face-detail value `R` produces a lossless half-float ZIP EXR at `4R × 2R`;
  Needle's field is panorama width and produces a lossy 32-bit DWAA EXR at
  `R × R/2`;
- every probe in Bake All renders and validates before any prior asset is
  replaced; Needle commits probes one at a time;
- exact bytes, dependency evidence, assignment membership, and stable IDs
  determine staleness instead of file modification time;
- assigned reflective receivers are excluded transactionally, on success and
  failure, so a helper centered inside a closed selected mesh cannot capture
  the mesh interior;
- Cycles device policy is canonical in `bakelib.py`, and a live probe capture
  restores the artist's scene device, compute backend, and every discovered
  device-enable flag;
- a reachable Shader to RGB contributor is refused as a **known** Eevee-only
  blocker with a Custom Texture remedy. This is not presented as a complete
  Eevee/Cycles compatibility proof.

Needle Engine's runtime `ReflectionProbe.ts` does not capture the web scene. It
loads or accepts a texture, registers influence/anchor lookup, and applies
material-property overrides. Blendlink matches that published-source outcome
and additionally provides an opt-in package-owned one-shot
`CubeCamera → PMREM` runtime route. Runtime capture is therefore a
**No analogue / Improvement**, not a Needle parity claim.

## Pinned primary implementation sources

`npm run verify:needle-baseline` identifies all of these local sources and
their package versions.

| Source | SHA-256 | What was inspected |
| --- | --- | --- |
| Needle add-on 1.4.2 `operators_reflectionprobe.py` | `a085bdfedc88baac932a1e6da8ca5eddaedf5800173f9ff025db561c5e35b5a4` | temporary panoramic camera, Cycles GPU/CPU selection, `R × R/2`, 32-bit DWAA EXR, owner visibility, state restore, per-probe commit |
| Needle add-on 1.4.2 `settings_scene.py` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` | scene authoring and reflection-probe settings |
| Needle add-on 1.4.2 `data/builtin.component.json` | `d32f28bc6beb4379dcce1b12e114c389f56e493e4e0820123c9a500dfb867382` | authored component schema |
| Needle Engine 5.1.7 `src/engine-components/ReflectionProbe.ts` | `02505478fdf0cfbb5e756864d4016dd38fe5536c221955dc907f97b4e187d836` | async PMREM texture loading, influence/anchor lookup, material overrides, enable/disable lifecycle; no runtime scene capture |

Relevant official contracts:

- [Blender Cycles panoramic cameras](https://docs.blender.org/manual/en/4.2/render/cycles/object_settings/cameras.html)
  specify equirectangular `360° × 180°` output and the `(90°, 0°, -90°)`
  orientation used by both implementations.
- [Blender Cycles GPU rendering](https://docs.blender.org/manual/en/latest/render/cycles/gpu_rendering.html)
  requires both a selected compute backend/device and the scene's GPU device.
- [Three PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)
  distinguishes cube/equirectangular inputs, documents 256-pixel cube faces
  and 1024×512 equirectangular input as ideal, and requires explicit resource
  disposal.

## Design comparison

### Panorama engine

| Design | Result | Decision |
| --- | --- | --- |
| Render the panoramic camera through Eevee | Blender 5.2 returns `FINISHED`, but the output is a perspective-like `+X` face; the other five cardinal emitters are absent | Rejected: a success return is not a valid panorama |
| Render six Eevee cameras and stitch a panorama | Could preserve more Eevee-only shading, but adds seams, another projection/color pipeline, six render-state transitions, and substantial test surface | Rejected: no evidence justified a second probe compiler |
| Render one Cycles equirectangular camera | Correct six-direction image in Blender 5.2 and matches Needle's underlying approach | Selected as the narrow offline-probe exception |

The exact differential used red/cyan/green/magenta/blue/yellow emissive spheres
at `±X/±Y/±Z`. Blender 5.2.0 LTS (`fbe6228777e7`) returned `FINISHED` for both
engines. Eevee produced only the red `+X` view; Cycles placed `+X` at center,
`+Y` at quarter width, `-X` across the seam, `-Y` at three-quarter width, and
`±Z` at the poles.

### Receiver exclusion

| Design | Consequence | Decision |
| --- | --- | --- |
| Hide only the probe helper/owner | Works when the probe component itself is the receiver; fails for Blendlink's separate helper plus explicit assigned meshes | Rejected for Blendlink |
| Hide each assigned receiver in the artist scene and restore in `finally` | Smallest mutation, preserves the exact evaluated scene, and is testable on failure | Selected |
| Duplicate the complete scene and remove receivers in a staging copy | Strong isolation, but duplicates heavy evaluated data and changes dependency/instance semantics | Future only if live-scene visibility mutation proves unsafe |

Offline capture uses `hide_render`; standard Three runtime capture uses
`Object3D.visible`, which suppresses the complete assigned subtree. Assignment
membership is included in the probe fingerprint, so moving an object into or
out of a probe requires new bytes even if the conservative scene fingerprint
is reused during one batch.

### GPU ownership

| Design | Consequence | Decision |
| --- | --- | --- |
| Keep separate atlas/probe backend selectors | Easy to drift in ordering, hybrid CPU policy, diagnostics, and future backend support | Rejected |
| One canonical selector plus an optional live-scene state transaction | One policy; background atlas export may retain its selected backend, while probe authoring restores artist preferences | Selected |

The local log may include the exact device name for diagnosis. Returned and
artist-facing evidence contains only `cpu/cpu` or the privacy-safe broad GPU
backend.

## Current evidence

| Capability ID | Relation | Implementation | Evidence |
| --- | --- | --- | --- |
| NDL-PRB-001 | **Improvement** | **Shipped** | Runtime/Baked/Custom authoring, exact-byte publication, atomic multi-probe commit, and source staleness. Focused real Blender fixture passed 2026-07-23 |
| NDL-PRB-002 | **Boundary / Match** | **Shipped Cycles exception** | Blender 5.2 Eevee/Cycles cardinal differential plus official Cycles panoramic-camera contract. Eevee remains authoritative everywhere outside offline probe capture |
| NDL-PRB-003 | **No analogue / Improvement** | **Shipped** | Needle runtime source proves texture loading/application only. Blendlink's production one-shot CubeCamera/PMREM route passes unit lifecycle tests and a real Chromium gate: exact six-face source orientation, `0 → 14,434` chromatic presentation pixels after PMREM, temporary-resource cleanup, owned-PMREM disposal, and idempotent teardown |
| NDL-PRB-004 | **Improvement** | **Shipped** | Assigned receiver hidden during offline and runtime capture and restored after success/forced failure; assignment membership changes the source hash. The Blender fixture captures through a closed receiver at the origin, and the browser fixture observes zero receiver renders during CubeCamera capture versus two after restoration |
| NDL-PRB-005 | **Improvement** | **Shipped** | Canonical exact-backend GPU selection with CPU fallback; live capture restores scene device, compute backend, and device flags. Physical cross-vendor performance remains pending |
| NDL-PRB-006 | **Improvement** | **Shipped known-blocker gate** | Reachable Shader to RGB contributor refuses offline Cycles capture with material/object context and a Custom Texture remedy. The diagnostic does not claim universal compatibility |

Focused commands and current outcomes:

```text
python packages/blender-addon/tests/probe_authoring_test.py
BLENDLINK_PROBE_AUTHORING_PURE_PASSED

"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" \
  --background --factory-startup --python-exit-code 1 \
  --python packages/blender-addon/tests/probe_authoring_check.py
BLENDLINK_PROBE_AUTHORING_CHECK_PASSED

npm run test --workspace packages/blendlink -- --run src/reflectionProbes.test.ts
8 passed

npm run test:reflection-probe-browser
BLENDLINK_REFLECTION_PROBE_BROWSER_PASSED
  captureMs=51.3 chromatic=0->14434 textures=2->1
```

The real fixture ran the selected OptiX path on an RTX 5080. It asserts
orientation from decoded scene-linear EXR pixels rather than relying on
operator success. It also injects a failure after receiver hiding and device
selection, then compares camera, engine, dimensions, output settings, render
policy, color management, Cycles samples/device/backend/device flags, object
visibility, selection, frame, and temporary datablock inventories.

The browser fixture runs the production
`createThreeWebGLReflectionCapture()` and
`applyCompiledSceneReflectionProbes()` interfaces against real Three r184
CubeCamera, WebGL render targets, and PMREM shaders. It reads all six cube-face
centers before filtering, compares the final presentation with a no-environment
negative control, observes receiver render calls, and records exact disposal
events. The generated screenshot and machine-readable evidence live under
`artifacts/reflection-probe-browser-2026/`.

## Limits and next evidence

- Load the published cardinal EXR through the production URL/EXRLoader path and
  compare its final PMREM presentation with the runtime capture. The current
  browser fixture proves six source cube directions before filtering and
  materially visible final PMREM use, but does not independently decode six
  directions from Three's filtered CubeUV layout.
- Repeat the browser gate in Firefox/WebKit/mobile and on a physical GPU. The
  current run used Chromium 150 with WebGL2 ANGLE SwiftShader.
- Add explicit WebGL-context-loss evidence. The injected failure proves
  Blendlink-owned rollback, not Three's internal renderer-state restoration if
  `renderer.render()` itself throws.
- Test CPU plus CUDA/HIP/oneAPI/Metal hosts. The current selection policy is
  source- and state-tested but physical evidence is OptiX-only.
- Blendlink does not yet provide box-projected parallax, probe blending, or
  automatic overlap assignment. Those remain explicit custom-adapter work and
  must not be implied by the influence gizmo.
