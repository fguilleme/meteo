const state = {
  payload: null,
  selectedCode: "07149",
  chart: null,
  visibleSeries: [],
  visibleMode: "month",
  clickedIndex: null,
  rangeStart: null,
  rangeEnd: null
};

const colors = {
  min: "#36d1c4",
  avg: "#f7b267",
  max: "#ff6b6b",
  gridDark: "rgba(255,255,255,0.09)",
  gridLight: "rgba(23,32,47,0.10)"
};

const elements = {
  cityButton: document.querySelector("#cityButton"),
  themeToggle: document.querySelector("#themeToggle"),
  modal: document.querySelector("#cityModal"),
  closeModal: document.querySelector("#closeModal"),
  citySearch: document.querySelector("#citySearch"),
  cityList: document.querySelector("#cityList"),
  currentCity: document.querySelector("#currentCity"),
  currentStation: document.querySelector("#currentStation"),
  currentCode: document.querySelector("#currentCode"),
  windowLabel: document.querySelector("#windowLabel"),
  rangeButtons: document.querySelectorAll("[data-range]"),
  resetZoom: document.querySelector("#resetZoom"),
  canvas: document.querySelector("#temperatureChart")
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "long",
  year: "numeric"
});

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric"
});

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const shortMonthFormatter = new Intl.DateTimeFormat("fr-FR", {
  month: "short"
});

function isLight() {
  return document.body.classList.contains("light");
}

function formatDay(value) {
  if (!value) return "date inconnue";
  return dateFormatter.format(new Date(value));
}

function formatPointDate(point, field) {
  return point[field] ? formatDay(point[field]) : longLabel(point.label);
}

function formatValue(value) {
  return `${value.toFixed(2)} °C`;
}

