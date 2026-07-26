// PROTOTYPE — do not ship. This asks one bounded question:
// Can one final Eevee frame, projected through its authored camera onto the
// exported scene geometry, preserve the fixed-camera pixels while retaining
// depth-tested geometry for picking/occlusion?
import * as THREE from "three";
import { GLTFLoader } from "/vendor/three/examples/jsm/loaders/GLTFLoader.js";

const parameters = new URLSearchParams(window.location.search);
const mode = parameters.get("mode") ?? "projected";
const view = parameters.get("view") ?? "authored";
const surfaceSet = parameters.get("surfaces") ?? "all";
const appearanceUrl =
  parameters.get("appearance") ?? "/assets/eevee-reference.png";
const depthProbe = parameters.get("depthProbe") === "behind-center";
const filter = parameters.get("filter") ?? "authored";
const width = 1200;
const height = 600;

const state = {
  kind: "blendlink-eevee-fixed-camera-transport-prototype",
  mode,
  view,
  surfaceSet,
  depthProbe,
  filter,
  viewport: { width, height },
  sceneUrl: "/assets/scene.glb",
  appearanceUrl,
  ready: false,
};
window.__prototypeState = state;

if (mode === "plate") {
  const canvas = document.querySelector("#scene");
  const plate = document.querySelector("#plate");
  canvas.hidden = true;
  plate.hidden = false;
  plate.src = state.appearanceUrl;
  await plate.decode();
  state.interface = "application-owned-image-plate";
  state.ready = true;
  window.__prototypeReady = true;
} else {
  const canvas = document.querySelector("#scene");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(state.sceneUrl);
  const world = new THREE.Scene();
  world.background = new THREE.Color(0x000000);
  world.add(gltf.scene);
  world.updateMatrixWorld(true);

  const authoredCamera = gltf.cameras[0];
  if (!authoredCamera?.isPerspectiveCamera) {
    throw new Error("Prototype fixture must contain one perspective authored camera.");
  }
  authoredCamera.aspect = width / height;
  authoredCamera.updateProjectionMatrix();
  authoredCamera.updateWorldMatrix(true, false);
  authoredCamera.matrixWorldInverse.copy(authoredCamera.matrixWorld).invert();

  const projector = new THREE.Matrix4().multiplyMatrices(
    authoredCamera.projectionMatrix,
    authoredCamera.matrixWorldInverse,
  );
  let renderCamera = authoredCamera;
  if (view === "offset") {
    renderCamera = authoredCamera.clone(false);
    authoredCamera.matrixWorld.decompose(
      renderCamera.position,
      renderCamera.quaternion,
      renderCamera.scale,
    );
    renderCamera.translateX(1.5);
    renderCamera.rotateY(THREE.MathUtils.degToRad(4));
    renderCamera.updateMatrixWorld(true);
  }

  let meshCount = 0;
  let visibleMeshCount = 0;
  let patchedMeshCount = 0;
  if (mode === "projected") {
    const appearance = await new THREE.TextureLoader().loadAsync(state.appearanceUrl);
    appearance.colorSpace = THREE.SRGBColorSpace;
    appearance.wrapS = THREE.ClampToEdgeWrapping;
    appearance.wrapT = THREE.ClampToEdgeWrapping;
    appearance.minFilter = THREE.LinearFilter;
    appearance.magFilter = THREE.LinearFilter;
    appearance.generateMipmaps = false;

    const projectedMaterial = new THREE.MeshBasicMaterial({
      map: appearance,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    projectedMaterial.name = "PROTOTYPE fixed-camera Eevee appearance";
    projectedMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.blendlinkProjector = { value: projector };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec4 blendlinkProjectiveCoord;
uniform mat4 blendlinkProjector;`,
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
vec4 blendlinkProjectiveWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  blendlinkProjectiveWorld = instanceMatrix * blendlinkProjectiveWorld;
#endif
blendlinkProjectiveCoord = blendlinkProjector * modelMatrix * blendlinkProjectiveWorld;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec4 blendlinkProjectiveCoord;`,
        )
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
vec2 blendlinkProjectiveUv =
  ( blendlinkProjectiveCoord.xy / blendlinkProjectiveCoord.w ) * 0.5 + 0.5;
if (
  blendlinkProjectiveCoord.w <= 0.0 ||
  any( lessThan( blendlinkProjectiveUv, vec2( 0.0 ) ) ) ||
  any( greaterThan( blendlinkProjectiveUv, vec2( 1.0 ) ) )
) {
  discard;
}
diffuseColor *= texture2D( map, blendlinkProjectiveUv );
#endif`,
        );
    };
    projectedMaterial.customProgramCacheKey = () =>
      "blendlink-fixed-camera-eevee-projector-prototype-v1";

    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      if (surfaceSet === "backdrop-only" && !object.name.includes("SkyPaint")) {
        object.visible = false;
        return;
      }
      visibleMeshCount += 1;
      if (surfaceSet === "sky-patch" && !object.name.includes("SkyPaint")) {
        return;
      }
      object.material = projectedMaterial;
      patchedMeshCount += 1;
    });
  } else {
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      if (object.visible) visibleMeshCount += 1;
      if (!object.name.includes("SkyPaint") || filter === "authored") return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material?.map) continue;
        if (filter === "linear-no-mips") {
          material.map.generateMipmaps = false;
          material.map.minFilter = THREE.LinearFilter;
          material.map.magFilter = THREE.LinearFilter;
        } else if (filter === "nearest") {
          material.map.generateMipmaps = false;
          material.map.minFilter = THREE.NearestFilter;
          material.map.magFilter = THREE.NearestFilter;
        }
        material.map.needsUpdate = true;
      }
    });
  }

  if (depthProbe) {
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    renderCamera.getWorldPosition(origin);
    renderCamera.getWorldDirection(direction);
    const probe = new THREE.Mesh(
      new THREE.SphereGeometry(2, 32, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        toneMapped: false,
        depthTest: true,
        depthWrite: true,
      }),
    );
    probe.name = "PROTOTYPE behind-center depth probe";
    probe.position.copy(origin).addScaledVector(direction, 50);
    world.add(probe);
    state.depthProbeContract = {
      distanceFromCamera: 50,
      expected:
        surfaceSet === "all"
          ? "occluded by the nearer exported scene"
          : "visible in front of the backdrop-only control",
    };
  }

  const compileStarted = performance.now();
  if (typeof renderer.compileAsync === "function") {
    await renderer.compileAsync(world, renderCamera);
  } else {
    renderer.compile(world, renderCamera);
  }
  const compileMilliseconds = performance.now() - compileStarted;
  const renderStarted = performance.now();
  renderer.render(world, renderCamera);
  const renderMilliseconds = performance.now() - renderStarted;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), renderCamera);
  const centerRaycast = raycaster
    .intersectObject(gltf.scene, true)
    .filter((hit) => hit.object.visible)
    .slice(0, 5)
    .map((hit) => ({
      object: hit.object.name,
      distance: hit.distance,
    }));

  state.interface =
    mode === "projected"
      ? "geometry-preserving-fixed-camera-projector"
      : "raw-gltf-control";
  state.authoredCamera = {
    name: authoredCamera.name,
    aspect: authoredCamera.aspect,
    fov: authoredCamera.fov,
    near: authoredCamera.near,
    far: authoredCamera.far,
  };
  state.meshCount = meshCount;
  state.visibleMeshCount = visibleMeshCount;
  state.patchedMeshCount = patchedMeshCount;
  state.materialDepthContract =
    mode === "projected"
      ? { depthTest: true, depthWrite: true, side: "double" }
      : null;
  state.centerRaycast = centerRaycast;
  state.renderer = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
    compileMilliseconds,
    firstRenderMilliseconds: renderMilliseconds,
    webgl2: renderer.capabilities.isWebGL2,
  };
  state.ready = true;
  window.__prototypeReady = true;
}
