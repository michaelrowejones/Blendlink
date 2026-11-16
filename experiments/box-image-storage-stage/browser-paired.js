// SPDX-License-Identifier: GPL-3.0-or-later
import {pairedMips} from './gpu-paired-mips.js'
import {pairedGlMips} from './gl-paired-mips.js'
import * as THREE from 'three'
import { WebGPURenderer, NodeMaterial, QuadMesh } from 'three/webgpu'
import { screenCoordinate, uniform, vec2, vec3, vec4, texture, textureLoad, int, ivec2, attribute, positionWorld } from 'three/tsl'
import { buildGeometryContext } from '@geometry-context'
import { buildTslColorNode, buildTslBlendOperation } from '@recipe'
import { boxSample, boxWeights } from '@box-candidate'
import { geometryFrame } from './geometry-inputs.mjs'

window.captureBoxNormalStage = async ({ backend, contract, native, inputs, assetBase, customInputs, colorGraph }) => {
    const renderer = new WebGPURenderer({ forceWebGL: backend === 'webgl2', antialias: false })
    const result = { status: 'running', backend, webgpuAvailableAtStart:typeof navigator.gpu!=='undefined', deviceLosses: [], rows: [], lodRows: [], errors: [], supportCredit: 0 }; window.boxNormalFailure = result
    const target = new THREE.RenderTarget(64, 4, { type: THREE.FloatType, depthBuffer: true }); target.texture.colorSpace = THREE.NoColorSpace
    const frames = inputs.cases.map(input => ({ input, ...geometryFrame(input) })), maps = [], materials = [], bitmaps = []
    try {
        await renderer.init();renderer.backend.device?.lost.then(info=>result.deviceLosses.push({owner:'renderer',reason:info.reason,message:info.message})); const webgpu = renderer.backend.isWebGPUBackend === true
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
        const generatorDevice=webgpu?renderer.backend.device:null
        const generatorInfo=webgpu?info:result.gpu
        if(!/apple|metal/i.test(JSON.stringify([generatorInfo?.vendor,generatorInfo?.architecture,generatorInfo?.description,generatorInfo?.renderer])))throw Error('Typed-mip generator is not actual Metal')
        result.customMipGeneration={api:(webgpu?'WebGPU':'WebGL2')+'-sRGB/CPU-UNORM',gpu:webgpu?{vendor:info?.vendor,architecture:info?.architecture,description:info?.description}:result.gpu,colorTransfer:'hardware SRGB read/write; BSL SharedSRGB intermediate',images:[]}
        const customChains=new Map()
        for(const entry of native.images){
            const base=customInputs.find(x=>x.image===entry.name);if(!base||base.width!==1024)throw Error('Missing independently decoded PNG input')
            const response=await fetch('/'+base.file);if(!response.ok)throw Error('Missing binary PNG decode fixture')
            const initial=new Uint8Array(await response.arrayBuffer())
            const generated=entry.colorSpace==='Non-Color'?{levels:await Promise.all(base.cpuMips.map(async mip=>{const r=await fetch('/'+mip.file);if(!r.ok)throw Error('Missing CPU source-model mip');return{data:new Uint8Array(await r.arrayBuffer()),width:mip.width,height:mip.height}})),model:'cpu-paired-unorm-store-no-extra-f32-v1',format:'rgba8unorm',errors:[],ownedTextures:0,readbackBuffers:0}:webgpu?await pairedMips(initial,base.width,true,generatorDevice):await pairedGlMips(initial,base.width)
            customChains.set(entry.name,generated.levels)
            const encode=data=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob([data]))})
            const levels=await Promise.all(generated.levels.map(async l=>({width:l.width,height:l.height,base64:await encode(l.data)})))
            result.customMipGeneration.images.push({image:entry.name,...generated,levels})
        }

        for (const entry of native.images) {
            const response = await fetch(new URL(entry.file, assetBase)); if (!response.ok) throw Error('Pinned image fetch failed')
            const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); bitmaps.push(bitmap)
            for (const policy of contract.policies) {
                const chain=customChains.get(entry.name)
                const map = new THREE.DataTexture(chain[0].data,chain[0].width,chain[0].height); maps.push(map); map.flipY = false;
                if(policy!=='nomip')map.mipmaps=chain; map.colorSpace = entry.colorSpace === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
                map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter; map.minFilter = policy === 'nomip' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter
                map.generateMipmaps = false; map.anisotropy = policy === 'scene-aniso' ? requested : 1; map.needsUpdate = true; textures.set(entry.name + '|' + policy, map)
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
        if(colorGraph){
            const graph=colorGraph.output,reference=graph?.b
            if(graph?.op!=='mix_color'||graph.blendType!=='OVERLAY'||graph.clampFactor!==true||graph.clampResult!==false||reference?.op!=='texture_ref'||reference.candidateBox?.model!=='independent-inset-simplex-v1'||reference.ref?.image!=='Plaster-Overlay.png'||reference.candidateBox.blend!==contract.blend)throw Error('Unexpected original color graph shape')
            result.materialColorRows=[]
            for(const frame of frames){
                const options={objectSpace:{basis:frame.input.basis}},document=output=>({...colorGraph,output})
                const mapped=buildTslColorNode(document(reference.vector),options)
                const n=actual.get(frame.input.id+'|'+primary).normal
                const sampled=boxSample(textures.get(reference.ref.image+'|scene-aniso'),mapped,n,blend)
                const base=buildTslColorNode(document(graph.a),options)
                const factor=uniform(graph.factor.value)
                const color=buildTslBlendOperation(graph.blendType,base,sampled.rgb,factor)
                const unmapped=boxSample(textures.get(reference.ref.image+'|scene-aniso'),buildTslColorNode(document({op:'object_coords'}),options),n,blend)
                for(const[kind,node]of [['mask',vec4(1)],['mapping',vec4(mapped.mul(.03125).add(.5),1)],['color',vec4(color,1)],['unmapped',vec4(buildTslBlendOperation(graph.blendType,base,unmapped.rgb,factor),1)],['unmixed',vec4(sampled.rgb,1)]]){
                    await draw('material-'+frame.input.id+'-'+kind,frame,material(node),{kind,case:frame.input.id})
                    result.materialColorRows.push(result.rows.pop())
                }
            }
        }
        result.status = 'CAPTURED_BOX_STORAGE_BROWSER_RESEARCH'; return result
    } finally {
        renderer.setRenderTarget(null); target.dispose(); for (const m of materials) m.dispose(); for (const map of maps) map.dispose(); for (const bitmap of bitmaps) bitmap.close(); for (const frame of frames) frame.dispose(); renderer.dispose()
    }
}
