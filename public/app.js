"use strict";

const $ = (selector) => document.querySelector(selector);

const input = $("#waste-input");
const analyzeBtn = $("#analyze-btn");
const analyzeBtnText = $("#analyze-btn-text");
const analyzeBtnIcon = $("#analyze-btn-icon");
const statusMessage = $("#analyzer-status");

const HISTORY_KEY = "ecosort_history";
const MAX_HISTORY = 10;

let currentAnalysis = null;
let pieChart = null;
let barChart = null;
let selectedCategory = null;

const categoryColors = {
  Plastic: "#55d6a0",
  Organic: "#b8e986",
  Paper: "#70b8ff",
  "E-waste": "#c39bff",
  Glass: "#65e1e7",
  "General waste": "#ffb86b",
  Other: "#a0a9b3"
};

const categoryTips = {
  Plastic: {
    title: "Make plastic sorting a habit",
    tip: "Empty containers and check local recycling rules. Reuse suitable containers when practical."
  },
  Organic: {
    title: "Give organic waste another purpose",
    tip: "Separate suitable food scraps and explore composting if a safe, appropriate option is available."
  },
  Paper: {
    title: "Keep recyclable paper clean",
    tip: "Keep accepted paper dry and free from food contamination. Check whether coated or greasy paper is accepted locally."
  },
  "E-waste": {
    title: "Handle electronics responsibly",
    tip: "Keep batteries and electronics separate from ordinary waste and look for an authorized collection point."
  },
  Glass: {
    title: "Sort glass carefully",
    tip: "Check local glass collection rules and handle broken pieces carefully."
  },
  "General waste": {
    title: "Check before throwing away",
    tip: "Look for reuse, repair, donation, or specialist collection options before disposing of an item."
  },
  Other: {
    title: "Learn the material first",
    tip: "Check the item's material and local disposal guidance before deciding how to handle it."
  }
};

// Read saved analyses from this browser.
function readHistory() {
  try {
    const data = JSON.parse(
      localStorage.getItem(HISTORY_KEY) || "[]"
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Could not read saved history:", error);
    return [];
  }
}

// Save analysis history.
function writeHistory(history) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history)
    );

    return true;
  } catch (error) {
    console.error("Could not save history:", error);

    setStatus(
      "Could not save history. Check your browser storage settings.",
      true
    );

    return false;
  }
}

