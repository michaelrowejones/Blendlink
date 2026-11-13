# EEVEE live fidelity and Cycles baking

Status: accepted on 2026-11-12

Use EEVEE as the reference for live shading and node translation where
applicable. Preserve Cycles scenes primarily through material/channel baking
and artist-selected appearance capture. This directs new implementation and
verification work toward smooth realtime export.

New live ports must reproduce the applicable EEVEE constant and shader
evaluation paths, including native input storage, geometry bindings and
compositing. Compositor CPU/GPU execution remains an independent contract:
using EEVEE to render a scene does not select the compositor evaluator.

Retain existing verified Cycles ports and serialized program behavior within
their documented domains. Additional Cycles-specific path tracing, tangent
generation or CPU precision profiles do not block an otherwise proven EEVEE
port. Shared functions can continue to carry evidence for both engines.

The source scene keeps its engine. Automatic fallback must not switch engines
when equivalence is unproven. A bake is recorded as a bake, and a static capture
does not earn live-node support. Unsupported dynamic or view-dependent behavior
continues to produce a named diagnostic.

The artist uses the existing preview, export and material-fidelity controls;
this decision adds no installation steps or technical renderer selection.
