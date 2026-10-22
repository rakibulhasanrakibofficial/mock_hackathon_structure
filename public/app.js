
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

let latestAnswer = "";
let currentReportDate = new Date().toISOString();
let isAnalyzing = false;

function updateCharCount() {
  if (charCount && wasteInput) {
    charCount.textContent = `${wasteInput.value.length}/1000`;
  }
}

function showError(message) {
  if (!errorMessage) return;
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  if (!errorMessage) return;
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function setLoading(loading) {
  isAnalyzing = loading;

  if (analyzeBtn) analyzeBtn.disabled = loading;
  if (buttonText) buttonText.textContent = loading ? "Analyzing..." : "Analyze with AI →";
  if (loadingState) loadingState.hidden = !loading;
  if (loading && emptyState) emptyState.hidden = true;
  if (loading && resultContent) resultContent.hidden = true;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

/* Example chips */
wasteInput?.addEventListener("input", updateCharCount);
updateCharCount();

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    wasteInput.value = button.dataset.example || "";
    updateCharCount();
    hideError();

    if (resultContent) resultContent.hidden = true;
    if (emptyState) emptyState.hidden = false;

    $("#analyzer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    wasteInput.focus({ preventScroll: true });
  });
});

/* Display AI response as safe text */
function displayAnswer(answer) {
  latestAnswer = answer;
  answerElement.replaceChildren();

  const headings = ["CATEGORY", "DISPOSAL", "RECYCLING", "SAFETY", "REUSE IDEA"];
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

    currentBody.textContent += (currentBody.textContent ? "\n" : "") + text;
  });

  if (!answerElement.children.length) answerElement.textContent = answer;
}

/* History */
function getHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory(item) {
  try {
    const history = getHistory();
    history.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    renderHistory();
  } catch (error) {
    console.warn("History save failed:", error);
  }
}

function loadReport(item) {
  wasteInput.value = item.waste || "";
  updateCharCount();

  currentReportDate = item.date || new Date().toISOString();
  displayAnswer(item.answer || "");

  reportWaste.textContent = item.waste || "Unknown item";
  reportDate.textContent = formatDate(currentReportDate);

  responseTime.textContent = typeof item.responseTimeMs === "number"
    ? `Response time: ${(item.responseTimeMs / 1000).toFixed(1)} seconds`
    : "";

  hideError();
  loadingState.hidden = true;
  emptyState.hidden = true;
  resultContent.hidden = false;

  $("#analyzer").scrollIntoView({ behavior: "smooth", block: "start" });
}

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
    preview.textContent = (item.answer || "").slice(0, 180) +
      ((item.answer || "").length > 180 ? "…" : "");

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

clearHistoryBtn?.addEventListener("click", () => {
  if (!getHistory().length) return;
  if (!confirm("Clear all saved analyses from this browser?")) return;

  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

/* AI analysis */
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isAnalyzing) return;

  const waste = wasteInput.value.trim();

  if (!waste) {
    showError("Please describe the waste item first.");
    wasteInput.focus();
    return;
  }

  if (waste.length > 1000) {
    showError("Description must be 1000 characters or less.");
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
      throw new Error(data.error || `AI request failed (HTTP ${response.status}).`);
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
    responseTime.textContent = `Response time: ${(elapsedMs / 1000).toFixed(1)} seconds`;

    emptyState.hidden = true;
    resultContent.hidden = false;

    saveHistory({
      waste,
      answer,
      date: currentReportDate,
      responseTimeMs: elapsedMs
    });

    resultContent.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    console.error("EcoSort AI error:", error);
    showError(error.message || "Could not analyze the item. Please try again.");
    if (emptyState && !latestAnswer) emptyState.hidden = false;
  } finally {
    setLoading(false);
  }
});

/* Copy result */
copyBtn?.addEventListener("click", async () => {
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

/* PDF export */
function exportPDF() {
  if (!latestAnswer) {
    showError("Analyze a waste item before exporting a report.");
    return;
  }

  const oldTitle = document.title;
  const datePart = new Date(currentReportDate).toISOString().slice(0, 10);

  document.title = `EcoSort-AI-Report-${datePart}`;
  window.print();
  document.title = oldTitle;
}

exportPdfBtn?.addEventListener("click", exportPDF);

/* Footer year */
const yearElement = $("#current-year");
if (yearElement) yearElement.textContent = new Date().getFullYear();

/* Initialize */
renderHistory();
