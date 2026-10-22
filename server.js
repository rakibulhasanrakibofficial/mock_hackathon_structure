
const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

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

// AI waste classification
app.post("/api/classify", async (req, res) => {
  const waste = String(req.body?.waste || "").trim();

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

  const systemPrompt = `
You are EcoSort AI, an accurate and practical waste sorting assistant.

Analyze the waste item described by the user.

Return your answer using exactly these headings:

CATEGORY
Identify the likely waste category and explain briefly why.

DISPOSAL
Give clear, practical instructions for disposing of the item.

RECYCLING
Explain whether it may be recyclable, how to prepare it,
and mention that recycling rules vary by location.

SAFETY
Mention relevant hazards and precautions.

REUSE IDEA
Suggest one realistic reuse idea if appropriate.

IMPORTANT RULES:
- Use simple, clear English.
- Be specific to the described item.
- Keep the answer concise, ideally 100-160 words.
- Never invent local recycling rules.
- Do not claim an item is recyclable everywhere.
- If the material is uncertain, clearly state the uncertainty.
- Explain when different parts of an item need different disposal methods.
- Never recommend opening, dismantling, or handling leaking batteries,
  unknown chemicals, medical waste, or hazardous sharp objects.
- Give safe alternatives for hazardous waste.
- Avoid generic introductions and repeated information.
`;

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: "10m",
        options: {
          temperature: 0.2,
          num_predict: 300
        },
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Analyze this waste item: ${waste}`
          }
        ]
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Ollama API error:", data.error || response.status);

      return res.status(502).json({
        error: data.error || "The AI service request failed."
      });
    }

    const answer = data.message?.content?.trim();

    if (!answer) {
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

    if (error.name === "TimeoutError" ||
        error.name === "AbortError") {
      return res.status(504).json({
        error: "AI response timed out. Please try again."
      });
    }

    return res.status(503).json({
      error: "Cannot connect to Ollama. Make sure Ollama is running."
    });
  }
});

// Handle unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌿 EcoSort AI running at http://localhost:${PORT}`);
  console.log(`🤖 AI model: ${MODEL}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_URL}`);
});
