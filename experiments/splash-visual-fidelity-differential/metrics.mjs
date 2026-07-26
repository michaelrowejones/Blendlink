// PROTOTYPE: fixture-specific visual evidence for the Blender 4.0 Splash scene.
// The pure functions in this file intentionally know the authored 1200x600 camera.

const FIXTURE_WIDTH = 1200;
const FIXTURE_HEIGHT = 600;

const SHADOW_ZONES = [
  [780, 142, 152, 84],
  [808, 232, 128, 112],
  [822, 350, 54, 72],
];

const SKY_ZONES = [
  [386, 0, 48, 278],
  [0, 198, 356, 142],
];

const BUILDING_ZONES = [
  // Flat left façade patch. This intentionally avoids the right-wall cast
  // shadows and roof/window silhouettes so packed wall texture, not geometry,
  // owns the measured mid-frequency signal.
  [442, 160, 68, 118],
];

function percentile(values, fraction) {
  if (values.length === 0) {
    throw new Error("Cannot compute a percentile for an empty sample.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function correlation(left, right) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftEnergy += leftDelta * leftDelta;
    rightEnergy += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator === 0 ? (leftEnergy === rightEnergy ? 1 : 0) : numerator / denominator;
}

function ratio(candidate, reference) {
  return reference === 0 ? (candidate === 0 ? 1 : Number.POSITIVE_INFINITY) : candidate / reference;
}

function rgbAt(image, index) {
  const offset = index * image.channels;
  return [
    image.data[offset] / 255,
    image.data[offset + 1] / 255,
    image.data[offset + 2] / 255,
  ];
}

function hueAndSaturation(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta === 0) {
    return { hue: 0, saturation: 0 };
  }
  let hue;
  if (maximum === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (maximum === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: maximum === 0 ? 0 : delta / maximum };
}

function lumaPlane(image) {
  const result = new Float64Array(image.width * image.height);
  for (let index = 0; index < result.length; index += 1) {
    const [red, green, blue] = rgbAt(image, index);
    result[index] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  return result;
}

function channelPlane(image, channel) {
  const result = new Float64Array(image.width * image.height);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = image.data[index * image.channels + channel] / 255;
  }
  return result;
}

function boxBlur(values, width, height, radius) {
  if (radius === 0) return Float64Array.from(values);
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const output = new Float64Array(values.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum =
        integral[(bottom + 1) * stride + right + 1] -
        integral[top * stride + right + 1] -
        integral[(bottom + 1) * stride + left] +
        integral[top * stride + left];
      output[y * width + x] = sum / ((right - left + 1) * (bottom - top + 1));
    }
  }
  return output;
}

function gradientMagnitude(values, width, height) {
  const result = new Float64Array(values.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = values[index + 1] - values[index - 1];
      const dy = values[index + width] - values[index - width];
      result[index] = Math.hypot(dx, dy) * 0.5;
    }
  }
  return result;
}

function zoneMask(width, height, zones) {
  const mask = new Uint8Array(width * height);
  const scaleX = width / FIXTURE_WIDTH;
  const scaleY = height / FIXTURE_HEIGHT;
  for (const [x, y, zoneWidth, zoneHeight] of zones) {
    const left = Math.round(x * scaleX);
    const top = Math.round(y * scaleY);
    const right = Math.round((x + zoneWidth) * scaleX);
    const bottom = Math.round((y + zoneHeight) * scaleY);
    for (let row = top; row < bottom; row += 1) {
      mask.fill(1, row * width + left, row * width + right);
    }
  }
  return mask;
}

function erode(mask, width, height, radius) {
  const numeric = Float64Array.from(mask);
  const average = boxBlur(numeric, width, height, radius);
  const output = new Uint8Array(mask.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = average[index] > 0.999999 ? 1 : 0;
  }
  return output;
}

function fillMaskWithMean(image, mask) {
  const output = {
    ...image,
    data: Buffer.from(image.data),
  };
  const sums = [0, 0, 0];
  let samples = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * image.channels;
    sums[0] += image.data[offset];
    sums[1] += image.data[offset + 1];
    sums[2] += image.data[offset + 2];
    samples += 1;
  }
  const color = sums.map((sum) => Math.round(sum / samples));
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * image.channels;
    output.data[offset] = color[0];
    output.data[offset + 1] = color[1];
    output.data[offset + 2] = color[2];
  }
  return output;
}

