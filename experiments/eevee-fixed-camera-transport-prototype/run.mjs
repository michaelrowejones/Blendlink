// PROTOTYPE — disposable browser evidence runner.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  buildSemanticMasks,
  evaluateSplashFidelity,
} from "../splash-visual-fidelity-differential/metrics.mjs";

const prototypeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(prototypeDirectory, "..", "..");
const outputDirectory = join(prototypeDirectory, "output");
const splashDirectory = join(
  repositoryRoot,
  "artifacts",
  "release-dogfood",
  "blender-4-splash",
);
const referencePath = join(
  splashDirectory,
  "blender-reference-selected-sky-0001.png",
);
const scenePath = join(
  splashDirectory,
  "public",
  "models",
  "blender40SplashSelectedSky",
  "5f6064b69bd25549132b26410600b070f1e7ab8965df122e6cec2ae43e9c570a",
  "blender40SplashSelectedSky.glb",
);
const retainedBlendlinkPath = join(
  splashDirectory,
  "browser-evidence-blender-4-splash-selected-sky.png",
);
const needlePath = join(
  splashDirectory,
  "needle-three-way-2026",
  "browser-evidence-needle-blender-4-splash-selected-sky-authored-camera-clean-ui.png",
);
const threeRoot = join(repositoryRoot, "node_modules", "three");

async function loadChromium() {
  const candidates = [
    join(repositoryRoot, "node_modules", "playwright", "index.mjs"),
    join(
      dirname(repositoryRoot),
      "MichaelRoweJonesSite",
      "node_modules",
      "playwright",
      "index.mjs",
    ),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      const packageJsonPath = join(dirname(candidate), "package.json");
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      return {
        chromium: (await import(pathToFileURL(candidate).href)).chromium,
        packageJsonPath,
        version: packageJson.version,
      };
    } catch {
      // Keep the prototype dependency-free and reuse an existing workspace install.
    }
  }
  throw new Error(
    "Playwright is not installed in Blendlink or the sibling MichaelRoweJonesSite.",
  );
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function existingChrome(chromium) {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    chromium.executablePath(),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next explicit browser location.
    }
  }
  throw new Error("No Chromium/Chrome executable is available for the prototype.");
}

function routePath(pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return join(prototypeDirectory, "index.html");
  }
  if (pathname === "/main.mjs") return join(prototypeDirectory, "main.mjs");
  if (pathname === "/assets/scene.glb") return scenePath;
  if (pathname === "/assets/eevee-reference.png") return referencePath;
  if (pathname.startsWith("/vendor/three/")) {
    const suffix = pathname.slice("/vendor/three/".length);
    const resolved = resolve(threeRoot, suffix);
    if (!resolved.startsWith(`${threeRoot}\\`)) {
      throw new Error(`Refusing a vendor path outside Three: ${pathname}`);
    }
    return resolved;
  }
  return null;
}

async function loadRgb(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function wholeFrameDifference(reference, candidate) {
  if (
    reference.width !== candidate.width ||
    reference.height !== candidate.height ||
    reference.channels !== candidate.channels
  ) {
    throw new Error("Whole-frame comparison dimensions differ.");
  }
  let absolute = 0;
  let squared = 0;
  let changed = 0;
  const pixels = reference.width * reference.height;
  for (let offset = 0; offset < reference.data.length; offset += 1) {
    const difference = Math.abs(reference.data[offset] - candidate.data[offset]);
    absolute += difference;
    squared += difference * difference;
    if (difference > 8) changed += 1;
  }
  return {
    meanAbsoluteError: absolute / reference.data.length / 255,
    rootMeanSquareError: Math.sqrt(squared / reference.data.length) / 255,
    changedChannelFractionOver8: changed / reference.data.length,
    pixelCount: pixels,
  };
}

function roundDeep(value) {
  if (typeof value === "number") return Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, roundDeep(child)]),
    );
  }
  return value;
}

