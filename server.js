
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OLLAMA_MODEL || "gemma4:e2b";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", app: "EcoSort AI", model: MODEL });
});

app.post("/api/classify", async (req, res) => {
  try {
    const waste = String(req.body?.waste || "").trim();

    if (!waste) {
      return res.status(400).json({ error: "Describe the waste first." });
    }

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: "system",
            content: `You are EcoSort AI, a waste sorting assistant.
Reply in simple English using these headings:
Category:
Bin or disposal:
Can it be recycled:
Safety:
Reuse idea:
Be concise. If unsure, say so. Never claim visual identification from text alone. Warn users not to handle unknown chemicals, batteries, sharp objects, or medical waste without proper guidance.`
          },
          { role: "user", content: waste.slice(0, 2000) }
        ]
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: data.error || "AI provider request failed."
      });
    }

    res.json({ answer: data.message?.content || "", model: MODEL });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Could not reach Ollama. Check that Ollama is running."
    });
  }
});

app.listen(PORT, () => {
  console.log(`EcoSort AI running on port ${PORT}`);
});
