export function dateValueForLabel(label) {
  const parts = label.split("-").map(Number);
  if (parts.length === 3) return Date.UTC(parts[0], parts[1] - 1, parts[2], 12);
  return Date.UTC(parts[0], parts[1] - 1, 15);
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) {
      augmented[column][item] /= divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function harmonicFeatures(time, originTime) {
  const yearMs = 365.2425 * 24 * 60 * 60 * 1000;
  const phase = (2 * Math.PI * (time - originTime)) / yearMs;
  return [
    1,
    Math.sin(phase),
    Math.cos(phase),
    Math.sin(2 * phase),
    Math.cos(2 * phase),
  ];
}

function fitHarmonic(points, metric) {
  const size = 5;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const vector = Array(size).fill(0);
  const datedPoints = points
    .map((point) => ({ point, time: dateValueForLabel(point.label) }))
    .filter(({ point, time }) => Number.isFinite(point[metric]) && Number.isFinite(time));

  if (datedPoints.length < size) return null;

  const originTime = datedPoints[0].time;
  for (const { point, time } of datedPoints) {
    const features = harmonicFeatures(time, originTime);
    for (let row = 0; row < size; row += 1) {
      vector[row] += features[row] * point[metric];
      for (let column = 0; column < size; column += 1) {
        matrix[row][column] += features[row] * features[column];
      }
    }
  }

  const coefficients = solveLinearSystem(matrix, vector);
  return coefficients ? { coefficients, originTime } : null;
}

function seasonalComponent(model, time) {
  const features = harmonicFeatures(time, model.originTime);
  return model.coefficients
    .slice(1)
    .reduce((sum, coefficient, index) => sum + coefficient * features[index + 1], 0);
}

function rollingAverage(points, metric, windowSize) {
  const halfWindow = Math.floor(windowSize / 2);

  return points.map((_, index) => {
    const start = Math.max(0, index - halfWindow);
    const end = Math.min(points.length - 1, index + halfWindow);
    let sum = 0;
    let count = 0;

    for (let item = start; item <= end; item += 1) {
      const value = points[item][metric];
      if (!Number.isFinite(value)) continue;
      sum += value;
      count += 1;
    }

    return count ? Number((sum / count).toFixed(2)) : null;
  });
}

function oddWindow(size, requested) {
  const bounded = Math.max(3, Math.min(size, requested));
  return bounded % 2 === 1 ? bounded : Math.max(3, bounded - 1);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function tricube(value) {
  const bounded = Math.max(0, Math.min(1, Math.abs(value)));
  const inner = 1 - bounded ** 3;
  return inner ** 3;
}

function localLinear(xs, ys, targetX, span, robustnessWeights) {
  const candidates = xs
    .map((x, index) => ({ x, y: ys[index], index, distance: Math.abs(x - targetX) }))
    .filter((item) => Number.isFinite(item.y))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, span);

  if (!candidates.length) return null;
  const maxDistance = Math.max(...candidates.map((item) => item.distance)) || 1;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;

  for (const item of candidates) {
    const robustWeight = robustnessWeights?.[item.index] ?? 1;
    const weight = tricube(item.distance / maxDistance) * robustWeight;
    if (weight <= 0) continue;
    const x = item.x - targetX;
    sw += weight;
    sx += weight * x;
    sy += weight * item.y;
    sxx += weight * x * x;
    sxy += weight * x * item.y;
  }

  if (sw <= 0) return null;
  const denominator = sw * sxx - sx * sx;
  if (Math.abs(denominator) < 1e-12) return sy / sw;
  const intercept = (sxx * sy - sx * sxy) / denominator;
  return intercept;
}

function loessSmooth(values, span, robustnessWeights) {
  const xs = values.map((_, index) => index);
  const windowSize = oddWindow(values.length, span);
  return values.map((_, index) => localLinear(xs, values, index, windowSize, robustnessWeights));
}

function seasonalLoess(values, period, spanCycles, robustnessWeights) {
  const seasonal = Array(values.length).fill(null);

  for (let phase = 0; phase < period; phase += 1) {
    const indices = [];
    const xs = [];
    const ys = [];
    const weights = [];
    for (let index = phase; index < values.length; index += period) {
      indices.push(index);
      xs.push(Math.floor(index / period));
      ys.push(values[index]);
      weights.push(robustnessWeights?.[index] ?? 1);
    }

    if (!indices.length) continue;
    const span = oddWindow(indices.length, Math.min(indices.length, spanCycles));
    for (let item = 0; item < indices.length; item += 1) {
      seasonal[indices[item]] = localLinear(xs, ys, xs[item], span, weights);
    }
  }

  for (let start = 0; start < values.length; start += period) {
    const end = Math.min(values.length, start + period);
    const block = seasonal.slice(start, end).filter(Number.isFinite);
    if (!block.length) continue;
    const blockMean = block.reduce((sum, value) => sum + value, 0) / block.length;
    for (let index = start; index < end; index += 1) {
      if (Number.isFinite(seasonal[index])) seasonal[index] -= blockMean;
    }
  }

  return seasonal;
}

function robustWeights(residuals) {
  const absMedian = median(residuals.map((value) => Math.abs(value)));
  if (!Number.isFinite(absMedian) || absMedian <= 0) return residuals.map(() => 1);
  const cutoff = 6 * absMedian;
  return residuals.map((residual) => {
    if (!Number.isFinite(residual)) return 0;
    const ratio = Math.abs(residual) / cutoff;
    if (ratio >= 1) return 0;
    return (1 - ratio * ratio) ** 2;
  });
}

function stlDecompose(values, options = {}) {
  const period = options.period ?? 12;
  if (values.length < period * 3) return null;

  const trendSpan = oddWindow(values.length, options.trendSpan ?? 121);
  const seasonalSpan = options.seasonalSpan ?? 21;
  let seasonal = Array(values.length).fill(0);
  let trend = loessSmooth(values, trendSpan);
  let weights = Array(values.length).fill(1);
  const iterations = options.iterations ?? 2;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const detrended = values.map((value, index) =>
      Number.isFinite(value) && Number.isFinite(trend[index]) ? value - trend[index] : null,
    );
    seasonal = seasonalLoess(detrended, period, seasonalSpan, weights);
    const deseasonalized = values.map((value, index) =>
      Number.isFinite(value) && Number.isFinite(seasonal[index]) ? value - seasonal[index] : null,
    );
    trend = loessSmooth(deseasonalized, trendSpan, weights);
    const residuals = values.map((value, index) =>
      Number.isFinite(value) &&
      Number.isFinite(seasonal[index]) &&
      Number.isFinite(trend[index])
        ? value - seasonal[index] - trend[index]
        : null,
    );
    weights = robustWeights(residuals);
  }

  return { seasonal, trend };
}

