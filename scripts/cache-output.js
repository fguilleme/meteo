import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function summaryPathFor(outputPath) {
  return outputPath.replace(/\.json$/, ".summary.json");
}

export function dailyDirFor(outputPath) {
  return outputPath.replace(/\.json$/, ".daily");
}

function dailyPathFor(dailyDir, code) {
  return path.join(dailyDir, `${encodeURIComponent(code)}.json`);
}

function summaryPayload(payload) {
  return {
    ...payload,
    cities: payload.cities.map(({ dailySeries, ...city }) => ({
      ...city,
      dailyCount: dailySeries?.length ?? 0,
    })),
  };
}

export async function writePayloadFiles(outputPath, payload) {
  const summaryPath = summaryPathFor(outputPath);
  const dailyDir = dailyDirFor(outputPath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}.tmp`, JSON.stringify(payload), "utf8");
  await rename(`${outputPath}.tmp`, outputPath);

  await writeFile(`${summaryPath}.tmp`, JSON.stringify(summaryPayload(payload)), "utf8");
  await rename(`${summaryPath}.tmp`, summaryPath);

  await rm(dailyDir, { force: true, recursive: true });
  await mkdir(dailyDir, { recursive: true });
  await Promise.all(
    payload.cities.map((city) =>
      writeFile(
        dailyPathFor(dailyDir, city.code),
        JSON.stringify({ code: city.code, dailySeries: city.dailySeries ?? [] }),
        "utf8",
      ),
    ),
  );
}
