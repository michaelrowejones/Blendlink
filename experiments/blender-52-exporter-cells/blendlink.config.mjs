export default {
  blenderPath: 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  outDir: 'output/blendlink',
  genDir: 'output/generated',
  urlPrefix: '/blender-52-exporter-cells',
  scenes: [
    {
      name: 'portableFactors',
      file: 'output/fixtures/portable-factors.blend',
    },
    {
      name: 'portableAlphaMask',
      file: 'output/fixtures/portable-alpha-mask.blend',
    },
    {
      name: 'unsupportedProcedural',
      file: 'output/fixtures/unsupported-procedural.blend',
    },
  ],
}
