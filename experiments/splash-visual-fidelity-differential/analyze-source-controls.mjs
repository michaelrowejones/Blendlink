import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildSemanticMasks } from "./metrics.mjs";

const experimentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(experimentDirectory, "..", "..");
const controlsDirectory = join(experimentDirectory, "output", "source-controls");
const referencePath = join(
  repositoryRoot,
  "artifacts",
  "release-dogfood",
  "blender-4-splash",
  "blender-reference-selected-sky-0001.png",
);
const imagePaths = {
  reference: referencePath,
  baselineA: join(controlsDirectory, "baseline-a.png"),
  baselineB: join(controlsDirectory, "baseline-b.png"),
  sunShadowsDisabled: join(controlsDirectory, "sun-shadows-disabled.png"),
  packedNoiseNeutralized: join(controlsDirectory, "packed-noise-neutralized.png"),
};

async function loadRgb(path) {
  const bytes = await readFile(path);
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    bytes,
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
  return Number(value.toFixed(6));
}

function percentile(values, fraction) {
  values.sort((left, right) => left - right);
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return values[lower] * (1 - mix) + values[upper] * mix;
}

function fullMask(image) {
  return new Uint8Array(image.width * image.height).fill(1);
}

function differenceStats(left, right, mask) {
  let absoluteSum = 0;
  let squaredSum = 0;
  let lumaSum = 0;
  let selectedPixels = 0;
  let changedPixels = 0;
  const rgbDistances = [];
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue;
    const offset = pixel * left.channels;
    const red = Math.abs(left.data[offset] - right.data[offset]) / 255;
    const green = Math.abs(left.data[offset + 1] - right.data[offset + 1]) / 255;
    const blue = Math.abs(left.data[offset + 2] - right.data[offset + 2]) / 255;
    absoluteSum += red + green + blue;
    squaredSum += red * red + green * green + blue * blue;
    lumaSum += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const distance = Math.sqrt((red * red + green * green + blue * blue) / 3);
    rgbDistances.push(distance);
    if (Math.max(red, green, blue) >= 4 / 255) changedPixels += 1;
    selectedPixels += 1;
  }
  return {
    selectedPixels,
    rgbMae: rounded(absoluteSum / (selectedPixels * 3)),
    rgbRmse: rounded(Math.sqrt(squaredSum / (selectedPixels * 3))),
    lumaAbsoluteMean: rounded(lumaSum / selectedPixels),
    rgbDistanceP95: rounded(percentile(rgbDistances, 0.95)),
    changedByAtLeastFourCodeValuesFraction: rounded(changedPixels / selectedPixels),
  };
}

function ratio(effect, floor) {
  return floor === 0 ? (effect === 0 ? 1 : "Infinity") : rounded(effect / floor);
}

function comparison(left, right, masks) {
  return Object.fromEntries(
    Object.entries(masks).map(([name, mask]) => [name, differenceStats(left, right, mask)]),
  );
}

function labelSvg(width, labels) {
  const panelWidth = width / labels.length;
  const text = labels
    .map(
      (label, index) =>
        `<text x="${index * panelWidth + 16}" y="27" fill="#fff" ` +
        `font-size="17" font-family="sans-serif">${label}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg width="${width}" height="40"><rect width="100%" height="100%" fill="#101318"/>` +
      `${text}</svg>`,
  );
}

