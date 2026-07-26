# PROTOTYPE — Eevee fixed-camera appearance transport

## Question

Can Blendlink capture one final Eevee frame and project it through the exact
authored camera onto the exported scene geometry, preserving the fixed-camera
pixels while retaining depth-tested geometry for picking and occlusion?

This is deliberately **not** a proposal for a general Eevee shader runtime.
The expected validity domain is one static scene, one frame, one camera pose,
and one declared aspect/composition. Moving the camera, geometry, visibility,
or animation is expected to invalidate the result and is captured as an
explicit negative boundary.

## Run

From the repository root:

```powershell
npm.cmd --prefix experiments/eevee-fixed-camera-transport-prototype run verify
```

The one command starts a private local server, loads the retained Splash GLB in
Three r184, captures an application-owned image plate, a geometry projector at
the authored camera, a one-backdrop-mesh semantic control, the same projector
after a camera move, complete/backdrop depth-probe controls, a raw-glTF control,
and the actual Needle browser result, then evaluates the existing
fixture-specific Splash semantic gates.

Outputs are written under `output/`. `overview.png` is the visual primary
source and `evidence.json` records the exact input hashes, browser state,
renderer counts, whole-frame metrics, semantic metrics, and evidence boundary.
The backdrop-only result deliberately proves that exact pixels do not establish
per-surface or object correctness; the red-sphere depth pair independently
proves the depth benefit of retaining the complete exported geometry.

## Throwaway status

Everything in this directory is disposable prototype code. It does not alter a
Blendlink manifest, generated binding, package module, Blender file, dogfood
site, or production runtime.