async function makeOverview(captures) {
  const width = 480;
  const height = 240;
  const labelHeight = 42;
  const labels = [
    ["Eevee source", referencePath],
    ["Current Blendlink", retainedBlendlinkPath],
    ["Needle actual", needlePath],
    ["Projected / authored", captures.projectedAuthored.path],
    ["Projected / backdrop only", captures.projectedBackdropOnly.path],
    ["Projected / offset", captures.projectedOffset.path],
    ["Application plate", captures.plate.path],
  ];
  const canvas = sharp({
    create: {
      width: width * labels.length,
      height: height + labelHeight,
      channels: 3,
      background: "#101318",
    },
  });
  const composites = [];
  for (let index = 0; index < labels.length; index += 1) {
    const [label, path] = labels[index];
    const image = await sharp(path).resize(width, height).png().toBuffer();
    const heading = Buffer.from(`
      <svg width="${width}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#101318"/>
        <text x="16" y="28" fill="#ffffff" font-size="18" font-family="sans-serif">${label}</text>
      </svg>
    `);
    composites.push(
      { input: heading, left: index * width, top: 0 },
      { input: image, left: index * width, top: labelHeight },
    );
  }
  await canvas
    .composite(composites)
    .png({ compressionLevel: 1 })
    .toFile(join(outputDirectory, "overview.png"));
}

