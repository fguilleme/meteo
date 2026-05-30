const state = {
  payload: null,
  dataSource: "synop",
  selectedCode: "07149",
  selectedCodes: {
    synop: "07149",
    noaa: null,
  },
  chart: null,
  visibleSeries: [],
  visibleMode: "month",
  clickedIndex: null,
  activePreset: "2y",
  removeSeasonality: false,
  rangeStart: null,
  rangeEnd: null,
  cutListHtml: "",
  latestCutCursors: [],
  latestCutLabel: "",
  touchStart: null,
  touchGesture: null,
  touchDirection: null,
  mousePan: null,
  suppressNextClick: false,
};

const colors = {
  min: "#36d1c4",
  avg: "#f7b267",
  max: "#ff6b6b",
  gridDark: "rgba(255,255,255,0.09)",
  gridLight: "rgba(23,32,47,0.10)",
};

const elements = {
  sourceTabs: document.querySelectorAll("[data-source]"),
  citySelect: document.querySelector("#citySelect"),
  themeToggle: document.querySelector("#themeToggle"),
  currentCity: document.querySelector("#currentCity"),
  currentStation: document.querySelector("#currentStation"),
  currentCode: document.querySelector("#currentCode"),
  windowLabel: document.querySelector("#windowLabel"),
  seasonalityToggle: document.querySelector("#seasonalityToggle"),
  zoomButtons: document.querySelectorAll("[data-zoom]"),
  alignEnd: document.querySelector("#alignEnd"),
  canvas: document.querySelector("#temperatureChart"),
  cutListPanel: document.querySelector("#cutListPanel"),
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const weekdayDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const shortMonthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "short",
});

function isLight() {
  return document.body.classList.contains("light");
}

function clampChartWindow(chart, min, max) {
  const lastIndex = chart.data.labels.length - 1;
  const span = Math.max(1, max - min);
  let nextMin = min;
  let nextMax = max;

  if (nextMin < 0) {
    nextMin = 0;
    nextMax = Math.min(lastIndex, nextMin + span);
  }
  if (nextMax > lastIndex) {
    nextMax = lastIndex;
    nextMin = Math.max(0, nextMax - span);
  }

  return { min: nextMin, max: nextMax };
}

function updateRangeLabelFromChart(chart) {
  const labels = chart.data.labels;
  if (!labels.length) return;

  const min = Math.max(0, Math.min(labels.length - 1, Math.ceil(chart.scales.x.min ?? 0)));
  const max = Math.max(0, Math.min(labels.length - 1, Math.floor(chart.scales.x.max ?? labels.length - 1)));
  state.rangeStart = labels[min].slice(0, 7);
  state.rangeEnd = labels[max].slice(0, 7);
  elements.windowLabel.textContent = `${longLabel(state.rangeStart)} -> ${longLabel(state.rangeEnd)}`;
}

function setChartXWindow(chart, min, max) {
  const range = clampChartWindow(chart, min, max);
  chart.options.scales.x.min = range.min;
  chart.options.scales.x.max = range.max;
  chart.update("none");
  updateRangeLabelFromChart(chart);
}

function panChartByPixels(chart, startMin, startMax, pixelDelta) {
  const width = Math.max(1, chart.chartArea.right - chart.chartArea.left);
  const span = Math.max(1, startMax - startMin);
  const dataDelta = (-pixelDelta / width) * span;
  setChartXWindow(chart, startMin + dataDelta, startMax + dataDelta);
}

function zoomChartAtPixel(chart, startMin, startMax, anchorPixel, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const { left, right } = chart.chartArea;
  const width = Math.max(1, right - left);
  const anchorRatio = Math.max(0, Math.min(1, (anchorPixel - left) / width));
  const startSpan = Math.max(1, startMax - startMin);
  const nextSpan = Math.max(4, startSpan / ratio);
  const anchorValue = startMin + startSpan * anchorRatio;
  const nextMin = anchorValue - nextSpan * anchorRatio;
  setChartXWindow(chart, nextMin, nextMin + nextSpan);
}