function addStlDeseasonalizedValues(points, options = {}) {
  const metrics = ["min", "avg", "max"];
  if (points.some((point) => point.label.length !== 7)) return;

  for (const metric of metrics) {
    const values = points.map((point) => point[metric]);
    const decomposition = stlDecompose(values, options);
    if (!decomposition) continue;

    for (let index = 0; index < points.length; index += 1) {
      const seasonal = decomposition.seasonal[index];
      const trend = decomposition.trend[index];
      if (!Number.isFinite(seasonal) || !Number.isFinite(trend)) continue;
      points[index][`${metric}StlSeasonal`] = Number(seasonal.toFixed(2));
      points[index][`${metric}StlDeseasonalized`] = Number((values[index] - seasonal).toFixed(2));
      points[index][`${metric}StlDeseasonalizedTrend`] = Number(trend.toFixed(2));
    }
  }
}

export function addDeseasonalizedValues(points, trendWindow, options = {}) {
  const metrics = ["min", "avg", "max"];
  const models = new Map(metrics.map((metric) => [metric, fitHarmonic(points, metric)]));

  for (const point of points) {
    const time = dateValueForLabel(point.label);
    if (!Number.isFinite(time)) continue;

    for (const metric of metrics) {
      const model = models.get(metric);
      const seasonal = model ? seasonalComponent(model, time) : 0;
      point[`${metric}Seasonal`] = Number(seasonal.toFixed(2));
      point[`${metric}Deseasonalized`] = Number((point[metric] - seasonal).toFixed(2));
    }
  }

  for (const metric of metrics) {
    const trendValues = rollingAverage(points, `${metric}Deseasonalized`, trendWindow);
    for (let index = 0; index < points.length; index += 1) {
      const trend = trendValues[index];
      if (Number.isFinite(trend)) {
        points[index][`${metric}DeseasonalizedTrend`] = trend;
      }
    }
  }

  if (options.stl) {
    addStlDeseasonalizedValues(points, options.stl);
  }
}
