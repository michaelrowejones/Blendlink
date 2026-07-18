# blendlink

> **Import .blend files like code.**
> Typed scene modules for any GLB — Blender sync first-class.

`blendlink sync` turns a `.blend` file into a standard GLB plus a generated,
typed TypeScript module: every object, material, animation clip, and custom
property becomes an autocompleted name. Rename something in Blender and you
get a compile error, not a silent `getObjectByName === undefined`.

Works with plain three.js and React Three Fiber via drei's `useGLTF` — no
runtime library, no engine, no lock-in. Delete blendlink and your GLB and
generated types keep working forever.

Status: pre-release spike. See `docs/` in the flagship project for the full
vision and research trail.
