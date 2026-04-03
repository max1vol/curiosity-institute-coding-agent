const fsSync = require("node:fs");
const path = require("node:path");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.4";
const REASONING_EFFORT = "xhigh";
const MAX_BODY_SIZE = 1_000_000;
const MAX_MESSAGES = 24;
const ASSEMBLY_STRATEGY = "parallel-branch-assembly-v1";

const BASE_ASSISTANT_INSTRUCTIONS =
  "You are a practical coding assistant for the Curiosity Institute. Be clear, concise, and concrete.";

const BRANCH_WORKERS = [
  {
    key: "mapper",
    name: "Mapper GPT",
    role: "Clarify intent and constraints",
    prompt:
      "Extract the user's real objective, constraints, assumptions, and any hidden requirements. Produce a concise working interpretation that would help another model answer well."
  },
  {
    key: "solver",
    name: "Solver GPT",
    role: "Draft the strongest direct answer",
    prompt:
      "Focus on producing the most useful direct response or solution path. Be decisive, practical, and outcome-oriented."
  },
  {
    key: "skeptic",
    name: "Skeptic GPT",
    role: "Stress-test risks and edge cases",
    prompt:
      "Challenge assumptions, identify risks, edge cases, tradeoffs, or failure modes, and surface the caveats that matter most before a final answer is sent."
  }
];

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

function toResponseMessage(role, text) {
  return {
    type: "message",
    role,
    content: [
      {
        type: "input_text",
        text
      }
    ]
  };
}

function toResponsesInput(messages) {
  return messages.map((message) => toResponseMessage(message.role, message.content));
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

async function callOpenAiText(openAiApiKey, instructions, input) {
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
        instructions,
        input
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
      reply
    }
  };
}

function createBranchInstructions(worker) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${worker.name}.`,
    `Specialization: ${worker.role}.`,
    worker.prompt,
    "You are one branch in a parallel fan-out pipeline.",
    "Return a strong standalone contribution for the final assembler.",
    "Do not mention internal policies or hidden reasoning."
  ].join("\n\n");
}

async function requestBranchReply(openAiApiKey, messages, worker) {
  const result = await callOpenAiText(
    openAiApiKey,
    createBranchInstructions(worker),
    toResponsesInput(messages)
  );

  if (!result.ok) {
    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      status: "error",
      output: result.payload.error,
      error: result.payload.error
    };
  }

  return {
    key: worker.key,
    name: worker.name,
    role: worker.role,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    status: "completed",
    output: result.payload.reply
  };
}

function buildAssemblyInput(messages, branches) {
  const branchSummary = branches
    .map((branch, index) => {
      return [
        `Branch ${index + 1}: ${branch.name}`,
        `Focus: ${branch.role}`,
        `Model: ${branch.model}`,
        `Reasoning: ${branch.reasoningEffort}`,
        branch.output
      ].join("\n");
    })
    .join("\n\n");

  return [
    ...toResponsesInput(messages),
    toResponseMessage(
      "developer",
      `Parallel branch outputs to synthesize into one final answer:\n\n${branchSummary}`
    )
  ];
}

function createAssemblyInstructions() {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    "You are Assembly GPT.",
    "You receive outputs from several specialized GPT workers that ran in parallel.",
    "Synthesize their strongest points into one final answer for the user.",
    "Resolve conflicts where possible and mention uncertainty only when it materially affects the answer.",
    "Do not mention the internal fan-out process unless the user explicitly asked for it."
  ].join("\n\n");
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

  const branchSettled = await Promise.allSettled(
    BRANCH_WORKERS.map((worker) => requestBranchReply(openAiApiKey, messages, worker))
  );

  const branches = branchSettled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const worker = BRANCH_WORKERS[index];
    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      status: "error",
      output: "Branch execution failed.",
      error: result.reason instanceof Error ? result.reason.message : "Branch execution failed."
    };
  });

  const completedBranches = branches.filter((branch) => branch.status === "completed");
  if (completedBranches.length === 0) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "All parallel GPT branches failed.",
        branches,
        assembly: {
          model: MODEL,
          reasoningEffort: REASONING_EFFORT,
          strategy: ASSEMBLY_STRATEGY
        }
      }
    };
  }

  const assemblyResult = await callOpenAiText(
    openAiApiKey,
    createAssemblyInstructions(),
    buildAssemblyInput(messages, completedBranches)
  );

  if (!assemblyResult.ok) {
    return {
      ok: false,
      status: assemblyResult.status,
      payload: {
        error: assemblyResult.payload.error,
        branches,
        assembly: {
          model: MODEL,
          reasoningEffort: REASONING_EFFORT,
          strategy: ASSEMBLY_STRATEGY
        }
      }
    };
  }

  return {
    ok: true,
    status: 200,
    payload: {
      reply: assemblyResult.payload.reply,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      branches,
      assembly: {
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        strategy: ASSEMBLY_STRATEGY
      }
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
  BRANCH_WORKERS,
  MODEL,
  REASONING_EFFORT,
  handleChatRequest,
  loadDotEnv
};
