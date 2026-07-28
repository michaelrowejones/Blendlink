// @ts-check
// blendlink — artist-authored Blender scenes compiled for Three.js.
// Docs: https://github.com/michaelrowejones/Blendlink
// Each scene becomes <genDir>/<name>.gen.ts + .manifest.json and <outDir>/<name>.glb.
/** @type {import('blendlink').BlendlinkConfig} */
const config = {
  // outDir: 'public/models',   // where GLBs land (served statically)
  // genDir: 'src/generated',   // where typed modules land
  // urlPrefix: '/models',
  // Website preview is auto-detected from package.json. For monorepos or
  // unusual dev servers, make the integration explicit (art settings stay in Blender):
  // website: { root: '.', devCommand: 'npm run dev', url: 'http://localhost:5173' },
  scenes: [
    { file: "scene/cube_diorama.blend" },
  ],
}

export default config
