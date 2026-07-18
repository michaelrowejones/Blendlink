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

## Quickstart

```bash
blendlink init      # scaffold blendlink.config.mjs from your .blend files
blendlink sync      # export + generate typed modules (uses your installed Blender)
blendlink doctor    # check Blender, config, drift, and environment any time
```

Commit the generated artifacts (plain git — no LFS, no postinstall).
`blendlink verify` in CI catches drift without needing Blender installed.
`blendlink sync --watch` re-syncs on every save from Blender.

## The vocabulary

Name things in Blender; get typed, validated structure in the web build.
Every token is linted — typos like `-collonly` warn instead of failing silently.

| You author | You get |
| --- | --- |
| `Crate-col` / `Crate-convcol` | trimesh / convex collider (object stays visible) |
| `Crate-colonly` / `-convcolonly` | collision-only proxy, removed from the render |
| `Barrel-rigid` + `mass`/`friction` props | typed rigid-body entry |
| `Rock_LOD0` … `_LOD2` + `lod_distance` | LOD chain with switch distances (gaps warn) |
| `SOCKET_Muzzle` (empty) | typed attachment transform |
| `HOTSPOT_Info` (empty + `title`/`body`) | typed interactive marker |
| `AUDIO_Hum` (empty) | typed positional-audio anchor |
| `RefGrid-noimp` | excluded from export (reported, never silent) |
| Bezier curves | typed Y-up point data for camera paths |
| Timeline markers | named seconds for scroll-scrub bindings |
| `mode: 'baked'` scenes | Cycles Combined atlas + unlit export, lighting states |

## Companion Blender addon

`packages/blender-addon` makes the vocabulary one-click inside Blender: tag
colliders/LODs/rigid bodies, drop typed anchor empties, see the lint live,
and preview what blendlink sees as a viewport overlay. The sidebar shows
whether your saved file matches the last sync — and when it doesn't, the
exact command to run. Authoring-only: the CLI always owns export.

## Bespoke pipelines

Already have your own export pipeline? Declare the scene `external` with a
`build` command and blendlink orchestrates without owning it:

```js
{
  file: 'assets/scene.blend',
  glb: 'public/models/scene.glb',
  url: '/models/scene.glb',
  external: true,
  build: 'npm run my-bake && blendlink typegen public/models/scene.glb --blend assets/scene.blend',
}
```

`sync` runs the build only when the .blend drifted, `sync --watch` makes
save-in-Blender trigger it, and `verify` drift-checks it in CI like any
other scene.

Status: pre-release spike. See `docs/` in the flagship project for the full
vision and research trail.
