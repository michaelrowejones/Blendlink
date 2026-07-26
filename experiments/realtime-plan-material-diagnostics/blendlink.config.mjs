/** @type {import('blendlink').BlendlinkConfig} */
const config = {
  scenes: [{
    name: 'realtimeNeedsBake',
    file: 'fixture/realtime-needs-bake.blend',
  }, {
    name: 'realtimeNeedsBakeAcknowledged',
    file: 'fixture/realtime-needs-bake.blend',
    applicationMaterialAdapter: {
      acknowledgePayloadCollapse: true,
      description: 'src/materials/installAutumnMaterials.ts',
    },
  }],
}

export default config
