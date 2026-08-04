// @ts-check
// blendlink showcase: the ellie character scene (Phase 4 acceptance).
/** @type {import('blendlink').BlendlinkConfig} */
const config = {
  scenes: [
    {
      file: "scene/ellie_animation.blend",
      // 38 of 50 materials lower into per-channel Material bakes with TSL
      // programs. The remaining 12 (hair, eyes, glass, translucent trims)
      // are measured-refused from every faithful route — hair/transparent
      // BSDFs, view-dependent pupils, multi-binding sets — so this
      // showcase accepts their stock-glTF approximation on screen.
      applicationMaterialAdapter: {
        acknowledgePayloadCollapse: true,
        description:
          "ellie showcase renders the 12 non-lowerable materials " +
          "(hair/eyes/glass/trims) as stock glTF approximations",
      },
    },
  ],
}

export default config
