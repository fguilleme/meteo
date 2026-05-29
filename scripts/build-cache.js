import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { readdir, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "data", "monthly-temperatures.json");
const tmpOutputPath = `${outputPath}.tmp`;

const stations = [
  { city: "Paris", code: "07149", station: "ORLY" },
  { city: "Marseille", code: "07650", station: "MARIGNANE" },
  { city: "Lyon", code: "07481", station: "LYON-ST EXUPERY" },
  { city: "Toulouse", code: "07630", station: "TOULOUSE-BLAGNAC" },
  { city: "Nice", code: "07690", station: "NICE" },
  { city: "Nantes", code: "07222", station: "NANTES-BOUGUENAIS" },
  { city: "Montpellier", code: "07643", station: "MONTPELLIER-AEROPORT" },
  { city: "Strasbourg", code: "07190", station: "STRASBOURG-ENTZHEIM" },
  { city: "Bordeaux", code: "07510", station: "BORDEAUX-MERIGNAC" },
  { city: "Lille", code: "07015", station: "LILLE-LESQUIN" },
  { city: "Rennes", code: "07130", station: "RENNES-ST JACQUES" },
  { city: "Dijon", code: "07280", station: "DIJON-LONGVIC" },
  { city: "Nancy", code: "07181", station: "NANCY-OCHEY" },
  { city: "Clermont-Ferrand", code: "07460", station: "CLERMONT-FD" },
  { city: "Tours", code: "07240", station: "TOURS" },
  { city: "Brest", code: "07110", station: "BREST-GUIPAVAS" },
  { city: "Limoges", code: "07434", station: "LIMOGES-BELLEGARDE" },
  { city: "Poitiers", code: "07335", station: "POITIERS-BIARD" },
  { city: "Perpignan", code: "07747", station: "PERPIGNAN" },
  { city: "Caen", code: "07027", station: "CAEN-CARPIQUET" },
  { city: "Rouen", code: "07037", station: "ROUEN-BOOS" },
  { city: "Mulhouse", code: "07299", station: "BALE-MULHOUSE" },
  { city: "Ajaccio", code: "07761", station: "AJACCIO" },
  { city: "Bastia", code: "07790", station: "BASTIA" }
];

const stationCodes = new Set(stations.map((station) => station.code));
const monthlyBuckets = new Map();
const dailyBuckets = new Map();

function monthFromIso(value) {
  const month = Number(value.slice(5, 7));
  if (!Number.isFinite(month)) return null;
  return month;
}

function getMonthlyBucket(code, year, month) {
  const key = `${code}|${year}|${month}`;
  let bucket = monthlyBuckets.get(key);
  if (!bucket) {
    bucket = {
      code,
      year,
      month,
      min: Infinity,
      max: -Infinity,
      minDate: null,
      maxDate: null,
      sum: 0,
      count: 0
    };
    monthlyBuckets.set(key, bucket);
  }
  return bucket;
}

function getDailyBucket(code, day) {
  const key = `${code}|${day}`;
  let bucket = dailyBuckets.get(key);
  if (!bucket) {
    bucket = {
      code,
      day,
      min: Infinity,
      max: -Infinity,
      minDate: null,
      maxDate: null,
      sum: 0,
      count: 0
    };
    dailyBuckets.set(key, bucket);
  }
  return bucket;
}

function dateValueForLabel(label) {
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
    Math.cos(2 * phase)
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

function addDeseasonalizedValues(points, trendWindow) {
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
      if (Number.isFinite(trend)) pointAssignTrend(points[index], metric, trend);
    }
  }
}

function pointAssignTrend(point, metric, trend) {
  point[`${metric}DeseasonalizedTrend`] = trend;
}

async function processFile(fileName) {
  const yearMatch = fileName.match(/synop_(\d{4})\.csv$/);
  if (!yearMatch) return;

  const year = Number(yearMatch[1]);
  const filePath = path.join(rootDir, fileName);
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (lineNumber === 1 || !line) continue;

    const columns = line.split(";");
    const code = columns[2];
    const kelvin = Number(columns[13]);
    const validityTime = columns[7];

    if (
      !stationCodes.has(code) ||
      !Number.isFinite(kelvin) ||
      kelvin < 180 ||
      kelvin > 340 ||
      !validityTime
    ) {
      continue;
    }

    const month = monthFromIso(validityTime);
    if (!month) continue;

    const celsius = kelvin - 273.15;
    const bucket = getMonthlyBucket(code, year, month);
    if (celsius < bucket.min) {
      bucket.min = celsius;
      bucket.minDate = validityTime;
    }
    if (celsius > bucket.max) {
      bucket.max = celsius;
      bucket.maxDate = validityTime;
    }
    bucket.sum += celsius;
    bucket.count += 1;

    const dailyBucket = getDailyBucket(code, validityTime.slice(0, 10));
    if (celsius < dailyBucket.min) {
      dailyBucket.min = celsius;
      dailyBucket.minDate = validityTime;
    }
    if (celsius > dailyBucket.max) {
      dailyBucket.max = celsius;
      dailyBucket.maxDate = validityTime;
    }
    dailyBucket.sum += celsius;
    dailyBucket.count += 1;
  }

  console.log(`Processed ${fileName}`);
}

async function main() {
  const files = (await readdir(rootDir))
    .filter((file) => /^synop_\d{4}\.csv$/.test(file))
    .sort();

  for (const file of files) {
    await processFile(file);
  }

  const seriesByCode = new Map(stations.map((station) => [station.code, []]));
  for (const bucket of monthlyBuckets.values()) {
    if (bucket.count === 0) continue;
    seriesByCode.get(bucket.code).push({
      year: bucket.year,
      month: bucket.month,
      label: `${bucket.year}-${String(bucket.month).padStart(2, "0")}`,
      min: Number(bucket.min.toFixed(2)),
      avg: Number((bucket.sum / bucket.count).toFixed(2)),
      max: Number(bucket.max.toFixed(2)),
      minDate: bucket.minDate,
      maxDate: bucket.maxDate,
      count: bucket.count
    });
  }
  const dailySeriesByCode = new Map(stations.map((station) => [station.code, []]));
  for (const bucket of dailyBuckets.values()) {
    if (bucket.count === 0) continue;
    dailySeriesByCode.get(bucket.code).push({
      label: bucket.day,
      min: Number(bucket.min.toFixed(2)),
      avg: Number((bucket.sum / bucket.count).toFixed(2)),
      max: Number(bucket.max.toFixed(2)),
      minDate: bucket.minDate,
      maxDate: bucket.maxDate,
      count: bucket.count
    });
  }

  const cities = stations.map((station) => ({
    ...station,
    series: seriesByCode
      .get(station.code)
      .sort((a, b) => a.year - b.year || a.month - b.month),
    dailySeries: dailySeriesByCode
      .get(station.code)
      .sort((a, b) => a.label.localeCompare(b.label))
  }));

  for (const city of cities) {
    addDeseasonalizedValues(city.series, 13);
    addDeseasonalizedValues(city.dailySeries, 365);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    unit: "celsius",
    granularity: "month+day",
    metric: "instantaneous temperature t aggregated by month and by day, invalid Kelvin values excluded; deseasonalized fields remove annual harmonic seasonality and trend fields apply centered rolling averages",
    seasonalityModel: "annual harmonic regression with two harmonics; deseasonalized = value - seasonal component; deseasonalized trend = centered rolling average, 13 months or 365 days",
    cities
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(tmpOutputPath, JSON.stringify(payload), "utf8");
  await rename(tmpOutputPath, outputPath);
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
