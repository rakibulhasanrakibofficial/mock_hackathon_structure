
"use strict";

const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_MODE = (process.env.OLLAMA_MODE || "local").toLowerCase();
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

const IS_CLOUD = OLLAMA_MODE === "cloud";

const MODEL =
  process.env.OLLAMA_MODEL ||
  (IS_CLOUD ? "gemma4:31b" : "gemma4:e2b");

const OLLAMA_URL = IS_CLOUD
  ? "https://ollama.com"
  : (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================
   Health Check
   ========================================= */

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    app: "EcoSort AI",
    mode: IS_CLOUD ? "cloud" : "local",
    model: MODEL
  });
});

/* =========================================
   Ollama Connection Status
   ========================================= */

app.get("/api/ollama-status", async (req, res) => {
  if (IS_CLOUD && !OLLAMA_API_KEY) {
    return res.status(503).json({
      status: "disconnected",
      error: "OLLAMA_API_KEY is not configured."
    });
  }

  try {
    const headers = {};

    if (IS_CLOUD) {
      headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
    }

    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(502).json({
        status: "error",
        mode: IS_CLOUD ? "cloud" : "local",
        error: `Ollama returned HTTP ${response.status}. Check your API key and configuration.`
      });
    }

    const data = await response.json();
    const installedModels = (data.models || []).map((item) => item.name);

    res.json({
      status: "connected",
      mode: IS_CLOUD ? "cloud" : "local",
      configuredModel: MODEL,
      modelAvailable: installedModels.some(
        (name) => name === MODEL || name.startsWith(`${MODEL}:`)
      ),
      installedModels
    });
  } catch (error) {
    console.error("Ollama status error:", error.message);

    res.status(503).json({
      status: "disconnected",
      mode: IS_CLOUD ? "cloud" : "local",
      error: "Cannot connect to Ollama. Check the service and configuration."
    });
  }
});

/* =========================================
   Waste Classification
   ========================================= */

app.post("/api/classify", async (req, res) => {
  const waste =
    typeof req.body?.waste === "string"
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

  if (IS_CLOUD && !OLLAMA_API_KEY) {
    return res.status(503).json({
      error: "Cloud AI is not configured. Add OLLAMA_API_KEY in Render Environment."
    });
  }

  const messages = [
    {
      role: "system",
      content: `You are EcoSort AI, a practical waste sorting assistant.

Use these five headings:
CATEGORY
DISPOSAL
RECYCLING
SAFETY
REUSE IDEA

Rules:
- Use simple English.
- Keep the answer around 60-100 words.
- Give specific, practical advice.
- State uncertainty when the material is unknown.
- Do not invent local recycling rules.
- Recycling availability varies by location.
- Never recommend unsafe handling of batteries, chemicals,
  medical waste, or hazardous sharp objects.
- Do not include an introduction.`
    },
    {
      role: "user",
      content: `Waste item: ${waste}`
    }
  ];

  try {
    const headers = {
      "Content-Type": "application/json"
    };

    if (IS_CLOUD) {
      headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
    }

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 160
        },
        keep_alive: IS_CLOUD ? undefined : "15m"
      }),
      signal: AbortSignal.timeout(120000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Ollama API error:",
        response.status,
        data.error || "Unknown error"
      );

      return res.status(502).json({
        error:
          response.status === 401 || response.status === 403
            ? "Ollama authentication failed. Check OLLAMA_API_KEY."
            : data.error || `AI service returned HTTP ${response.status}.`
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
        : "Cannot connect to the AI service. Check your configuration."
    });
  }
});

/* =========================================
   Unknown API Endpoint
   ========================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

/* =========================================
   Error Handling
   ========================================= */

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  console.error("Server error:", error.message);

  res.status(500).json({
    error: "An unexpected server error occurred."
  });
});

/* =========================================
   Start Server
   ========================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌿 EcoSort AI running on port ${PORT}`);
  console.log(`🤖 AI model: ${MODEL}`);
  console.log(`🔗 AI mode: ${IS_CLOUD ? "Ollama Cloud" : "Local Ollama"}`);

  if (IS_CLOUD && !OLLAMA_API_KEY) {
    console.error("⚠️ Missing OLLAMA_API_KEY environment variable.");
  }
});
