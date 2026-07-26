# Ellie zero-configuration audit

This cell keeps Blender's official Ellie Animation bundle immutable and runs
Blendlink with only the source path and a generated scene name. Python
auto-execution remains disabled by Blendlink's Blender invocation.

The source archive and extracted `.blend` are retained under ignored local
`artifacts/release-dogfood/next-corpus/sources/`. Their identities and
read-only capability inventory are recorded in
`docs/demo-corpus-inventory.json` and
`docs/research-demo-corpus-expansion-2026.md`.

After building the local package, run:

```powershell
node run.mjs
```

A blocked plan is a valid result only when it names the exact renderable
behavior that stock glTF would lose. It must not write a Preview artifact or
mutate the source `.blend`.

The runner verifies those invariants and retains the complete structured plan,
stderr, and a compact source/publication summary under `evidence/`.

## Current result

The 2026-07-25 untouched Final run refuses before publication with 41
`material.used-needs-bake` errors affecting 41 actually used materials. The
diagnostics name the owning materials and meshes and enumerate the concrete
non-portable inputs, including generated coordinates, procedural textures,
mixed shader closures, non-image normal inputs, camera/view-dependent nodes,
subsurface, sheen, anisotropic, transparent, and Hair BSDF paths.

This is a useful loud negative, not animation parity evidence: material
preflight stops the plan before a rig or browser artifact exists. The source
remains byte-identical at
`20e00af5488721c5bf5a10534e7f6a5cef667849c671773daf8348b7c1237b9e`,
and no publication file is emitted. Generated Blender and Khronos fixtures
remain the compact positive animation lanes.
