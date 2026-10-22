
"use strict";

const $ = (selector) => document.querySelector(selector);

const form = $("#waste-form");
const wasteInput = $("#waste");
const charCount = $("#char-count");
const analyzeBtn = $("#analyze-btn");
const buttonText = $("#button-text");

const emptyState = $("#empty-state");
const loadingState = $("#loading-state");
const resultContent = $("#result-content");
const answerElement = $("#answer");
const errorMessage = $("#error-message");

const copyBtn = $("#copy-btn");
const exportPdfBtn = $("#export-pdf-btn");
const responseTime = $("#response-time");
const reportWaste = $("#report-waste");
const reportDate = $("#report-date");

const clearHistoryBtn = $("#clear-history");
const historyList = $("#history-list");

const HISTORY_KEY = "ecosort-ai-history";
const MAX_HISTORY = 10;

const CATEGORY_COLORS = {
  Plastic: "#39e58c",
  Paper: "#62b8ff",
  Organic: "#e9c46a",
  Electronic: "#c5a3ff",
  Glass: "#ff9c78",
  Other: "#718b80"
};

let latestAnswer = "";
let currentReportDate = new Date().toISOString();
let isAnalyzing = false;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function updateCharCount() {
  charCount.textContent = `${wasteInput.value.length}/1000`;
}

function setLoading(loading) {
  isAnalyzing = loading;
  analyzeBtn.disabled = loading;
  buttonText.textContent = loading ? "Analyzing..." : "Analyze with AI →";
  loadingState.hidden = !loading;

  if (loading) {
    emptyState.hidden = true;
    resultContent.hidden = true;
  }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function localDayKey(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* Determine the category from the AI response and item description. */
function getCategory(item) {
  const answer = String(item.answer || "");
  const categorySection = answer.match(
    /(?:^|\n)\s*(?:#{1,4}\s*)?CATEGORY\s*:?\s*\n?([\s\S]*?)(?=\n\s*(?:#{1,4}\s*)?(?:DISPOSAL|RECYCLING|SAFETY|REUSE IDEA)\b|$)/i
  );

  const categoryText = categorySection
    ? categorySection[1].slice(0, 250)
    : "";

  const text = `${categoryText} ${item.waste || ""}`.toLowerCase();

  if (/electronic|e-waste|battery|batteries|lithium|circuit board|mobile phone|charger/.test(text)) {
    return "Electronic";
  }

  if (/organic|food waste|food scraps|compost|fruit peel|vegetable peel/.test(text)) {
    return "Organic";
  }

  if (/cardboard|paper packaging|newspaper|paper waste|paper &/.test(text)) {
    return "Paper";
  }

  if (/plastic|pet\b|hdpe|polypropylene|polyethylene|water bottle/.test(text)) {
    return "Plastic";
  }

  if (/glass|glass bottle|glass jar/.test(text)) {
    return "Glass";
  }

  return "Other";
}

/* Category examples update the analyzer input. */
wasteInput.addEventListener("input", updateCharCount);
updateCharCount();

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    wasteInput.value = button.dataset.example || "";
    updateCharCount();
    hideError();

    resultContent.hidden = true;
    emptyState.hidden = false;

    $("#analyzer").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    wasteInput.focus({ preventScroll: true });
  });
});

/* Render the AI answer as text, not executable HTML. */
function displayAnswer(answer) {
  latestAnswer = answer;
  answerElement.replaceChildren();

  const headings = [
    "CATEGORY",
    "DISPOSAL",
    "RECYCLING",
    "SAFETY",
    "REUSE IDEA"
  ];

  let currentBody = null;

  answer.split(/\r?\n/).forEach((line) => {
    const text = line.trim();

    if (!text) return;

    const normalized = text
      .replace(/^#{1,4}\s*/, "")
      .replace(/\*{1,2}/g, "")
      .replace(/:$/, "")
      .trim()
      .toUpperCase();

    if (headings.includes(normalized)) {
      const card = document.createElement("section");
      card.className = "answer-card";

      const heading = document.createElement("h4");
      heading.textContent = normalized;

      const paragraph = document.createElement("p");

      card.append(heading, paragraph);
      answerElement.appendChild(card);
      currentBody = paragraph;
      return;
    }

    if (!currentBody) {
      const card = document.createElement("section");
      card.className = "answer-card";
      currentBody = document.createElement("p");
      card.appendChild(currentBody);
      answerElement.appendChild(card);
    }

    currentBody.textContent +=
      (currentBody.textContent ? "\n" : "") + text;
  });

  if (!answerElement.children.length) {
    answerElement.textContent = answer;
  }
}

/* Read and save browser-local history. */
function getHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("History read failed:", error);
    return [];
  }
}