await mkdir(outputDirectory, { recursive: true });
const playwright = await loadChromium();
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const path = routePath(pathname);
    if (!path) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const bytes = await readFile(path);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolvePromise) =>
  server.listen(0, "127.0.0.1", resolvePromise),
);
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const browser = await playwright.chromium.launch({
  executablePath: await existingChrome(playwright.chromium),
  headless: true,
});
const browserVersion = browser.version();
const captures = {};
const cases = [
  ["projectedAuthored", "?mode=projected&view=authored"],
  [
    "projectedBackdropOnly",
    "?mode=projected&view=authored&surfaces=backdrop-only",
  ],
  ["projectedOffset", "?mode=projected&view=offset"],
  [
    "depthProbeAll",
    "?mode=projected&view=authored&depthProbe=behind-center",
  ],
  [
    "depthProbeBackdropOnly",
    "?mode=projected&view=authored&surfaces=backdrop-only&depthProbe=behind-center",
  ],
  ["rawGlb", "?mode=current&view=authored"],
  ["plate", "?mode=plate&view=authored"],
];
try {
  for (const [name, query] of cases) {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 600 },
      deviceScaleFactor: 1,
    });
    const failures = [];
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
    page.on("requestfailed", (request) =>
      failures.push(`request: ${request.url()} ${request.failure()?.errorText}`),
    );
    await page.goto(`${baseUrl}/${query}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__prototypeReady === true, null, {
      timeout: 120_000,
    });
    const state = await page.evaluate(() => window.__prototypeState);
    const path = join(outputDirectory, `${name}.png`);
    await page.screenshot({ path });
    captures[name] = {
      path,
      sha256: sha256(await readFile(path)),
      state,
      failures,
    };
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

const [
  referenceBytes,
  sceneBytes,
  retainedBlendlinkBytes,
  needleBytes,
  reference,
  retainedBlendlink,
  needle,
  projectedAuthored,
  projectedBackdropOnly,
  projectedOffset,
  depthProbeAll,
  depthProbeBackdropOnly,
  rawGlb,
  plate,
] = await Promise.all([
  readFile(referencePath),
  readFile(scenePath),
  readFile(retainedBlendlinkPath),
  readFile(needlePath),
  loadRgb(referencePath),
  loadRgb(retainedBlendlinkPath),
  loadRgb(needlePath),
  loadRgb(captures.projectedAuthored.path),
  loadRgb(captures.projectedBackdropOnly.path),
  loadRgb(captures.projectedOffset.path),
  loadRgb(captures.depthProbeAll.path),
  loadRgb(captures.depthProbeBackdropOnly.path),
  loadRgb(captures.rawGlb.path),
  loadRgb(captures.plate.path),
]);
const masks = buildSemanticMasks(reference);

function evaluate(candidate) {
  return {
    wholeFrame: wholeFrameDifference(reference, candidate),
    splashSemantic: evaluateSplashFidelity(reference, candidate, masks),
  };
}

function centerPixel(image) {
  const x = Math.floor(image.width / 2);
  const y = Math.floor(image.height / 2);
  const offset = (y * image.width + x) * image.channels;
  return Array.from(image.data.subarray(offset, offset + 3));
}

function rgbDistance(left, right) {
  return Math.sqrt(
    left.reduce((sum, value, index) => {
      const difference = value - right[index];
      return sum + difference * difference;
    }, 0),
  );
}

const referenceCenter = centerPixel(reference);
const depthAllCenter = centerPixel(depthProbeAll);
const depthBackdropCenter = centerPixel(depthProbeBackdropOnly);

const results = {
  retainedBlendlink: evaluate(retainedBlendlink),
  needleActual: evaluate(needle),
  rawGlb: evaluate(rawGlb),
  projectedAuthored: evaluate(projectedAuthored),
  projectedBackdropOnly: evaluate(projectedBackdropOnly),
  plate: evaluate(plate),
  surfaceSemanticControl: {
    backdropOnlyMatchesReference:
      evaluate(projectedBackdropOnly).wholeFrame.meanAbsoluteError <= 1 / 255 &&
      evaluate(projectedBackdropOnly).splashSemantic.passed,
    meaning:
      "If one backdrop mesh reproduces the beauty frame, matching pixels do not prove per-surface material, object, or depth correctness.",
  },
  depthProxyControl: {
    referenceCenter,
    allGeometryCenter: depthAllCenter,
    backdropOnlyCenter: depthBackdropCenter,
    allGeometryDistanceFromReference: rgbDistance(
      referenceCenter,
      depthAllCenter,
    ),
    backdropOnlyIsRed:
      depthBackdropCenter[0] >= 220 &&
      depthBackdropCenter[0] >= depthBackdropCenter[1] + 120 &&
      depthBackdropCenter[0] >= depthBackdropCenter[2] + 120,
    passed:
      rgbDistance(referenceCenter, depthAllCenter) <= 4 &&
      depthBackdropCenter[0] >= 220 &&
      depthBackdropCenter[0] >= depthBackdropCenter[1] + 120 &&
      depthBackdropCenter[0] >= depthBackdropCenter[2] + 120,
    meaning:
      "A red sphere placed 50 units along the center ray is hidden by the complete exported geometry (nearest hit 36.56) but visible when only the 619.50-unit sky backdrop remains. This verifies a depth benefit independently from pixel matching.",
  },
  offsetDiagnostic: {
    differenceFromAuthoredProjection: wholeFrameDifference(
      projectedAuthored,
      projectedOffset,
    ),
    evidenceBoundary:
      "Diagnostic only: no Eevee offset-camera reference exists. The projector is intentionally invalid once the website moves the camera.",
  },
};
const browserFailures = Object.values(captures).flatMap((capture) =>
  capture.failures,
);
const projectedPass =
  results.projectedAuthored.splashSemantic.passed &&
  results.projectedAuthored.wholeFrame.meanAbsoluteError <
    Math.min(
      results.retainedBlendlink.wholeFrame.meanAbsoluteError,
      results.needleActual.wholeFrame.meanAbsoluteError,
    );
const platePass =
  results.plate.wholeFrame.meanAbsoluteError <= 1 / 255 &&
  results.plate.splashSemantic.passed;
const surfaceSemanticClaimRefused =
  results.surfaceSemanticControl.backdropOnlyMatchesReference;
const passed =
  projectedPass &&
  platePass &&
  results.depthProxyControl.passed &&
  browserFailures.length === 0;

await makeOverview(captures);
const [
  overviewBytes,
  threePackageBytes,
  threeShaderMaterialBytes,
  threeCameraBytes,
  threeLoaderBytes,
] = await Promise.all([
  readFile(join(outputDirectory, "overview.png")),
  readFile(join(threeRoot, "package.json")),
  readFile(join(threeRoot, "src", "materials", "ShaderMaterial.js")),
  readFile(join(threeRoot, "src", "cameras", "Camera.js")),
  readFile(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js")),
]);
const threePackage = JSON.parse(threePackageBytes.toString("utf8"));
const evidence = roundDeep({
  schemaVersion: 1,
  kind: "blendlink-eevee-fixed-camera-transport-prototype",
  question:
    "Can a final Eevee frame projected through its authored camera onto exported geometry preserve the fixed-camera Splash appearance while keeping depth-tested scene geometry?",
  evidenceBoundary:
    "One static Splash frame, one exact 1200x600 authored perspective camera, Chrome/WebGL, and one unoptimized PNG. This does not validate moving cameras, animation, visibility changes, transparent layer ownership, other aspect ratios, WebGPU, compression, or production integration.",
  toolchain: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    browser: browserVersion,
    playwright: {
      version: playwright.version,
      packageJsonPath: relative(repositoryRoot, playwright.packageJsonPath).replaceAll(
        "\\",
        "/",
      ),
    },
    three: {
      version: threePackage.version,
      packageSha256: sha256(threePackageBytes),
      shaderMaterialSha256: sha256(threeShaderMaterialBytes),
      cameraSha256: sha256(threeCameraBytes),
      gltfLoaderSha256: sha256(threeLoaderBytes),
    },
  },
  inputs: {
    reference: {
      path: relative(repositoryRoot, referencePath).replaceAll("\\", "/"),
      sha256: sha256(referenceBytes),
    },
    scene: {
      path: relative(repositoryRoot, scenePath).replaceAll("\\", "/"),
      sha256: sha256(sceneBytes),
    },
    retainedBlendlink: {
      path: relative(repositoryRoot, retainedBlendlinkPath).replaceAll("\\", "/"),
      sha256: sha256(retainedBlendlinkBytes),
    },
    needleActual: {
      path: relative(repositoryRoot, needlePath).replaceAll("\\", "/"),
      sha256: sha256(needleBytes),
      boundary:
        "Actual Needle add-on/runtime pixels from the bounded mixed-host browser cell; not a coherent package-tree or official build-pipeline claim.",
    },
  },
  captures: Object.fromEntries(
    Object.entries(captures).map(([name, capture]) => [
      name,
      {
        path: relative(repositoryRoot, capture.path).replaceAll("\\", "/"),
        sha256: capture.sha256,
        state: capture.state,
        failures: capture.failures,
      },
    ]),
  ),
  results,
  verdict: {
    projectedPass,
    platePass,
    passed,
    meaning: projectedPass
      ? "The projector is promising as a depth-tested fixed-camera pixel proxy, but the backdrop-only control refuses any per-surface or object-completeness claim."
      : "The geometry projector is falsified for this fixture or harness; a plate remains the exact fixed-camera control.",
    surfaceSemanticClaimRefused,
  },
  overview: {
    path: relative(
      repositoryRoot,
      join(outputDirectory, "overview.png"),
    ).replaceAll("\\", "/"),
    sha256: sha256(overviewBytes),
  },
});
await writeFile(
  join(outputDirectory, "evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);

console.log("PROTOTYPE — Eevee fixed-camera appearance transport");
console.log(`Reference: ${evidence.inputs.reference.sha256.slice(0, 16)}`);
console.log(`Scene: ${evidence.inputs.scene.sha256.slice(0, 16)}`);
for (const [name, result] of Object.entries({
  retained: evidence.results.retainedBlendlink,
  needle: evidence.results.needleActual,
  projected: evidence.results.projectedAuthored,
  plate: evidence.results.plate,
})) {
  console.log(
    `${name}: MAE=${result.wholeFrame.meanAbsoluteError}, ` +
      `semantic=${result.splashSemantic.passed ? "PASS" : "FAIL"}`,
  );
}
console.log(
  `offset diagnostic: projected-frame delta MAE=` +
    `${evidence.results.offsetDiagnostic.differenceFromAuthoredProjection.meanAbsoluteError}`,
);
console.log(
  `browser failures: ${browserFailures.length}; verdict: ${passed ? "PROMISING" : "FALSIFIED"}`,
);
console.log(
  `Evidence: ${relative(repositoryRoot, join(outputDirectory, "evidence.json"))}`,
);
console.log(
  `Overview: ${relative(repositoryRoot, join(outputDirectory, "overview.png"))}`,
);
if (!passed) process.exitCode = 1;
