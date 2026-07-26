# Blendlink / Needle Engine adoption spike

This is a reversible trial of Needle Engine as the Blender-to-web publishing
layer. It uses Needle's supported React web component. The original React
Three Fiber template was also tested, but it is experimental and failed to
build unmodified with the package versions generated on July 19, 2026.

## What the spike proves

- The official Needle Blender add-on exports the Blendlink sample scene.
- Blender animation (`CrateHop`) plays in the browser automatically.
- `Ground` can be baked while the animated `Crate` remains realtime.
- Needle creates and exports `NEEDLE_LightmapUV` and a packed lightmap.
- The Vite plugin generates typed bindings for Blender nodes and components.
- A React application can embed the result without a custom scene loader.

The lightmap is intentionally only 128x128 at Preview quality. It validates the
workflow, not final visual quality.

## Run it

```powershell
npm install
npm start
```

Open `https://localhost:3000` and accept the local development certificate.

## Re-export the copied Blender scene

The Needle add-on must be installed and enabled in Blender. The trial was run
with Blender 5.2 LTS and Needle's Blender add-on 1.4.2.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background scene\blendlink-sample.blend `
  --python scripts\export_blend_scene.py `
  -- (Resolve-Path .)
```

The copied `.blend` stores the web-project connection. Needle owns `assets/`
and clears existing files there during export, so do not mix hand-authored web
assets into that directory.

## Trial caveats

- Commercial use requires a Needle license.
- `npm run build:production` requires a Needle Cloud login or
  `NEEDLE_CLOUD_TOKEN`; the trial's unauthenticated production transform exits
  with code 6 after the app bundle is compiled.
- Lightmapping and direct React Three Fiber interop are both documented as
  experimental.
- The R3F scaffold generated mutually incompatible Three/Drei versions and
  referenced a stale `Cube.glb` after Blender exported `scene.glb`.
- The add-on emits non-fatal warnings under headless Blender and its bake flow
  needs a Blender UI context.
- Generated scene bindings live under `node_modules`, so CI should regenerate
  them rather than expect them to be committed.