function select(mask, values) {
  const result = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) result.push(values[index]);
  }
  return result;
}

function selectDifference(mask, left, right) {
  const result = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) result.push(left[index] - right[index]);
  }
  return result;
}

function count(mask) {
  let total = 0;
  for (const value of mask) total += value;
  return total;
}

function rgbLocalResidual(image, blurredChannels, mask) {
  const values = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const [red, green, blue] = rgbAt(image, index);
    values.push(
      Math.sqrt(
        ((red - blurredChannels[0][index]) ** 2 +
          (green - blurredChannels[1][index]) ** 2 +
          (blue - blurredChannels[2][index]) ** 2) /
          3,
      ),
    );
  }
  return values;
}

function rgbPairDistance(reference, candidate, mask) {
  const values = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const referenceRgb = rgbAt(reference, index);
    const candidateRgb = rgbAt(candidate, index);
    values.push(
      Math.sqrt(
        ((referenceRgb[0] - candidateRgb[0]) ** 2 +
          (referenceRgb[1] - candidateRgb[1]) ** 2 +
          (referenceRgb[2] - candidateRgb[2]) ** 2) /
          3,
      ),
    );
  }
  return values;
}

export function buildSemanticMasks(reference) {
  const { width, height } = reference;
  if (width !== FIXTURE_WIDTH || height !== FIXTURE_HEIGHT) {
    throw new Error(
      `The Splash differential expects the authored ${FIXTURE_WIDTH}x${FIXTURE_HEIGHT} camera, received ${width}x${height}.`,
    );
  }

  const luma = lumaPlane(reference);
  const blur8 = boxBlur(luma, width, height, 8);
  const structuralGradient = gradientMagnitude(blur8, width, height);
  const shadow = erode(zoneMask(width, height, SHADOW_ZONES), width, height, 3);

  const skyZone = zoneMask(width, height, SKY_ZONES);
  const skyBlue = new Uint8Array(skyZone.length);
  for (let index = 0; index < skyZone.length; index += 1) {
    if (!skyZone[index]) continue;
    const [red, green, blue] = rgbAt(reference, index);
    const { hue, saturation } = hueAndSaturation(red, green, blue);
    skyBlue[index] =
      hue >= 175 &&
      hue <= 255 &&
      saturation >= 0.12 &&
      blue >= 0.32 &&
      blue >= red * 1.04
        ? 1
        : 0;
  }
  const sky = erode(skyBlue, width, height, 2);

  const buildingZone = erode(zoneMask(width, height, BUILDING_ZONES), width, height, 5);
  const buildingGradients = select(buildingZone, structuralGradient);
  const maximumStructuralGradient = percentile(buildingGradients, 0.58);
  const building = new Uint8Array(buildingZone.length);
  for (let index = 0; index < buildingZone.length; index += 1) {
    if (!buildingZone[index]) continue;
    const [red, green, blue] = rgbAt(reference, index);
    const { saturation } = hueAndSaturation(red, green, blue);
    const brightness = Math.max(red, green, blue);
    building[index] =
      brightness >= 0.42 &&
      saturation <= 0.62 &&
      structuralGradient[index] <= maximumStructuralGradient
        ? 1
        : 0;
  }

  for (const [name, mask] of Object.entries({ shadow, sky, building })) {
    if (count(mask) < 500) {
      throw new Error(`Semantic ${name} mask is unexpectedly small (${count(mask)} pixels).`);
    }
  }

  return {
    shadow,
    sky,
    building,
    metadata: {
      authoredViewport: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
      pixelCounts: {
        shadow: count(shadow),
        sky: count(sky),
        building: count(building),
      },
      buildingReferenceSelection: {
        maximumStructuralGradient,
      },
    },
  };
}

