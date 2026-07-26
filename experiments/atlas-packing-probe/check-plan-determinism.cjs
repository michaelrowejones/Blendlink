const { spawnSync } = require("node:child_process");
const path = require("node:path");

const scene = process.argv[2] || "cubeDioramaAppearance";
const analyzer = path.join(__dirname, "analyze-plan.cjs");
const results = [];

for (let run = 1; run <= 2; run += 1) {
  const child = spawnSync(
    process.execPath,
    [analyzer, scene, "--receivers"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (child.status !== 0) {
    process.stderr.write(child.stderr);
    process.stderr.write(child.stdout);
    throw new Error(`atlas plan run ${run} failed with exit code ${child.status}`);
  }
  results.push(JSON.parse(child.stdout));
}

const first = results[0];
const second = results[1];
const stable = first.packedUvEvidenceSha256 === second.packedUvEvidenceSha256;
const firstReceivers = new Map(first.receivers.map((entry) => [entry.name, entry]));
const changedReceiverShapes = second.receivers.filter((entry) =>
  firstReceivers.get(entry.name)?.localShapeSha256 !== entry.localShapeSha256
).map((entry) => ({
  name: entry.name,
  first: firstReceivers.get(entry.name),
  second: entry,
}));
const summarize = ({ receivers: _receivers, ...result }) => result;
console.log(JSON.stringify({
  stable,
  runs: results.map(summarize),
  changedReceiverShapeCount: changedReceiverShapes.length,
  changedReceiverShapes,
}, null, 2));
if (!stable) {
  process.exitCode = 1;
}
