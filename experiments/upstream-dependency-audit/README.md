# Out-of-line upstream dependency proposal

`out-of-line-groups.json` is source-impact data for the new node-port pipeline,
not support metadata, a closed dependency graph or a native qualification.
It is separate from `node-ports/*.json`, which another owner maintains.

The10 groups contain77 per-revision files (21 in4.2,28 each in5.2/5.3).
Every path was checked against the actual upstream tree, downloaded at the full
commit, SHA256-pinned, and independently matched to its Git blob SHA1 using the
Git `blob <length>\0<content>` framing. All77 matches pass. Empty version lists
mean known version structure, not a missing path hidden as a completed graph.
Full downloaded files/trees remain in this private worker's
`artifacts/upstream-dependency-audit`.

Consumers can flatten `groups[].pathsByVersion[version]` into their manifest's
shared dependencies and verify the referenced entry under
`references[version].files[path]`. The suggested native IDs are impact hints,
not renderer/context claims. Preserve the group's stage notes, especially:

- Squeeze has a GPU callback and **no own MF evaluator**. Folding its inputs is
  a separate graph concern; do not invent a Squeeze MF profile.
- Function-node context routing lives outside individual node files.
  FloatToInt's registered class is not proof of Shader/Compositor usability.
- Modern compositor all-single-value GPU units route through CPU MF. That
  dispatch is `node_group_operation.cc` in5.2 and `node_tree_evaluator.cc` in5.3.
  Legacy4.2 realtime evaluation is a separate group, not that same MF route.
- `BLI_radial_tiling.hh` declares Radial's MF functions. Their implementation
  is `radial_tiling_wrapper.cc` including `radial_tiling_shared.hh`; quoted
  include closure from the node does not reach the wrapper automatically.
- GPU stack linking resolves names through `gpu_node_graph.cc` and
  `gpu_shader_dependency.cc`; `gpu_material_library.hh` has declarations, with
  no corresponding `gpu_material_library.cc` in the measured5.3 tree.
- Image-bearing slices also depend on actual image mapping/filter/color/upload
  and the measured backend texture path. A path match cannot qualify a new
  backend. Image-free slices can retain their narrower dependency domain.

The JSON contains the exact4.2 `DefNode` mapping example and a regex fast path.
Parse balanced macro arguments for the robust implementation: concatenate
arguments1 and5 to form the native RNA ID, retain argument2 as the legacy enum
expression and retain the family/registration context. The static mapping file
does not exist in the measured5.2/5.3 trees, which register string IDs directly.

Continue normal include/`BLENDER_REQUIRE` closure, direct node registration and
GPU literal-symbol discovery alongside these groups. Getter-returned symbols
matter: Squeeze links `squeeze`; Radial resolves `node_radial_tiling` through a
getter; FloatToInt selects four different `float_to_int_*` names. Index shader
definitions across `.glsl` and `.bsl.hh` rather than guessing filenames. New
unresolved/dynamic edges still require review and appropriate requalification.

RNA catalogs remain complementary evidence. Current catalogs enumerate actual
creation in shader/compositor root/group contexts, menu/semantic boolean states
and socket schemas/defaults. They intentionally do not prove numerical domains,
all numeric node properties, image/ID bindings, point handles, animation,
saved-state migration, native evaluator/stage, f32 rounding, texture formats or
backend/compiler behavior. They also hash Blendlink sources, not a complete
upstream semantic dependency closure. A new native archive/backend/profile
therefore still needs canaries when RNA and upstream source hashes match.
Actual Radial MF signed-zero differences across the measured5.2/5.3 builds are
one retained example; do not infer a universal source-stage model from a shared
algorithm header's identical bytes.
