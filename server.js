"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const { fetch: undiciFetch, Agent } = require("undici");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_MODE = (process.env.OLLAMA_MODE || "local").toLowerCase();
const IS_CLOUD = OLLAMA_MODE === "cloud";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ||
  (IS_CLOUD ? "gemma4:31b" : "gemma4:e2b");

const OLLAMA_URL = (
  IS_CLOUD
    ? "https://ollama.com"
    : process.env.OLLAMA_URL || "http://localhost:11434"
).replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 120000;

app.disable("x-powered-by");

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    "body" in err
  ) {
    return res.status(400).json({
      message: "Invalid JSON request body."
    });
  }

  return next(err);
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

async function ollamaRequest(
  endpoint,
  body,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  const dispatcher = new Agent({
    connect: {
      timeout: 15000
    }
  });

  try {
    const response = await undiciFetch(
      `${OLLAMA_URL}${endpoint}`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        dispatcher
      }
    );

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      const error = new Error(
        data.error ||
        `Ollama request failed (${response.status}).`
      );

      error.status = response.status;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeout);
    await dispatcher.close().catch(() => {});
  }
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "EcoSort AI",
    mode: OLLAMA_MODE,
    model: OLLAMA_MODEL
  });
});

// Ollama connection status
app.get("/api/status", async (req, res) => {
  if (IS_CLOUD && !OLLAMA_API_KEY) {
    return res.status(503).json({
      status: "unavailable",
      message: "OLLAMA_API_KEY is not configured."
    });
  }

  if (IS_CLOUD) {
    return res.json({
      status: "configured",
      mode: OLLAMA_MODE,
      model: OLLAMA_MODEL
    });
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    const response = await undiciFetch(
      `${OLLAMA_URL}/api/tags`,
      {
        method: "GET",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return res.status(503).json({
        status: "unavailable",
        message: `Ollama returned HTTP ${response.status}.`
      });
    }

    const data = await response.json();

    return res.json({
      status: "connected",
      mode: OLLAMA_MODE,
      model: OLLAMA_MODEL,
      models: Array.isArray(data.models)
        ? data.models.map((model) => model.name)
        : []
    });
  } catch (error) {
    return res.status(503).json({
      status: "unavailable",
      message:
        error.name === "TimeoutError" ||
        error.name === "AbortError"
          ? "Ollama status request timed out."
          : "Cannot connect to the configured Ollama endpoint."
    });
  } finally {
    clearTimeout(timeout);
  }
});

// Analyze waste
app.post("/api/analyze", async (req, res) => {
  try {
    const item =
      typeof req.body?.item === "string"
        ? req.body.item.trim()
        : "";

    if (!item) {
      return res.status(400).json({
        message: "Please provide a waste item."
      });
    }

    if (item.length > 500) {
      return res.status(400).json({
        message:
          "The waste description must be 500 characters or fewer."
      });
    }

    if (IS_CLOUD && !OLLAMA_API_KEY) {
      return res.status(503).json({
        message:
          "Cloud mode requires an OLLAMA_API_KEY environment variable."
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

    const answer = result.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      console.error("Unexpected Ollama response:", result);

      return res.status(502).json({
        message:
          "The AI returned an empty response. Please try again."
      });
    }

    const labels = [
      "ITEM",
      "CATEGORY",
      "RECOMMENDED ACTION",
      "WHY IT MATTERS",
      "ECO TIP"
    ];

    function extract(label) {
      const index = labels.indexOf(label);

      const startRegex = new RegExp(
        `(?:^|\\n)\\s*${label.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}\\s*:\\s*`,
        "i"
      );

      const match = startRegex.exec(answer);

      if (!match) return "";

      const start = match.index + match[0].length;

      const nextHeadings = labels
        .slice(index + 1)
        .map((entry) =>
          entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
        .join("|");

      if (!nextHeadings) {
        return answer.slice(start).trim();
      }

      const nextRegex = new RegExp(
        `\\n\\s*(?:${nextHeadings})\\s*:`,
        "i"
      );

      const rest = answer.slice(start);
      const next = nextRegex.exec(rest);

      return (
        next ? rest.slice(0, next.index) : rest
      ).trim();
    }

    const category = extract("CATEGORY") || "Other";

    return res.json({
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

      response: answer.trim(),
      model: OLLAMA_MODEL
    });
  } catch (error) {
    console.error(
      "EcoSort AI analysis error:",
      error.message
    );

    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError"
    ) {
      return res.status(504).json({
        message:
          "The AI request timed out. Please try again."
      });
    }

    if (error.status === 401 || error.status === 403) {
      return res.status(502).json({
        message:
          "Ollama authentication failed. Check your API key."
      });
    }

    if (error.status === 404) {
      return res.status(502).json({
        message:
          "The Ollama endpoint or model was not found. Check your Ollama URL and model name."
      });
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.cause?.code === "ECONNREFUSED"
    ) {
      return res.status(503).json({
        message:
          "Cannot connect to Ollama. Start Ollama and check the configured URL."
      });
    }

    return res.status(502).json({
      message:
        "AI analysis failed. Check the Ollama connection and try again."
    });
  }
});

// Unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    message:
      `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// Express 5 fallback route
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }

  return res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (error) => {
      if (error && !res.headersSent) {
        res.status(500).send(
          "Could not load the EcoSort AI frontend."
        );
      }
    }
  );
});

// Final error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    message: "An unexpected server error occurred."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `EcoSort AI server listening on port ${PORT}`
  );

  console.log(`Ollama mode: ${OLLAMA_MODE}`);
  console.log(`Ollama model: ${OLLAMA_MODEL}`);

  if (!IS_CLOUD) {
    console.log(`Ollama URL: ${OLLAMA_URL}`);
  }
});