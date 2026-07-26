const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const zlib = require("node:zlib");

const scene = process.argv[2] || "cubeDioramaAppearance";
const command = process.execPath;
const cli = path.join(process.cwd(), "node_modules", "blendlink", "dist", "cli.js");
const child = spawnSync(command, [cli, "plan", scene, "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

let result;
try {
  result = JSON.parse(child.stdout);
} catch (error) {
  console.error("Could not parse plan JSON:", error.message);
  console.error(child.stdout.slice(0, 500));
  console.error(child.stderr.slice(-2_000));
  process.exit(2);
}

const plan = result.scenes[0].plan;
const packedUvEvidenceSha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(plan.atlasLayout.objects.map(({ name, data }) => ({ name, data }))))
  .digest("hex");
const objects = new Map(plan.objects.map((object) => [object.name, object]));
const rows = plan.atlasLayout.objects.map((record) => {
  const raw = zlib.inflateSync(Buffer.from(record.data, "base64"));
  const coordinates = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let offset = 0; offset < raw.length; offset += 8) {
    const x = raw.readFloatLE(offset);
    const y = raw.readFloatLE(offset + 4);
    coordinates.push([x, y]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const uvArea = objects.get(record.name).uvShare;
  const width = maxX - minX;
  const height = maxY - minY;
  const boundsArea = width * height;
  const localShape = coordinates.map(([x, y]) => [
    Number(((x - minX) / width).toFixed(7)),
    Number(((y - minY) / height).toFixed(7)),
  ]);
  return {
    name: record.name,
    localShapeSha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(localShape))
      .digest("hex"),
    uvArea,
    boundsArea,
    localFill: uvArea / boundsArea,
    width,
    height,
    aspect: Math.max(width / height, height / width),
  };
});

const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
const atlas = plan.atlases.main;
const edgeGutter = atlas.paddingPx + 4;
const usableArea = (1 - (2 * edgeGutter) / atlas.size) ** 2;
const uvArea = sum("uvArea");
const boundsArea = sum("boundsArea");
const output = {
  childExitCode: child.status,
  packedUvEvidenceSha256,
  occupancy: plan.occupancy,
  targetAchievement: atlas.targetAchievement,
  uvArea,
  boundsArea,
  localChartFill: uvArea / boundsArea,
  usableArea,
  globalRectangleFill: boundsArea / usableArea,
  idealGainIfGlobalPackPerfect: usableArea / boundsArea,
  topAbsoluteLocalWaste: [...rows]
    .sort((left, right) =>
      (right.boundsArea - right.uvArea) - (left.boundsArea - left.uvArea))
    .slice(0, 15),
  worstLocalFill: [...rows]
    .sort((left, right) => left.localFill - right.localFill)
    .slice(0, 15),
  highestAspect: [...rows]
    .sort((left, right) => right.aspect - left.aspect)
    .slice(0, 15),
};

const summaryOnly = process.argv.includes("--summary");
const receivers = process.argv.includes("--receivers");
console.log(JSON.stringify(summaryOnly || receivers ? {
  childExitCode: output.childExitCode,
  packedUvEvidenceSha256: output.packedUvEvidenceSha256,
  occupancy: output.occupancy,
  targetAchievement: output.targetAchievement,
  globalRectangleFill: output.globalRectangleFill,
  ...(receivers ? {
    receivers: rows
      .map(({ name, localShapeSha256, width, height, localFill }) => ({
        name, localShapeSha256, width, height, localFill,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  } : {}),
} : output, null, 2));
