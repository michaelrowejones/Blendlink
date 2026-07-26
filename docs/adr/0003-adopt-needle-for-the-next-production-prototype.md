# Adopt Needle for the next production prototype

Status: superseded by ADR 0004 on 2026-07-19

Needle Engine is the default Blender-to-web publishing layer for the next representative production scene. Use its supported React web component, not direct React Three Fiber interop, unless a project demonstrates that sharing the R3F renderer and reconciler is essential.

The artist authors the scene, animation, components, baked/dynamic classification, lightmapped lights, and lightmap scale in Blender. The generated `assets` directory belongs to Needle and is not a home for hand-authored web assets. Web developers consume Needle's runtime and generated scene bindings from the surrounding React application.

Blendlink product development is frozen, not deleted. Its repository and bake research remain available until Needle has passed a production-scale scene with final-quality lightmaps, topology iteration, authenticated CI/self-hosting, licensing, and acceptable bundle cost. Production transforms require a Needle Cloud login or token; this is an explicit adoption dependency. Archive Blendlink if that trial reveals no demonstrated blocker. Resume only as a narrowly scoped tool if committed atlas ownership, direct R3F control, portable additive bounced lighting, or runtime/license independence proves materially necessary.

The adoption spike is `experiments/needle-spike`; its README contains the runnable workflow and observed caveats.