function installChartTouchHandling() {
  elements.canvas.addEventListener(
    "touchstart",
    (event) => {
      const chart = state.chart;
      if (!chart) return;

      if (event.touches.length > 1) {
        const first = event.touches[0];
        const second = event.touches[1];
        const distance = Math.hypot(
          second.clientX - first.clientX,
          second.clientY - first.clientY,
        );
        state.touchStart = null;
        state.touchDirection = "pinch";
        state.touchGesture = {
          distance,
          centerX: (first.clientX + second.clientX) / 2,
          min: chart.scales.x.min ?? 0,
          max: chart.scales.x.max ?? chart.data.labels.length - 1,
        };
        return;
      }

      const touch = event.touches[0];
      state.touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        min: chart.scales.x.min ?? 0,
        max: chart.scales.x.max ?? chart.data.labels.length - 1,
      };
      state.touchGesture = null;
      state.touchDirection = null;
    },
    { capture: true, passive: true },
  );

  elements.canvas.addEventListener(
    "touchmove",
    (event) => {
      const chart = state.chart;
      if (!chart) return;

      if (event.touches.length > 1) {
        const first = event.touches[0];
        const second = event.touches[1];
        const distance = Math.hypot(
          second.clientX - first.clientX,
          second.clientY - first.clientY,
        );
        if (!state.touchGesture || state.touchDirection !== "pinch") {
          state.touchGesture = {
            distance,
            centerX: (first.clientX + second.clientX) / 2,
            min: chart.scales.x.min ?? 0,
            max: chart.scales.x.max ?? chart.data.labels.length - 1,
          };
        }
        state.touchDirection = "pinch";
        zoomChartAtPixel(
          chart,
          state.touchGesture.min,
          state.touchGesture.max,
          state.touchGesture.centerX,
          distance / Math.max(1, state.touchGesture.distance),
        );
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (!state.touchStart || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - state.touchStart.x);
      const dy = Math.abs(touch.clientY - state.touchStart.y);
      if (!state.touchDirection && Math.max(dx, dy) > 8) {
        state.touchDirection = dy > dx * 1.2 ? "vertical" : "horizontal";
      }

      if (state.touchDirection === "vertical") {
        event.stopImmediatePropagation();
        return;
      }

      if (state.touchDirection === "horizontal") {
        panChartByPixels(
          chart,
          state.touchStart.min,
          state.touchStart.max,
          touch.clientX - state.touchStart.x,
        );
        state.suppressNextClick = true;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );

  elements.canvas.addEventListener(
    "touchend",
    () => {
      state.touchStart = null;
      state.touchGesture = null;
      state.touchDirection = null;
    },
    { capture: true, passive: true },
  );

  elements.canvas.addEventListener(
    "touchcancel",
    () => {
      state.touchStart = null;
      state.touchGesture = null;
      state.touchDirection = null;
    },
    { capture: true, passive: true },
  );

  elements.canvas.addEventListener("mousedown", (event) => {
    if (!state.chart || event.button !== 0) return;
    const { left, right, top, bottom } = state.chart.chartArea;
    if (
      event.offsetX < left ||
      event.offsetX > right ||
      event.offsetY < top ||
      event.offsetY > bottom
    )
      return;

    state.mousePan = {
      x: event.clientX,
      min: state.chart.scales.x.min ?? 0,
      max: state.chart.scales.x.max ?? state.chart.data.labels.length - 1,
      moved: false,
    };
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!state.chart || !state.mousePan) return;
    const dx = event.clientX - state.mousePan.x;
    if (Math.abs(dx) > 3) state.mousePan.moved = true;
    panChartByPixels(state.chart, state.mousePan.min, state.mousePan.max, dx);
  });

  window.addEventListener("mouseup", () => {
    if (state.mousePan?.moved) state.suppressNextClick = true;
    state.mousePan = null;
  });
}

function formatDay(value) {
  if (!value) return "date inconnue";
  return dateFormatter.format(new Date(value));
}

function formatWeekday(value) {
  if (!value) return "date inconnue";
  return weekdayDateFormatter.format(new Date(value));
}

function formatPointDate(point, field) {
  return point[field] ? formatDay(point[field]) : longLabel(point.label);
}

function formatValue(value) {
  return `${value.toFixed(2)} °C`;
}

function getCity() {
  const city =
    state.payload.cities.find((city) => city.code === state.selectedCode) ||
    state.payload.cities[0];
  state.selectedCode = city?.code ?? state.selectedCode;
  return city;
}

function payloadSupportsDeseasonalizedTrend() {
  return state.payload?.cities?.some((city) =>
    city.series?.some((point) => Number.isFinite(point.maxDeseasonalizedTrend)),
  );
}

function monthToNumber(label) {
  const [year, month] = label.split("-").map(Number);
  return year * 12 + month;
}

function dayToNumber(label) {
  return Math.floor(new Date(`${label}T00:00:00Z`).getTime() / 86400000);
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateCutListPanel(html) {
  if (!elements.cutListPanel || state.cutListHtml === html) return;
  state.cutListHtml = html;
  elements.cutListPanel.innerHTML = html;
  elements.cutListPanel.hidden = !html;
}

function monthTitle(label) {
  const parts = label.split("-").map(Number);
  const value =
    parts.length === 3
      ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      : new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  const formatted = monthFormatter.format(value);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function longLabel(label) {
  if (label.length === 10) return formatDay(`${label}T00:00:00Z`);
  return monthTitle(label);
}

function shortDate(value) {
  return shortDateFormatter.format(new Date(value));
}

function dateForPoint(datasetLabel, point) {
  if (!point) return "";
  if (datasetLabel === "Max")
    return point.maxDate ? shortDate(point.maxDate) : longLabel(point.label);
  if (datasetLabel === "Min")
    return point.minDate ? shortDate(point.minDate) : longLabel(point.label);
  return longLabel(point.label);
}

function dateValueForPoint(datasetLabel, point) {
  if (!point) return null;
  if (datasetLabel === "Max" && point.maxDate)
    return new Date(point.maxDate).getTime();
  if (datasetLabel === "Min" && point.minDate)
    return new Date(point.minDate).getTime();

  const parts = point.label.split("-").map(Number);
  if (parts.length === 3) return Date.UTC(parts[0], parts[1] - 1, parts[2], 12);
  return Date.UTC(parts[0], parts[1] - 1, 15);
}

function timeForLabel(label) {
  if (!label) return null;
  const parts = label.split("-").map(Number);
  if (parts.length === 3) return Date.UTC(parts[0], parts[1] - 1, parts[2], 12);
  return Date.UTC(parts[0], parts[1] - 1, 15);
}

function interpolatedAxisTime(index, ratio) {
  const timeA = timeForLabel(state.visibleSeries[index]?.label);
  const timeB = timeForLabel(state.visibleSeries[index + 1]?.label);
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) {
    return timeForLabel(
      state.visibleSeries[ratio < 0.5 ? index : index + 1]?.label,
    );
  }

  return timeA + (timeB - timeA) * ratio;
}

function axisTimeAt(value) {
  const low = Math.max(
    0,
    Math.min(state.visibleSeries.length - 1, Math.floor(value)),
  );
  const high = Math.max(
    0,
    Math.min(state.visibleSeries.length - 1, Math.ceil(value)),
  );
  if (low === high) return timeForLabel(state.visibleSeries[low]?.label);

  const timeLow = timeForLabel(state.visibleSeries[low]?.label);
  const timeHigh = timeForLabel(state.visibleSeries[high]?.label);
  if (!Number.isFinite(timeLow) || !Number.isFinite(timeHigh)) return timeLow;
  return timeLow + (timeHigh - timeLow) * (value - low);
}

function rightmostVisibleIndex(chart) {
  const labels = chart.data.labels;
  if (!labels.length) return -1;

  const max = Number.isFinite(chart.scales.x.max)
    ? chart.scales.x.max
    : labels.length - 1;
  return Math.max(0, Math.min(labels.length - 1, Math.floor(max)));
}

function rightmostVisibleValue(chart) {
  const lastIndex = chart.data.labels.length - 1;
  const max = Number.isFinite(chart.scales.x.max)
    ? chart.scales.x.max
    : lastIndex;
  return Math.max(0, Math.min(lastIndex, max));
}

function interpolatedDataValue(values, xValue) {
  const low = Math.max(0, Math.min(values.length - 1, Math.floor(xValue)));
  const high = Math.max(0, Math.min(values.length - 1, Math.ceil(xValue)));
  const lowValue = values[low];
  const highValue = values[high];
  if (!Number.isFinite(lowValue)) return highValue;
  if (!Number.isFinite(highValue) || low === high) return lowValue;
  return lowValue + (highValue - lowValue) * (xValue - low);
}

function visibleMonthSpan(chart) {
  const min = Number.isFinite(chart.scales.x.min) ? chart.scales.x.min : 0;
  const max = Number.isFinite(chart.scales.x.max)
    ? chart.scales.x.max
    : chart.data.labels.length - 1;
  if (state.visibleMode === "day") return (max - min) / 30.5;
  return max - min;
}

function valueForDatasetLabel(point, label) {
  if (label === "Max") return point.max;
  if (label === "Min") return point.min;
  return point.avg;
}

function displayMetric(point, metric) {
  if (!state.removeSeasonality) return point[metric];
  const trendKey = `${metric}DeseasonalizedTrend`;
  if (Number.isFinite(point[trendKey])) return point[trendKey];
  const deseasonalizedKey = `${metric}Deseasonalized`;
  if (Number.isFinite(point[deseasonalizedKey])) return point[deseasonalizedKey];
  return point[metric];
}

function displaySeriesValues(series) {
  return series.map((point) => {
    return {
      ...point,
      min: displayMetric(point, "min"),
      avg: displayMetric(point, "avg"),
      max: displayMetric(point, "max"),
    };
  });
}

function thresholdStarts(chart, threshold, targetLabel) {
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  const visibleMin = Number.isFinite(xScale.min) ? xScale.min : 0;
  const visibleMax = Number.isFinite(xScale.max)
    ? xScale.max
    : chart.data.labels.length - 1;
  const starts = [];
  const minIndex = Math.max(0, Math.floor(visibleMin) - 1);
  const maxIndex = Math.min(
    chart.data.labels.length - 1,
    Math.ceil(visibleMax) + 1,
  );

  const dataset = chart.data.datasets.find(
    (item) => item.label === targetLabel,
  );
  if (!dataset) return starts;

  const values = dataset.data;
  const allowedBelowCount = state.visibleMode === "day" ? 14 : 1;
  let inEpisode =
    minIndex > 0 &&
    Number.isFinite(values[minIndex - 1]) &&
    values[minIndex - 1] >= threshold;
  let belowCount = 0;
  for (let index = minIndex; index <= maxIndex; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    const isAbove = value >= threshold;
    if (isAbove) {
      if (!inEpisode) {
        const x = xScale.getPixelForValue(index);
        const y = yScale.getPixelForValue(value);
        const point = state.visibleSeries[index];
        const time =
          dateValueForPoint(targetLabel, point) || timeForLabel(point?.label);
        if (
          x >= chart.chartArea.left &&
          x <= chart.chartArea.right &&
          y >= chart.chartArea.top &&
          y <= chart.chartArea.bottom
        ) {
          starts.push({
            x,
            y,
            time,
            color: dataset.borderColor,
            datasetLabel: dataset.label,
            formattedValue: formatValue(value),
            value,
            date: formatDay(new Date(time)),
            weekdayDate: formatWeekday(new Date(time)),
          });
        }
      }
      inEpisode = true;
      belowCount = 0;
      continue;
    }

    if (!inEpisode) continue;
    belowCount += 1;
    if (belowCount > allowedBelowCount) {
      inEpisode = false;
      belowCount = 0;
    }
  }

  return starts.sort((a, b) => a.x - b.x);
}

function thresholdIntersections(chart, threshold, targetLabel) {
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  const visibleMin = Number.isFinite(xScale.min) ? xScale.min : 0;
  const visibleMax = Number.isFinite(xScale.max)
    ? xScale.max
    : chart.data.labels.length - 1;
  const minIndex = Math.max(0, Math.floor(visibleMin) - 1);
  const maxIndex = Math.min(
    chart.data.labels.length - 1,
    Math.ceil(visibleMax) + 1,
  );
  const dataset = chart.data.datasets.find(
    (item) => item.label === targetLabel,
  );
  if (!dataset) return [];

  const intersections = [];
  const values = dataset.data;
  for (let index = minIndex; index < maxIndex; index += 1) {
    const yA = values[index];
    const yB = values[index + 1];
    if (!Number.isFinite(yA) || !Number.isFinite(yB) || yA === yB) continue;

    const min = Math.min(yA, yB);
    const max = Math.max(yA, yB);
    if (threshold < min || threshold > max) continue;

    const ratio = (threshold - yA) / (yB - yA);
    const x = xScale.getPixelForValue(index + ratio);
    const y = yScale.getPixelForValue(threshold);
    if (
      x < chart.chartArea.left ||
      x > chart.chartArea.right ||
      y < chart.chartArea.top ||
      y > chart.chartArea.bottom
    ) {
      continue;
    }

    intersections.push({ x, y, color: dataset.borderColor });
  }

  return intersections;
}

function renderCutList(cursors, activeLabel) {
  const sections = cursors
    .map((cursor) => {
      const rows = sortedCutRows(cursor);
      const body = rows.length
        ? rows
          .map(
            (row) => `
          <li class="cut-list-row">
            <span class="cut-dot" style="--cut-color: ${escapeHtml(row.color)}"></span>
            <span>${escapeHtml(row.datasetLabel)} ${escapeHtml(row.formattedValue)}</span>
            <span>${escapeHtml(row.weekdayDate)}</span>
          </li>
        `,
          )
          .join("")
        : `<li class="cut-list-empty">Aucune coupe visible</li>`;

      return `
      <article class="cut-list-section">
        <h2 style="--cut-color: ${escapeHtml(cursor.color)}">${escapeHtml(cursor.label)}</h2>
        <ul>${body}</ul>
      </article>
    `;
    })
    .join("");

  updateCutListPanel(`
    <div class="cut-list-header">
      <span>Premiers jours des épisodes chauds</span>
      <span>${escapeHtml(longLabel(activeLabel))}</span>
    </div>
    <div class="cut-list-grid">${sections}</div>
  `);
}

function sortedCutRows(cursor) {
  return cursor.intersections
    .filter((intersection) => Number.isFinite(intersection.time))
    .sort((a, b) => {
      const distance =
        Math.abs(a.time - cursor.referenceTime) -
        Math.abs(b.time - cursor.referenceTime);
      return distance || b.time - a.time;
    });
}

const rightEdgeCursorPlugin = {
  id: "rightEdgeCursor",
  afterDraw(chart) {
    const index = rightmostVisibleIndex(chart);
    if (index < 0) {
      updateCutPreviewPanel("");
      updateCutListPanel("");
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const rightXValue = rightmostVisibleValue(chart);
    const x = scales.x.getPixelForValue(rightXValue);
    const cursors = chart.data.datasets
      .filter((dataset) => dataset.label === "Max" || dataset.label === "Min")
      .map((dataset) => ({
        label: dataset.label,
        color: dataset.borderColor,
        value: interpolatedDataValue(dataset.data, rightXValue),
      }))
      .filter((cursor) => Number.isFinite(cursor.value));

    ctx.save();
    const detailCursors = [];
    cursors.forEach((cursor) => {
      const y = scales.y.getPixelForValue(cursor.value);
      if (y < chartArea.top || y > chartArea.bottom) return;
      const showCutMarkers = cursor.label === "Max";
      const intersections = showCutMarkers
        ? thresholdStarts(chart, cursor.value, cursor.label)
        : [];
      const crossingMarkers = showCutMarkers
        ? thresholdIntersections(chart, cursor.value, cursor.label)
        : [];
      const referenceTime = axisTimeAt(rightXValue);
      if (showCutMarkers) {
        detailCursors.push({ ...cursor, intersections, referenceTime });
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = cursor.color;
      ctx.globalAlpha = 0.54;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.fillStyle = cursor.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      crossingMarkers.forEach((marker) => {
        ctx.fillStyle = marker.color;
        ctx.globalAlpha = 0.78;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    });

    ctx.restore();
    state.latestCutCursors = detailCursors;
    state.latestCutLabel = state.visibleSeries[index]?.label ?? "";
    renderCutList(detailCursors, state.latestCutLabel);
  },
};

const clickTooltipPlugin = {
  id: "clickTooltip",
  afterEvent(chart, args) {
    const event = args.event;
    if (event.type !== "click") return;
    if (state.suppressNextClick) {
      state.suppressNextClick = false;
      return;
    }

    const { left, right, top, bottom } = chart.chartArea;
    const inChart =
      event.x >= left &&
      event.x <= right &&
      event.y >= top &&
      event.y <= bottom;
    if (!inChart) {
      state.clickedIndex = null;
      args.changed = true;
      return;
    }

    const rawIndex = chart.scales.x.getValueForPixel(event.x);
    state.clickedIndex = Math.max(
      0,
      Math.min(chart.data.labels.length - 1, Math.round(rawIndex)),
    );
    args.changed = true;
  },
  afterDraw(chart) {
    const index = state.clickedIndex;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= state.visibleSeries.length
    )
      return;

    const { ctx, chartArea, scales } = chart;
    const point = state.visibleSeries[index];
    const textColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--text")
      .trim();
    const panelColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--panel")
      .trim();
    const lineColor = isLight()
      ? "rgba(23, 32, 47, 0.55)"
      : "rgba(243, 246, 251, 0.62)";
    const x = scales.x.getPixelForValue(index);

    if (x < chartArea.left || x > chartArea.right) return;

    const rows = [
      {
        color: colors.max,
        text: `Max ${formatValue(point.max)} - ${formatPointDate(point, "maxDate")}`,
      },
      { color: colors.avg, text: `Moy ${formatValue(point.avg)}` },
      {
        color: colors.min,
        text: `Min ${formatValue(point.min)} - ${formatPointDate(point, "minDate")}`,
      },
    ];

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = lineColor;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "800 12px system-ui, sans-serif";
    const title = longLabel(point.label);
    const titleWidth = ctx.measureText(title).width;
    ctx.font = "700 11px system-ui, sans-serif";
    const rowWidth = Math.max(
      ...rows.map((row) => ctx.measureText(row.text).width),
    );
    const width = Math.max(titleWidth, rowWidth) + 34;
    const height = 30 + rows.length * 16;
    const boxX =
      x < (chartArea.left + chartArea.right) / 2
        ? Math.min(x + 14, chartArea.right - width)
        : Math.max(x - width - 14, chartArea.left);
    const boxY = chartArea.top + 14;

    roundedRect(ctx, boxX, boxY, width, height, 8);
    ctx.fillStyle = panelColor;
    ctx.globalAlpha = 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = lineColor;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillText(title, boxX + 10, boxY + 18);

    ctx.font = "700 11px system-ui, sans-serif";
    rows.forEach((row, rowIndex) => {
      const y = boxY + 38 + rowIndex * 16;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(boxX + 12, y - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.fillText(row.text, boxX + 22, y);
    });

    ctx.restore();
  },
};

const alternatingYearBandsPlugin = {
  id: "alternatingYearBands",
  beforeDatasetsDraw(chart) {
    const labels = chart.data.labels;
    if (!labels.length) return;

    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    let activeYear = null;
    let startIndex = 0;
    let bandIndex = 0;

    ctx.save();
    for (let index = 0; index <= labels.length; index += 1) {
      const year = labels[index]?.slice(0, 4);
      if (index === 0) {
        activeYear = year;
        continue;
      }

      if (year !== activeYear) {
        if (bandIndex % 2 === 0) {
          const startX = xScale.getPixelForValue(startIndex - 0.5);
          const endX = xScale.getPixelForValue(index - 0.5);
          ctx.fillStyle = isLight()
            ? "rgba(8, 127, 140, 0.045)"
            : "rgba(54, 209, 196, 0.035)";
          ctx.fillRect(
            startX,
            chartArea.top,
            endX - startX,
            chartArea.bottom - chartArea.top,
          );
        }
        activeYear = year;
        startIndex = index;
        bandIndex += 1;
      }
    }
    ctx.restore();
  },
};

Chart.register(
  alternatingYearBandsPlugin,
  rightEdgeCursorPlugin,
  clickTooltipPlugin,
);

function clampRangeToCity(city) {
  const first = city.series[0]?.label;
  const last = city.series.at(-1)?.label;
  if (!first || !last) return;

  if (
    !state.rangeStart ||
    monthToNumber(state.rangeStart) < monthToNumber(first)
  ) {
    state.rangeStart = first;
  }
  if (!state.rangeEnd || monthToNumber(state.rangeEnd) > monthToNumber(last)) {
    state.rangeEnd = last;
  }
  if (monthToNumber(state.rangeStart) > monthToNumber(state.rangeEnd)) {
    state.rangeStart = first;
    state.rangeEnd = last;
  }

  elements.windowLabel.textContent = `${longLabel(state.rangeStart)} -> ${longLabel(state.rangeEnd)}`;
}

function filteredSeries(city) {
  const start = monthToNumber(state.rangeStart);
  const end = monthToNumber(state.rangeEnd);
  return city.series.filter((point) => {
    const month = monthToNumber(point.label);
    return month >= start && month <= end;
  });
}

function labelIndex(series, label, fallback) {
  const index = series.findIndex((point) => point.label === label);
  return index === -1 ? fallback : index;
}

function lowerBoundIndex(series, label) {
  const index = series.findIndex((point) => point.label >= label);
  return index === -1 ? Math.max(0, series.length - 1) : index;
}

function endOfMonthLabel(monthLabel) {
  const [year, month] = monthLabel.split("-").map(Number);
  const value = new Date(Date.UTC(year, month, 0));
  return value.toISOString().slice(0, 10);
}

function selectedMonthSpan() {
  return monthToNumber(state.rangeEnd) - monthToNumber(state.rangeStart) + 1;
}

function zoomSpanMonths(zoom) {
  if (zoom === "all") return Infinity;
  if (zoom.endsWith("m")) return Number(zoom.replace("m", ""));
  return Number(zoom.replace("y", "")) * 12;
}

function monthLabelFromNumber(value) {
  const year = Math.floor((value - 1) / 12);
  const month = ((value - 1) % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function xMinForSeries(series) {
  if (state.visibleMode === "day")
    return lowerBoundIndex(series, `${state.rangeStart}-01`);
  return labelIndex(series, state.rangeStart, 0);
}

function xMaxForSeries(series) {
  if (state.visibleMode === "day")
    return lowerBoundIndex(series, endOfMonthLabel(state.rangeEnd));
  return labelIndex(series, state.rangeEnd, series.length - 1);
}

function dayTickInterval(span) {
  if (state.visibleMode === "day") {
    if (span > 540) return 3;
    if (span > 240) return 2;
    if (span > 45) return 1;
    return Math.max(1, Math.ceil(span / 12));
  }
  return 1;
}

function monthTickInterval(span) {
  if (span > 600) return 120;
  if (span > 360) return 60;
  if (span > 180) return 24;
  if (span > 72) return 12;
  if (span > 36) return 6;
  if (span > 18) return 3;
  return 1;
}

function shouldShowAxisTick(label, index, span, visibleStart, visibleEnd) {
  if (index === visibleStart || index === visibleEnd) return true;

  if (state.visibleMode === "day") {
    const date = new Date(`${label}T00:00:00Z`);
    if (span <= 45) {
      return (index - visibleStart) % dayTickInterval(span) === 0;
    }
    return (
      date.getUTCDate() === 1 &&
      date.getUTCMonth() % dayTickInterval(span) === 0
    );
  }

  const [year, month] = label.split("-").map(Number);
  if (span <= 36) return (month - 1) % monthTickInterval(span) === 0;
  const yearInterval = Math.max(1, monthTickInterval(span) / 12);
  return month === 1 && year % yearInterval === 0;
}

function axisTickLabel(label, index, span, visibleStart) {
  if (state.visibleMode === "day") {
    const date = new Date(`${label}T00:00:00Z`);
    if (span <= 45) {
      return new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
      }).format(date);
    }

    const month = shortMonthFormatter.format(date).replace(".", "");
    return date.getUTCMonth() === 0 || index === visibleStart
      ? `${month} ${date.getUTCFullYear()}`
      : month;
  }

  const [year, month] = label.split("-").map(Number);
  if (span <= 36) {
    const monthName = shortMonthFormatter
      .format(new Date(Date.UTC(year, month - 1, 1)))
      .replace(".", "");
    return month === 1 || index === visibleStart
      ? `${monthName} ${year}`
      : monthName;
  }
  return String(year);
}

function chartOptions() {
  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--text")
    .trim();
  const mutedColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--muted")
    .trim();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 850,
      easing: "easeOutQuart",
    },
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          color: textColor,
          boxWidth: 12,
          usePointStyle: true,
        },
      },
      tooltip: {
        enabled: false,
        itemSort(a, b) {
          const order = { Max: 0, Moy: 1, Min: 2 };
          return order[a.dataset.label] - order[b.dataset.label];
        },
        callbacks: {
          title(items) {
            const label = items[0]?.label;
            return label ? monthTitle(label) : "";
          },
          label(context) {
            const point = state.visibleSeries[context.dataIndex];
            const value = formatValue(context.parsed.y);
            if (context.dataset.label === "Min") {
              return `Min ${value} - ${formatDay(point.minDate)}`;
            }
            if (context.dataset.label === "Max") {
              return `Max ${value} - ${formatDay(point.maxDate)}`;
            }
            return `Moy ${value}`;
          },
        },
      },
      zoom: {
        limits: {
          x: { min: 0, max: Math.max(0, state.visibleSeries.length - 1) },
          y: { min: "original", max: "original" },
        },
        pan: {
          enabled: false,
          mode: "x",
          threshold: 4,
          modifierKey: null,
        },
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.08,
          },
          pinch: {
            enabled: false,
          },
          drag: {
            enabled: false,
          },
          mode: "x",
        },
      },
    },
    scales: {
      x: {
        min: xMinForSeries(state.visibleSeries),
        max: xMaxForSeries(state.visibleSeries),
        ticks: {
          color: mutedColor,
          maxRotation: 0,
          autoSkip: false,
          callback(value) {
            const labels = this.chart.data.labels;
            const label = this.getLabelForValue(value);
            const lastIndex = labels.length - 1;
            const visibleStart = Math.max(
              0,
              Math.ceil(this.chart.scales.x.min ?? 0),
            );
            const visibleEnd = Math.min(
              lastIndex,
              Math.floor(this.chart.scales.x.max ?? lastIndex),
            );
            const span = Math.max(1, visibleEnd - visibleStart);

            if (
              shouldShowAxisTick(label, value, span, visibleStart, visibleEnd)
            ) {
              return axisTickLabel(label, value, span, visibleStart);
            }
            return "";
          },
        },
        grid: {
          color(context) {
            const labels = context.chart.data.labels;
            const value = context.tick.value;
            const lastIndex = labels.length - 1;
            const label = labels[value];
            const visibleStart = Math.max(
              0,
              Math.ceil(context.chart.scales.x.min ?? 0),
            );
            const visibleEnd = Math.min(
              lastIndex,
              Math.floor(context.chart.scales.x.max ?? lastIndex),
            );
            const span = Math.max(1, visibleEnd - visibleStart);
            const visibleTick =
              label &&
              shouldShowAxisTick(label, value, span, visibleStart, visibleEnd);
            if (!visibleTick) return "rgba(0, 0, 0, 0)";
            return isLight() ? colors.gridLight : colors.gridDark;
          },
        },
      },
      y: {
        title: {
          display: true,
          text: state.removeSeasonality
            ? "Température désaisonnalisée (°C)"
            : "Température (°C)",
          color: mutedColor,
        },
        ticks: {
          color: mutedColor,
          callback: (value) => `${value} °C`,
        },
        grid: {
          color: isLight() ? colors.gridLight : colors.gridDark,
        },
      },
    },
  };
}

