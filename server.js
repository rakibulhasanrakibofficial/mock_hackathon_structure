
const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const OLLAMA_URL = (
  process.env.OLLAMA_URL || "http://localhost:11434"
).replace(/\/+$/, "");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    app: "EcoSort AI",
    model: MODEL
  });
});

// Check Ollama connection and model
app.get("/api/ollama-status", async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        status: "error",
        error: "Ollama returned an error."
      });
    }

    const models = (data.models || []).map((item) => item.name);

    res.json({
      status: "connected",
      configuredModel: MODEL,
      modelAvailable: models.some(
        (name) => name === MODEL || name.startsWith(`${MODEL}:`)
      ),
      installedModels: models
    });
  } catch (error) {
    res.status(503).json({
      status: "disconnected",
      error: "Cannot connect to Ollama. Check that it is running."
    });
  }
});

// Fast, concise waste analysis
app.post("/api/classify", async (req, res) => {
  const waste = typeof req.body?.waste === "string"
    ? req.body.waste.trim()
    : "";

  if (!waste) {
    return res.status(400).json({
      error: "Please describe the waste item."
    });
  }

  if (waste.length > 1000) {
    return res.status(400).json({
      error: "Description must be 1000 characters or less."
    });
  }

  const messages = [
    {
      role: "system",
      content: `You are EcoSort AI, a practical waste sorting assistant.

Answer using these five headings:

CATEGORY
Name the likely waste category.

DISPOSAL
Give the most useful disposal steps.

RECYCLING
Explain recycling options and preparation.

SAFETY
Mention important hazards and precautions.

REUSE IDEA
Give one practical reuse suggestion if appropriate.

Rules:
- Use simple English.
- Keep the whole answer around 60-100 words.
- Be specific and actionable.
- Do not add an introduction or repeat the question.
- Never invent local recycling rules.
- Recycling availability varies by location.
- State uncertainty when the material is unknown.
- Never recommend unsafe handling of batteries, chemicals,
  medical waste, or hazardous sharp objects.
- Do not provide internal reasoning.`
    },
    {
      role: "user",
      content: `Waste item: ${waste}`
    }
  ];

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        keep_alive: "15m",
        options: {
          temperature: 0.2,
          num_predict: 140,
          num_ctx: 2048
        },
        messages
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Ollama error:", data.error || response.status);

      return res.status(502).json({
        error: data.error || "The AI service request failed."
      });
    }

    const answer = data.message?.content?.trim();

    if (!answer) {
      console.error("Empty Ollama response:", JSON.stringify(data));

      return res.status(502).json({
        error: "The AI returned an empty response. Please try again."
      });
    }

    return res.json({
      success: true,
      answer,
      model: MODEL
    });
  } catch (error) {
    console.error("EcoSort AI error:", error.message);

    const timedOut =
      error.name === "TimeoutError" ||
      error.name === "AbortError";

    return res.status(timedOut ? 504 : 503).json({
      error: timedOut
        ? "AI response took too long. Please try again."
        : "Cannot connect to Ollama. Make sure it is running."
    });
  }
});

// Unknown API endpoint
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// Invalid JSON handler
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`🌿 EcoSort AI running at http://localhost:${PORT}`);
  console.log(`🤖 AI model: ${MODEL}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_URL}`);
});