function setStatus(message, isError = false) {
  if (!statusMessage) return;

  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

// Standardize AI category names.
function normalizeCategory(value) {
  const category = String(value || "").trim().toLowerCase();

  if (category.includes("plastic")) return "Plastic";

  if (
    category.includes("organic") ||
    category.includes("biodegradable") ||
    category.includes("food") ||
    category.includes("compost")
  ) {
    return "Organic";
  }

  if (
    category.includes("paper") ||
    category.includes("cardboard")
  ) {
    return "Paper";
  }

  if (
    category.includes("e-waste") ||
    category.includes("e waste") ||
    category.includes("electronic") ||
    category.includes("battery") ||
    category.includes("hazardous")
  ) {
    return "E-waste";
  }

  if (category.includes("glass")) return "Glass";

  if (
    category.includes("general") ||
    category.includes("residual") ||
    category.includes("landfill") ||
    category.includes("non-recyclable")
  ) {
    return "General waste";
  }

  return "Other";
}

// Extract a labelled field from the AI response.
function extractSection(text, labels) {
  const lines = String(text || "").split(/\r?\n/);
  const wanted = new Set(
    labels.map((label) => label.toLowerCase())
  );

  let collecting = false;
  const result = [];

  for (const line of lines) {
    const match = line.match(
      /^\s*([A-Z][A-Z _/-]{1,})\s*:\s*(.*)$/i
    );

    if (match) {
      const heading = match[1].trim().toLowerCase();

      if (wanted.has(heading)) {
        collecting = true;

        if (match[2].trim()) {
          result.push(match[2].trim());
        }

        continue;
      }

      if (collecting) break;
    } else if (collecting) {
      result.push(line.trim());
    }
  }

  return result.join(" ").trim();
}

// Convert backend response to a consistent object.
function parseAnalysis(data, itemDescription) {
  const safeData =
    data && typeof data === "object" ? data : {};

  const rawText = typeof data === "string"
    ? data
    : String(
        safeData.response ||
        safeData.message?.content ||
        safeData.result ||
        ""
      );

  const categoryText =
    safeData.category ||
    extractSection(rawText, [
      "CATEGORY",
      "WASTE CATEGORY",
      "CLASSIFICATION"
    ]);

  const itemName =
    safeData.itemName ||
    safeData.item ||
    extractSection(rawText, ["ITEM"]) ||
    itemDescription;

  const action =
    safeData.action ||
    extractSection(rawText, [
      "RECOMMENDED ACTION",
      "DISPOSAL",
      "DISPOSAL GUIDANCE",
      "RECOMMENDATION"
    ]);

  const reason =
    safeData.reason ||
    extractSection(rawText, [
      "WHY IT MATTERS",
      "REASON",
      "EXPLANATION"
    ]);

  const tip =
    safeData.tip ||
    extractSection(rawText, [
      "ECO TIP",
      "ECO-FRIENDLY TIP",
      "TIP",
      "SAFETY"
    ]);

  return {
    itemName: String(
      itemName || itemDescription
    ).trim(),

    category: normalizeCategory(
      categoryText || rawText
    ),

    action: String(
      action ||
      "Check local waste collection guidance before disposal."
    ).trim(),

    reason: String(
      reason ||
      "Follow local guidance to make an informed disposal decision."
    ).trim(),

    tip: String(
      tip ||
      "Consider whether the item can be reused, repaired, or safely recycled."
    ).trim(),

    rawText: rawText.trim()
  };
}

// Display AI analysis.
function showAnalysis(analysis) {
  const placeholder = $("#result-placeholder");
  const result = $("#analysis-result");

  if (placeholder) placeholder.hidden = true;
  if (result) result.hidden = false;

  const fields = {
    "#result-item-name": analysis.itemName,
    "#result-category": analysis.category,
    "#result-category-badge": analysis.category,
    "#result-action": analysis.action,
    "#result-reason": analysis.reason,
    "#result-tip": analysis.tip
  };

  Object.entries(fields).forEach(([selector, value]) => {
    const element = $(selector);

    if (element) element.textContent = value;
  });
}

// Call backend AI endpoint.
async function analyzeWaste() {
  if (!input) return;

  const description = input.value.trim();

  if (!description) {
    setStatus("Please describe a waste item first.", true);
    input.focus();
    return;
  }

  if (description.length > 500) {
    setStatus(
      "Please keep your description under 500 characters.",
      true
    );

    return;
  }

  if (analyzeBtn) analyzeBtn.disabled = true;

  if (analyzeBtnText) {
    analyzeBtnText.textContent = "Analyzing...";
  }

  if (analyzeBtnIcon) {
    analyzeBtnIcon.textContent = "◌";
  }

  setStatus(
    "Connecting to AI. This may take a few moments..."
  );

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        item: description
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The server returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Analysis failed. Please try again."
      );
    }

    currentAnalysis = parseAnalysis(
      data,
      description
    );

    showAnalysis(currentAnalysis);

    setStatus(
      "Analysis complete! Review the guidance, then save it to update your charts."
    );
  } catch (error) {
    console.error("Analysis error:", error);

    setStatus(
      error.message ||
      "Unable to analyze this item. Check the server and try again.",
      true
    );
  } finally {
    if (analyzeBtn) analyzeBtn.disabled = false;

    if (analyzeBtnText) {
      analyzeBtnText.textContent = "Analyze with AI";
    }

    if (analyzeBtnIcon) {
      analyzeBtnIcon.textContent = "✦";
    }
  }
}

