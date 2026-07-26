import { describe, expect, it } from 'vitest'
import {
  bindCompiledScene,
  applyCompiledSceneEnvironment,
  applyCompiledSceneLook,
  applyCompiledSceneShadows,
  configureCompiledSceneLoader,
  loadCompiledScene,
  prepareCompiledSceneEnvironment,
  prepareCompiledSceneLook,
  prepareCompiledSceneShadows,
  startCompiledScenePlayback,
} from './runtime.js'

describe('runtime adapters', () => {
  const mesh = {
    name: 'LoaderPrivateSuffix_7',
    userData: { blendlink_id: 'de305d54-75b4-431b-adb2-eb6b9e546014' },
    children: [],
  }
  const root = { name: 'Root', children: [mesh] }
  const descriptor = {
    url: '/hero.glb?v=123',
    nodes: { HeroMesh: 'Hero_Mesh' },
    nodeIds: { HeroMesh: 'de305d54-75b4-431b-adb2-eb6b9e546014' },
    objectsById: { 'de305d54-75b4-431b-adb2-eb6b9e546014': 'Hero_Mesh' },
  }

  it('resolves readable names and stable IDs', () => {
    const bound = bindCompiledScene(root, descriptor)
    expect(bound.byName.HeroMesh).toBe(mesh)
    expect(bound.object('de305d54-75b4-431b-adb2-eb6b9e546014')).toBe(mesh)
    expect(() => bound.object('missing')).toThrow(/not present/)
  })

  it('loads and binds with a Three-compatible loader', async () => {
    const loaded = await loadCompiledScene({ loadAsync: async () => ({ scene: root }) }, descriptor)
    expect(loaded.blendlink.byId['de305d54-75b4-431b-adb2-eb6b9e546014']).toBe(mesh)
  })

  it('applies namespaced initial visibility and shadow intent from generated extras', () => {
    const object = {
      name: 'Runtime_Hero', children: [], visible: true,
      castShadow: false, receiveShadow: true,
    }
    const bound = bindCompiledScene({ name: 'Scene', children: [object] }, {
      url: '/hero.glb',
      nodes: { RuntimeHero: 'Runtime_Hero' },
      extras: {
        Runtime_Hero: {
          blendlink_active: false,
          blendlink_cast_shadow: true,
          blendlink_receive_shadow: false,
        },
      },
    })
    expect(object).toMatchObject({ visible: false, castShadow: true, receiveShadow: false })
    object.castShadow = false // a later application owner wins
    bound.dispose()
    bound.dispose()
    expect(object).toMatchObject({ visible: true, castShadow: false, receiveShadow: true })
  })

  it('carries authored shadow intent onto generated multi-primitive mesh children', () => {
    const primitiveA = { name: 'Hero_Primitive_0', children: [], castShadow: true, receiveShadow: true }
    const primitiveB = { name: 'Hero_Primitive_1', children: [], castShadow: true, receiveShadow: true }
    const group = {
      name: 'Hero', children: [primitiveA, primitiveB],
      castShadow: true, receiveShadow: true,
    }
    const bound = bindCompiledScene({ name: 'Scene', children: [group] }, {
      url: '/hero.glb',
      nodes: { Hero: 'Hero' },
      extras: {
        Hero: { blendlink_cast_shadow: false, blendlink_receive_shadow: false },
      },
    })

    expect(group).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(primitiveA).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(primitiveB).toMatchObject({ castShadow: false, receiveShadow: false })
    bound.dispose()
    expect(group).toMatchObject({ castShadow: true, receiveShadow: true })
    expect(primitiveA).toMatchObject({ castShadow: true, receiveShadow: true })
    expect(primitiveB).toMatchObject({ castShadow: true, receiveShadow: true })
  })

  it('stops shadow intent at the next authored Blender object', () => {
    const generatedPrimitive = {
      name: 'Parent_Primitive_0', children: [], castShadow: true, receiveShadow: true,
    }
    const authoredChild = {
      name: 'Authored_Child', children: [], castShadow: true, receiveShadow: true,
    }
    const authoredParent = {
      name: 'Authored_Parent', children: [generatedPrimitive, authoredChild],
      castShadow: true, receiveShadow: true,
    }
    const bound = bindCompiledScene({ name: 'Scene', children: [authoredParent] }, {
      url: '/nested.glb',
      nodes: {
        AuthoredParent: 'Authored_Parent',
        AuthoredChild: 'Authored_Child',
      },
      extras: {
        Authored_Parent: {
          blendlink_cast_shadow: false,
          blendlink_receive_shadow: false,
        },
      },
    })

    expect(authoredParent).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(generatedPrimitive).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(authoredChild).toMatchObject({ castShadow: true, receiveShadow: true })
    expect(bound.shadowIntent(generatedPrimitive)).toEqual({ cast: false, receive: false })
    expect(bound.shadowIntent(authoredChild)).toBeUndefined()
    bound.dispose()
  })

  it('keeps proxy-only collider geometry bindable for physics but hidden from rendering', () => {
    const proxy = {
      name: 'LoaderSuffix_2',
      userData: { blendlink_id: 'proxy-id' },
      visible: true,
      geometry: { triangles: 12 },
      children: [],
    }
    const visibleCollider = { name: 'Floor-col', visible: true, children: [] }
    const bound = bindCompiledScene({ name: 'Scene', children: [proxy, visibleCollider] }, {
      url: '/hero.glb',
      nodes: { PhysicsHull: 'Hull-colonly', Floor: 'Floor-col' },
      nodeIds: { PhysicsHull: 'proxy-id' },
      colliders: [
        { name: 'Hull', loadedName: 'Hull-colonly', id: 'proxy-id', proxyOnly: true },
        { name: 'Floor', loadedName: 'Floor-col', proxyOnly: false },
      ],
    })
    expect(bound.object('PhysicsHull')).toBe(proxy)
    expect(proxy.visible).toBe(false)
    expect(proxy.geometry.triangles).toBe(12)
    expect(visibleCollider.visible).toBe(true)
    proxy.visible = true // physics/debug UI takes ownership after installation
    bound.dispose()
    expect(proxy.visible).toBe(true)
  })

  it('configures the official Meshopt decoder or fails with an actionable loader error', () => {
    let decoder: unknown
    configureCompiledSceneLoader({ setMeshoptDecoder(value) { decoder = value } }, {
      url: '/hero.glb', nodes: {}, requiresMeshopt: true,
    })
    expect(decoder).toBeDefined()
    expect((decoder as { useWorkers?: unknown }).useWorkers).toBeUndefined()
    const ownedDecoder = {
      supported: true,
      ready: Promise.resolve(),
      decodeGltfBuffer() {},
    }
    configureCompiledSceneLoader({ setMeshoptDecoder(value) { decoder = value } }, {
      url: '/owned.glb', nodes: {}, requiresMeshopt: true,
    }, { meshoptDecoder: ownedDecoder })
    expect(decoder).toBe(ownedDecoder)
    expect(() => configureCompiledSceneLoader({ setMeshoptDecoder() {} }, {
      url: '/owned.glb', nodes: {}, requiresMeshopt: true,
    }, { meshoptDecoder: ownedDecoder, meshoptWorkerCount: 2 })).toThrow(/one worker lifecycle owner/)
    expect(() => configureCompiledSceneLoader({ setMeshoptDecoder() {} }, {
      url: '/hero.glb', nodes: {}, requiresMeshopt: true,
    }, { meshoptWorkerCount: 99 })).toThrow(/integer from 0 to 4/)
    expect(() => configureCompiledSceneLoader({}, {
      url: '/hero.glb', nodes: {}, optimization: { geometry: 'meshopt' },
    })).toThrow(/setMeshoptDecoder/)
    expect(() => configureCompiledSceneLoader({}, {
      url: '/external.glb', nodes: {}, requiresMeshopt: true,
    })).toThrow(/setMeshoptDecoder/)
  })

  it('requires an application-configured KTX2Loader only for compressed scenes', () => {
    const ktx2Loader = { ready: true }
    let configured: unknown
    configureCompiledSceneLoader({ setKTX2Loader(value) { configured = value } }, {
      url: '/hero.glb', nodes: {}, requiresKtx2: true,
    }, { ktx2Loader })
    expect(configured).toBe(ktx2Loader)
    expect(() => configureCompiledSceneLoader({ setKTX2Loader() {} }, {
      url: '/hero.glb', nodes: {}, textureCompression: { format: 'ktx2' },
    })).toThrow(/detectSupport/)
    expect(() => configureCompiledSceneLoader({}, {
      url: '/hero.glb', nodes: {}, textureCompression: { format: 'ktx2' },
    }, { ktx2Loader })).toThrow(/setKTX2Loader/)
  })

  it('starts the selected clip with authored loop/speed and exposes one render-loop handle', () => {
    const calls: unknown[] = []
    const action = {
      clampWhenFinished: false,
      timeScale: 1,
      reset() { calls.push('reset') },
      setLoop(mode: unknown, repetitions: number) { calls.push(['loop', mode, repetitions]) },
      play() { calls.push('play') },
    }
    const mixer = {
      clipAction(clip: { name: string }) { calls.push(['clip', clip.name]); return action },
      update(delta: number) { calls.push(['update', delta]) },
      stopAllAction() { calls.push('stop') },
    }
    const playback = startCompiledScenePlayback({
      scene: root,
      animations: [{ name: 'Idle' }, { name: 'Reveal' }],
    }, {
      ...descriptor,
      playback: { start: 'named', clip: 'Reveal', loop: 'once', speed: 0.5 },
    }, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })
    expect(playback?.clips.map((clip) => clip.name)).toEqual(['Reveal'])
    expect(action).toMatchObject({ clampWhenFinished: true, timeScale: 0.5 })
    expect(calls).toContainEqual(['loop', 1, 1])
    playback?.update(1 / 60)
    playback?.stop()
    expect(calls).toContainEqual(['update', 1 / 60])
    expect(calls).toContain('stop')
  })

  it('fails loudly when authored animation startup cannot be fulfilled', () => {
    const options = {
      createMixer: () => ({ clipAction() { throw new Error('unused') }, update() {}, stopAllAction() {} }),
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    }
    expect(() => startCompiledScenePlayback({ scene: root, animations: [{ name: 'Idle' }] }, {
      ...descriptor,
      playback: { start: 'named', clip: 'Missing', loop: 'repeat', speed: 1 },
    }, options)).toThrow(/Available clips: Idle/)
  })

  it('applies explicit tone/background ownership and preserves application-owned values', () => {
    const renderer = {
      toneMapping: 'site',
      toneMappingExposure: 3,
      clearAlpha: 1,
      setClearAlpha(value: number) { this.clearAlpha = value },
      getClearAlpha() { return this.clearAlpha },
      getContextAttributes: () => ({ alpha: true }),
    }
    const scene: { background?: unknown } = { background: 'site-background' }
    const handle = applyCompiledSceneLook(renderer, scene, {
      ...descriptor,
      look: { toneMapping: 'agx', exposure: -1, background: 'transparent' },
    }, {
      toneMappings: { agx: 6, neutral: 7, aces: 4, none: 0 },
    })
    expect(renderer).toMatchObject({ toneMapping: 6, toneMappingExposure: 0.5, clearAlpha: 0 })
    expect(scene.background).toBeNull()
    handle.dispose()
    handle.dispose()
    expect(renderer).toMatchObject({ toneMapping: 'site', toneMappingExposure: 3, clearAlpha: 1 })
    expect(scene.background).toBe('site-background')

    const untouchedRenderer = { toneMapping: 'site', toneMappingExposure: 2 }
    const untouchedScene = { background: 'site' }
    applyCompiledSceneLook(untouchedRenderer, untouchedScene, {
      ...descriptor,
      look: { toneMapping: 'application', exposure: 0, background: 'application' },
    }, { toneMappings: { agx: 6, neutral: 7, aces: 4, none: 0 } })
    expect(untouchedRenderer).toEqual({ toneMapping: 'site', toneMappingExposure: 2 })
    expect(untouchedScene.background).toBe('site')
  })

  it('does not clobber a later look owner and rolls back failed application atomically', () => {
    const renderer = {
      toneMapping: 'site', toneMappingExposure: 2, clearAlpha: 1,
      setClearAlpha(value: number) { this.clearAlpha = value },
      getClearAlpha() { return this.clearAlpha },
      getContextAttributes: () => ({ alpha: true }),
    }
    const scene = { background: 'site' as unknown }
    const handle = applyCompiledSceneLook(renderer, scene, {
      ...descriptor,
      look: { toneMapping: 'agx', exposure: -1, background: 'transparent' },
    }, { toneMappings: { agx: 6, neutral: 7, aces: 4, none: 0 } })
    renderer.toneMapping = 'later-owner'
    scene.background = 'later-background'
    handle.dispose()
    expect(renderer).toMatchObject({ toneMapping: 'later-owner', toneMappingExposure: 0.5, clearAlpha: 0 })
    expect(scene.background).toBe('later-background')

    const failingRenderer = {
      toneMapping: 'site', toneMappingExposure: 2, clearAlpha: 1,
      setClearAlpha(value: number) {
        if (value === 0) throw new Error('renderer rejected alpha')
        this.clearAlpha = value
      },
      getClearAlpha() { return this.clearAlpha },
      getContextAttributes: () => ({ alpha: true }),
    }
    const failingScene = { background: 'site' as unknown }
    expect(() => applyCompiledSceneLook(failingRenderer, failingScene, {
      ...descriptor,
      look: { toneMapping: 'agx', exposure: 0, background: 'transparent' },
    }, { toneMappings: { agx: 6, neutral: 7, aces: 4, none: 0 } })).toThrow(/renderer rejected alpha/)
    expect(failingRenderer).toMatchObject({ toneMapping: 'site', toneMappingExposure: 2, clearAlpha: 1 })
    expect(failingScene.background).toBe('site')
  })

  it('prepares a scene look without live mutation and snapshots application state at commit', () => {
    const renderer = {
      toneMapping: 'application-before-prepare' as unknown,
      toneMappingExposure: 0.5,
      alpha: 1,
      setClearAlpha(value: number) { this.alpha = value },
      getClearAlpha() { return this.alpha },
      getContextAttributes: () => ({ alpha: true }),
    }
    const scene = { background: 'application-before-prepare' as unknown }
    const color = { name: 'prepared-color' }
    const prepared = prepareCompiledSceneLook(renderer, scene, {
      ...descriptor,
      look: {
        toneMapping: 'neutral', exposure: 1,
        background: 'color', backgroundColor: [0.2, 0.3, 0.4],
      },
    }, {
      toneMappings: { agx: 1, neutral: 2, aces: 3, none: 4 },
      createColor: () => color,
    })

    expect(prepared.state).toBe('prepared')
    expect(renderer).toMatchObject({
      toneMapping: 'application-before-prepare',
      toneMappingExposure: 0.5,
      alpha: 1,
    })
    expect(scene.background).toBe('application-before-prepare')

    renderer.toneMapping = 'application-at-commit'
    renderer.toneMappingExposure = 0.75
    scene.background = 'background-at-commit'
    const installed = prepared.commit()
    expect(renderer).toMatchObject({ toneMapping: 2, toneMappingExposure: 2, alpha: 1 })
    expect(scene.background).toBe(color)

    installed.dispose()
    expect(renderer).toMatchObject({
      toneMapping: 'application-at-commit',
      toneMappingExposure: 0.75,
      alpha: 1,
    })
    expect(scene.background).toBe('background-at-commit')
    expect(prepared.state).toBe('disposed')
  })

  it('requires an alpha-capable renderer or native color constructor for owned backgrounds', () => {
    const toneMappings = { agx: 6, neutral: 7, aces: 4, none: 0 }
    expect(() => applyCompiledSceneLook({
      setClearAlpha() {}, getClearAlpha: () => 1, getContextAttributes: () => ({ alpha: false }),
    }, {}, {
      ...descriptor,
      look: { toneMapping: 'application', exposure: 0, background: 'transparent' },
    }, { toneMappings })).toThrow(/alpha: true/)
    expect(() => applyCompiledSceneLook({}, {}, {
      ...descriptor,
      look: {
        toneMapping: 'application', exposure: 0, background: 'color', backgroundColor: [0, 0, 0],
      },
    }, { toneMappings })).toThrow(/createColor/)
  })

  it('resolves a shadow preset onto the renderer and every shadow-capable light', () => {
    const mapSize = { width: 0, height: 0 }
    const shadow = {
      mapSize,
      camera: { far: 0, updated: false, updateProjectionMatrix() { this.updated = true } },
    }
    const light = {
      name: 'Key', castShadow: false, isPointLight: true, shadow, children: [],
    }
    const disabledShadow = {
      mapSize: { width: 64, height: 64 },
      camera: { far: 7, updateProjectionMatrix() {} },
    }
    const disabledLight = {
      name: 'Fill', castShadow: false,
      userData: { blendlink_cast_shadow: false },
      shadow: disabledShadow, children: [],
    }
    const renderer = { shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false, type: 0 } }
    const report = applyCompiledSceneShadows(renderer, {
      name: 'Scene', children: [light, disabledLight],
    }, {
      ...descriptor,
      shadows: {
        preset: 'soft', filter: 'vsm', mapSize: 2048, maxDistance: 60,
        bias: -0.0001, normalBias: 0.02, radius: 4, autoUpdate: true,
      },
    }, { shadowMapTypes: { basic: 1, pcf: 2, vsm: 3 } })
    expect(renderer.shadowMap).toEqual({ enabled: true, autoUpdate: true, needsUpdate: true, type: 3 })
    expect(shadow).toMatchObject({ bias: -0.0001, normalBias: 0.02, radius: 4, camera: { far: 60, updated: true } })
    expect(light.castShadow).toBe(true)
    expect(disabledLight.castShadow).toBe(false)
    expect(disabledShadow).toMatchObject({ mapSize: { width: 64, height: 64 }, camera: { far: 7 } })
    expect(mapSize).toEqual({ width: 2048, height: 2048 })
    expect(report).toMatchObject({ lightsConfigured: 1, shadowPixels: 6 * 2048 ** 2 })
    report.dispose()
    expect(renderer.shadowMap).toEqual({ enabled: false, autoUpdate: false, needsUpdate: false, type: 0 })
    expect(shadow).toMatchObject({ camera: { far: 0 } })
    expect(light.castShadow).toBe(false)
    expect(mapSize).toEqual({ width: 0, height: 0 })
  })

  it('prepares detached light shadows without taking renderer ownership before commit', () => {
    const mapSize = { width: 32, height: 32 }
    const shadow = {
      mapSize,
      camera: { far: 7, updateProjectionMatrix() {} },
      bias: 0,
      normalBias: 0,
      radius: 1,
    }
    const light = {
      name: 'Detached Key',
      castShadow: false,
      shadow,
      children: [],
    }
    const renderer = {
      shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false, type: 0 },
    }
    const prepared = prepareCompiledSceneShadows(renderer, {
      name: 'Detached Root',
      children: [light],
    }, {
      ...descriptor,
      shadows: {
        preset: 'soft', filter: 'vsm', mapSize: 1024, maxDistance: 80,
        bias: -0.0002, normalBias: 0.04, radius: 3, autoUpdate: true,
      },
    }, { shadowMapTypes: { basic: 1, pcf: 2, vsm: 3 } })

    expect(renderer.shadowMap).toEqual({
      enabled: false, autoUpdate: false, needsUpdate: false, type: 0,
    })
    expect(light.castShadow).toBe(true)
    expect(shadow).toMatchObject({
      mapSize: { width: 1024, height: 1024 },
      camera: { far: 80 },
      bias: -0.0002,
      normalBias: 0.04,
      radius: 3,
    })

    const installed = prepared.commit()
    expect(renderer.shadowMap).toEqual({
      enabled: true, autoUpdate: true, needsUpdate: true, type: 3,
    })
    expect(installed).toMatchObject({
      lightsConfigured: 1,
      shadowPixels: 1024 ** 2,
    })

    installed.dispose()
    expect(renderer.shadowMap).toEqual({
      enabled: false, autoUpdate: false, needsUpdate: false, type: 0,
    })
    expect(light.castShadow).toBe(false)
    expect(shadow).toMatchObject({
      mapSize: { width: 32, height: 32 },
      camera: { far: 7 },
      bias: 0,
      normalBias: 0,
      radius: 1,
    })
  })

  it('releases an unpublished shadow candidate without touching renderer state', () => {
    const light = {
      castShadow: false,
      shadow: {
        mapSize: { width: 64, height: 64 },
        camera: { far: 12, updateProjectionMatrix() {} },
      },
      children: [],
    }
    const renderer = {
      shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false, type: 0 },
    }
    const prepared = prepareCompiledSceneShadows(renderer, {
      name: 'Cancelled Root',
      children: [light],
    }, {
      ...descriptor,
      shadows: {
        preset: 'hard', filter: 'basic', mapSize: 512, maxDistance: 30,
        bias: 0, normalBias: 0, radius: 1, autoUpdate: false,
      },
    }, { shadowMapTypes: { basic: 1, pcf: 2, vsm: 3 } })

    expect(light.castShadow).toBe(true)
    prepared.dispose()
    prepared.dispose()

    expect(prepared.state).toBe('disposed')
    expect(light.castShadow).toBe(false)
    expect(light.shadow).toMatchObject({
      mapSize: { width: 64, height: 64 },
      camera: { far: 12 },
    })
    expect(renderer.shadowMap).toEqual({
      enabled: false, autoUpdate: false, needsUpdate: false, type: 0,
    })
  })

  it('loads one HDR for independent lighting and grounded background outcomes', async () => {
    const texture = { mapping: null as unknown, disposed: false, dispose() { this.disposed = true } }
    const rotations: unknown[] = []
    const environmentRotation = {
      x: 0.1, y: 0.2, z: 0.3,
      set(x: number, y: number, z: number) {
        this.x = x; this.y = y; this.z = z
        rotations.push(['lighting', x, y, z])
      },
    }
    const scene = {
      environment: 'site', environmentIntensity: 0.4, background: 'site',
      added: [] as unknown[], removed: [] as unknown[], environmentRotation,
      add(object: unknown) { this.added.push(object) },
      remove(object: unknown) { this.removed.push(object) },
    }
    const ground = { name: 'Grounded HDR' }
    let groundDisposed = 0
    const handle = await applyCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Studio.hdr', lighting: 'image', background: 'grounded',
        lightingIntensity: 1.5, lightingRotation: 90, backgroundIntensity: 0.8,
        backgroundRotation: 30, backgroundBlur: 0.1, groundHeight: 1.7, groundRadius: 90,
      },
      environmentAsset: {
        url: '/studio.hdr?v=abc', sourceName: 'Studio.hdr', format: 'hdr', bytes: 1234, hash: 'abc', source: 'packed',
      },
    }, {
      loaders: { hdr: { loadAsync: async () => texture }, exr: { loadAsync: async () => texture } },
      equirectangularReflectionMapping: 303,
      createGroundedBackground(source, settings) {
        expect(source).toBe(texture)
        expect(settings).toMatchObject({ height: 1.7, radius: 90, intensity: 0.8, blur: 0.1 })
        return ground
      },
      disposeGroundedBackground(value) {
        expect(value).toBe(ground)
        groundDisposed += 1
      },
    })
    expect(texture.mapping).toBe(303)
    expect(scene).toMatchObject({ environment: texture, environmentIntensity: 1.5, background: null, added: [ground] })
    expect(rotations[0]).toEqual(['lighting', 0, Math.PI / 2, 0])
    handle.dispose()
    handle.dispose()
    expect(scene.removed).toEqual([ground])
    expect(scene).toMatchObject({ environment: 'site', environmentIntensity: 0.4, background: 'site' })
    expect(environmentRotation).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 })
    expect(groundDisposed).toBe(1)
    expect(texture.disposed).toBe(true)
  })

  it('prepares an HDR environment without mutating the target scene, then commits synchronously once', async () => {
    const events: string[] = []
    const texture = {
      mapping: null as unknown,
      disposed: false,
      dispose() { this.disposed = true; events.push('texture:dispose') },
    }
    const rotation = {
      x: 0.1, y: 0.2, z: 0.3,
      set(x: number, y: number, z: number) {
        this.x = x; this.y = y; this.z = z
        events.push('rotation:set')
      },
    }
    const ground = { name: 'Prepared Ground', parent: null as unknown }
    const scene = {
      environment: 'application',
      environmentIntensity: 0.25,
      environmentRotation: rotation,
      background: 'application',
      children: [] as unknown[],
      add(object: unknown) {
        this.children.push(object)
        ground.parent = this
        events.push('scene:add')
      },
      remove(object: unknown) {
        this.children = this.children.filter((candidate) => candidate !== object)
        ground.parent = null
        events.push('scene:remove')
      },
    }
    const prepared = await prepareCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Prepared.hdr',
        lighting: 'image', background: 'grounded',
        lightingIntensity: 1.75, lightingRotation: 60,
        backgroundIntensity: 0.8, backgroundRotation: 20,
        backgroundBlur: 0, groundHeight: 1.5, groundRadius: 80,
      },
      environmentAsset: {
        url: '/prepared.hdr', sourceName: 'Prepared.hdr', format: 'hdr',
        bytes: 10, hash: 'prepared', source: 'packed',
      },
    }, {
      loaders: {
        hdr: { loadAsync: async () => { events.push('texture:loaded'); return texture } },
        exr: { loadAsync: async () => texture },
      },
      equirectangularReflectionMapping: 303,
      createGroundedBackground: () => {
        events.push('ground:created')
        return ground
      },
      disposeGroundedBackground: () => { events.push('ground:dispose') },
    })

    expect(prepared.state).toBe('prepared')
    expect(scene).toMatchObject({
      environment: 'application',
      environmentIntensity: 0.25,
      background: 'application',
      children: [],
    })
    expect(rotation).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 })
    expect(events).toEqual(['texture:loaded', 'ground:created'])

    const installed = prepared.commit()
    expect(prepared.state).toBe('committed')
    expect(scene).toMatchObject({
      environment: texture,
      environmentIntensity: 1.75,
      background: null,
      children: [ground],
    })
    expect(rotation.y).toBeCloseTo(Math.PI / 3)
    expect(() => prepared.commit()).toThrow(/committed.*exactly once/i)

    installed.dispose()
    prepared.dispose()
    expect(prepared.state).toBe('disposed')
    expect(scene).toMatchObject({
      environment: 'application',
      environmentIntensity: 0.25,
      background: 'application',
      children: [],
    })
    expect(rotation).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 })
    expect(events.slice(-3)).toEqual(['scene:remove', 'ground:dispose', 'texture:dispose'])
  })

  it('disposes an uncommitted prepared environment without ever touching the scene', async () => {
    const texture = { disposed: 0, dispose() { this.disposed += 1 } }
    const scene = { environment: 'application', background: 'application' }
    const prepared = await prepareCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Unused.hdr',
        lighting: 'image', background: 'application',
        lightingIntensity: 1, lightingRotation: 0,
        backgroundIntensity: 1, backgroundRotation: 0,
        backgroundBlur: 0, groundHeight: 2, groundRadius: 100,
      },
      environmentAsset: {
        url: '/unused.hdr', sourceName: 'Unused.hdr', format: 'hdr',
        bytes: 1, hash: 'unused', source: 'packed',
      },
    }, {
      loaders: { hdr: { loadAsync: async () => texture }, exr: { loadAsync: async () => texture } },
      equirectangularReflectionMapping: 303,
    })

    prepared.dispose()
    prepared.dispose()
    expect(prepared.state).toBe('disposed')
    expect(scene).toEqual({ environment: 'application', background: 'application' })
    expect(texture.disposed).toBe(1)
    expect(() => prepared.commit()).toThrow(/disposed/i)
  })

  it('prefers verified KTX2 radiance but falls back loudly to the original source', async () => {
    const optimized = {
      name: 'optimized', mapping: null as unknown, minFilter: null as unknown,
      magFilter: null as unknown, needsUpdate: false,
    }
    const original = { name: 'original', mapping: null as unknown }
    const calls: string[] = []
    const warnings: string[] = []
    const environment = {
      source: 'image' as const, imageName: 'Studio.exr', lighting: 'image' as const,
      background: 'application' as const, lightingIntensity: 1, lightingRotation: 0,
      backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
      groundHeight: 2, groundRadius: 100,
    }
    const environmentAsset = {
      url: '/studio.exr?v=raw', sourceName: 'Studio.exr', format: 'exr' as const,
      bytes: 4000, hash: 'raw', source: 'packed' as const,
      optimized: {
        url: '/studio.ktx2?v=gpu', format: 'ktx2' as const, codec: 'r11g11b10-zstd' as const,
        bytes: 1000, hash: 'gpu', encoder: 'KTX-Software' as const, encoderVersion: 'ktx 4.4.2',
        minThreeRevision: 180 as const,
        fidelity: {
          width: 64, height: 32, relativeRmse: 0.01, meanRelativeError: 0.005,
          peakRelativeError: 0.01, maxErrorOverPeak: 0.01, logLuminanceRmseStops: 0.02,
          sourcePeak: 10, decodedPeak: 9.9, sourceMin: 0, negativeChannels: 0, invalidPixels: 0,
        },
      },
    }
    const preferred = await applyCompiledSceneEnvironment({}, {
      ...descriptor, environment, environmentAsset,
    }, {
      loaders: {
        hdr: { loadAsync: async () => original },
        exr: { loadAsync: async () => original },
        ktx2: { loadAsync: async (url) => { calls.push(url); return optimized } },
      },
      linearFilter: 1006,
      equirectangularReflectionMapping: 303,
    })
    expect(preferred).toMatchObject({ texture: optimized, source: 'optimized' })
    expect(optimized).toMatchObject({ minFilter: 1006, magFilter: 1006, needsUpdate: true })
    expect(calls).toEqual(['/studio.ktx2?v=gpu'])

    const fallback = await applyCompiledSceneEnvironment({}, {
      ...descriptor, environment, environmentAsset,
    }, {
      loaders: {
        hdr: { loadAsync: async () => original },
        exr: { loadAsync: async (url) => { calls.push(url); return original } },
        ktx2: { loadAsync: async () => { throw new Error('unsupported packed float') } },
      },
      linearFilter: 1006,
      equirectangularReflectionMapping: 303,
      onWarning: (message) => warnings.push(message),
    })
    expect(fallback).toMatchObject({ texture: original, source: 'original' })
    expect(calls).toContain('/studio.exr?v=raw')
    expect(warnings.join('\n')).toMatch(/byte-exact EXR fallback.*unsupported packed float/)

    let nearestCandidateLoaded = false
    const missingFilterWarnings: string[] = []
    const missingFilter = await applyCompiledSceneEnvironment({}, {
      ...descriptor, environment, environmentAsset,
    }, {
      loaders: {
        hdr: { loadAsync: async () => original },
        exr: { loadAsync: async () => original },
        ktx2: { loadAsync: async () => {
          nearestCandidateLoaded = true
          return optimized
        } },
      },
      equirectangularReflectionMapping: 303,
      onWarning: (message) => missingFilterWarnings.push(message),
    })
    expect(missingFilter).toMatchObject({ texture: original, source: 'original' })
    expect(nearestCandidateLoaded).toBe(false)
    expect(missingFilterWarnings.join('\n')).toMatch(/Three\.LinearFilter.*byte-exact EXR fallback/)
  })

  it('rolls a grounded environment back completely when scene attachment fails', async () => {
    const texture = { disposed: false, dispose() { this.disposed = true } }
    const ground = { parent: null as unknown }
    const rotation = {
      x: 0.1, y: 0.2, z: 0.3,
      set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z },
    }
    const scene = {
      environment: 'site', environmentIntensity: 0.25, environmentRotation: rotation,
      background: 'site', removed: [] as unknown[],
      add(object: unknown) {
        ground.parent = this
        void object
        throw new Error('scene rejected ground')
      },
      remove(object: unknown) {
        this.removed.push(object)
        ground.parent = null
      },
    }
    let groundDisposed = 0
    await expect(applyCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Studio.hdr', lighting: 'image', background: 'grounded',
        lightingIntensity: 2, lightingRotation: 45, backgroundIntensity: 1,
        backgroundRotation: 0, backgroundBlur: 0, groundHeight: 2, groundRadius: 100,
      },
      environmentAsset: {
        url: '/studio.hdr', sourceName: 'Studio.hdr', format: 'hdr', bytes: 1, hash: 'a', source: 'packed',
      },
    }, {
      loaders: { hdr: { loadAsync: async () => texture }, exr: { loadAsync: async () => texture } },
      equirectangularReflectionMapping: 303,
      createGroundedBackground: () => ground,
      disposeGroundedBackground: () => { groundDisposed += 1 },
    })).rejects.toThrow(/scene rejected ground/)
    expect(scene).toMatchObject({ environment: 'site', environmentIntensity: 0.25, background: 'site' })
    expect(rotation).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 })
    expect(scene.removed).toEqual([ground])
    expect(groundDisposed).toBe(1)
    expect(texture.disposed).toBe(true)
  })

  it('preserves a later environment owner and transfers the texture lifecycle', async () => {
    const texture = { disposed: false, dispose() { this.disposed = true } }
    const environmentRotation = {
      x: 0, y: 0, z: 0,
      set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z },
    }
    const backgroundRotation = {
      x: 0, y: 0, z: 0,
      set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z },
    }
    const scene = {
      environment: 'site', environmentIntensity: 0.5, environmentRotation,
      background: 'site', backgroundIntensity: 0.4, backgroundBlurriness: 0.2, backgroundRotation,
    }
    const handle = await applyCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Studio.hdr', lighting: 'image', background: 'image',
        lightingIntensity: 2, lightingRotation: 45, backgroundIntensity: 1.2,
        backgroundRotation: 30, backgroundBlur: 0.1, groundHeight: 2, groundRadius: 100,
      },
      environmentAsset: {
        url: '/studio.hdr', sourceName: 'Studio.hdr', format: 'hdr', bytes: 1, hash: 'a', source: 'packed',
      },
    }, {
      loaders: { hdr: { loadAsync: async () => texture }, exr: { loadAsync: async () => texture } },
      equirectangularReflectionMapping: 303,
    })
    // A later owner keeps the loaded texture but changes its lighting policy.
    scene.environmentIntensity = 9
    handle.dispose()
    expect(scene.environment).toBe(texture)
    expect(scene.environmentIntensity).toBe(9)
    expect(environmentRotation.y).toBeCloseTo(Math.PI / 4)
    expect(scene).toMatchObject({
      background: 'site', backgroundIntensity: 0.4, backgroundBlurriness: 0.2,
    })
    expect(backgroundRotation).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(texture.disposed).toBe(false)
  })

  it('does not remove or dispose a grounded background reparented by a later owner', async () => {
    const texture = { disposed: false, dispose() { this.disposed = true } }
    const otherScene = { name: 'later-owner' }
    const ground = { parent: null as unknown }
    const scene = {
      environment: 'site' as unknown, background: 'site' as unknown, removed: [] as unknown[],
      add(object: unknown) { ground.parent = this; void object },
      remove(object: unknown) { this.removed.push(object); ground.parent = null },
    }
    const handle = await applyCompiledSceneEnvironment(scene, {
      ...descriptor,
      environment: {
        source: 'image', imageName: 'Studio.hdr', lighting: 'image', background: 'grounded',
        lightingIntensity: 1, lightingRotation: 0, backgroundIntensity: 1,
        backgroundRotation: 0, backgroundBlur: 0, groundHeight: 2, groundRadius: 100,
      },
      environmentAsset: {
        url: '/studio.hdr', sourceName: 'Studio.hdr', format: 'hdr', bytes: 1, hash: 'a', source: 'packed',
      },
    }, {
      loaders: { hdr: { loadAsync: async () => texture }, exr: { loadAsync: async () => texture } },
      equirectangularReflectionMapping: 303,
      createGroundedBackground: () => ground,
      disposeGroundedBackground: () => { throw new Error('must not dispose transferred ground') },
    })
    ground.parent = otherScene
    handle.dispose()
    expect(scene.removed).toEqual([])
    expect(scene).toMatchObject({ environment: 'site', background: 'site' })
    expect(texture.disposed).toBe(false)
  })

  it('fails loudly when an authored environment asset or grounded adapter is missing', async () => {
    const environment = {
      source: 'image' as const, imageName: 'Missing.hdr', lighting: 'image' as const,
      background: 'application' as const, lightingIntensity: 1, lightingRotation: 0,
      backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
      groundHeight: 2, groundRadius: 100,
    }
    await expect(applyCompiledSceneEnvironment({}, { ...descriptor, environment }, {
      loaders: { hdr: { loadAsync: async () => ({}) }, exr: { loadAsync: async () => ({}) } },
      equirectangularReflectionMapping: 1,
    })).rejects.toThrow(/no environmentAsset/)

    let loads = 0
    await expect(applyCompiledSceneEnvironment({ add() {} }, {
      ...descriptor,
      environment: { ...environment, background: 'grounded' },
      environmentAsset: {
        url: '/missing.hdr', sourceName: 'Missing.hdr', format: 'hdr', bytes: 1, hash: 'm', source: 'packed',
      },
    }, {
      loaders: {
        hdr: { loadAsync: async () => { loads += 1; return {} } },
        exr: { loadAsync: async () => { loads += 1; return {} } },
      },
      equirectangularReflectionMapping: 1,
      createGroundedBackground: () => ({}),
    })).rejects.toThrow(/add\(\) and remove\(\)/)
    expect(loads).toBe(0)
  })
})
