/**
 * PROTOTYPE: source-visible object inventory versus Blendlink and Needle GLBs.
 *
 * One command from the repository root:
 *   node experiments/splash-object-completeness/run.mjs
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const artifactRoot = resolve(
  repoRoot,
  "artifacts",
  "release-dogfood",
  "blender-4-splash",
);
const outputRoot = resolve(import.meta.dirname, "output");
mkdirSync(outputRoot, { recursive: true });

const defaults = {
  blender:
    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
  source: resolve(
    artifactRoot,
    "fixtures",
    "blender-4.0-splash-selected-sky.blend",
  ),
  blendlink: resolve(
    artifactRoot,
    "public",
    "models",
    "blender40SplashSelectedSky.glb",
  ),
  blendlinkStock: resolve(
    artifactRoot,
    "public",
    "models",
    "blender40Splash.glb",
  ),
  needle: resolve(
    artifactRoot,
    "needle-three-way-2026",
    "assets",
    "scene.glb",
  ),
};

const [
  source = defaults.source,
  blendlink = defaults.blendlink,
  needle = defaults.needle,
] = process.argv.slice(2);
const sourceEvidencePath = resolve(outputRoot, "source-object-evidence.json");
const sourcePreviewPath = resolve(outputRoot, "source-object-index-preview.png");

const blenderRun = spawnSync(
  defaults.blender,
  [
    "--background",
    source,
    "--python-exit-code",
    "1",
    "--python",
    resolve(import.meta.dirname, "inventory_source.py"),
    "--",
    sourceEvidencePath,
    sourcePreviewPath,
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  },
);

if (blenderRun.status !== 0) {
  process.stderr.write(blenderRun.stdout ?? "");
  process.stderr.write(blenderRun.stderr ?? "");
  throw new Error(`Blender inventory failed with status ${blenderRun.status}`);
}
process.stdout.write(
  (blenderRun.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes("BLENDLINK_SPLASH_OBJECT_INVENTORY"))
    .join("\n") + "\n",
);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${path} is not a GLB`);
  }
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) {
    throw new Error(
      `${path} length mismatch: header=${declaredLength} actual=${bytes.length}`,
    );
  }
  let offset = 12;
  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = bytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(chunk.toString("utf8").replace(/\u0000+$/u, ""));
    }
  }
  throw new Error(`${path} has no JSON chunk`);
}

function glbInventory(path) {
  const gltf = parseGlb(path);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const meshNodes = nodes
    .map((node, nodeIndex) => ({
      nodeIndex,
      name: typeof node.name === "string" ? node.name : null,
      meshIndex: Number.isInteger(node.mesh) ? node.mesh : null,
      meshName:
        Number.isInteger(node.mesh) &&
        typeof meshes[node.mesh]?.name === "string"
          ? meshes[node.mesh].name
          : null,
    }))
    .filter((node) => node.meshIndex !== null);
  const names = new Set();
  for (const node of meshNodes) {
    if (node.name) names.add(node.name);
    if (node.meshName) names.add(node.meshName);
  }
  return {
    path,
    bytes: readFileSync(path).length,
    sha256: sha256(path),
    generator: gltf.asset?.generator ?? null,
    nodeCount: nodes.length,
    meshCount: meshes.length,
    meshNodeCount: meshNodes.length,
    names: [...names].sort(),
    meshNodes,
  };
}

function accessorStats(accessor) {
  if (!accessor) return null;
  const count = accessor.getCount();
  const size = accessor.getElementSize();
  const min = Array(size).fill(Number.POSITIVE_INFINITY);
  const max = Array(size).fill(Number.NEGATIVE_INFINITY);
  const sum = Array(size).fill(0);
  const element = [];
  for (let index = 0; index < count; index += 1) {
    accessor.getElement(index, element);
    for (let component = 0; component < size; component += 1) {
      const value = element[component];
      min[component] = Math.min(min[component], value);
      max[component] = Math.max(max[component], value);
      sum[component] += value;
    }
  }
  return {
    count,
    type: accessor.getType(),
    componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized(),
    min,
    max,
    mean: sum.map((value) => value / count),
  };
}

async function focusedArtifactDetails(path, focusNames) {
  const document = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .read(path);
  const details = {};
  for (const node of document.getRoot().listNodes()) {
    if (!focusNames.has(node.getName()) || !node.getMesh()) continue;
    details[node.getName()] = {
      nodeName: node.getName(),
      meshName: node.getMesh().getName(),
      primitives: node
        .getMesh()
        .listPrimitives()
        .map((primitive, primitiveIndex) => {
          const material = primitive.getMaterial();
          const position = primitive.getAttribute("POSITION");
          const indices = primitive.getIndices();
          return {
            primitiveIndex,
            mode: primitive.getMode(),
            semantics: primitive.listSemantics(),
            vertices: position?.getCount() ?? 0,
            indices: indices?.getCount() ?? 0,
            triangles: indices
              ? Math.floor(indices.getCount() / 3)
              : Math.floor((position?.getCount() ?? 0) / 3),
            color0: accessorStats(primitive.getAttribute("COLOR_0")),
            material: material
              ? {
                  name: material.getName(),
                  baseColorFactor: material.getBaseColorFactor(),
                  hasBaseColorTexture: Boolean(
                    material.getBaseColorTexture(),
                  ),
                  alphaMode: material.getAlphaMode(),
                  alphaCutoff: material.getAlphaCutoff(),
                  doubleSided: material.getDoubleSided(),
                  extensions: material
                    .listExtensions()
                    .map((extension) => extension.extensionName),
                }
              : null,
          };
        }),
    };
  }
  return details;
}

const sourceEvidence = JSON.parse(readFileSync(sourceEvidencePath, "utf8"));
const blendlinkInventory = glbInventory(blendlink);
const blendlinkStockInventory = glbInventory(defaults.blendlinkStock);
const needleInventory = glbInventory(needle);
const blendlinkNames = new Set(blendlinkInventory.names);
const blendlinkStockNames = new Set(blendlinkStockInventory.names);
const needleNames = new Set(needleInventory.names);

const visibleSource = sourceEvidence.objects
  .filter(
    (object) =>
      object.renderParticipates &&
      object.objectIdReliable &&
      object.visiblePixels > 0,
  )
  .sort((left, right) => right.visiblePixels - left.visiblePixels);

const comparisons = visibleSource.map((object) => ({
  name: object.name,
  visiblePixels: object.visiblePixels,
  bboxTopLeft: object.bboxTopLeft,
  materials: object.materials,
  evaluatedVertices: object.evaluatedVertices,
  evaluatedPolygons: object.evaluatedPolygons,
  inBlendlinkStock: blendlinkStockNames.has(object.name),
  inBlendlink: blendlinkNames.has(object.name),
  inNeedle: needleNames.has(object.name),
}));

const blendlinkMissingVisible = comparisons.filter(
  (record) => !record.inBlendlink,
);
const needleMissingVisible = comparisons.filter((record) => !record.inNeedle);
const needleOnlyVisible = comparisons.filter(
  (record) => !record.inBlendlink && record.inNeedle,
);
const blendlinkOnlyVisible = comparisons.filter(
  (record) => record.inBlendlink && !record.inNeedle,
);
const focusNames = new Set([
  "Pencil.001.GPM.meshline",
  "Pencil.001.GPM.meshline.003",
  "Pencil.GPM.meshline.004",
  "Pencil.GPM.meshline.005",
  "Pencil.GPM.meshline.006",
  "Icosphere.025",
  "Icosphere.026",
  "Icosphere.028",
  "Icosphere.029",
]);
const [blendlinkStockFocus, blendlinkFocus, needleFocus] = await Promise.all([
  focusedArtifactDetails(defaults.blendlinkStock, focusNames),
  focusedArtifactDetails(blendlink, focusNames),
  focusedArtifactDetails(needle, focusNames),
]);

const evidence = {
  prototype: "splash-object-completeness-v1",
  inputs: {
    source: {
      path: source,
      bytes: readFileSync(source).length,
      sha256: sha256(source),
    },
    blendlink: {
      ...blendlinkInventory,
      names: undefined,
      meshNodes: undefined,
    },
    blendlinkStock: {
      ...blendlinkStockInventory,
      names: undefined,
      meshNodes: undefined,
      sourceRelationship:
        "Retained 120-frame stock/no-selected-material-lowering derivative; " +
        "same authored camera and material graphs, but not the exact selected-sky source hash.",
    },
    needle: {
      ...needleInventory,
      names: undefined,
      meshNodes: undefined,
    },
  },
  source: {
    blenderVersion: sourceEvidence.blenderVersion,
    blenderBuildHash: sourceEvidence.blenderBuildHash,
    scene: sourceEvidence.scene,
    viewLayer: sourceEvidence.viewLayer,
    camera: sourceEvidence.camera,
    resolution: sourceEvidence.resolution,
    meshObjectCount: sourceEvidence.meshObjectCount,
    renderParticipatingMeshCount:
      sourceEvidence.renderParticipatingMeshCount,
    pixelVisibleMeshCount: sourceEvidence.pixelVisibleMeshCount,
    geometryNodesEmitterCount: sourceEvidence.geometryNodesEmitterCount,
  },
  summary: {
    visibleSourceCount: comparisons.length,
    blendlinkMissingVisibleCount: blendlinkMissingVisible.length,
    needleMissingVisibleCount: needleMissingVisible.length,
    needleOnlyVisibleCount: needleOnlyVisible.length,
    blendlinkOnlyVisibleCount: blendlinkOnlyVisible.length,
  },
  needleOnlyVisible,
  blendlinkOnlyVisible,
  blendlinkMissingVisible,
  needleMissingVisible,
  focus: {
    blendlinkStock: blendlinkStockFocus,
    blendlink: blendlinkFocus,
    needle: needleFocus,
  },
  comparisons,
};

const evidencePath = resolve(outputRoot, "evidence.json");
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

const visualEvidencePath = resolve(outputRoot, "visual-evidence.json");
const visualOverviewPath = resolve(
  outputRoot,
  "object-appearance-overview.png",
);
const visualRun = spawnSync(
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\5.2\\python\\bin\\python.exe",
  [
    resolve(import.meta.dirname, "analyze_visual.py"),
    sourceEvidencePath,
    evidencePath,
    resolve(outputRoot, "source-object-index-preview-id-0001.exr"),
    resolve(artifactRoot, "blender-reference-selected-sky-0001.png"),
    resolve(
      artifactRoot,
      "browser-evidence-blender-4-splash-stock.png",
    ),
    resolve(
      artifactRoot,
      "browser-evidence-blender-4-splash-selected-sky.png",
    ),
    resolve(
      artifactRoot,
      "needle-three-way-2026",
      "browser-evidence-needle-blender-4-splash-selected-sky-authored-camera-clean-ui.png",
    ),
    sourcePreviewPath,
    visualEvidencePath,
    visualOverviewPath,
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  },
);
if (visualRun.status !== 0) {
  process.stderr.write(visualRun.stdout ?? "");
  process.stderr.write(visualRun.stderr ?? "");
  throw new Error(
    `Visual object-completeness analysis failed with status ${visualRun.status}`,
  );
}
process.stdout.write(visualRun.stdout ?? "");
evidence.visual = JSON.parse(readFileSync(visualEvidencePath, "utf8"));
const collapsedFocus = Object.values(evidence.visual.focus).filter(
  (record) => record.classification === "visually-collapsed",
);
evidence.summary.collapsedFocusCount = collapsedFocus.length;
evidence.summary.collapsedFocusNames = collapsedFocus.map(
  (record) => record.name,
);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      sourceVisible: comparisons.length,
      blendlinkMissingVisible: blendlinkMissingVisible.length,
      needleMissingVisible: needleMissingVisible.length,
      needleOnlyVisible: needleOnlyVisible.length,
      blendlinkOnlyVisible: blendlinkOnlyVisible.length,
      evidence: evidencePath,
    },
    null,
    2,
  ),
);

if (needleOnlyVisible.length > 0) {
  process.exitCode = 2;
} else if (collapsedFocus.length > 0) {
  process.exitCode = 3;
}