// Save current analysis and refresh charts.
function saveCurrentAnalysis() {
  if (!currentAnalysis) {
    setStatus(
      "Analyze an item before saving it.",
      true
    );

    return;
  }

  const history = readHistory();

  history.unshift({
    ...currentAnalysis,

    id: `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,

    date: new Date().toISOString()
  });

  if (!writeHistory(history.slice(0, MAX_HISTORY))) {
    return;
  }

  selectedCategory = null;

  renderHistory();
  renderAnalytics();

  setStatus(
    "Analysis saved! Your pie chart and weekly graph have been updated."
  );
}

// Copy the current analysis.
async function copyCurrentAnalysis() {
  if (!currentAnalysis) {
    setStatus(
      "There is no analysis to copy yet.",
      true
    );

    return;
  }

  const text = [
    `Item: ${currentAnalysis.itemName}`,
    `Category: ${currentAnalysis.category}`,
    `Recommended action: ${currentAnalysis.action}`,
    `Why it matters: ${currentAnalysis.reason}`,
    `Eco tip: ${currentAnalysis.tip}`
  ].join("\n\n");

  try {
    await navigator.clipboard.writeText(text);

    setStatus("Analysis copied to clipboard.");
  } catch {
    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");

    textarea.remove();

    setStatus(
      copied
        ? "Analysis copied to clipboard."
        : "Copy failed. Please copy the text manually.",
      !copied
    );
  }
}

// Display saved analyses.
function renderHistory() {
  const history = readHistory();
  const container = $("#history-list");

  if (!container) return;

  container.innerHTML = "";

  if (!history.length) {
    const empty = document.createElement("div");

    empty.className = "history-empty";

    empty.innerHTML =
      '<span>◷</span><h3>No saved analyses yet</h3><p>Analyze an item and choose Save to history to get started.</p>';

    container.appendChild(empty);

    return;
  }

  history.forEach((item) => {
    const row = document.createElement("article");

    row.className = "history-item";

    const details = document.createElement("div");

    details.className = "history-item-details";

    const title = document.createElement("h3");

    title.textContent = item.itemName || "Waste item";

    const date = document.createElement("p");

    const parsedDate = item.date
      ? new Date(item.date)
      : null;

    date.textContent =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleString()
        : "Date unavailable";

    const badge = document.createElement("span");

    badge.className = "history-category";

    badge.textContent = normalizeCategory(item.category);

    details.append(title, date, badge);

    const viewButton = document.createElement("button");

    viewButton.type = "button";
    viewButton.className = "button button-secondary";
    viewButton.textContent = "View";

    viewButton.addEventListener("click", () => {
      currentAnalysis = {
        itemName: item.itemName || "Waste item",
        category: normalizeCategory(item.category),
        action: item.action || "",
        reason: item.reason || "",
        tip: item.tip || "",
        rawText: item.rawText || ""
      };

      showAnalysis(currentAnalysis);

      const analyzer = $("#analyzer");

      if (analyzer) {
        analyzer.scrollIntoView({
          behavior: "smooth"
        });
      }

      setStatus("Loaded a saved analysis.");
    });

    row.append(details, viewButton);

    container.appendChild(row);
  });
}

// Count saved categories.
function countCategories(history) {
  const counts = {};

  history.forEach((item) => {
    const category = normalizeCategory(item.category);

    counts[category] = (counts[category] || 0) + 1;
  });

  return counts;
}

// Update statistics, charts, and eco tip.
function renderAnalytics() {
  const history = readHistory();
  const counts = countCategories(history);
  const categories = Object.keys(counts);
  const total = history.length;

  if ($("#stat-total")) {
    $("#stat-total").textContent = total;
  }

  if ($("#stat-categories")) {
    $("#stat-categories").textContent =
      categories.length;
  }

  if ($("#pie-total")) {
    $("#pie-total").textContent = total;
  }

  const sortedCategories = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);

  const topCategory = sortedCategories.length
    ? sortedCategories[0][0]
    : "—";

  if ($("#stat-top-category")) {
    $("#stat-top-category").textContent = topCategory;
  }

  const recyclableCount = history.filter((item) => {
    const text =
      `${item.category || ""} ${item.action || ""} ${item.reason || ""}`
        .toLowerCase();

    return /\brecyclable\b|\bcan be recycled\b|\brecycling accepted\b/.test(text);
  }).length;

  if ($("#stat-recyclable")) {
    $("#stat-recyclable").textContent =
      recyclableCount;
  }

  renderPieChart(counts, history);
  renderBarChart(history);
  renderSmartTip(topCategory, total);
}

// Interactive pie chart with CSS fallback.
function renderPieChart(counts, history) {
  const canvas = $("#category-pie-chart");
  const legend = $("#pie-legend");
  const wrapper = canvas?.parentElement;

  if (!canvas || !legend || !wrapper) {
    console.error("Pie chart HTML elements are missing.");
    return;
  }

  const categories = Object.keys(counts);
  const hasData = history.length > 0;

  const labels = hasData
    ? categories
    : ["No saved analyses"];

  const values = hasData
    ? categories.map((category) => counts[category])
    : [1];

  const colors = hasData
    ? categories.map(
        (category) =>
          categoryColors[category] || categoryColors.Other
      )
    : ["rgba(158, 180, 168, 0.22)"];

  if (pieChart) {
    pieChart.destroy();
    pieChart = null;
  }

  canvas.style.display = "block";

  wrapper.style.background = "transparent";
  wrapper.style.borderRadius = "";
  wrapper.style.width = "";
  wrapper.style.aspectRatio = "";
  wrapper.style.height = "";
  wrapper.style.padding = "";
  wrapper.style.display = "";
  wrapper.style.placeItems = "";

  const center = wrapper.querySelector(".pie-center");

  if (center) {
    center.style.position = "";
    center.style.inset = "";
    center.style.borderRadius = "";
    center.style.background = "";
  }

  if (typeof Chart !== "undefined") {
    pieChart = new Chart(canvas, {
      type: "doughnut",

      data: {
        labels,

        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: "#10271e",
          borderWidth: 4,
          hoverOffset: hasData ? 10 : 0,
          borderRadius: 5
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            enabled: hasData,

            callbacks: {
              label(context) {
                const value = context.raw;

                const percentage = history.length
                  ? Math.round(
                      (value / history.length) * 100
                    )
                  : 0;

                return `${context.label}: ${value} (${percentage}%)`;
              }
            }
          }
        },

        onClick(_event, elements) {
          if (!hasData || !elements.length) return;

          selectedCategory =
            categories[elements[0].index];

          renderCategoryInsight(
            selectedCategory,
            history
          );

          renderPieLegend(counts, categories);
        }
      }
    });

    legend.textContent = "";

    if (hasData) {
      renderPieLegend(counts, categories);
    } else {
      legend.textContent =
        "Save an analysis to populate the chart with your real categories.";
    }

    return;
  }

  // CSS fallback if Chart.js is unavailable.
  canvas.style.display = "none";

  const total =
    values.reduce((sum, value) => sum + value, 0) || 1;

  let cursor = 0;

  const stops = values.map((value, index) => {
    const start = cursor;

    cursor += (value / total) * 100;

    return `${colors[index]} ${start}% ${cursor}%`;
  });

  wrapper.style.background =
    `conic-gradient(${stops.join(", ")})`;

  wrapper.style.borderRadius = "50%";
  wrapper.style.width = "min(280px, 100%)";
  wrapper.style.aspectRatio = "1 / 1";
  wrapper.style.height = "auto";
  wrapper.style.margin = "12px auto 24px";
  wrapper.style.padding = "0";
  wrapper.style.display = "grid";
  wrapper.style.placeItems = "center";

  if (center) {
    center.style.position = "absolute";
    center.style.inset = "12%";
    center.style.borderRadius = "50%";
    center.style.background = "#10271e";
  }

  legend.textContent = "";

  if (hasData) {
    renderPieLegend(counts, categories);
  } else {
    legend.textContent =
      "Save an analysis to populate the chart with your real categories.";
  }
}

// Render clickable category legend.
function renderPieLegend(counts, categories) {
  const legend = $("#pie-legend");

  if (!legend) return;

  legend.innerHTML = "";

  categories.forEach((category) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "legend-item";

    if (selectedCategory === category) {
      button.classList.add("selected");
    }

    const dot = document.createElement("span");

    dot.className = "legend-dot";

    dot.style.backgroundColor =
      categoryColors[category] || categoryColors.Other;

    const label = document.createElement("span");

    label.className = "legend-name";
    label.textContent = category;

    const count = document.createElement("strong");

    count.textContent = counts[category];

    button.append(dot, label, count);

    button.addEventListener("click", () => {
      selectedCategory = category;

      const history = readHistory();

      renderCategoryInsight(category, history);
      renderPieLegend(counts, categories);

      if (pieChart) {
        const index = categories.indexOf(category);

        pieChart.setActiveElements([
          {
            datasetIndex: 0,
            index
          }
        ]);

        pieChart.update();
      }
    });

    legend.appendChild(button);
  });
}

// Show selected category details.
function renderCategoryInsight(category, history) {
  const target = $("#category-insight");

  if (!target) return;

  const items = history.filter(
    (item) =>
      normalizeCategory(item.category) === category
  );

  const names = items
    .slice(0, 3)
    .map((item) => item.itemName || "Unnamed item");

  target.textContent =
    `${category}: ${items.length} saved analysis` +
    `${items.length === 1 ? "" : "es"}. ` +
    `${names.length ? `Examples: ${names.join(", ")}.` : ""}`;
}

// Weekly activity graph with CSS fallback.
function renderBarChart(history) {
  const canvas = $("#activity-bar-chart");

  if (!canvas) {
    console.error("Activity chart canvas is missing.");
    return;
  }

  const wrapper = canvas.parentElement;

  if (!wrapper) return;

  const days = [];
  const values = [];
  const today = new Date();

  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(today);

    day.setHours(0, 0, 0, 0);
    day.setDate(today.getDate() - offset);

    days.push(
      day.toLocaleDateString(undefined, {
        weekday: "short"
      })
    );

    const nextDay = new Date(day);

    nextDay.setDate(day.getDate() + 1);

    values.push(
      history.filter((item) => {
        if (!item.date) return false;

        const date = new Date(item.date);

        return (
          !Number.isNaN(date.getTime()) &&
          date >= day &&
          date < nextDay
        );
      }).length
    );
  }

  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  canvas.style.display = "block";

  const oldFallback =
    wrapper.querySelector(".bar-fallback");

  if (oldFallback) oldFallback.remove();

  if (typeof Chart !== "undefined") {
    barChart = new Chart(canvas, {
      type: "bar",

      data: {
        labels: days,

        datasets: [{
          label: "Saved analyses",
          data: values,
          backgroundColor: "#55d6a0",
          hoverBackgroundColor: "#b8e986",
          borderRadius: 7,
          maxBarThickness: 32
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            callbacks: {
              label: (context) =>
                ` ${context.raw} saved`
            }
          }
        },

        scales: {
          x: {
            grid: {
              display: false
            },

            ticks: {
              color: "#9eb4a8"
            },

            border: {
              display: false
            }
          },

          y: {
            beginAtZero: true,

            ticks: {
              precision: 0,
              color: "#9eb4a8"
            },

            grid: {
              color: "rgba(158,180,168,0.12)"
            },

            border: {
              display: false
            }
          }
        }
      }
    });

    return;
  }

  // CSS bar chart if Chart.js is unavailable.
  canvas.style.display = "none";

  const fallback = document.createElement("div");

  fallback.className = "bar-fallback";

  fallback.style.cssText =
    "display:flex;align-items:stretch;justify-content:space-around;" +
    "gap:8px;height:100%;width:100%;padding:15px 0 5px;";

  const maxValue = Math.max(...values, 1);

  days.forEach((day, index) => {
    const column = document.createElement("div");

    column.style.cssText =
      "display:flex;flex:1;min-width:0;flex-direction:column;" +
      "align-items:center;justify-content:flex-end;gap:9px;height:100%;";

    const value = document.createElement("span");

    value.textContent = String(values[index]);

    value.style.cssText =
      "color:#9eb4a8;font-size:12px;";

    const track = document.createElement("div");

    track.style.cssText =
      "display:flex;align-items:flex-end;justify-content:center;" +
      "width:100%;flex:1;max-width:32px;background:rgba(158,180,168,.08);" +
      "border-radius:7px 7px 2px 2px;overflow:hidden;";

    const bar = document.createElement("div");

    const height = values[index]
      ? Math.max(
          5,
          (values[index] / maxValue) * 100
        )
      : 0;

    bar.style.cssText =
      `width:100%;height:${height}%;background:#55d6a0;` +
      "border-radius:7px 7px 2px 2px;";

    track.appendChild(bar);

    const label = document.createElement("span");

    label.textContent = day;

    label.style.cssText =
      "color:#9eb4a8;font-size:11px;";

    column.append(value, track, label);

    fallback.appendChild(column);
  });

  wrapper.appendChild(fallback);
}

