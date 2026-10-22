
const form = document.getElementById("waste-form");
const wasteInput = document.getElementById("waste");
const analyzeBtn = document.getElementById("analyze-btn");
const buttonText = document.getElementById("button-text");
const charCount = document.getElementById("char-count");

const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const resultContent = document.getElementById("result-content");
const answer = document.getElementById("answer");
const errorMessage = document.getElementById("error-message");
const copyBtn = document.getElementById("copy-btn");

const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");

const HISTORY_KEY = "ecosort-analysis-history";

const sections = [
  { heading: "CATEGORY", label: "Waste Category", icon: "♻️", color: "green" },
  { heading: "DISPOSAL", label: "How to Dispose", icon: "🗑️", color: "blue" },
  { heading: "RECYCLING", label: "Recycling Guide", icon: "🌱", color: "purple" },
  { heading: "SAFETY", label: "Safety First", icon: "🛡️", color: "orange" },
  { heading: "REUSE IDEA", label: "Reuse Idea", icon: "✨", color: "pink" }
];

let latestAnswer = "";
let latestWaste = "";
let requestInProgress = false;

function showState(state) {
  emptyState.hidden = state !== "empty";
  loadingState.hidden = state !== "loading";
  resultContent.hidden = state !== "result";
}

function getHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(item) {
  try {
    const history = getHistory();
    history.unshift(item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
    renderHistory();
  } catch (error) {
    console.warn("Could not save history:", error.message);
  }
}

function renderHistory() {
  if (!historyList) return;

  historyList.replaceChildren();
  const history = getHistory();

  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";

    const icon = document.createElement("span");
    icon.textContent = "🌱";

    const message = document.createElement("p");
    message.textContent = "Your analysis history will appear here.";

    empty.append(icon, message);
    historyList.appendChild(empty);
    return;
  }

  history.forEach((item) => {
    const card = document.createElement("article");
    card.className = "history-card";

    const icon = document.createElement("div");
    icon.className = "history-icon";
    icon.textContent = "♻";

    const details = document.createElement("div");
    details.className = "history-details";

    const title = document.createElement("h3");
    title.textContent = item.waste;

    const preview = document.createElement("p");
    preview.textContent = item.answer.length > 140
      ? `${item.answer.slice(0, 140)}…`
      : item.answer;

    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = new Date(item.date).toLocaleString();

    details.append(title, preview, date);
    card.append(icon, details);
    historyList.appendChild(card);
  });
}

function renderAnswer(text) {
  answer.replaceChildren();

  const pattern =
    /(?:^|\n)\s*(CATEGORY|DISPOSAL|RECYCLING|SAFETY|REUSE IDEA)\s*:?\s*/gi;

  const matches = [...text.matchAll(pattern)];

  if (matches.length === 0) {
    const card = document.createElement("article");
    card.className = "answer-card green";

    const content = document.createElement("p");
    content.className = "answer-card-text";
    content.textContent = text;

    card.appendChild(content);
    answer.appendChild(card);
    return;
  }

  matches.forEach((match, index) => {
    const config = sections.find(
      (item) => item.heading === match[1].toUpperCase()
    );

    if (!config) return;

    const start = match.index + match[0].length;
    const end = index + 1 < matches.length
      ? matches[index + 1].index
      : text.length;

    const contentText = text.slice(start, end).trim();
    if (!contentText) return;

    const card = document.createElement("article");
    card.className = `answer-card ${config.color}`;

    const header = document.createElement("div");
    header.className = "answer-card-header";

    const icon = document.createElement("span");
    icon.className = "answer-card-icon";
    icon.textContent = config.icon;

    const title = document.createElement("h4");
    title.textContent = config.label;

    header.append(icon, title);

    const content = document.createElement("p");
    content.className = "answer-card-text";
    content.textContent = contentText;

    card.append(header, content);
    answer.appendChild(card);
  });
}

function showResponseTime(milliseconds) {
  let timing = document.getElementById("response-time");

  if (!timing) {
    timing = document.createElement("p");
    timing.id = "response-time";
    timing.className = "response-time";
    answer.insertAdjacentElement("afterend", timing);
  }

  timing.textContent = `⏱ AI response time: ${(milliseconds / 1000).toFixed(1)} seconds`;
}

wasteInput.addEventListener("input", () => {
  charCount.textContent = `${wasteInput.value.length} / 1000`;
});

document.querySelectorAll(".example-chip").forEach((button) => {
  button.addEventListener("click", () => {
    wasteInput.value = button.dataset.example || "";
    charCount.textContent = `${wasteInput.value.length} / 1000`;
    wasteInput.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (requestInProgress) return;

  const waste = wasteInput.value.trim();

  if (!waste) {
    wasteInput.focus();
    return;
  }

  requestInProgress = true;
  latestWaste = waste;

  analyzeBtn.disabled = true;
  buttonText.textContent = "Analyzing...";
  errorMessage.hidden = true;
  showState("loading");

  const startedAt = performance.now();

  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waste })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI analysis failed.");
    }

    latestAnswer = data.answer || "";

    if (!latestAnswer.trim()) {
      throw new Error("The AI returned an empty response.");
    }

    const elapsed = performance.now() - startedAt;

    renderAnswer(latestAnswer);
    showResponseTime(elapsed);
    showState("result");

    saveHistory({
      waste,
      answer: latestAnswer,
      date: new Date().toISOString(),
      responseTimeMs: Math.round(elapsed)
    });
  } catch (error) {
    showState("empty");
    errorMessage.textContent = error.message ||
      "Could not complete the analysis. Check the server and Ollama.";
    errorMessage.hidden = false;
  } finally {
    requestInProgress = false;
    analyzeBtn.disabled = false;
    buttonText.textContent = "Analyze with AI";
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(latestAnswer);
    copyBtn.textContent = "Copied ✓";
  } catch {
    copyBtn.textContent = "Copy unavailable";
  }

  setTimeout(() => {
    copyBtn.textContent = "Copy results ↗";
  }, 1800);
});

clearHistoryBtn?.addEventListener("click", () => {
  if (!getHistory().length) return;

  if (confirm("Clear all saved analysis history?")) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
});

renderHistory();