function shadowMetrics(referenceLuma, candidateLuma, mask, width, height) {
  const referenceBlur4 = boxBlur(referenceLuma, width, height, 4);
  const candidateBlur4 = boxBlur(candidateLuma, width, height, 4);
  const referenceBlur30 = boxBlur(referenceLuma, width, height, 30);
  const candidateBlur30 = boxBlur(candidateLuma, width, height, 30);
  const referenceBand = rms(selectDifference(mask, referenceBlur4, referenceBlur30));
  const candidateBand = rms(selectDifference(mask, candidateBlur4, candidateBlur30));
  const referenceSamples = select(mask, referenceBlur4);
  const candidateSamples = select(mask, candidateBlur4);
  const referenceRange = percentile(referenceSamples, 0.9) - percentile(referenceSamples, 0.1);
  const candidateRange = percentile(candidateSamples, 0.9) - percentile(candidateSamples, 0.1);
  const bandRatio = ratio(candidateBand, referenceBand);
  const rangeRatio = ratio(candidateRange, referenceRange);
  const thresholds = {
    minimumBroadShadowBandRatio: 0.72,
    minimumLumaRangeRatio: 0.72,
  };
  return {
    reference: { broadShadowBandRms: referenceBand, lumaP10P90Range: referenceRange },
    candidate: { broadShadowBandRms: candidateBand, lumaP10P90Range: candidateRange },
    ratios: { broadShadowBand: bandRatio, lumaRange: rangeRatio },
    thresholds,
    passed:
      bandRatio >= thresholds.minimumBroadShadowBandRatio &&
      rangeRatio >= thresholds.minimumLumaRangeRatio,
  };
}

function skyMetrics(reference, candidate, mask, width, height) {
  const referenceChannels = [0, 1, 2].map((channel) =>
    boxBlur(channelPlane(reference, channel), width, height, 3),
  );
  const candidateChannels = [0, 1, 2].map((channel) =>
    boxBlur(channelPlane(candidate, channel), width, height, 3),
  );
  const referenceResidual = rgbLocalResidual(reference, referenceChannels, mask);
  const candidateResidual = rgbLocalResidual(candidate, candidateChannels, mask);
  const pairDistance = rgbPairDistance(reference, candidate, mask);
  const referenceNoise = rms(referenceResidual);
  const candidateNoise = rms(candidateResidual);
  const noiseRatio = ratio(candidateNoise, referenceNoise);

  const referenceIntrinsicSpread = percentile(referenceResidual, 0.9);
  const medianColorError = percentile(pairDistance, 0.5);
  const colorErrorInReferenceSpreads = ratio(medianColorError, referenceIntrinsicSpread);
  const thresholds = {
    maximumNoiseRatio: 1.25,
    maximumMedianColorErrorInReferenceSpreads: 2,
  };
  return {
    reference: {
      localRgbNoiseRms: referenceNoise,
      intrinsicRgbSpreadP90: referenceIntrinsicSpread,
    },
    candidate: {
      localRgbNoiseRms: candidateNoise,
      medianRgbDistanceFromReference: medianColorError,
    },
    ratios: {
      localNoise: noiseRatio,
      medianColorErrorInReferenceSpreads: colorErrorInReferenceSpreads,
    },
    thresholds,
    passed:
      noiseRatio <= thresholds.maximumNoiseRatio &&
      colorErrorInReferenceSpreads <= thresholds.maximumMedianColorErrorInReferenceSpreads,
  };
}

