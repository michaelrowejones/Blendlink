# Splash sky diagnosis

This retained prototype isolates the current Blender 4 Splash
`DP-SkyPaint.MAT` failure without changing production code.

Read the complete finding in
[`docs/research-splash-sky-materialization-2026.md`](../../docs/research-splash-sky-materialization-2026.md).

## Reproduce

Inspect the exact source graph:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\splash-sky-diagnosis\inspect_blend.py -- `
  artifacts\release-dogfood\blender-4-splash\fixtures\blender-4.0-splash-selected-sky.blend
```

Extract and attest the current embedded sky PNG:

```powershell
node experiments\splash-sky-diagnosis\inspect_glb.mjs `
  artifacts\release-dogfood\blender-4-splash\public\models\blender40SplashSelectedSky\3727e808731b5ac1550e15f4f0f0d37a533996685d9cb256030e289f68851fd2\blender40SplashSelectedSky.glb `
  experiments\splash-sky-diagnosis\output\sky.png
```

Render the isolated authoritative sky:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python experiments\splash-sky-diagnosis\render_isolated_sky.py -- `
  artifacts\release-dogfood\blender-4-splash\fixtures\blender-4.0-splash-selected-sky.blend `
  experiments\splash-sky-diagnosis\output\isolated-sky.png
```

Run the browser sampler and projected-surface differential:

```powershell
node experiments\splash-sky-diagnosis\run_projected_control.mjs
```

The last command must exit zero. It asserts that the current raw browser
capture is reproduced byte-for-byte, disabling mipmaps is also byte-identical,
nearest filtering is worse, one surface-scoped projected material is
installed, and the isolated projected sky passes the fixture sky gate.

`apply_authored_look.py` is a separate negative control: it applies the exact
Blender Filmic/look/exposure/gamma settings to the current browser PNG.
Chromatic error improves, but the local-noise gate stays red, proving that look
transport alone is insufficient.
