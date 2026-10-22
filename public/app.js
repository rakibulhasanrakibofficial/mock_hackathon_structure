
"use strict";

/* =========================================
   EcoSort AI — Complete Frontend Logic
   ========================================= */

const form = document.getElementById("waste-form");
const wasteInput = document.getElementById("waste");
const charCount = document.getElementById("char-count");
const analyzeBtn = document.getElementById("analyze-btn");
const buttonText = document.getElementById("button-text");

const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const resultContent = document.getElementById("result-content");
const answerElement = document.getElementById("answer");

const errorMessage = document.getElementById("error-message");
const copyBtn = document.getElementById("copy-btn");
const responseTime = document.getElementById("response-time");

const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");

const HISTORY_KEY = "ecosort-ai-history";
const MAX_HISTORY = 10;

let latestAnswer = "";
let isAnalyzing = false;

/* =========================================
   Character Counter
   ========================================= */

function updateCharCount() {
  if (!wasteInput || !charCount) return;

  charCount.textContent = `${wasteInput.value.length}/1000`;
}

wasteInput?.addEventListener("input", updateCharCount);
updateCharCount();

/* =========================================
   Example Chips + Category Buttons
   ========================================= */

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!wasteInput) return;

    wasteInput.value = button.dataset.example || "";
    updateCharCount();

    hideError();

    if (resultContent) resultContent.hidden = true;
    if (emptyState) emptyState.hidden = false;

    document.getElementById("analyzer")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    wasteInput.focus({ preventScroll: true });
  });
});

/* =========================================
   UI State Helpers
   ========================================= */

function hideError() {
  if (!errorMessage) return;

  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function showError(message) {
  if (!errorMessage) return;

  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function setLoading(loading) {
  isAnalyzing = loading;

  if (analyzeBtn) {
    analyzeBtn.disabled = loading;
  }

  if (buttonText) {
    buttonText.textContent = loading
      ? "Analyzing..."
      : "Analyze with AI →";
  }

  if (loadingState) {
    loadingState.hidden = !loading;
  }

  if (loading) {
    if (emptyState) emptyState.hidden = true;
    if (resultContent) resultContent.hidden = true;
  }
}

/* =========================================
   Safe Text Rendering
   ========================================= */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

/*
 * Display the AI answer as plain text.
 * No AI-generated HTML is executed.
 */
function displayAnswer(answer) {
  if (!answerElement) return;

  latestAnswer = answer;
  answerElement.replaceChildren();

  const lines = answer.split(/\r?\n/);
  let currentCard = null;
  let currentBody = null;

  const headingPattern =
    /^(?:#{1,4}\s*)?(CATEGORY|DISPOSAL|RECYCLING|SAFETY|REUSE IDEA)\s*:?\s*$/i;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) return;

    const headingMatch = trimmed.match(headingPattern);

    if (headingMatch) {
      currentCard = document.createElement("section");
      currentCard.className = "answer-card";

      const heading = document.createElement("h4");
      heading.textContent = headingMatch[1].toUpperCase();

      currentBody = document.createElement("p");

      currentCard.append(heading, currentBody);
      answerElement.appendChild(currentCard);

      return;
    }

    if (!currentCard) {
      currentCard = document.createElement("section");
      currentCard.className = "answer-card";

      currentBody = document.createElement("p");

      currentCard.appendChild(currentBody);
      answerElement.appendChild(currentCard);
    }

    const existingText = currentBody.textContent;

    currentBody.textContent = existingText
      ? `${existingText}\n${trimmed}`
      : trimmed;
  });

  if (!answerElement.children.length) {
    answerElement.textContent = answer;
  }
}

/* =========================================
   Local Analysis History
   ========================================= */

function getHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);

    if (!stored) return [];

    const history = JSON.parse(stored);

    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.warn("Could not read history:", error);
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

    renderHistory();
  } catch (error) {
    console.warn("Could not save history:", error);
  }
}

