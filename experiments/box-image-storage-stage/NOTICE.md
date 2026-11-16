# Experimental mip model attribution

The experimental `mip-model.mjs` and `mip-model-unorm-store.mjs` model the power-of-two reduction and `SharedSRGB` intermediate-storage semantics in Blender's `source/blender/gpu/shaders/gpu_shader_update_mipmaps.bsl.hh`.

The upstream shader's notice states:

> SPDX-FileCopyrightText: 2021 NVIDIA Corporation
> SPDX-FileCopyrightText: 2026 Blender Foundation
> SPDX-License-Identifier: Apache-2.0
> Adapted code from NVIDIA Corporation.

The applicable license is the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0). The upstream shader describes its reduction algorithm as based on [NVIDIA's Vulkan Compute Mipmaps sample](https://github.com/nvpro-samples/vk_compute_mipmaps/tree/main/nvpro_pyramid).

The SceneToWeb versions translate the relevant power-of-two arithmetic into JavaScript for an isolated CPU experiment, add PNG decoding and comparisons, and separate a normalized-store rounding hypothesis. They do not implement the shader's complete dimensional, format, layer, tile, or GPU behavior. Their file-level license is Apache-2.0. Native Blender capture helpers and the imported experimental BOX/comparison code retain their own file-level licenses; none of this research is added to the MIT SceneToWeb runtime.

This notice is additive. The frozen `09b5310` model, producer scripts, proofs and evidence hashes remain unchanged.

The additive `mip-model-bsl-f32.mjs` separates the source's Float32 SharedSRGB
operations from typed Metal texture conversion hypotheses.
`gpu-paired-mips.js` transcribes the same bounded power-of-two paired reduction
and shared conversion into WGSL for an isolated hardware-typed attachment
experiment. Both retain the NVIDIA/Blender Apache-2.0 notices. The browser
capture/comparison harnesses retain GPL-3.0-or-later licensing and do not add
this code to the production runtime.
