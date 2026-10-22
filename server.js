
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
    model: MODEL,
    ollamaUrl: OLLAMA_URL
  });
});

// Check Ollama connectivity
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

// Classify waste with AI
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

Analyze the item and answer using these five headings:

CATEGORY
Identify the likely waste category and briefly explain why.

DISPOSAL
Give clear, practical disposal instructions.

RECYCLING
Explain whether it may be recyclable, how to prepare it,
and note that local recycling rules vary.

SAFETY
Mention relevant hazards and precautions.

REUSE IDEA
Suggest one realistic reuse idea if appropriate.

Instructions:
- Use simple, concise English.
- Aim for 80-120 words total.
- Do not add an introduction or repeat the question.
- Never invent local recycling rules.
- Do not claim an item is recyclable everywhere.
- State uncertainty if the item's material is unknown.
- Explain when different parts require different disposal methods.
- Never encourage unsafe handling of leaking batteries,
  unknown chemicals, medical waste, or hazardous sharp objects.
- Do not reveal internal reasoning.`
    },
    {
      role: "user",
      content: `Analyze this waste item: ${waste}`
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
        keep_alive: "10m",
        options: {
          temperature: 0.2,
          num_predict: 180
        },
        messages
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Ollama API error:",
        response.status,
        data.error || "Unknown error"
      );

      return res.status(502).json({
        error: data.error || "The AI service request failed."
      });
    }

    // Extract the normal chat response.
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

    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      return res.status(504).json({
        error: "AI response timed out. Please try again."
      });
    }

    return res.status(503).json({
      error: "Cannot connect to Ollama. Make sure it is running."
    });
  }
});

// Unknown API endpoint
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// Handle invalid JSON
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  next(error);
});

// Start server
app.listen(PORT, () => {
  console.log(`🌿 EcoSort AI running at http://localhost:${PORT}`);
  console.log(`🤖 AI model: ${MODEL}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_URL}`);
});