function renderHistory() {
  if (!historyList) return;

  const history = getHistory();
  historyList.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";

    const icon = document.createElement("span");
    icon.textContent = "📝";

    const message = document.createElement("p");
    message.textContent =
      "Your analyses will appear here after you use the AI analyzer.";

    empty.append(icon, message);
    historyList.appendChild(empty);

    return;
  }

  history.forEach((item) => {
    const card = document.createElement("article");
    card.className = "history-card";

    const title = document.createElement("h3");
    title.textContent = item.waste || "Waste analysis";

    const preview = document.createElement("p");
    preview.textContent = (item.answer || "").slice(0, 220);

    if ((item.answer || "").length > 220) {
      preview.textContent += "...";
    }

    const date = document.createElement("p");
    date.className = "history-date";

    const parsedDate = new Date(item.date);

    date.textContent = Number.isNaN(parsedDate.getTime())
      ? ""
      : parsedDate.toLocaleString();

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "category-link";
    viewButton.textContent = "View result →";

    viewButton.addEventListener("click", () => {
      if (wasteInput) {
        wasteInput.value = item.waste || "";
        updateCharCount();
      }

      displayAnswer(item.answer || "");
      hideError();

      if (emptyState) emptyState.hidden = true;
      if (loadingState) loadingState.hidden = true;
      if (resultContent) resultContent.hidden = false;

      if (responseTime) {
        responseTime.textContent =
          typeof item.responseTimeMs === "number"
            ? `Response time: ${(item.responseTimeMs / 1000).toFixed(1)} seconds`
            : "";
      }

      document.getElementById("analyzer")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    card.append(title, preview, date, viewButton);
    historyList.appendChild(card);
  });
}

clearHistoryBtn?.addEventListener("click", () => {
  const history = getHistory();

  if (history.length === 0) return;

  const confirmed = window.confirm(
    "Are you sure you want to clear your analysis history?"
  );

  if (!confirmed) return;

  try {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  } catch (error) {
    console.warn("Could not clear history:", error);
  }
});

/* =========================================
   AI Waste Analysis
   ========================================= */

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isAnalyzing) return;

  const waste = wasteInput?.value.trim() || "";

  if (!waste) {
    showError("Please describe the waste item first.");
    wasteInput?.focus();
    return;
  }

  if (waste.length > 1000) {
    showError("Description must be 1000 characters or less.");
    return;
  }

  hideError();
  setLoading(true);

  const startTime = performance.now();

  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ waste })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Analysis failed (HTTP ${response.status}).`
      );
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error("The AI returned an empty response. Please try again.");
    }

    const elapsedMs = Math.round(performance.now() - startTime);
    const answer = data.answer.trim();

    displayAnswer(answer);

    if (responseTime) {
      responseTime.textContent =
        `Response time: ${(elapsedMs / 1000).toFixed(1)} seconds`;
    }

    if (emptyState) emptyState.hidden = true;
    if (resultContent) resultContent.hidden = false;

    saveHistory({
      waste,
      answer,
      date: new Date().toISOString(),
      responseTimeMs: elapsedMs
    });

    resultContent?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  } catch (error) {
    console.error("EcoSort AI analysis error:", error);

    showError(
      error.message ||
      "Could not analyze your waste. Check the server and try again."
    );

    if (emptyState && !latestAnswer) {
      emptyState.hidden = false;
    }
  } finally {
    setLoading(false);
  }
});

/* =========================================
   Copy AI Result
   ========================================= */

copyBtn?.addEventListener("click", async () => {
  if (!latestAnswer) {
    showError("There is no result to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(latestAnswer);

    const originalText = copyBtn.textContent;
    copyBtn.textContent = "Copied! ✓";

    window.setTimeout(() => {
      if (copyBtn.isConnected) {
        copyBtn.textContent = originalText;
      }
    }, 1800);
  } catch (error) {
    console.error("Clipboard error:", error);

    showError(
      "Could not copy automatically. Please select and copy the result manually."
    );
  }
});

/* =========================================
   Footer Year
   ========================================= */

const yearElement = document.getElementById("current-year");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

/* =========================================
   Initialize
   ========================================= */

renderHistory();