function cityDatasets(series) {
  return [
    {
      label: "Max",
      data: series.map((point) => point.max),
      borderColor: colors.max,
      backgroundColor: "rgba(255, 107, 107, 0.14)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.28,
    },
    {
      label: "Moy",
      data: series.map((point) => point.avg),
      borderColor: colors.avg,
      backgroundColor: "rgba(247, 178, 103, 0.18)",
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.28,
    },
    {
      label: "Min",
      data: series.map((point) => point.min),
      borderColor: colors.min,
      backgroundColor: "rgba(54, 209, 196, 0.16)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.28,
    },
  ];
}

function updateSummary(city, series) {
  elements.currentCity.textContent = city.city;
  elements.currentStation.textContent = city.station;
  elements.currentCode.textContent = city.code;
}

function renderChart() {
  const city = getCity();
  clampRangeToCity(city);
  state.visibleMode =
    selectedMonthSpan() <= 24 && city.dailySeries?.length ? "day" : "month";
  const displaySeries =
    state.visibleMode === "day" ? city.dailySeries : city.series;
  const visibleSeries = state.removeSeasonality
    ? displaySeriesValues(displaySeries)
    : displaySeries;
  const selectedSeries = filteredSeries(city);
  state.visibleSeries = visibleSeries;
  updateSummary(city, selectedSeries);

  const data = {
    labels: visibleSeries.map((point) => point.label),
    datasets: cityDatasets(visibleSeries),
  };

  if (!state.chart) {
    state.chart = new Chart(elements.canvas, {
      type: "line",
      data,
      options: chartOptions(),
    });
    return;
  }

  state.chart.data = data;
  state.chart.options = chartOptions();
  state.chart.update();
}

