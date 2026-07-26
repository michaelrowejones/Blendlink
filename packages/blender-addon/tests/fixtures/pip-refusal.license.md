# Pip refusal fixture attribution

The topology and authored names in `pip-refusal.json` are derived from
**Pip - Shading Breakdown**, created by **Simon Thommes** and published by
**Blender Studio** under the
[Creative Commons Attribution 4.0 license](https://creativecommons.org/licenses/by/4.0/).
The source asset and attachment metadata are available from the
[Blender Studio asset record](https://studio.blender.org/projects/api/assets/2618/?site_context=gallery).

The official Blender 2.90.2 attachment has SHA-256
`B62B5A38350E80626DE5593CD1E1BA79664849DC55CDB9B20B396BC2A27A1C26`.
The locally inspected Blender 5.1 resave has SHA-256
`60AFB3EEB71131F9D7DF942901CC3A5311C64A12BEDC4EDF9BC1932386AB2B63`.

The repository does not redistribute either `.blend` file. The headless test
constructs a minimal scratch scene containing only the names and unsupported
behavior needed to verify Blendlink's refusal contract. It does not reproduce
Pip artwork, geometry, textures, or the complete shader implementation.