function getCity() {
  return state.payload.cities.find((city) => city.code === state.selectedCode) || state.payload.cities[0];
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

function monthTitle(label) {
  const parts = label.split("-").map(Number);
  const value = parts.length === 3
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
  if (datasetLabel === "Max") return point.maxDate ? shortDate(point.maxDate) : longLabel(point.label);
  if (datasetLabel === "Min") return point.minDate ? shortDate(point.minDate) : longLabel(point.label);
  return longLabel(point.label);
}

function dateValueForPoint(datasetLabel, point) {
  if (!point) return null;
  if (datasetLabel === "Max" && point.maxDate) return new Date(point.maxDate).getTime();
  if (datasetLabel === "Min" && point.minDate) return new Date(point.minDate).getTime();

  const parts = point.label.split("-").map(Number);
  if (parts.length === 3) return Date.UTC(parts[0], parts[1] - 1, parts[2], 12);
  return Date.UTC(parts[0], parts[1] - 1, 15);
}

function interpolatedCutDate(datasetLabel, index, ratio) {
  const pointA = state.visibleSeries[index];
  const pointB = state.visibleSeries[index + 1];
  const dateA = dateValueForPoint(datasetLabel, pointA);
  const dateB = dateValueForPoint(datasetLabel, pointB);
  if (!Number.isFinite(dateA) || !Number.isFinite(dateB)) {
    return dateForPoint(datasetLabel, ratio < 0.5 ? pointA : pointB);
  }

  return formatDay(new Date(dateA + (dateB - dateA) * ratio));
}

function rightmostVisibleIndex(chart) {
  const labels = chart.data.labels;
  if (!labels.length) return -1;

  const max = Number.isFinite(chart.scales.x.max) ? chart.scales.x.max : labels.length - 1;
  return Math.max(0, Math.min(labels.length - 1, Math.floor(max)));
}

function visibleMonthSpan(chart) {
  const min = Number.isFinite(chart.scales.x.min) ? chart.scales.x.min : 0;
  const max = Number.isFinite(chart.scales.x.max) ? chart.scales.x.max : chart.data.labels.length - 1;
  if (state.visibleMode === "day") return (max - min) / 30.5;
  return max - min;
}

function horizontalIntersections(chart, yValue) {
  const xScale = chart.scales.x;
  const minIndex = Math.max(0, Math.floor(Number.isFinite(xScale.min) ? xScale.min : 0) - 1);
  const maxIndex = Math.min(
    chart.data.labels.length - 1,
    Math.ceil(Number.isFinite(xScale.max) ? xScale.max : chart.data.labels.length - 1) + 1
  );
  const intersections = [];

  chart.data.datasets.forEach((dataset) => {
    const values = dataset.data;
    for (let index = minIndex; index < maxIndex; index += 1) {
      const yA = values[index];
      const yB = values[index + 1];
      if (!Number.isFinite(yA) || !Number.isFinite(yB) || yA === yB) continue;

      const min = Math.min(yA, yB);
      const max = Math.max(yA, yB);
      if (yValue < min || yValue > max) continue;

      const ratio = (yValue - yA) / (yB - yA);
      const x = xScale.getPixelForValue(index + ratio);
      if (x < chart.chartArea.left || x > chart.chartArea.right) continue;

      intersections.push({
        x,
        color: dataset.borderColor,
        label: `${dataset.label} ${formatValue(yValue)} · ${interpolatedCutDate(dataset.label, index, ratio)}`
      });
    }
  });

  return intersections.sort((a, b) => a.x - b.x);
}

const rightEdgeCursorPlugin = {
  id: "rightEdgeCursor",
  afterDraw(chart) {
    const index = rightmostVisibleIndex(chart);
    if (index < 0) return;

    const { ctx, chartArea, scales } = chart;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
    const panelColor = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
    const labelColor = isLight() ? "rgba(23, 32, 47, 0.55)" : "rgba(243, 246, 251, 0.62)";
    const x = scales.x.getPixelForValue(index);
    const cursors = chart.data.datasets
      .filter((dataset) => dataset.label === "Max" || dataset.label === "Min")
      .map((dataset) => ({
        label: dataset.label,
        color: dataset.borderColor,
        value: dataset.data[index]
      }))
      .filter((cursor) => Number.isFinite(cursor.value));

    ctx.save();
    ctx.font = "700 12px system-ui, sans-serif";
    cursors.forEach((cursor, cursorIndex) => {
      const y = scales.y.getPixelForValue(cursor.value);
      if (y < chartArea.top || y > chartArea.bottom) return;
      const intersections = horizontalIntersections(chart, cursor.value);

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

      intersections.forEach((intersection) => {
        ctx.fillStyle = intersection.color;
        ctx.globalAlpha = 0.78;
        ctx.beginPath();
        ctx.arc(intersection.x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      const visibleRows = intersections.slice(-4).reverse();
      const hiddenCount = Math.max(0, intersections.length - visibleRows.length);
      const rows = [
        `${cursor.label} ${formatValue(cursor.value)}`,
        ...visibleRows.map((intersection) => intersection.label)
      ];
      if (hiddenCount > 0) rows.push(`+ ${hiddenCount} autres`);

      const width = Math.max(...rows.map((row) => ctx.measureText(row).width)) + 20;
      const height = rows.length * 16 + 10;
      const labelX = chartArea.right - width;
      const labelY = Math.min(Math.max(y - 18 + cursorIndex * 22, chartArea.top), chartArea.bottom - height);

      roundedRect(ctx, labelX, labelY, width, height, 6);
      ctx.fillStyle = panelColor;
      ctx.fill();
      ctx.strokeStyle = labelColor;
      ctx.stroke();
      rows.forEach((row, rowIndex) => {
        const rowY = labelY + 15 + rowIndex * 16;
        ctx.fillStyle = rowIndex === 0 ? cursor.color : textColor;
        ctx.fillText(row, labelX + 9, rowY);
      });
    });

    ctx.restore();
  }
};

const clickTooltipPlugin = {
  id: "clickTooltip",
  afterEvent(chart, args) {
    const event = args.event;
    if (event.type !== "click") return;

    const { left, right, top, bottom } = chart.chartArea;
    const inChart = event.x >= left && event.x <= right && event.y >= top && event.y <= bottom;
    if (!inChart) {
      state.clickedIndex = null;
      args.changed = true;
      return;
    }

    const rawIndex = chart.scales.x.getValueForPixel(event.x);
    state.clickedIndex = Math.max(0, Math.min(chart.data.labels.length - 1, Math.round(rawIndex)));
    args.changed = true;
  },
  afterDraw(chart) {
    const index = state.clickedIndex;
    if (!Number.isInteger(index) || index < 0 || index >= state.visibleSeries.length) return;

    const { ctx, chartArea, scales } = chart;
    const point = state.visibleSeries[index];
    const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
    const panelColor = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
    const lineColor = isLight() ? "rgba(23, 32, 47, 0.55)" : "rgba(243, 246, 251, 0.62)";
    const x = scales.x.getPixelForValue(index);

    if (x < chartArea.left || x > chartArea.right) return;

    const rows = [
      { color: colors.max, text: `Max ${formatValue(point.max)} - ${formatPointDate(point, "maxDate")}` },
      { color: colors.avg, text: `Moy ${formatValue(point.avg)}` },
      { color: colors.min, text: `Min ${formatValue(point.min)} - ${formatPointDate(point, "minDate")}` }
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
    const rowWidth = Math.max(...rows.map((row) => ctx.measureText(row.text).width));
    const width = Math.max(titleWidth, rowWidth) + 34;
    const height = 30 + rows.length * 16;
    const boxX = x < (chartArea.left + chartArea.right) / 2
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
  }
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
          ctx.fillStyle = isLight() ? "rgba(8, 127, 140, 0.045)" : "rgba(54, 209, 196, 0.035)";
          ctx.fillRect(startX, chartArea.top, endX - startX, chartArea.bottom - chartArea.top);
        }
        activeYear = year;
        startIndex = index;
        bandIndex += 1;
      }
    }
    ctx.restore();
  }
};

Chart.register(alternatingYearBandsPlugin, rightEdgeCursorPlugin, clickTooltipPlugin);

function clampRangeToCity(city) {
  const first = city.series[0]?.label;
  const last = city.series.at(-1)?.label;
  if (!first || !last) return;

  if (!state.rangeStart || monthToNumber(state.rangeStart) < monthToNumber(first)) {
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

function xMinForSeries(series) {
  if (state.visibleMode === "day") return lowerBoundIndex(series, `${state.rangeStart}-01`);
  return labelIndex(series, state.rangeStart, 0);
}

function xMaxForSeries(series) {
  if (state.visibleMode === "day") return lowerBoundIndex(series, endOfMonthLabel(state.rangeEnd));
  return labelIndex(series, state.rangeEnd, series.length - 1);
}

function tickStep(labelCount, span) {
  if (state.visibleMode === "day") {
    if (span > 540) return 60;
    if (span > 240) return 30;
    if (span > 90) return 14;
    if (span > 45) return 7;
    return Math.max(1, Math.ceil(span / 12));
  }

  if (span > 180) return 24;
  if (span > 72) return 12;
  if (span > 36) return 6;
  if (span > 18) return 3;
  return 1;
}

function axisTickLabel(label, index, labels, span) {
  if (state.visibleMode === "day") {
    const date = new Date(`${label}T00:00:00Z`);
    if (span <= 45) {
      return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date);
    }
    if (date.getUTCDate() <= 7 || index === 0 || index === labels.length - 1) {
      const month = shortMonthFormatter.format(date).replace(".", "");
      return date.getUTCMonth() === 0 ? `${month} ${date.getUTCFullYear()}` : month;
    }
    return "";
  }

  const [year, month] = label.split("-").map(Number);
  if (span <= 36) {
    const monthName = shortMonthFormatter
      .format(new Date(Date.UTC(year, month - 1, 1)))
      .replace(".", "");
    return month === 1 ? `${monthName} ${year}` : monthName;
  }
  return String(year);
}

function chartOptions() {
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const mutedColor = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 850,
      easing: "easeOutQuart"
    },
    interaction: {
      mode: "index",
      intersect: false
    },
    plugins: {
      legend: {
        labels: {
          color: textColor,
          boxWidth: 12,
          usePointStyle: true
        }
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
          }
        }
      },
      zoom: {
        limits: {
          x: { min: "original", max: "original" },
          y: { min: "original", max: "original" }
        },
        pan: {
          enabled: true,
          mode: "x",
          threshold: 4,
          modifierKey: null
        },
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.08
          },
          pinch: {
            enabled: false
          },
          drag: {
            enabled: false
          },
          mode: "x"
        }
      }
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
            const span = Math.max(1, (this.chart.scales.x.max ?? lastIndex) - (this.chart.scales.x.min ?? 0));
            const step = tickStep(labels.length, span);

            if (value === 0 || value === lastIndex || value % step === 0) {
              return axisTickLabel(label, value, labels, span);
            }
            return "";
          }
        },
        grid: {
          color(context) {
            const labels = context.chart.data.labels;
            const value = context.tick.value;
            const lastIndex = labels.length - 1;
            const span = Math.max(1, (context.chart.scales.x.max ?? lastIndex) - (context.chart.scales.x.min ?? 0));
            const step = tickStep(labels.length, span);
            const visibleTick = value === 0 || value === lastIndex || value % step === 0;
            if (!visibleTick) return "rgba(0, 0, 0, 0)";
            return isLight() ? colors.gridLight : colors.gridDark;
          }
        }
      },
      y: {
        title: {
          display: true,
          text: "Temperature (°C)",
          color: mutedColor
        },
        ticks: {
          color: mutedColor,
          callback: (value) => `${value} °C`
        },
        grid: {
          color: isLight() ? colors.gridLight : colors.gridDark
        }
      }
    }
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
      tension: 0.28
    },
    {
      label: "Moy",
      data: series.map((point) => point.avg),
      borderColor: colors.avg,
      backgroundColor: "rgba(247, 178, 103, 0.18)",
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.28
    },
    {
      label: "Min",
      data: series.map((point) => point.min),
      borderColor: colors.min,
      backgroundColor: "rgba(54, 209, 196, 0.16)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.28
    }
  ];
}

