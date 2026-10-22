
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

let latestAnswer = "";

const sections = [
  { heading: "CATEGORY", label: "Waste Category", icon: "♻️", color: "green" },
  { heading: "DISPOSAL", label: "How to Dispose", icon: "🗑️", color: "blue" },
  { heading: "RECYCLING", label: "Recycling Guide", icon: "🌱", color: "purple" },
  { heading: "SAFETY", label: "Safety First", icon: "🛡️", color: "orange" },
  { heading: "REUSE IDEA", label: "Reuse Idea", icon: "✨", color: "pink" }
];

wasteInput.addEventListener("input", () => {
  charCount.textContent = `${wasteInput.value.length} / 2000`;
});

document.querySelectorAll(".example-chip").forEach((button) => {
  button.addEventListener("click", () => {
    wasteInput.value = button.dataset.example;
    charCount.textContent = `${wasteInput.value.length} / 2000`;
    wasteInput.focus();
  });
});

function showState(state) {
  emptyState.hidden = state !== "empty";
  loadingState.hidden = state !== "loading";
  resultContent.hidden = state !== "result";
}

function renderAnswer(text) {
  answer.replaceChildren();

  const pattern =
    /(?:^|\n)\s*(CATEGORY|DISPOSAL|RECYCLING|SAFETY|REUSE IDEA)\s*:?\s*/gi;

  const matches = [...text.matchAll(pattern)];

  if (!matches.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "answer-card-text";
    paragraph.textContent = text;
    answer.appendChild(paragraph);
    return;
  }

  matches.forEach((match, index) => {
    const heading = match[1].toUpperCase();
    const config = sections.find((item) => item.heading === heading);

    const start = match.index + match[0].length;
    const end = index + 1 < matches.length
      ? matches[index + 1].index
      : text.length;

    const content = text.slice(start, end).trim();
    if (!content) return;

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

    const paragraph = document.createElement("p");
    paragraph.className = "answer-card-text";
    paragraph.textContent = content;

    card.append(header, paragraph);
    answer.appendChild(card);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const waste = wasteInput.value.trim();
  if (!waste) {
    wasteInput.focus();
    return;
  }

  analyzeBtn.disabled = true;
  buttonText.textContent = "Analyzing...";
  errorMessage.hidden = true;
  showState("loading");

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

    latestAnswer = data.answer || "No answer returned. Please try again.";
    renderAnswer(latestAnswer);
    showState("result");
  } catch (error) {
    showState("empty");
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  } finally {
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