// Suggest an eco tip based on the most frequent category.
function renderSmartTip(topCategory, total) {
  const title = $("#smart-tip-title");
  const tip = $("#smart-eco-tip");

  if (!title || !tip) return;

  if (!total || topCategory === "—") {
    title.textContent = "Start with one small habit";

    tip.textContent =
      "Save a few analyses to discover a practical tip based on your most frequent waste category.";

    return;
  }

  const recommendation =
    categoryTips[topCategory] || categoryTips.Other;

  title.textContent =
    `${topCategory}: ${recommendation.title}`;

  tip.textContent = recommendation.tip;
}

// Open the browser's Print dialog for PDF export.
function exportReport() {
  renderAnalytics();

  const previousTitle = document.title;

  document.title = "EcoSort-AI-Analytics-Report";

  window.print();

  document.title = previousTitle;
}

// Clear saved browser history.
function clearHistory() {
  const history = readHistory();

  if (!history.length) {
    setStatus("Your history is already empty.");
    return;
  }

  const confirmed = window.confirm(
    "Clear all saved analyses from this browser? This cannot be undone."
  );

  if (!confirmed) return;

  if (!writeHistory([])) return;

  selectedCategory = null;

  renderHistory();
  renderAnalytics();

  setStatus("Saved history cleared.");
}

