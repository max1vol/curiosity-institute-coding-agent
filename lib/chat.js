const fsSync = require("node:fs");
const path = require("node:path");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.4";
const REASONING_EFFORT = "xhigh";
const MAX_BODY_SIZE = 1_000_000;
const MAX_MESSAGES = 24;
const ORCHESTRATION_STRATEGY = "manager-worker-subagents-v2";

const BASE_ASSISTANT_INSTRUCTIONS =
  "You are a practical coding assistant for the Curiosity Institute. Be clear, concise, and concrete.";

const MANAGER_AGENT = {
  key: "manager",
  name: "Manager GPT",
  role: "Steer and brief the worker leads"
};

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

const WORKER_SUBAGENTS = [
  {
    key: "pathfinder",
    name: "Pathfinder Subagent",
    role: "Push toward the strongest useful angle",
    prompt:
      "Find the strongest path for this worker: key interpretations, solution angles, or decisive moves that materially improve the branch result."
  },
  {
    key: "auditor",
    name: "Auditor Subagent",
    role: "Probe risks and weak assumptions",
    prompt:
      "Stress-test the worker task by highlighting weak assumptions, conflicts, missing constraints, or risks that the worker lead should account for."
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

function sanitizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractJsonObject(text) {
  if (typeof text !== "string") {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callOpenAiText(openAiApiKey, instructions, messages) {
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
  } catch {
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

function createDefaultManagerPlan() {
  return {
    name: MANAGER_AGENT.name,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    strategy: ORCHESTRATION_STRATEGY,
    brief: "Coordinate specialized worker subagents, then merge the strongest branch results.",
    workers: BRANCH_WORKERS.map((worker, index) => ({
      key: worker.key,
      name: worker.name,
      role: worker.role,
      objective: worker.role,
      task: worker.prompt,
      watchouts: "Stay concrete and avoid unnecessary speculation.",
      priority: index + 1
    }))
  };
}

function normalizeManagerPlan(rawPlan) {
  const defaultPlan = createDefaultManagerPlan();
  const rawWorkers = Array.isArray(rawPlan?.workers) ? rawPlan.workers : [];

  const workers = BRANCH_WORKERS.map((worker, index) => {
    const planned = rawWorkers.find((item) => item && item.key === worker.key) || {};
    const fallback = defaultPlan.workers[index];

    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      objective: sanitizeText(planned.objective) || fallback.objective,
      task: sanitizeText(planned.task) || fallback.task,
      watchouts: sanitizeText(planned.watchouts) || fallback.watchouts,
      priority:
        Number.isFinite(Number(planned.priority)) && Number(planned.priority) > 0
          ? Number(planned.priority)
          : fallback.priority
    };
  });

  return {
    name: MANAGER_AGENT.name,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    strategy: ORCHESTRATION_STRATEGY,
    brief: sanitizeText(rawPlan?.summary) || defaultPlan.brief,
    workers
  };
}

function createManagerInstructions() {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${MANAGER_AGENT.name}.`,
    "You must steer the worker leads and assign precise briefs before they run.",
    "The worker leads are:",
    ...BRANCH_WORKERS.map((worker) => `- ${worker.key}: ${worker.name} (${worker.role})`),
    "Return JSON only with this exact shape:",
    "{",
    '  "summary": "short steering summary",',
    '  "workers": [',
    '    {',
    '      "key": "mapper",',
    '      "objective": "what this worker should optimize for",',
    '      "task": "specific brief from the manager",',
    '      "watchouts": "important risk or constraint",',
    '      "priority": 1',
    "    }",
    "  ]",
    "}",
    "Every listed worker key must appear exactly once."
  ].join("\n");
}

async function requestManagerPlan(openAiApiKey, messages) {
  const result = await callOpenAiText(openAiApiKey, createManagerInstructions(), messages);

  if (!result.ok) {
    const fallback = createDefaultManagerPlan();
    fallback.brief = `${fallback.brief} Manager call failed, so default briefs were used.`;
    return fallback;
  }

  const parsed = extractJsonObject(result.payload.reply);
  return normalizeManagerPlan(parsed);
}

function formatManagerAssignment(assignment) {
  return [
    `Manager objective: ${assignment.objective}`,
    `Manager task: ${assignment.task}`,
    `Priority: ${assignment.priority}`,
    `Watchouts: ${assignment.watchouts}`
  ].join("\n");
}

function createSubagentInstructions(worker, assignment, subagent, managerPlan) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${subagent.name}, a subagent supporting ${worker.name}.`,
    `Manager steering summary: ${managerPlan.brief}`,
    `Worker role: ${worker.role}`,
    formatManagerAssignment(assignment),
    subagent.prompt,
    "Return a compact contribution that the worker lead can synthesize.",
    "Do not mention internal orchestration or say you are a subagent."
  ].join("\n\n");
}

async function requestWorkerSubagentReply(openAiApiKey, messages, worker, assignment, subagent, managerPlan) {
  const result = await callOpenAiText(
    openAiApiKey,
    createSubagentInstructions(worker, assignment, subagent, managerPlan),
    messages
  );

  if (!result.ok) {
    return {
      key: subagent.key,
      name: subagent.name,
      role: subagent.role,
      status: "error",
      output: result.payload.error,
      error: result.payload.error
    };
  }

  return {
    key: subagent.key,
    name: subagent.name,
    role: subagent.role,
    status: "completed",
    output: result.payload.reply
  };
}

function formatSubagentOutputs(subagents) {
  return subagents
    .map((subagent, index) => {
      return [
        `Subagent ${index + 1}: ${subagent.name}`,
        `Role: ${subagent.role}`,
        `Status: ${subagent.status}`,
        subagent.output
      ].join("\n");
    })
    .join("\n\n");
}

function createWorkerLeadInstructions(worker, assignment, managerPlan, subagents) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${worker.name}.`,
    `Specialization: ${worker.role}.`,
    `Manager steering summary: ${managerPlan.brief}`,
    formatManagerAssignment(assignment),
    worker.prompt,
    "You supervise worker subagents and must synthesize their contributions into your branch result.",
    `Subagent outputs:\n\n${formatSubagentOutputs(subagents)}`,
    "Return only the branch result for the final assembly step."
  ].join("\n\n");
}

async function requestBranchReply(openAiApiKey, messages, worker, assignment, managerPlan) {
  const subagentSettled = await Promise.allSettled(
    WORKER_SUBAGENTS.map((subagent) =>
      requestWorkerSubagentReply(openAiApiKey, messages, worker, assignment, subagent, managerPlan)
    )
  );

  const subagents = subagentSettled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const subagent = WORKER_SUBAGENTS[index];
    return {
      key: subagent.key,
      name: subagent.name,
      role: subagent.role,
      status: "error",
      output: "Subagent execution failed.",
      error: result.reason instanceof Error ? result.reason.message : "Subagent execution failed."
    };
  });

  const synthesisResult = await callOpenAiText(
    openAiApiKey,
    createWorkerLeadInstructions(worker, assignment, managerPlan, subagents),
    messages
  );

  if (!synthesisResult.ok) {
    const fallbackOutput = subagents
      .filter((subagent) => subagent.status === "completed")
      .map((subagent) => `${subagent.name}: ${subagent.output}`)
      .join("\n\n")
      .trim();

    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      task: assignment.task,
      objective: assignment.objective,
      priority: assignment.priority,
      watchouts: assignment.watchouts,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      status: fallbackOutput ? "partial" : "error",
      output: fallbackOutput || synthesisResult.payload.error,
      error: synthesisResult.payload.error,
      subagents
    };
  }

  return {
    key: worker.key,
    name: worker.name,
    role: worker.role,
    task: assignment.task,
    objective: assignment.objective,
    priority: assignment.priority,
    watchouts: assignment.watchouts,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    status: "completed",
    output: synthesisResult.payload.reply,
    subagents
  };
}

function formatBranchOutputs(branches) {
  return branches
    .map((branch, index) => {
      return [
        `Worker ${index + 1}: ${branch.name}`,
        `Role: ${branch.role}`,
        `Task: ${branch.task}`,
        `Priority: ${branch.priority}`,
        `Status: ${branch.status}`,
        branch.output
      ].join("\n");
    })
    .join("\n\n");
}

function createAssemblyInstructions(managerPlan, branches) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    "You are Assembly GPT.",
    `Manager steering summary: ${managerPlan.brief}`,
    "You are receiving worker-lead outputs that already synthesize their own subagents.",
    `Worker outputs:\n\n${formatBranchOutputs(branches)}`,
    "Merge the strongest points into one final answer for the user.",
    "Resolve conflicts where possible and mention uncertainty only when it materially affects the answer.",
    "Do not mention the internal manager/worker/subagent process unless the user explicitly asked for it."
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

  const managerPlan = await requestManagerPlan(openAiApiKey, messages);

  const branchSettled = await Promise.allSettled(
    managerPlan.workers.map((assignment, index) =>
      requestBranchReply(openAiApiKey, messages, BRANCH_WORKERS[index], assignment, managerPlan)
    )
  );

  const branches = branchSettled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const worker = BRANCH_WORKERS[index];
    const assignment = managerPlan.workers[index];
    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      task: assignment.task,
      objective: assignment.objective,
      priority: assignment.priority,
      watchouts: assignment.watchouts,
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      status: "error",
      output: "Worker execution failed.",
      error: result.reason instanceof Error ? result.reason.message : "Worker execution failed.",
      subagents: []
    };
  });

  const usableBranches = branches.filter(
    (branch) => branch.status === "completed" || branch.status === "partial"
  );

  if (usableBranches.length === 0) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "All manager-directed worker branches failed.",
        manager: managerPlan,
        branches,
        assembly: {
          model: MODEL,
          reasoningEffort: REASONING_EFFORT,
          strategy: ORCHESTRATION_STRATEGY
        }
      }
    };
  }

  const assemblyResult = await callOpenAiText(
    openAiApiKey,
    createAssemblyInstructions(managerPlan, usableBranches),
    messages
  );

  if (!assemblyResult.ok) {
    return {
      ok: false,
      status: assemblyResult.status,
      payload: {
        error: assemblyResult.payload.error,
        manager: managerPlan,
        branches,
        assembly: {
          model: MODEL,
          reasoningEffort: REASONING_EFFORT,
          strategy: ORCHESTRATION_STRATEGY
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
      manager: managerPlan,
      branches,
      assembly: {
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        strategy: ORCHESTRATION_STRATEGY
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
  } catch {
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
  MANAGER_AGENT,
  BRANCH_WORKERS,
  WORKER_SUBAGENTS,
  MODEL,
  REASONING_EFFORT,
  handleChatRequest,
  loadDotEnv
};