function saveHistory(item) {
  try {
    const history = getHistory();
    history.unshift(item);

    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY))
    );
  } catch (error) {
    console.warn("History could not be saved:", error);
    showError("Analysis succeeded, but browser history storage is unavailable.");
  }

  renderHistory();
  renderAnalytics();
}

/* Load a saved report into the analyzer. */
function loadReport(item) {
  wasteInput.value = item.waste || "";
  updateCharCount();

  currentReportDate = item.date || new Date().toISOString();
  displayAnswer(item.answer || "");

  reportWaste.textContent = item.waste || "Unknown item";
  reportDate.textContent = formatDate(currentReportDate);

  responseTime.textContent =
    typeof item.responseTimeMs === "number"
      ? `Response time: ${(item.responseTimeMs / 1000).toFixed(1)} seconds`
      : "";

  hideError();
  loadingState.hidden = true;
  emptyState.hidden = true;
  resultContent.hidden = false;

  $("#analyzer").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* History cards */
function renderHistory() {
  historyList.replaceChildren();

  const history = getHistory();

  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.append("📝");

    const message = document.createElement("p");
    message.textContent = "Your analyses will appear here.";
    empty.appendChild(message);
    historyList.appendChild(empty);
    return;
  }

  history.forEach((item) => {
    const card = document.createElement("article");
    card.className = "history-card";

    const title = document.createElement("h3");
    title.textContent = item.waste || "Waste analysis";

    const preview = document.createElement("p");
    const answer = item.answer || "";

    preview.textContent =
      answer.slice(0, 180) + (answer.length > 180 ? "…" : "");

    const date = document.createElement("p");
    date.className = "history-date";
    date.textContent = formatDate(item.date);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.textContent = "View report";
    viewButton.addEventListener("click", () => loadReport(item));

    const pdfButton = document.createElement("button");
    pdfButton.type = "button";
    pdfButton.textContent = "Export PDF";
    pdfButton.addEventListener("click", () => {
      loadReport(item);
      exportPDF();
    });

    actions.append(viewButton, pdfButton);
    card.append(title, preview, date, actions);
    historyList.appendChild(card);
  });
}

clearHistoryBtn.addEventListener("click", () => {
  if (!getHistory().length) return;

  if (!window.confirm("Clear all saved analyses from this browser?")) {
    return;
  }

  try {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    renderAnalytics();
  } catch (error) {
    showError("Could not clear saved history.");
  }
});

/* =========================================
   ANALYTICS DASHBOARD
   ========================================= */

function renderAnalytics() {
  const history = getHistory();

  $("#stat-total").textContent = history.length;

  const categoryCounts = {};
  const dailyCounts = {};

  history.forEach((item) => {
    const category = getCategory(item);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    const day = localDayKey(item.date);

    if (day) {
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }
  });

  $("#stat-categories").textContent = Object.keys(categoryCounts).length;
  $("#stat-days").textContent = Object.keys(dailyCounts).length;

  renderPieChart(categoryCounts, history.length);
  renderBarChart(dailyCounts);
}

