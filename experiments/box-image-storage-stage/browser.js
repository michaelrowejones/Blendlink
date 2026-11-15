import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { screenCoordinate, uniform, vec2, vec3, vec4, texture, textureLoad, int, ivec2, attribute, positionWorld } from 'three/tsl'
import { buildGeometryContext } from '@geometry-context'
import { boxSample, boxWeights } from '@box-candidate'
import { geometryFrame } from './geometry-inputs.mjs'

window.captureBoxNormalStage = async ({ backend, contract, native, inputs, assetBase }) => {
    const renderer = new WebGPURenderer({ forceWebGL: backend === 'webgl2', antialias: false })
    const result = { status: 'running', backend, rows: [], lodRows: [], errors: [], supportCredit: 0 }; window.boxNormalFailure = result
    const target = new THREE.RenderTarget(64, 4, { type: THREE.FloatType, depthBuffer: true }); target.texture.colorSpace = THREE.NoColorSpace
    const frames = inputs.cases.map(input => ({ input, ...geometryFrame(input) })), maps = [], materials = [], bitmaps = []
    try {
        await renderer.init(); const webgpu = renderer.backend.isWebGPUBackend === true
        if ((webgpu ? 'webgpu' : 'webgl2') !== backend) throw Error('Actual API fallback')
        const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info'), info = renderer.backend.device?.adapterInfo
        result.gpu = webgpu ? { vendor: info?.vendor, description: info?.description, architecture: info?.architecture }
            : { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) }
        renderer.debug.onShaderError = (g, p, v, f) => result.errors.push([g.getProgramInfoLog(p), g.getShaderInfoLog(v), g.getShaderInfoLog(f)].filter(Boolean).join('\n'))
        renderer.backend.device?.addEventListener('uncapturederror', event => result.errors.push(String(event.error)))
        renderer.setSize(64, 4); renderer.setPixelRatio(1); renderer.setClearColor(0, 1)
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
        function material(node) {
            const m = new NodeMaterial(); m.fragmentNode = node; m.side = THREE.DoubleSide; m.blending = THREE.NoBlending; m.depthTest = true; m.depthWrite = true; materials.push(m); return m
        }
        const white = material(vec4(1, 1, 1, 1)), coordinate = uniform(new THREE.Vector4()), blend = uniform(contract.blend)
        const p = vec3(screenCoordinate.x.div(64).mul(coordinate.x).add(coordinate.y), coordinate.z, coordinate.w)
        const actual = new Map()
        for (const frame of frames) for (const profile of contract.profiles) {
            const n = buildGeometryContext({ op: 'geometry_context', model: 'primary-triangles-v1', output: 'object-normal', sourceEngine: 'EEVEE', normalStorage: profile }, frame.input.basis)
            const weights = boxWeights(n, blend).toVar()
            actual.set(frame.input.id + '|' + profile, { normal: n, normalMaterial: material(vec4(n.mul(.5).add(.5), 1)), weightMaterial: material(vec4(weights, 1)) })
        }
        async function draw(id, frame, m, metadata = {}) {
            frame.mesh.material = m; renderer.setRenderTarget(target); const started = performance.now()
            renderer.render(frame.scene, frame.camera)
            const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 4)
            result.rows.push({ id, width: 64, height: 4, ...metadata, words: Array.from(new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)), drawAndReadbackMs: performance.now() - started })
        }
        // Independent storage control uses the same target before any
        // geometry-stage comparisons, with no native per-pixel inputs.
        const control = material(vec4(.125, .375, .625, 1)), quad = new QuadMesh(control)
        renderer.setRenderTarget(target); quad.render(renderer)
        const calibration = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 4), wanted = new Uint32Array(new Float32Array([.125, .375, .625, 1]).buffer)
        if (!new Uint32Array(calibration.buffer, calibration.byteOffset, calibration.length).every((word, i) => word === wanted[i % 4])) throw Error('RGBA32F storage calibration failed')
        result.storageCalibration = { words: Array.from(new Uint32Array(calibration.buffer, calibration.byteOffset, calibration.length)), wordDifferences: 0 }
        for (const frame of frames) for (const profile of contract.profiles) {
            const state = actual.get(frame.input.id + '|' + profile)
            await draw(profile + '-' + frame.input.id + '-mask', frame, white, { kind: 'mask', profile, case: frame.input.id })
            await draw(profile + '-' + frame.input.id + '-normal', frame, state.normalMaterial, { kind: 'normal', profile, case: frame.input.id })
            await draw(profile + '-' + frame.input.id + '-weights', frame, state.weightMaterial, { kind: 'weights', profile, case: frame.input.id })
            await draw(profile+'-'+frame.input.id+'-face',frame,material(vec4(vec3(attribute('boxFaceId','float')),1)),{kind:'face',profile,case:frame.input.id})
            const world=frame.input.basis==='gltf-y-up'?vec3(positionWorld.x,positionWorld.z.negate(),positionWorld.y):positionWorld
            await draw(profile+'-'+frame.input.id+'-position',frame,material(vec4(world.mul(.03125).add(.5),1)),{kind:'position',profile,case:frame.input.id})
        }
        const primary = native.sourceSettings.normalStorage, maxAnisotropy = renderer.getMaxAnisotropy(), requested = native.sourceSettings.renderAnisotropicSamples
        if (maxAnisotropy < requested) throw Error('Renderer cannot meet the actual native scene anisotropy')
        result.samplerPolicy = { nativeSceneSamples: requested, maximumAnisotropy: maxAnisotropy, globalStateChanged: false }
        const textures = new Map()
        for (const entry of native.images) {
            const response = await fetch(new URL(entry.file, assetBase)); if (!response.ok) throw Error('Pinned image fetch failed')
            const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); bitmaps.push(bitmap)
            for (const policy of contract.policies) {
                const map = new THREE.Texture(bitmap); maps.push(map); map.flipY = false; map.colorSpace = entry.colorSpace === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
                map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter; map.minFilter = policy === 'nomip' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter
                map.generateMipmaps = policy !== 'nomip'; map.anisotropy = policy === 'scene-aniso' ? requested : 1; map.needsUpdate = true; textures.set(entry.name + '|' + policy, map)
            }
        }
        // Explicit LOD probes sample original byte-backed image textures.
        // Native supplies only authored coordinates/LOD, never answers.
        for(const entry of native.images) for(let level=0;level<=10;level++) for(const kind of ['fetch','linear']){
            const map=textures.get(entry.name+'|mip'),uv=vec2(screenCoordinate.x.sub(.5).mul(.137).add(.1875).fract(),.37109375)
            const node=kind==='fetch'?textureLoad(map,ivec2(uv.mul(Math.max(1,1024>>level)).floor())).level(int(level)):texture(map,uv).level(level)
            quad.material=material(node);renderer.setRenderTarget(target);quad.render(renderer)
            const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,64,4),words=new Uint32Array(pixels.buffer,pixels.byteOffset,256)
            result.lodRows.push({id:entry.name+'-lod-'+level+'-'+kind,image:entry.name,level,kind,words:Array.from(words)})
        }
        result.actualTextureFormats=native.images.map(entry=>{const map=textures.get(entry.name+'|mip'),data=renderer.backend.get(map);return {image:entry.name,type:map.type,colorSpace:map.colorSpace,webgpu:data.texture?.format??null,webglInternalFormat:data.glInternalFormat??null}})
        for (const frame of frames) {
            coordinate.value.set(8, .125, .375, .625)
            await draw(primary + '-' + frame.input.id + '-input', frame, material(vec4(p, 1)), { kind: 'input', case: frame.input.id, profile: primary })
            const n = actual.get(frame.input.id + '|' + primary).normal
            for (const image of native.images) for (const policy of contract.policies) {
                const m = material(boxSample(textures.get(image.name + '|' + policy), p, n, blend))
                for (const frequency of contract.frequencies) {
                    coordinate.value.set(frequency, .125, .375, .625)
                    await draw(primary + '-' + frame.input.id + '-' + image.name + '-' + frequency + '-' + policy, frame, m, { kind: 'sampler', profile: primary, case: frame.input.id, image: image.name, frequency, policy })
                }
            }
        }
        result.status = 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH'; return result
    } finally {
        renderer.setRenderTarget(null); target.dispose(); for (const m of materials) m.dispose(); for (const map of maps) map.dispose(); for (const bitmap of bitmaps) bitmap.close(); for (const frame of frames) frame.dispose(); renderer.dispose()
    }
}
