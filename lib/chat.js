const fsSync = require("node:fs");
const path = require("node:path");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.4";
const REASONING_EFFORT = "xhigh";
const MAX_BODY_SIZE = 1_000_000;
const MAX_MESSAGES = 24;

function loadDotEnv(baseDir) {
  const envPath = path.join(baseDir, ".env");

  if (!fsSync.existsSync(envPath)) {
    return;
  }

  const source = fsSync.readFileSync(envPath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(statusCode).json(payload);
    return;
  }

  res.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(body);
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  if (typeof req.body === "string") {
    return req.body;
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) {
    throw new Error("Expected `messages` to be an array.");
  }

  const normalized = value
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content.trim() : ""
    }))
    .filter((message) => {
      return (
        (message.role === "user" || message.role === "assistant") &&
        message.content.length > 0
      );
    })
    .slice(-MAX_MESSAGES);

  if (normalized.length === 0) {
    throw new Error("At least one non-empty message is required.");
  }

  return normalized;
}

function toResponsesInput(messages) {
  return messages.map((message) => ({
    type: "message",
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content
      }
    ]
  }));
}

function extractReply(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  const parts = [];

  for (const item of response.output) {
    if (item?.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }

      if (content?.type === "refusal" && typeof content.refusal === "string") {
        parts.push(content.refusal);
      }
    }
  }

  return parts.join("\n").trim();
}

async function requestReply(messages) {
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (!openAiApiKey) {
    return {
      ok: false,
      status: 500,
      payload: {
        error: "OPENAI_API_KEY is not set. Add it to your environment before using the chat."
      }
    };
  }

  let upstream;
  try {
    upstream = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning: {
          effort: REASONING_EFFORT
        },
        instructions:
          "You are a practical coding assistant for the Curiosity Institute. Be clear, concise, and concrete.",
        input: toResponsesInput(messages)
      })
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "Failed to reach the OpenAI API.",
        details: error.message
      }
    };
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "OpenAI API returned an unreadable response."
      }
    };
  }

  if (!upstream.ok) {
    return {
      ok: false,
      status: upstream.status,
      payload: {
        error: payload?.error?.message || "OpenAI API request failed."
      }
    };
  }

  const reply = extractReply(payload);
  if (!reply) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "OpenAI API returned no assistant text."
      }
    };
  }

  return {
    ok: true,
    status: 200,
    payload: {
      reply,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT
    }
  };
}

async function handleChatRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  let parsed;
  try {
    const body = await readRequestBody(req);
    parsed = body ? JSON.parse(body) : {};
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON request body." });
    return;
  }

  let messages;
  try {
    messages = normalizeMessages(parsed.messages);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const result = await requestReply(messages);
  sendJson(res, result.status, result.payload);
}

module.exports = {
  MODEL,
  REASONING_EFFORT,
  handleChatRequest,
  loadDotEnv
};