function buildingMetrics(reference, candidate, referenceLuma, candidateLuma, mask, width, height) {
  const referenceBlur1 = boxBlur(referenceLuma, width, height, 1);
  const candidateBlur1 = boxBlur(candidateLuma, width, height, 1);
  const referenceBlur8 = boxBlur(referenceLuma, width, height, 8);
  const candidateBlur8 = boxBlur(candidateLuma, width, height, 8);
  const referenceLumaSamples = selectDifference(mask, referenceBlur1, referenceBlur8);
  const candidateLumaSamples = selectDifference(mask, candidateBlur1, candidateBlur8);
  const referenceLumaDetail = rms(referenceLumaSamples);
  const candidateLumaDetail = rms(candidateLumaSamples);
  const lumaPatternCorrelation = correlation(referenceLumaSamples, candidateLumaSamples);
  const lumaPatternError = rms(
    referenceLumaSamples.map((value, index) => value - candidateLumaSamples[index]),
  );

  const referenceChannels = [0, 1, 2].map((channel) =>
    boxBlur(channelPlane(reference, channel), width, height, 8),
  );
  const candidateChannels = [0, 1, 2].map((channel) =>
    boxBlur(channelPlane(candidate, channel), width, height, 8),
  );
  const referenceColorDetail = rms(rgbLocalResidual(reference, referenceChannels, mask));
  const candidateColorDetail = rms(rgbLocalResidual(candidate, candidateChannels, mask));
  const lumaRatio = ratio(candidateLumaDetail, referenceLumaDetail);
  const colorRatio = ratio(candidateColorDetail, referenceColorDetail);
  const thresholds = {
    minimumMidFrequencyLumaRatio: 0.7,
    minimumLocalColorDetailRatio: 0.7,
    minimumReferencePatternCorrelation: 0.65,
    maximumPatternErrorInReferenceDetails: 0.7,
  };
  return {
    reference: {
      midFrequencyLumaRms: referenceLumaDetail,
      localColorDetailRms: referenceColorDetail,
    },
    candidate: {
      midFrequencyLumaRms: candidateLumaDetail,
      localColorDetailRms: candidateColorDetail,
    },
    ratios: {
      midFrequencyLuma: lumaRatio,
      localColorDetail: colorRatio,
      referencePatternCorrelation: lumaPatternCorrelation,
      patternErrorInReferenceDetails: ratio(lumaPatternError, referenceLumaDetail),
    },
    thresholds,
    passed:
      lumaRatio >= thresholds.minimumMidFrequencyLumaRatio &&
      colorRatio >= thresholds.minimumLocalColorDetailRatio &&
      lumaPatternCorrelation >= thresholds.minimumReferencePatternCorrelation &&
      ratio(lumaPatternError, referenceLumaDetail) <=
        thresholds.maximumPatternErrorInReferenceDetails,
  };
}

export function evaluateSplashFidelity(reference, candidate, masks) {
  if (
    reference.width !== candidate.width ||
    reference.height !== candidate.height ||
    reference.channels !== candidate.channels
  ) {
    throw new Error(
      `Reference and candidate must have identical dimensions/channels; got ` +
        `${reference.width}x${reference.height}x${reference.channels} and ` +
        `${candidate.width}x${candidate.height}x${candidate.channels}.`,
    );
  }
  const { width, height } = reference;
  const referenceLuma = lumaPlane(reference);
  const candidateLuma = lumaPlane(candidate);
  const symptoms = {
    "lost-shadow-information": shadowMetrics(
      referenceLuma,
      candidateLuma,
      masks.shadow,
      width,
      height,
    ),
    "noisy-or-incorrect-sky": skyMetrics(reference, candidate, masks.sky, width, height),
    "missing-building-texture": buildingMetrics(
      reference,
      candidate,
      referenceLuma,
      candidateLuma,
      masks.building,
      width,
      height,
    ),
  };
  return {
    passed: Object.values(symptoms).every((symptom) => symptom.passed),
    symptoms,
  };
}

export function buildIsolatedNegativeControls(reference, masks) {
  const { width, height } = reference;

  const shadowOnly = fillMaskWithMean(reference, zoneMask(width, height, SHADOW_ZONES));
  const buildingOnly = fillMaskWithMean(reference, zoneMask(width, height, BUILDING_ZONES));

  const skyOnly = {
    ...reference,
    data: Buffer.from(reference.data),
  };
  for (let index = 0; index < masks.sky.length; index += 1) {
    if (!masks.sky[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * reference.channels;
    const signedNoise = (((x * 17 + y * 31) % 23) / 22 - 0.5) * 96;
    skyOnly.data[offset] = Math.max(0, Math.min(255, reference.data[offset] * 0.72 + signedNoise));
    skyOnly.data[offset + 1] = Math.max(
      0,
      Math.min(255, reference.data[offset + 1] * 0.82 + signedNoise),
    );
    skyOnly.data[offset + 2] = Math.max(
      0,
      Math.min(255, reference.data[offset + 2] + 32 + signedNoise),
    );
  }

  return {
    "shadow-only-negative": {
      intendedFailure: "lost-shadow-information",
      candidate: shadowOnly,
    },
    "sky-only-negative": {
      intendedFailure: "noisy-or-incorrect-sky",
      candidate: skyOnly,
    },
    "building-only-negative": {
      intendedFailure: "missing-building-texture",
      candidate: buildingOnly,
    },
  };
}
