const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const blender = process.argv[2] ||
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
const blend = process.argv[3] || path.join(
  root,
  "artifacts",
  "release-dogfood",
  "cube-diorama",
  "fixtures",
  "cube-diorama-web-appearance.blend",
);
const probe = path.join(__dirname, "repeat_local_pack.py");

function run() {
  return new Promise((resolve, reject) => {
    const workspaceArgs = process.env.BLENDLINK_WORKSPACE_STRATEGY
      ? ["--workspace-strategy", process.env.BLENDLINK_WORKSPACE_STRATEGY]
      : [];
    const child = spawn(blender, [
      "--background",
      blend,
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      probe,
      "--",
      "--stages",
      ...workspaceArgs,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Blender exited ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      const marker = stdout.split(/\r?\n/).find((line) =>
        line.startsWith("BLENDLINK_STAGE_FINGERPRINTS "));
      if (!marker) {
        reject(new Error(`Blender emitted no stage marker: ${stdout.slice(-2000)}`));
        return;
      }
      try {
        const payload = marker.slice("BLENDLINK_STAGE_FINGERPRINTS ".length);
        // Blender can append its shutdown banner to the final stdout record
        // without a separating LF on Windows. The marker itself is one JSON
        // object and contains the last closing brace in that record.
        resolve(JSON.parse(payload.slice(0, payload.lastIndexOf("}") + 1)));
      } catch (error) {
        reject(new Error(`Stage marker was not JSON: ${error.message}`));
      }
    });
  });
}

function compareMap(label, left, right) {
  const changes = [];
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const name of names) {
    if (!left[name] || !right[name]) {
      changes.push(`${name}:presence`);
      continue;
    }
    if (left[name].geometry !== right[name].geometry) changes.push(`${name}:geometry`);
    if (left[name].uv !== right[name].uv) changes.push(`${name}:uv`);
    if (left[name].atlas !== right[name].atlas) changes.push(`${name}:atlas`);
  }
  console.log(`${label} CHANGES=${changes.length} ${changes.join(",")}`);
}

Promise.all([run(), run()]).then(([one, two]) => {
  for (const stage of ["frozen", "authored", "staged", "final"]) {
    compareMap(`stage:${stage}`, one.stages[stage], two.stages[stage]);
  }
  for (const key of ["repairs", "averages", "packs"]) {
    console.log(`${key}-count ${one[key].length}/${two[key].length}`);
    for (let index = 0; index < Math.min(one[key].length, two[key].length); index += 1) {
      compareMap(`${key}:${index}:before`, one[key][index].before, two[key][index].before);
      compareMap(`${key}:${index}:after`, one[key][index].after, two[key][index].after);
    }
  }
  console.log(`allocation-count ${one.allocations.length}/${two.allocations.length}`);
  for (let index = 0; index < Math.min(one.allocations.length, two.allocations.length); index += 1) {
    const left = one.allocations[index];
    const right = two.allocations[index];
    console.log([
      `allocation:${index}`,
      `rect=${left.rectangleHash}/${right.rectangleHash}`,
      `scale=${left.scale}/${right.scale}`,
      `route=${left.ordering}-${left.scoring}/${right.ordering}-${right.scoring}`,
    ].join(" "));
  }
  console.log(`metrics ${JSON.stringify(one.metrics)} / ${JSON.stringify(two.metrics)}`);
  console.log(`canonicalization ${JSON.stringify(one.canonicalization)} / ${JSON.stringify(two.canonicalization)}`);
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