function renderCitySelect() {
  elements.citySelect.innerHTML = "";
  for (const city of state.payload.cities) {
    const option = document.createElement("option");
    option.value = city.code;
    option.textContent = `${city.city} / ${city.station} / ${city.code}`;
    option.selected = city.code === state.selectedCode;
    elements.citySelect.append(option);
  }
}

function syncSourceControls() {
  elements.sourceTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.source === state.dataSource);
  });
  const hasDeseasonalizedTrend = payloadSupportsDeseasonalizedTrend();
  elements.seasonalityToggle.disabled = !hasDeseasonalizedTrend;
  if (!hasDeseasonalizedTrend) {
    state.removeSeasonality = false;
    elements.seasonalityToggle.checked = false;
  }
}

function setWindowFromNumbers(startNumber, endNumber) {
  const city = getCity();
  const firstNumber = monthToNumber(city.series[0].label);
  const lastNumber = monthToNumber(city.series.at(-1).label);
  const span = Math.max(1, endNumber - startNumber + 1);

  if (startNumber < firstNumber) {
    startNumber = firstNumber;
    endNumber = Math.min(lastNumber, startNumber + span - 1);
  }
  if (endNumber > lastNumber) {
    endNumber = lastNumber;
    startNumber = Math.max(firstNumber, endNumber - span + 1);
  }

  state.rangeStart = monthLabelFromNumber(startNumber);
  state.rangeEnd = monthLabelFromNumber(endNumber);
}

