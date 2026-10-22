
"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const { fetch: undiciFetch, Agent } = require("undici");

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_MODE = (process.env.OLLAMA_MODE || "local").toLowerCase();
const IS_CLOUD = OLLAMA_MODE === "cloud";

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || (IS_CLOUD ? "gemma4:31b" : "gemma4:e2b");

const OLLAMA_URL = IS_CLOUD
  ? "https://ollama.com"
  : (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 120000;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

// Serve the frontend from the public directory.
app.use(express.static(path.join(__dirname, "public")));

// Handle invalid JSON request bodies.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      message: "Invalid JSON request body."
    });
  }

  next(err);
});

function getAuthHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (IS_CLOUD && OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  }

  return headers;
}

async function ollamaRequest(endpoint, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await undiciFetch(`${OLLAMA_URL}${endpoint}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
      dispatcher: new Agent({
        connect: {
          timeout: 15000
        }
      })
    });

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      const error = new Error(
        data.error || `Ollama request failed (${response.status}).`
      );

      error.status = response.status;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Basic service status.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "EcoSort AI",
    mode: OLLAMA_MODE,
    model: OLLAMA_MODEL
  });
});

// Ollama connectivity status.
app.get("/api/status", async (req, res) => {
  if (IS_CLOUD && !OLLAMA_API_KEY) {
    return res.status(503).json({
      status: "unavailable",
      message: "OLLAMA_API_KEY is not configured."
    });
  }

  try {
    const response = await undiciFetch(`${OLLAMA_URL}/api/tags`, {
      method: "GET",
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(503).json({
        status: "unavailable",
        message: `Ollama returned HTTP ${response.status}.`
      });
    }

    const data = await response.json();

    res.json({
      status: "connected",
      mode: OLLAMA_MODE,
      model: OLLAMA_MODEL,
      models: Array.isArray(data.models)
        ? data.models.map((model) => model.name)
        : []
    });
  } catch (error) {
    res.status(503).json({
      status: "unavailable",
      message: error.name === "TimeoutError" || error.name === "AbortError"
        ? "Ollama status request timed out."
        : "Cannot connect to the configured Ollama endpoint."
    });
  }
});

// Main AI waste analysis endpoint.
app.post("/api/analyze", async (req, res) => {
  try {
    const item = typeof req.body?.item === "string"
      ? req.body.item.trim()
      : "";

    if (!item) {
      return res.status(400).json({
        message: "Please provide a waste item."
      });
    }

    if (item.length > 500) {
      return res.status(400).json({
        message: "The waste description must be 500 characters or fewer."
      });
    }

    if (IS_CLOUD && !OLLAMA_API_KEY) {
      return res.status(503).json({
        message: "Cloud mode requires an OLLAMA_API_KEY environment variable."
      });
    }

    

const systemPrompt = `
You are EcoSort AI, an intelligent waste classification assistant.

Analyze the user's waste item and provide useful, practical, easy-to-understand guidance.

Use exactly these five headings:

ITEM: A clear item name.
CATEGORY: Choose one: Plastic, Organic, Paper, E-waste, Glass, General waste, or Other.
RECOMMENDED ACTION: Explain what to do with the item in 2-3 useful sentences, around 25-40 words.
WHY IT MATTERS: Explain the environmental or safety benefit in 2-3 informative sentences, around 25-40 words.
ECO TIP: Give a practical, actionable tip in 1-2 sentences, around 15-25 words.

Writing rules:
- Aim for approximately 100-140 words in total.
- Use clear, natural, professional English.
- Avoid repetitive information and unnecessary introductions.
- Tailor every answer to the specific item.
- Never invent local recycling facilities or guarantee recyclability.
- Mention safety precautions when relevant.
- Recommend checking local rules when disposal options vary.
- Do not claim the item has actually been recycled or composted.
- Return only the five labelled fields.
`.trim();


    const result = await ollamaRequest("/api/chat", {
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Analyze this waste item: ${item}`
        }
      ],
      options: {
        temperature: 0.2,
        num_predict: 350
      },
      ...(IS_CLOUD ? {} : { keep_alive: "15m" })
    });

    const content = result.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      console.error("Unexpected Ollama response:", result);

      return res.status(502).json({
        message: "The AI returned an empty response. Please try again."
      });
    }

    const answer = content.trim();

    function extract(label) {
      const labels = [
        "ITEM",
        "CATEGORY",
        "RECOMMENDED ACTION",
        "WHY IT MATTERS",
        "ECO TIP"
      ];

      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const otherLabels = labels
        .filter((entry) => entry !== label)
        .map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

      const nextHeading = otherLabels.length
        ? `(?=\\n\\s*(?:${otherLabels.join("|")})\\s*:|$)`
        : "$";

      const regex = new RegExp(
        `(?:^|\\n)\\s*${escaped}\\s*:\\s*([\\s\\S]*?)${nextHeading}`,
        "i"
      );

      const match = answer.match(regex);
      return match ? match[1].trim() : "";
    }

    const category = extract("CATEGORY") || "Other";

    res.json({
      success: true,
      itemName: extract("ITEM") || item,
      category,
      action:
        extract("RECOMMENDED ACTION") ||
        "Check local waste collection guidance before disposal.",
      reason:
        extract("WHY IT MATTERS") ||
        "Correct handling can help reduce waste and avoid inappropriate disposal.",
      tip:
        extract("ECO TIP") ||
        "Consider whether the item can be reused or safely recycled.",
      response: answer,
      model: OLLAMA_MODEL
    });
  } catch (error) {
    console.error("EcoSort AI analysis error:", error.message);

    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return res.status(504).json({
        message: "The AI request timed out. Please try again."
      });
    }

    if (error.status === 401 || error.status === 403) {
      return res.status(502).json({
        message: "Ollama authentication failed. Check your API key."
      });
    }

    if (error.status === 404) {
      return res.status(502).json({
        message: "The Ollama endpoint or model was not found. Check your Ollama URL and model name."
      });
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.cause?.code === "ECONNREFUSED"
    ) {
      return res.status(503).json({
        message: "Cannot connect to Ollama. Start Ollama and check the configured URL."
      });
    }

    res.status(502).json({
      message: "AI analysis failed. Check the Ollama connection and try again."
    });
  }
});

// Return JSON for unknown API routes instead of an HTML 404 page.
app.use("/api", (req, res) => {
  res.status(404).json({
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// Frontend fallback.

app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();

  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (error) => {
      if (error && !res.headersSent) {
        res.status(500).send("Could not load the EcoSort AI frontend.");
      }
    }
  );
});


// General error handler.
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) return next(err);

  res.status(500).json({
    message: "An unexpected server error occurred."
  });
});

app.listen(PORT, () => {
  console.log(`EcoSort AI server running at http://localhost:${PORT}`);
  console.log(`Ollama mode: ${OLLAMA_MODE}`);
  console.log(`Ollama model: ${OLLAMA_MODEL}`);

  if (!IS_CLOUD) {
    console.log(`Ollama URL: ${OLLAMA_URL}`);
  }
});
