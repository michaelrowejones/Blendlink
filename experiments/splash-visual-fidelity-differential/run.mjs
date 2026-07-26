import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  buildIsolatedNegativeControls,
  buildSemanticMasks,
  evaluateSplashFidelity,
} from "./metrics.mjs";

const experimentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(experimentDirectory, "..", "..");
const defaultFixtureDirectory = join(
  repositoryRoot,
  "artifacts",
  "release-dogfood",
  "blender-4-splash",
);
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}
const referencePath = resolve(
  argumentsByName.get("--reference") ??
    join(defaultFixtureDirectory, "blender-reference-selected-sky-0001.png"),
);
const candidatePath = resolve(
  argumentsByName.get("--candidate") ??
    join(defaultFixtureDirectory, "browser-evidence-blender-4-splash-selected-sky.png"),
);
const outputDirectory = resolve(
  argumentsByName.get("--output") ?? join(experimentDirectory, "output"),
);

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : String(value);
}

function roundDeep(value) {
  if (typeof value === "number") return rounded(value);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundDeep(child)]));
  }
  return value;
}

function maskBuffer(mask) {
  const data = Buffer.alloc(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    data[index] = mask[index] ? 255 : 0;
  }
  return data;
}

function highlightedImage(image, mask, color) {
  const result = Buffer.alloc(image.width * image.height * 3);
  for (let index = 0; index < mask.length; index += 1) {
    const sourceOffset = index * image.channels;
    const targetOffset = index * 3;
    const selected = mask[index] === 1;
    const sourceWeight = selected ? 0.7 : 0.18;
    const colorWeight = selected ? 0.3 : 0;
    result[targetOffset] = Math.round(image.data[sourceOffset] * sourceWeight + color[0] * colorWeight);
    result[targetOffset + 1] = Math.round(
      image.data[sourceOffset + 1] * sourceWeight + color[1] * colorWeight,
    );
    result[targetOffset + 2] = Math.round(
      image.data[sourceOffset + 2] * sourceWeight + color[2] * colorWeight,
    );
  }
  return result;
}

