/**
 * Fixture-specific production evidence gate for the Blender 4 Splash scene.
 *
 * Run after:
 *   1. the selected-sky Final publish and production browser capture;
 *   2. `node experiments/splash-object-completeness/run.mjs`; and
 *   3. the Splash visual-fidelity differential with a fresh output directory.
 *
 * This is not a universal parity score. It binds the published manifest, the
 * browser-loaded GLB, the browser pixels, object-level classifications, and
 * the independent Eevee-relative symptom gates into one auditable record.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import sharp from "sharp";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const artifactRoot = resolve(
  repositoryRoot,
  "artifacts",
  "release-dogfood",
  "blender-4-splash",
);
const experimentRoot = import.meta.dirname;

const defaults = {
  manifest: resolve(
    artifactRoot,
    "src",
    "generated",
    "blender40SplashSelectedSky.manifest.json",
  ),
  matrix: resolve(artifactRoot, "visual-reference-selected-sky.json"),
  source: resolve(
    artifactRoot,
    "fixtures",
    "blender-4.0-splash-selected-sky.blend",
  ),
  browser: resolve(
    artifactRoot,
    "browser-evidence-blender-4-splash-selected-sky.json",
  ),
  screenshot: resolve(
    artifactRoot,
    "browser-evidence-blender-4-splash-selected-sky.png",
  ),
  objectEvidence: resolve(experimentRoot, "output", "evidence.json"),
  objectVisual: resolve(experimentRoot, "output", "visual-evidence.json"),
  fidelity: resolve(
    artifactRoot,
    "needle-three-way-2026",
    "visual-differential-blendlink-selected-sky-production",
    "evidence.json",
  ),
  reference: resolve(artifactRoot, "blender-reference-selected-sky-0001.png"),
  needle: resolve(
    artifactRoot,
    "needle-three-way-2026",
    "browser-evidence-needle-blender-4-splash-selected-sky-authored-camera-clean-ui.png",
  ),
  output: resolve(experimentRoot, "output", "production-evidence.json"),
};

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || !value) {
    throw new Error(
      "Arguments must be --name path pairs. Supported names: " +
        Object.keys(defaults).join(", "),
    );
  }
  argumentsByName.set(name.slice(2), value);
}
const paths = Object.fromEntries(
  Object.entries(defaults).map(([name, fallback]) => {
    const requested = argumentsByName.get(name);
    if (!requested) return [name, fallback];
    return [name, isAbsolute(requested) ? requested : resolve(repositoryRoot, requested)];
  }),
);
for (const name of argumentsByName.keys()) {
  if (!(name in defaults)) throw new Error(`Unsupported argument --${name}.`);
}

function bytes(path) {
  return readFileSync(path);
}

function sha256(path) {
  return createHash("sha256").update(bytes(path)).digest("hex");
}

async function canonicalPixelIdentity(path) {
  const { data, info } = await sharp(bytes(path))
    .resize(600, 300, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function json(path) {
  return JSON.parse(bytes(path).toString("utf8"));
}

function sceneEntry(manifest) {
  const entries = manifest.runtimeAssetGraph?.entries ?? [];
  const scenes = entries.filter((entry) => entry.role === "scene");
  if (scenes.length !== 1) {
    throw new Error(`Expected exactly one runtime scene entry; found ${scenes.length}.`);
  }
  return scenes[0];
}

function symptom(evidence, name) {
  const value = evidence.result?.symptoms?.[name];
  if (!value) throw new Error(`Fidelity evidence is missing ${name}.`);
  return value;
}

const manifest = json(paths.manifest);
const matrix = json(paths.matrix);
const browser = json(paths.browser);
const objectEvidence = json(paths.objectEvidence);
const objectVisual = json(paths.objectVisual);
const fidelity = json(paths.fidelity);
const publishedScene = sceneEntry(manifest);
const screenshotSha256 = sha256(paths.screenshot);
const sourceSha256 = sha256(paths.source);
const referenceSha256 = sha256(paths.reference);
const referencePixels = await canonicalPixelIdentity(paths.reference);
const needleSha256 = sha256(paths.needle);

const failures = [];
const checks = {};
function check(name, passed, detail) {
  checks[name] = { passed: Boolean(passed), detail };
  if (!passed) failures.push(`${name}: ${detail}`);
}

check(
  "browser-smoke",
  browser.passed === true,
  browser.passed === true ? "passed" : "browser evidence did not pass",
);
check(
  "manifest-is-current-source",
  typeof manifest.blendBytesHash === "string" &&
    sourceSha256.startsWith(manifest.blendBytesHash),
  `manifest=${manifest.blendBytesHash ?? "missing"} source=${sourceSha256}`,
);
check(
  "visual-reference-is-current-source",
  matrix.sourceBlendHash === sourceSha256.slice(0, 16),
  `matrix=${matrix.sourceBlendHash ?? "missing"} source=${sourceSha256.slice(0, 16)}`,
);
const matrixComparison = (matrix.comparisons ?? []).find(
  (comparison) =>
    comparison.browser?.path ===
    "browser-evidence-blender-4-splash-selected-sky.png",
);
check(
  "visual-matrix-used-browser-pixels",
  matrixComparison?.browser?.hash === screenshotSha256.slice(0, 16),
  `matrix=${matrixComparison?.browser?.hash ?? "missing"} browser=${screenshotSha256.slice(0, 16)}`,
);
const browserGlbs = browser.glb ?? [];
check(
  "browser-loaded-one-glb",
  browserGlbs.length === 1,
  `loaded ${browserGlbs.length} GLBs`,
);
check(
  "browser-glb-is-published-scene",
  browserGlbs.length === 1 && browserGlbs[0].sha256 === publishedScene.sha256,
  `browser=${browserGlbs[0]?.sha256 ?? "missing"} manifest=${publishedScene.sha256}`,
);
const browserUrl = browserGlbs.length === 1
  ? new URL(browserGlbs[0].url).pathname
  : null;
check(
  "browser-url-is-manifest-url",
  browserUrl === manifest.url,
  `browser=${browserUrl ?? "missing"} manifest=${manifest.url}`,
);
check(
  "object-audit-is-published-scene",
  objectEvidence.inputs?.blendlink?.sha256 === publishedScene.sha256,
  `object=${objectEvidence.inputs?.blendlink?.sha256 ?? "missing"} manifest=${publishedScene.sha256}`,
);
check(
  "object-audit-used-browser-pixels",
  objectVisual.inputs?.blendlink?.sha256 === screenshotSha256,
  `object=${objectVisual.inputs?.blendlink?.sha256 ?? "missing"} browser=${screenshotSha256}`,
);
check(
  "fidelity-used-browser-pixels",
  fidelity.candidate?.sha256 === screenshotSha256,
  `fidelity=${fidelity.candidate?.sha256 ?? "missing"} browser=${screenshotSha256}`,
);
check(
  "fidelity-used-eevee-reference",
  fidelity.reference?.sha256 === referenceSha256,
  `fidelity=${fidelity.reference?.sha256 ?? "missing"} reference=${referenceSha256}`,
);

// This hash was independently recovered from the retained Eevee panel in the
// pre-fix three-way composite. Pin decoded, canonically resized RGBA pixels so
// a lossless PNG re-encode does not masquerade as changed visual evidence.
const expectedReferencePixels =
  "6405a4699a99abae8544715b6b02be2d1bb15160f0f2a5ecaf21992e35091b6e";
const expectedNeedle =
  "54e30ecaa0342611122288efbf6ffe9c7440709d6d613c67adf77d37fe0efcbc";
check(
  "retained-eevee-identity",
  referencePixels.sha256 === expectedReferencePixels,
  `canonicalPixels=${referencePixels.sha256} expected=${expectedReferencePixels}`,
);
check(
  "retained-needle-identity",
  needleSha256 === expectedNeedle,
  `actual=${needleSha256} expected=${expectedNeedle}`,
);
check(
  "direct-object-structure",
  objectEvidence.summary?.blendlinkMissingVisibleCount === 0,
  `missing=${objectEvidence.summary?.blendlinkMissingVisibleCount ?? "unknown"}`,
);

const focusRecords = Object.values(objectVisual.focus ?? {});
const collapsedFocus = focusRecords.filter(
  (record) => record.classification === "visually-collapsed",
);
const collapsedMeaningful = (objectVisual.objectRecords ?? []).filter(
  (record) =>
    record.visiblePixels >= 50 &&
    record.classification === "visually-collapsed",
);
check(
  "lamp-and-flowerpot-recovery",
  focusRecords.length === 9 && collapsedFocus.length === 0,
  `focus=${focusRecords.length}/9 collapsed=${collapsedFocus.map((record) => record.name).join(",") || "none"}`,
);
check(
  "opaque-prototype-object-nonregression",
  collapsedMeaningful.length <= 4,
  `collapsed=${collapsedMeaningful.length}; opaque-alpha prototype baseline=4`,
);

const focusMaterials = new Set([
  "DPMLeaf.006",
  "DPM.003",
  "Bush.001",
  "Bush.003",
  "Bush.006",
]);
const materialEvidence = manifest.sceneDiagnostics?.materialCompilation?.gltfEvidence ?? [];
const focusMaterialEvidence = materialEvidence.filter((entry) =>
  focusMaterials.has(entry.sourceMaterial),
);
const incorrectFocusMaterials = focusMaterialEvidence.filter(
  (entry) =>
    entry.alphaMode !== "OPAQUE" ||
    entry.surfaceResponse !== "lit" ||
    entry.unlit !== false ||
    entry.metallicFactor !== 0 ||
    entry.roughnessFactor !== 0.5,
);
check(
  "focus-material-artifact-semantics",
  focusMaterialEvidence.length === focusMaterials.size &&
    incorrectFocusMaterials.length === 0,
  `found=${focusMaterialEvidence.length}/${focusMaterials.size} incorrect=` +
    `${incorrectFocusMaterials.map((entry) => entry.sourceMaterial).join(",") || "none"}`,
);

check(
  "fidelity-negative-controls",
  fidelity.isolatedNegativeControls?.passed === true,
  `passed=${String(fidelity.isolatedNegativeControls?.passed)}`,
);
const shadow = symptom(fidelity, "lost-shadow-information");
const sky = symptom(fidelity, "noisy-or-incorrect-sky");
const building = symptom(fidelity, "missing-building-texture");
check(
  "shadow-recovery",
  shadow.passed === true,
  `band=${shadow.ratios?.broadShadowBand} range=${shadow.ratios?.lumaRange}`,
);

const previous = {
  shadowBand: 0.268233,
  shadowRange: 0.154057,
  skyNoise: 1.630712,
  skyColorError: 3.458311,
  buildingLuma: 0.04299,
  buildingColor: 0.040908,
  buildingCorrelation: 0.045046,
  buildingPatternError: 0.999061,
};
const noRegression =
  shadow.ratios.broadShadowBand >= previous.shadowBand &&
  shadow.ratios.lumaRange >= previous.shadowRange &&
  sky.ratios.localNoise <= previous.skyNoise &&
  sky.ratios.medianColorErrorInReferenceSpreads <= previous.skyColorError &&
  building.ratios.midFrequencyLuma >= previous.buildingLuma &&
  building.ratios.localColorDetail >= previous.buildingColor &&
  building.ratios.referencePatternCorrelation >= previous.buildingCorrelation &&
  building.ratios.patternErrorInReferenceDetails <= previous.buildingPatternError;
check(
  "reported-symptom-nonregression",
  noRegression,
  JSON.stringify({
    shadow: shadow.ratios,
    sky: sky.ratios,
    building: building.ratios,
  }),
);

const report = {
  schemaVersion: 1,
  kind: "blendlink-splash-production-evidence-gate",
  scope:
    "Fixture-specific linkage and acceptance for selected-sky object recovery, " +
    "lit carrier semantics, and reported visual symptoms; not a universal parity score.",
  identities: {
    manifest: { path: paths.manifest, sha256: sha256(paths.manifest) },
    matrix: { path: paths.matrix, sha256: sha256(paths.matrix) },
    source: { path: paths.source, sha256: sourceSha256 },
    publishedScene,
    browserScreenshot: { path: paths.screenshot, sha256: screenshotSha256 },
    eeveeReference: {
      path: paths.reference,
      sha256: referenceSha256,
      canonicalPixels: referencePixels,
    },
    needleReference: { path: paths.needle, sha256: needleSha256 },
    previousBlendlink: {
      screenshotSha256:
        "853d883dac57506c45a23cbc06056a691e19a22199ec2387d35baa902ae55621",
      symptomRatios: previous,
    },
    opaqueAlphaPrototype: {
      screenshotSha256:
        "f98284c67a038987545837c58e5a4431ee2bb717c31e1be5c51608328bc10f1f",
      collapsedMeaningfulObjects: 4,
      collapsedFocusObjects: 0,
    },
    needleSymptomRatios: {
      shadowBand: 1.066283,
      shadowRange: 0.550198,
      skyNoise: 1.371534,
      skyColorError: 5.037634,
      buildingLuma: 0.879401,
      buildingColor: 0.925291,
      buildingCorrelation: 0.595708,
      buildingPatternError: 0.85254,
    },
  },
  checks,
  passed: failures.length === 0,
  failures,
};
const encodedReport = `${JSON.stringify(report, null, 2)}\n`;
mkdirSync(dirname(paths.output), { recursive: true });
writeFileSync(paths.output, encodedReport);
console.log(encodedReport);
console.log(`Evidence: ${paths.output}`);
if (failures.length > 0) process.exitCode = 1;