/* Pie chart: each slice is proportional to saved analysis count. */
function renderPieChart(counts, total) {
  const pie = $("#pie-chart");
  const legend = $("#pie-legend");

  $("#pie-total").textContent = total;
  legend.replaceChildren();

  if (!total) {
    pie.style.background = "conic-gradient(#244b3b 0% 100%)";

    const message = document.createElement("p");
    message.className = "muted small";
    message.textContent = "Analyze an item to populate the chart.";
    legend.appendChild(message);
    return;
  }

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);

  let currentPercent = 0;

  const slices = entries.map(([category, count]) => {
    const start = currentPercent;
    currentPercent += (count / total) * 100;

    return `${CATEGORY_COLORS[category] || CATEGORY_COLORS.Other} ${start}% ${currentPercent}%`;
  });

  pie.style.background = `conic-gradient(${slices.join(", ")})`;

  entries.forEach(([category, count]) => {
    const row = document.createElement("div");
    row.className = "legend-item";

    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;

    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = category;

    const value = document.createElement("strong");
    value.className = "legend-value";
    value.textContent = `${count} (${Math.round(count / total * 100)}%)`;

    row.append(dot, name, value);
    legend.appendChild(row);
  });

  pie.setAttribute(
    "aria-label",
    entries.map(([category, count]) => `${category}: ${count}`).join(", ")
  );
}

/* Bar chart: counts for today and the preceding six calendar days. */
function renderBarChart(dailyCounts) {
  const chart = $("#bar-chart");
  chart.replaceChildren();

  const today = new Date();
  const days = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setHours(12, 0, 0, 0);
    date.setDate(today.getDate() - offset);

    days.push({
      key: localDayKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" })
    });
  }

  const maxCount = Math.max(
    1,
    ...days.map((day) => dailyCounts[day.key] || 0)
  );

  days.forEach((day) => {
    const count = dailyCounts[day.key] || 0;

    const column = document.createElement("div");
    column.className = "bar-column";

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = count;

    const track = document.createElement("div");
    track.className = "bar-track";

    const bar = document.createElement("div");
    bar.className = "bar-fill";
    bar.style.height = count ? `${(count / maxCount) * 100}%` : "0%";

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = day.label;

    track.appendChild(bar);
    column.append(value, track, label);
    chart.appendChild(column);
  });

  chart.setAttribute(
    "aria-label",
    days.map((day) => `${day.label}: ${dailyCounts[day.key] || 0}`).join(", ")
  );
}

/* =========================================
   AI ANALYSIS
   ========================================= */

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isAnalyzing) return;

  const waste = wasteInput.value.trim();

  if (!waste) {
    showError("Please describe the waste item first.");
    wasteInput.focus();
    return;
  }

  hideError();
  setLoading(true);

  const startedAt = performance.now();

  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waste })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `AI request failed (HTTP ${response.status}).`
      );
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error("The AI returned an empty response. Please try again.");
    }

    const answer = data.answer.trim();
    const elapsedMs = Math.round(performance.now() - startedAt);

    currentReportDate = new Date().toISOString();
    displayAnswer(answer);

    reportWaste.textContent = waste;
    reportDate.textContent = formatDate(currentReportDate);
    responseTime.textContent =
      `Response time: ${(elapsedMs / 1000).toFixed(1)} seconds`;

    emptyState.hidden = true;
    resultContent.hidden = false;

    saveHistory({
      waste,
      answer,
      date: currentReportDate,
      responseTimeMs: elapsedMs
    });

    resultContent.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  } catch (error) {
    console.error("EcoSort AI error:", error);
    showError(error.message || "Could not analyze the item. Please try again.");

    if (!latestAnswer) emptyState.hidden = false;
  } finally {
    setLoading(false);
  }
});

/* Copy analysis text */
copyBtn.addEventListener("click", async () => {
  if (!latestAnswer) {
    showError("Analyze an item before copying the result.");
    return;
  }

  try {
    await navigator.clipboard.writeText(latestAnswer);

    const oldText = copyBtn.textContent;
    copyBtn.textContent = "Copied ✓";

    setTimeout(() => {
      if (copyBtn.isConnected) copyBtn.textContent = oldText;
    }, 1800);
  } catch {
    showError("Copy failed. Please select and copy the result manually.");
  }
});

/* Export current report to browser print/PDF dialog */
function exportPDF() {
  if (!latestAnswer) {
    showError("Analyze an item before exporting a report.");
    return;
  }

  const oldTitle = document.title;
  const datePart = new Date(currentReportDate).toISOString().slice(0, 10);

  document.title = `EcoSort-AI-Report-${datePart}`;
  window.print();
  document.title = oldTitle;
}

exportPdfBtn.addEventListener("click", exportPDF);

/* Footer and initial dashboard */
$("#current-year").textContent = new Date().getFullYear();

renderHistory();
renderAnalytics();