async function writeMask(path, mask, width, height) {
  await sharp(maskBuffer(mask), { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toFile(path);
}

async function diagnosticPair(path, label, reference, candidate, mask, color) {
  const sourceWidth = reference.width;
  const sourceHeight = reference.height;
  const width = Math.round(sourceWidth / 2);
  const height = Math.round(sourceHeight / 2);
  const labelHeight = 42;
  const referenceOverlay = await sharp(highlightedImage(reference, mask, color), {
    raw: { width: sourceWidth, height: sourceHeight, channels: 3 },
  })
    .resize(width, height)
    .raw()
    .toBuffer();
  const candidateOverlay = await sharp(highlightedImage(candidate, mask, color), {
    raw: { width: sourceWidth, height: sourceHeight, channels: 3 },
  })
    .resize(width, height)
    .raw()
    .toBuffer();
  const labelSvg = Buffer.from(`
    <svg width="${width * 2}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#101318"/>
      <text x="18" y="28" fill="#ffffff" font-size="17" font-family="sans-serif">
        Blender Eevee reference — ${label}
      </text>
      <text x="${width + 18}" y="28" fill="#ffffff" font-size="17" font-family="sans-serif">
        Current Blendlink browser — ${label}
      </text>
    </svg>
  `);
  await sharp({
    create: {
      width: width * 2,
      height: height + labelHeight,
      channels: 3,
      background: "#101318",
    },
  })
    .composite([
      { input: labelSvg, left: 0, top: 0 },
      {
        input: referenceOverlay,
        raw: { width, height, channels: 3 },
        left: 0,
        top: labelHeight,
      },
      {
        input: candidateOverlay,
        raw: { width, height, channels: 3 },
        left: width,
        top: labelHeight,
      },
    ])
    .png({ compressionLevel: 1 })
    .toFile(path);
}

async function overview(path, pairs, width, height) {
  const cellWidth = width / 2;
  const cellHeight = height / 2;
  const rowHeight = cellHeight + 44;
  const canvas = sharp({
    create: {
      width,
      height: rowHeight * pairs.length,
      channels: 3,
      background: "#101318",
    },
  });
  const composites = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const top = index * rowHeight;
    const label = Buffer.from(`
      <svg width="${width}" height="44">
        <rect width="100%" height="100%" fill="#101318"/>
        <circle cx="20" cy="22" r="8" fill="rgb(${pair.color.join(",")})"/>
        <text x="38" y="29" fill="#ffffff" font-size="21" font-family="sans-serif">${pair.label}</text>
        <text x="${width - 166}" y="29" fill="#aab2c0" font-size="17" font-family="sans-serif">current browser</text>
        <text x="${cellWidth - 172}" y="29" fill="#aab2c0" font-size="17" font-family="sans-serif">Eevee reference</text>
      </svg>
    `);
    const referenceOverlay = await sharp(
      highlightedImage(pair.reference, pair.mask, pair.color),
      { raw: { width: pair.reference.width, height: pair.reference.height, channels: 3 } },
    )
      .resize(cellWidth, cellHeight)
      .png({ compressionLevel: 1 })
      .toBuffer();
    const candidateOverlay = await sharp(
      highlightedImage(pair.candidate, pair.mask, pair.color),
      { raw: { width: pair.candidate.width, height: pair.candidate.height, channels: 3 } },
    )
      .resize(cellWidth, cellHeight)
      .png({ compressionLevel: 1 })
      .toBuffer();
    composites.push(
      { input: label, left: 0, top },
      { input: referenceOverlay, left: 0, top: top + 44 },
      { input: candidateOverlay, left: cellWidth, top: top + 44 },
    );
  }
  await canvas.composite(composites).png({ compressionLevel: 1 }).toFile(path);
}

await mkdir(outputDirectory, { recursive: true });
const [referenceBytes, candidateBytes, reference, candidate] = await Promise.all([
  readFile(referencePath),
  readFile(candidatePath),
  loadRgb(referencePath),
  loadRgb(candidatePath),
]);
const masks = buildSemanticMasks(reference);
const result = evaluateSplashFidelity(reference, candidate, masks);
const negativeControls = buildIsolatedNegativeControls(reference, masks);
const controlMatrix = Object.fromEntries(
  Object.entries(negativeControls).map(([name, control]) => {
    const controlResult = evaluateSplashFidelity(reference, control.candidate, masks);
    const actualFailures = Object.entries(controlResult.symptoms)
      .filter(([, symptom]) => !symptom.passed)
      .map(([symptom]) => symptom);
    return [
      name,
      {
        intendedFailure: control.intendedFailure,
        actualFailures,
        passed:
          actualFailures.length === 1 && actualFailures[0] === control.intendedFailure,
      },
    ];
  }),
);
const controlMatrixPassed = Object.values(controlMatrix).every((control) => control.passed);

const diagnostics = [
  {
    key: "shadow",
    label: "lost shadow information",
    color: [255, 184, 46],
    mask: masks.shadow,
  },
  {
    key: "sky",
    label: "noisy / incorrect sky",
    color: [50, 199, 255],
    mask: masks.sky,
  },
  {
    key: "building",
    label: "missing building texture",
    color: [255, 67, 164],
    mask: masks.building,
  },
];

await Promise.all(
  diagnostics.flatMap((diagnostic) => [
    writeMask(
      join(outputDirectory, `mask-${diagnostic.key}.png`),
      diagnostic.mask,
      reference.width,
      reference.height,
    ),
    diagnosticPair(
      join(outputDirectory, `diagnostic-${diagnostic.key}.png`),
      diagnostic.label,
      reference,
      candidate,
      diagnostic.mask,
      diagnostic.color,
    ),
  ]),
);
await overview(
  join(outputDirectory, "diagnostic-overview.png"),
  diagnostics.map((diagnostic) => ({
    ...diagnostic,
    reference,
    candidate,
  })),
  reference.width,
  reference.height,
);

const evidence = roundDeep({
  schemaVersion: 1,
  kind: "blendlink-splash-visual-fidelity-differential-prototype",
  scope:
    "Reference-relative, fixture-specific evidence for three reported Blender 4.0 Splash symptoms; not a universal visual-parity score.",
  reference: {
    path: relative(repositoryRoot, referencePath).replaceAll("\\", "/"),
    sha256: sha256(referenceBytes),
  },
  candidate: {
    path: relative(repositoryRoot, candidatePath).replaceAll("\\", "/"),
    sha256: sha256(candidateBytes),
  },
  viewport: { width: reference.width, height: reference.height },
  masks: masks.metadata,
  isolatedNegativeControls: {
    scope:
      "Each synthetic candidate starts from the exact Eevee reference and mutates only its named semantic region.",
    cases: controlMatrix,
    passed: controlMatrixPassed,
  },
  result,
  diagnostics: diagnostics.map((diagnostic) =>
    relative(repositoryRoot, join(outputDirectory, `diagnostic-${diagnostic.key}.png`)).replaceAll(
      "\\",
      "/",
    ),
  ),
  passed: result.passed,
});
await writeFile(join(outputDirectory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);

console.log("Splash visual-fidelity differential (fixture-specific, reference-relative)");
console.log(`Reference: ${evidence.reference.path} (${evidence.reference.sha256.slice(0, 16)})`);
console.log(`Candidate: ${evidence.candidate.path} (${evidence.candidate.sha256.slice(0, 16)})`);
for (const [name, control] of Object.entries(evidence.isolatedNegativeControls.cases)) {
  console.log(
    `[${control.passed ? "PASS" : "FAIL"}] control ${name}: failures=` +
      `${control.actualFailures.join(",") || "none"}; intended=${control.intendedFailure}`,
  );
}
for (const [name, symptom] of Object.entries(evidence.result.symptoms)) {
  const status = symptom.passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}`);
  if (name === "lost-shadow-information") {
    console.log(
      `       broad-shadow band=${symptom.ratios.broadShadowBand}x reference ` +
        `(required >=${symptom.thresholds.minimumBroadShadowBandRatio}x); ` +
        `luma range=${symptom.ratios.lumaRange}x ` +
        `(required >=${symptom.thresholds.minimumLumaRangeRatio}x)`,
    );
  } else if (name === "noisy-or-incorrect-sky") {
    console.log(
      `       local noise=${symptom.ratios.localNoise}x reference ` +
        `(required <=${symptom.thresholds.maximumNoiseRatio}x); ` +
        `median color error=${symptom.ratios.medianColorErrorInReferenceSpreads} ` +
        `reference spreads (required <=${symptom.thresholds.maximumMedianColorErrorInReferenceSpreads})`,
    );
  } else {
    console.log(
      `       luma detail=${symptom.ratios.midFrequencyLuma}x reference ` +
        `(required >=${symptom.thresholds.minimumMidFrequencyLumaRatio}x); ` +
        `color detail=${symptom.ratios.localColorDetail}x ` +
        `(required >=${symptom.thresholds.minimumLocalColorDetailRatio}x); ` +
        `pattern correlation=${symptom.ratios.referencePatternCorrelation} ` +
        `(required >=${symptom.thresholds.minimumReferencePatternCorrelation})`,
    );
  }
}
console.log(`Evidence: ${relative(repositoryRoot, join(outputDirectory, "evidence.json"))}`);
if (!controlMatrixPassed) {
  console.error("HARNESS ERROR: isolated negative controls are coupled or did not turn red.");
  process.exitCode = 2;
} else if (!result.passed) {
  console.error("RED: current pixels do not preserve all three reference-relative Splash features.");
  process.exitCode = 1;
} else {
  console.log("GREEN: all three reference-relative Splash feature gates passed.");
}