async function differenceImage(left, right, region, gain = 5) {
  const channels = left.channels;
  const raw = Buffer.alloc(region.width * region.height * 3);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const sourcePixel = (region.top + y) * left.width + region.left + x;
      const targetPixel = y * region.width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        raw[targetPixel * 3 + channel] = Math.min(
          255,
          Math.abs(
            left.data[sourcePixel * channels + channel] -
              right.data[sourcePixel * channels + channel],
          ) * gain,
        );
      }
    }
  }
  return sharp(raw, {
    raw: { width: region.width, height: region.height, channels: 3 },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

async function controlDiagnostic(output, baseline, changed, region, changedLabel) {
  const [left, middle, difference] = await Promise.all([
    sharp(baseline.bytes).extract(region).png({ compressionLevel: 1 }).toBuffer(),
    sharp(changed.bytes).extract(region).png({ compressionLevel: 1 }).toBuffer(),
    differenceImage(baseline, changed, region),
  ]);
  const width = region.width * 3;
  await sharp({
    create: {
      width,
      height: region.height + 40,
      channels: 3,
      background: "#101318",
    },
  })
    .composite([
      { input: labelSvg(width, ["Eevee baseline", changedLabel, "absolute difference ×5"]), top: 0, left: 0 },
      { input: left, top: 40, left: 0 },
      { input: middle, top: 40, left: region.width },
      { input: difference, top: 40, left: region.width * 2 },
    ])
    .png({ compressionLevel: 1 })
    .toFile(output);
}

async function overview(output, images) {
  const panelWidth = 600;
  const panelHeight = 300;
  const labels = [
    ["baselineA", "Eevee baseline"],
    ["sunShadowsDisabled", "Sun shadows disabled"],
    ["packedNoiseNeutralized", "packed noiseA–E neutralized"],
    ["reference", "retained reference"],
  ];
  const composites = [];
  for (let index = 0; index < labels.length; index += 1) {
    const [key, label] = labels[index];
    const left = (index % 2) * panelWidth;
    const top = Math.floor(index / 2) * (panelHeight + 40);
    const image = await sharp(images[key].bytes)
      .resize(panelWidth, panelHeight)
      .png({ compressionLevel: 1 })
      .toBuffer();
    composites.push(
      { input: labelSvg(panelWidth, [label]), left, top },
      { input: image, left, top: top + 40 },
    );
  }
  await sharp({
    create: {
      width: panelWidth * 2,
      height: (panelHeight + 40) * 2,
      channels: 3,
      background: "#101318",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 1 })
    .toFile(output);
}

const images = Object.fromEntries(
  await Promise.all(
    Object.entries(imagePaths).map(async ([name, path]) => [name, await loadRgb(path)]),
  ),
);
for (const [name, image] of Object.entries(images)) {
  if (image.width !== 1200 || image.height !== 600 || image.channels !== 3) {
    throw new Error(`${name} is ${image.width}x${image.height}x${image.channels}, expected 1200x600x3.`);
  }
}

const semanticMasks = buildSemanticMasks(images.reference);
const masks = {
  fullFrame: fullMask(images.reference),
  shadow: semanticMasks.shadow,
  sky: semanticMasks.sky,
  building: semanticMasks.building,
};
const comparisons = {
  repeatNoiseFloor: comparison(images.baselineA, images.baselineB, masks),
  baselineToReference: comparison(images.baselineA, images.reference, masks),
  sunShadowsDisabled: comparison(images.baselineA, images.sunShadowsDisabled, masks),
  packedNoiseNeutralized: comparison(images.baselineA, images.packedNoiseNeutralized, masks),
};
const effectToRepeatNoiseFloor = {};
for (const effectName of ["sunShadowsDisabled", "packedNoiseNeutralized"]) {
  effectToRepeatNoiseFloor[effectName] = {};
  for (const maskName of Object.keys(masks)) {
    const floor = comparisons.repeatNoiseFloor[maskName];
    const effect = comparisons[effectName][maskName];
    effectToRepeatNoiseFloor[effectName][maskName] = {
      rgbMae: ratio(effect.rgbMae, floor.rgbMae),
      rgbRmse: ratio(effect.rgbRmse, floor.rgbRmse),
      lumaAbsoluteMean: ratio(effect.lumaAbsoluteMean, floor.lumaAbsoluteMean),
    };
  }
}

await Promise.all([
  overview(join(controlsDirectory, "source-control-overview.png"), images),
  controlDiagnostic(
    join(controlsDirectory, "diagnostic-sun-shadow-control.png"),
    images.baselineA,
    images.sunShadowsDisabled,
    { left: 760, top: 105, width: 250, height: 350 },
    "Sun shadow off",
  ),
  controlDiagnostic(
    join(controlsDirectory, "diagnostic-packed-noise-control.png"),
    images.baselineA,
    images.packedNoiseNeutralized,
    { left: 400, top: 95, width: 430, height: 255 },
    "packed noise neutral",
  ),
]);

const evidence = {
  schemaVersion: 1,
  kind: "blendlink-splash-retained-source-control-analysis",
  status: "prototype",
  scope:
    "One-variable, fixture-specific Eevee controls. Repeat A/B is the renderer/compositor noise floor.",
  images: Object.fromEntries(
    Object.entries(images).map(([name, image]) => [
      name,
      {
        path: relative(repositoryRoot, imagePaths[name]).replaceAll("\\", "/"),
        sha256: sha256(image.bytes),
      },
    ]),
  ),
  maskPixelCounts: Object.fromEntries(
    Object.entries(masks).map(([name, mask]) => [
      name,
      mask.reduce((sum, value) => sum + value, 0),
    ]),
  ),
  comparisons,
  effectToRepeatNoiseFloor,
  diagnostics: [
    "source-control-overview.png",
    "diagnostic-sun-shadow-control.png",
    "diagnostic-packed-noise-control.png",
  ],
};
await writeFile(
  join(controlsDirectory, "analysis-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence.effectToRepeatNoiseFloor, null, 2));