// Connect buttons and inputs.
function setupEventListeners() {
  if (input) {
    input.addEventListener("input", () => {
      const counter = $("#character-count");

      if (counter) {
        counter.textContent =
          `${input.value.length} / 500`;
      }
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener(
      "click",
      analyzeWaste
    );
  }

  $("#save-result-btn")?.addEventListener(
    "click",
    saveCurrentAnalysis
  );

  $("#copy-result-btn")?.addEventListener(
    "click",
    copyCurrentAnalysis
  );

  $("#clear-history-btn")?.addEventListener(
    "click",
    clearHistory
  );

  $("#export-report-btn")?.addEventListener(
    "click",
    exportReport
  );

  document.querySelectorAll("[data-example]").forEach(
    (button) => {
      button.addEventListener("click", () => {
        if (!input) return;

        input.value = button.dataset.example || "";

        const counter = $("#character-count");

        if (counter) {
          counter.textContent =
            `${input.value.length} / 500`;
        }

        input.focus();
      });
    }
  );
}

// Initialize after HTML is loaded.
function initializeApp() {
  setupEventListeners();
  renderHistory();
  renderAnalytics();

  console.log("EcoSort AI frontend initialized.");

  console.log(
    "Chart.js available:",
    typeof Chart !== "undefined"
  );
}

document.addEventListener(
  "DOMContentLoaded",
  initializeApp
);