function applyZoomSetting(zoom, align = "center") {
  state.activePreset = zoom;
  const city = getCity();
  const firstNumber = monthToNumber(city.series[0].label);
  const lastNumber = monthToNumber(city.series.at(-1).label);
  const span = zoomSpanMonths(zoom);

  if (!Number.isFinite(span) || span >= lastNumber - firstNumber + 1) {
    state.rangeStart = city.series[0].label;
    state.rangeEnd = city.series.at(-1).label;
  } else {
    let endNumber;
    if (align === "end") {
      endNumber = lastNumber;
    } else {
      const currentStart = monthToNumber(
        state.rangeStart || city.series[0].label,
      );
      const currentEnd = monthToNumber(
        state.rangeEnd || city.series.at(-1).label,
      );
      const center = Math.round((currentStart + currentEnd) / 2);
      endNumber = center + Math.floor(span / 2);
    }
    setWindowFromNumbers(endNumber - span + 1, endNumber);
  }

  state.clickedIndex = null;
  renderChart();
}

function alignWindowToEnd() {
  if (!state.chart) {
    applyZoomSetting(state.activePreset, "end");
    return;
  }

  const xScale = state.chart.scales.x;
  const lastIndex = state.visibleSeries.length - 1;
  const currentMin = Number.isFinite(xScale.min)
    ? xScale.min
    : xMinForSeries(state.visibleSeries);
  const currentMax = Number.isFinite(xScale.max)
    ? xScale.max
    : xMaxForSeries(state.visibleSeries);
  const span = Math.max(1, currentMax - currentMin);
  const min = Math.max(0, lastIndex - span);

  state.clickedIndex = null;
  state.chart.options.scales.x.min = min;
  state.chart.options.scales.x.max = lastIndex;
  state.chart.update("none");
}