function updateSummary(city, series) {
  elements.currentCity.textContent = city.city;
  elements.currentStation.textContent = city.station;
  elements.currentCode.textContent = city.code;
  elements.cityButton.textContent = city.city;
}

function renderChart() {
  const city = getCity();
  clampRangeToCity(city);
  state.visibleMode = selectedMonthSpan() <= 24 && city.dailySeries?.length ? "day" : "month";
  const displaySeries = state.visibleMode === "day" ? city.dailySeries : city.series;
  const selectedSeries = filteredSeries(city);
  state.visibleSeries = displaySeries;
  updateSummary(city, selectedSeries);

  const data = {
    labels: displaySeries.map((point) => point.label),
    datasets: cityDatasets(displaySeries)
  };

  if (!state.chart) {
    state.chart = new Chart(elements.canvas, {
      type: "line",
      data,
      options: chartOptions()
    });
    return;
  }

  state.chart.data = data;
  state.chart.options = chartOptions();
  state.chart.update();
}

function renderCityList() {
  const query = elements.citySearch.value.trim().toLowerCase();
  const cities = state.payload.cities.filter((city) => {
    const haystack = `${city.city} ${city.station} ${city.code}`.toLowerCase();
    return haystack.includes(query);
  });

  elements.cityList.innerHTML = "";
  for (const city of cities) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `city-option${city.code === state.selectedCode ? " active" : ""}`;
    button.innerHTML = `
      <span>
        <strong>${city.city}</strong><br>
        <span>${city.station}</span>
      </span>
      <span class="code-pill">${city.code}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedCode = city.code;
      closeModal();
      renderChart();
    });
    elements.cityList.append(button);
  }
}

function openModal() {
  elements.modal.classList.add("open");
  elements.modal.setAttribute("aria-hidden", "false");
  elements.citySearch.value = "";
  renderCityList();
  elements.citySearch.focus();
}

function closeModal() {
  elements.modal.classList.remove("open");
  elements.modal.setAttribute("aria-hidden", "true");
}

function setRangePreset(preset) {
  const city = getCity();
  const first = city.series[0].label;
  const last = city.series.at(-1).label;
  const lastNumber = monthToNumber(last);

  state.rangeEnd = last;
  if (preset === "all") {
    state.rangeStart = first;
  } else if (preset.endsWith("m")) {
    const months = Number(preset.replace("m", ""));
    const startNumber = Math.max(monthToNumber(first), lastNumber - months + 1);
    const year = Math.floor((startNumber - 1) / 12);
    const month = ((startNumber - 1) % 12) + 1;
    state.rangeStart = `${year}-${String(month).padStart(2, "0")}`;
  } else {
    const years = Number(preset.replace("y", ""));
    const startNumber = Math.max(monthToNumber(first), lastNumber - years * 12 + 1);
    const year = Math.floor((startNumber - 1) / 12);
    const month = ((startNumber - 1) % 12) + 1;
    state.rangeStart = `${year}-${String(month).padStart(2, "0")}`;
  }
  state.clickedIndex = null;
  renderChart();
}

async function loadData() {
  const response = await fetch(`/api/temperatures?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Impossible de charger les donnees");
  state.payload = await response.json();
  const city = getCity();
  state.rangeStart = city.series[0].label;
  state.rangeEnd = city.series.at(-1).label;
  renderCityList();
  renderChart();
}

elements.cityButton.addEventListener("click", openModal);
elements.closeModal.addEventListener("click", closeModal);
elements.citySearch.addEventListener("input", renderCityList);
elements.rangeButtons.forEach((button) => {
  button.addEventListener("click", () => setRangePreset(button.dataset.range));
});
elements.resetZoom.addEventListener("click", () => {
  setRangePreset("2y");
});
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

elements.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("theme", isLight() ? "light" : "dark");
  if (state.chart) renderChart();
});

if (localStorage.getItem("theme") === "light") {
  document.body.classList.add("light");
}

loadData().catch((error) => {
  elements.currentCity.textContent = "Erreur";
  elements.currentStation.textContent = error.message;
});
