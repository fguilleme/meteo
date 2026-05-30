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

export function addDeseasonalizedValues(points, trendWindow) {
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
}
