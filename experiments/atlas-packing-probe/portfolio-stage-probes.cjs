const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const blender = "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
const blend = path.join(
  root, "artifacts", "release-dogfood", "cube-diorama", "fixtures",
  "cube-diorama-web-appearance.blend",
);
const probe = path.join(__dirname, "repeat_local_pack.py");
const strategies = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["smart-bevel-70", "smart-bevel-80", "smart-bevel-89"];

function run(strategy) {
  return new Promise((resolve) => {
    const child = spawn(blender, [
      "--background", blend, "--factory-startup", "--python-exit-code", "1",
      "--python", probe, "--", "--stages", "--workspace-strategy", strategy,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ strategy, error: error.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ strategy, error: stderr.slice(-3000) });
        return;
      }
      const marker = stdout.split(/\r?\n/).find((line) =>
        line.startsWith("BLENDLINK_STAGE_FINGERPRINTS "));
      if (!marker) {
        resolve({ strategy, error: stdout.slice(-3000) });
        return;
      }
      const payload = marker.slice("BLENDLINK_STAGE_FINGERPRINTS ".length);
      const result = JSON.parse(payload.slice(0, payload.lastIndexOf("}") + 1));
      resolve({
        strategy,
        metrics: result.metrics,
        allocations: result.allocations.map((item) => ({
          rectangleHash: item.rectangleHash,
          scale: item.scale,
          ordering: item.ordering,
          scoring: item.scoring,
        })),
        repairs: result.repairs.filter((item) => item.reports.length).map((item) => ({
          names: item.names,
          reports: item.reports,
        })),
      });
    });
  });
}

Promise.all(strategies.map(run)).then((results) => {
  console.log(JSON.stringify(results, null, 2));
});