async function loadData(source = state.dataSource) {
  state.dataSource = source;
  const response = await fetch(`/api/temperatures?source=${state.dataSource}&v=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Impossible de charger les donnees");
  state.payload = await response.json();
  state.selectedCode = state.selectedCodes[state.dataSource];
  if (!state.payload.cities.some((city) => city.code === state.selectedCode)) {
    state.selectedCode = state.payload.cities[0]?.code;
  }
  state.selectedCodes[state.dataSource] = state.selectedCode;
  state.rangeStart = null;
  state.rangeEnd = null;
  state.clickedIndex = null;
  syncSourceControls();
  renderCitySelect();
  applyZoomSetting(state.activePreset, "end");
}

elements.sourceTabs.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.source === state.dataSource) return;
    loadData(button.dataset.source).catch((error) => {
      elements.currentCity.textContent = "Erreur";
      elements.currentStation.textContent = error.message;
    });
  });
});
elements.citySelect.addEventListener("change", () => {
  state.selectedCode = elements.citySelect.value;
  state.selectedCodes[state.dataSource] = state.selectedCode;
  state.clickedIndex = null;
  applyZoomSetting(state.activePreset, "end");
});
elements.zoomButtons.forEach((button) => {
  button.addEventListener("click", () => applyZoomSetting(button.dataset.zoom));
});
elements.alignEnd.addEventListener("click", alignWindowToEnd);
elements.seasonalityToggle.addEventListener("change", () => {
  state.removeSeasonality = elements.seasonalityToggle.checked;
  state.clickedIndex = null;
  renderChart();
});
elements.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("theme", isLight() ? "light" : "dark");
  if (state.chart) renderChart();
});

if (localStorage.getItem("theme") === "light") {
  document.body.classList.add("light");
}

installChartTouchHandling();

loadData().catch((error) => {
  elements.currentCity.textContent = "Erreur";
  elements.currentStation.textContent = error.message;
});
