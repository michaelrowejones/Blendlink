# Authored-frame transport differential (prototype)

Question: how can Blendlink show the frame and pose saved by the artist without
corrupting skin binds, silently dropping evaluated constraints/drivers, or
taking ownership of application animation playback?

Run:

```powershell
node experiments/authored-frame-transport-prototype/run.mjs
```

This is a throwaway design differential, not production Blendlink behavior. The
single command:

1. generates a Blender 5.2 fixture saved at frame 10 whose animation begins at
   frame 0;
2. samples Blender's evaluated dependency graph at frames 0, 10, and 20;
3. exports six GLBs through exact, recorded stock-export settings;
4. loads them with Three 0.184 in real Chrome/WebGL;
5. tests their default state, clip playback, skin deformation, source
   restoration, and an intentionally unsupported material driver; and
6. writes immutable source/artifact identities and browser evidence to
   `output/evidence.json`.

The fixture includes:

- `ConstrainedCube`, which has no keys and follows `MotionTarget` through Copy
  Location;
- `AuthoredCamera`, whose keyed location and Track To constraint jointly
  determine the view;
- `DrivenCube`, whose X location comes from an animated custom-property driver;
- a one-bone skinned ribbon whose saved pose differs from rest;
- an animated Principled Roughness driver that core glTF cannot transport.

The command's test seam is the observable Blender -> GLB -> Three behavior. It
does not test exporter helper functions or manually recompute expected values.

## Last result

Passed on 2026-07-25 with Blender 5.2.0 LTS, glTF exporter 5.2.39,
Three 0.184.0, Vite 7.3.6, Playwright 1.60.0, and Chrome 150:

```text
BLENDLINK_AUTHORED_FRAME_TRANSPORT_PROTOTYPE_PASSED A=3.720e-7 B=3.720e-7 C=3.720e-7 D-idle=3.386e-7 D-play=2.154e+0
```

`A`, `B`, and `C` are exact within the `7e-4` portable transform/skin gate.
`D` is exact while idle and after stop/reapply; its intentionally red playback
number proves ordinary Actions still omit the unkeyed follower and
transform-driven object.

The non-portable material driver is separately verified. Blender evaluates
Roughness as `0.15 -> 0.55 -> 0.90`; core glTF holds `0.55` at all three
times. The prototype emits:

```text
animation.material-driver-not-portable:
DrivenCubeMaterial -> Principled BSDF -> Roughness
```

Useful visual artifacts:

- [`output/blender-authored-frame.png`](output/blender-authored-frame.png)
- [`output/browser-evidence.png`](output/browser-evidence.png)
- [`output/browser-canvas.png`](output/browser-canvas.png)

The full research and design comparison is in
[`docs/research-authored-current-frame-transport-2026.md`](../../docs/research-authored-current-frame-transport-2026.md).
