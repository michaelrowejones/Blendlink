const { spawn } = require("node:child_process");
const path = require("node:path");
const zlib = require("node:zlib");

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
const names = process.argv.slice(4).length
  ? process.argv.slice(4)
  : ["Dresser", "Computer"];
const probe = path.join(__dirname, "repeat_local_pack.py");

function run(name) {
  return new Promise((resolve, reject) => {
    const threadArgs = process.env.BLENDLINK_PROBE_THREADS
      ? ["--threads", process.env.BLENDLINK_PROBE_THREADS]
      : [];
    const child = spawn(blender, [
      ...threadArgs,
      "--background", blend, "--factory-startup", "--python-exit-code", "1",
      "--python", probe, "--", "--freeze-one", name,
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
        reject(new Error(`${name}: Blender exited ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      const marker = stdout.split(/\r?\n/).find((line) =>
        line.startsWith("BLENDLINK_FREEZE_ONE "));
      if (!marker) {
        reject(new Error(`${name}: no marker: ${stdout.slice(-2000)}`));
        return;
      }
      const payload = marker.slice("BLENDLINK_FREEZE_ONE ".length);
      resolve(JSON.parse(payload.slice(0, payload.lastIndexOf("}") + 1)));
    });
  });
}

function compareLayers(left, right) {
  const result = [];
  const layerNames = [...new Set([
    ...Object.keys(left.layers), ...Object.keys(right.layers),
  ])].sort();
  for (const layerName of layerNames) {
    const a = left.layers[layerName];
    const b = right.layers[layerName];
    if (!a || !b) {
      result.push({ layer: layerName, presenceChanged: true });
      continue;
    }
    const leftRaw = zlib.inflateSync(Buffer.from(a.data, "base64"));
    const rightRaw = zlib.inflateSync(Buffer.from(b.data, "base64"));
    let changedLoops = 0;
    let changedCoordinates = 0;
    let maxAbs = 0;
    const deltas = [];
    const changedAfterRound = { "1e-8": 0, "1e-7": 0, "1e-6": 0 };
    const maxRoundDisplacement = { "1e-8": 0, "1e-7": 0, "1e-6": 0 };
    const first = [];
    const loops = Math.min(a.loops, b.loops);
    for (let index = 0; index < loops; index += 1) {
      const offset = index * 9;
      let loopChanged = false;
      for (let component = 0; component < 2; component += 1) {
        const coordinateOffset = offset + component * 4;
        const av = leftRaw.readFloatLE(coordinateOffset);
        const bv = rightRaw.readFloatLE(coordinateOffset);
        for (const [label, step] of [["1e-8", 1e-8], ["1e-7", 1e-7], ["1e-6", 1e-6]]) {
          const roundedA = Math.fround(Math.round(av / step) * step);
          const roundedB = Math.fround(Math.round(bv / step) * step);
          maxRoundDisplacement[label] = Math.max(
            maxRoundDisplacement[label],
            Math.abs(roundedA - av),
            Math.abs(roundedB - bv),
          );
          if (!Object.is(roundedA, roundedB)) {
            changedAfterRound[label] += 1;
          }
        }
        if (!Object.is(av, bv)) {
          loopChanged = true;
          changedCoordinates += 1;
          const delta = Math.abs(av - bv);
          deltas.push(delta);
          maxAbs = Math.max(maxAbs, delta);
          if (first.length < 8) first.push({ index, component, left: av, right: bv });
        }
      }
      if (leftRaw[offset + 8] !== rightRaw[offset + 8]) loopChanged = true;
      if (loopChanged) changedLoops += 1;
    }
    result.push({
      layer: layerName,
      active: `${a.active}/${b.active}`,
      activeRender: `${a.activeRender}/${b.activeRender}`,
      loops: `${a.loops}/${b.loops}`,
      changedLoops,
      changedCoordinates,
      maxAbs,
      medianAbs: deltas.length
        ? deltas.sort((x, y) => x - y)[Math.floor(deltas.length / 2)]
        : 0,
      changedAfterRound,
      maxRoundDisplacement,
      first,
    });
  }
  return result;
}

Promise.all(names.flatMap((name) => [run(name), run(name)])).then((results) => {
  for (let index = 0; index < names.length; index += 1) {
    const left = results[index * 2];
    const right = results[index * 2 + 1];
    console.log(JSON.stringify({
      name: names[index],
      modifiers: left.source.modifiers,
      sourceGeometryEqual:
        left.source.fingerprint.geometry === right.source.fingerprint.geometry,
      sourceUvEqual: left.source.fingerprint.uv === right.source.fingerprint.uv,
      frozenGeometryEqual:
        left.frozen.fingerprint.geometry === right.frozen.fingerprint.geometry,
      frozenUvEqual: left.frozen.fingerprint.uv === right.frozen.fingerprint.uv,
      sourceLayers: compareLayers(left.source, right.source),
      frozenLayers: compareLayers(left.frozen, right.frozen),
    }, null, 2));
  }
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
