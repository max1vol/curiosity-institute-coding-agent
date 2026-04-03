import { generateText } from "@ljoukov/llm";

export const MODEL = "gpt-5.4";
export const REASONING_EFFORT = "high";
export const MANAGER_MODEL = "gpt-5.4-mini";
export const MANAGER_REASONING_EFFORT = "medium";
export const WORKER_MODEL = "gpt-5.4-mini";
export const WORKER_REASONING_EFFORT = "medium";
export const MANAGER_AGENT = {
  key: "manager",
  name: "Manager GPT",
  role: "Steer and brief the worker leads"
};
export const BRANCH_WORKERS = [
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
export const WORKER_SUBAGENTS = [
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

const MAX_MESSAGES = 24;
const OPENAI_TIMEOUT_MS = 45000;
const ORCHESTRATION_STRATEGY = "manager-worker-subagents-v3";
const WEB_SEARCH_TOOLS = [{ type: "web-search", mode: "live" }];
const BASE_ASSISTANT_INSTRUCTIONS =
  "You are a practical coding assistant for the Curiosity Institute. Be clear, concise, and concrete.";

export function normalizeMessages(value) {
  if (!Array.isArray(value)) {
    throw new Error("Expected `messages` to be an array.");
  }

  const normalized = value
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content.trim() : ""
    }))
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") && message.content.length > 0
    )
    .slice(-MAX_MESSAGES);

  if (normalized.length === 0) {
    throw new Error("At least one non-empty message is required.");
  }

  return normalized;
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

function toThinkingLevel(reasoningEffort) {
  switch (reasoningEffort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    default:
      return "high";
  }
}

async function callOpenAiTextWithProfile(openAiApiKey, model, reasoningEffort, instructions, messages) {
  if (openAiApiKey && process.env.OPENAI_API_KEY !== openAiApiKey) {
    process.env.OPENAI_API_KEY = openAiApiKey;
  }

  try {
    const result = await generateText({
      model,
      instructions,
      input: messages,
      thinkingLevel: toThinkingLevel(reasoningEffort),
      tools: WEB_SEARCH_TOOLS,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
    });
    const reply = sanitizeText(result.text);

    if (result.blocked) {
      return {
        ok: false,
        status: 502,
        payload: {
          error: "The model blocked the request."
        }
      };
    }

    if (!reply) {
      return {
        ok: false,
        status: 502,
        payload: {
          error: "The model returned no assistant text."
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
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";

    return {
      ok: false,
      status: 502,
      payload: {
        error:
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "OpenAI API request timed out."
            : details || "OpenAI API request failed.",
        details
      }
    };
  }
}

async function callOpenAiText(openAiApiKey, instructions, messages) {
  return callOpenAiTextWithProfile(
    openAiApiKey,
    MODEL,
    REASONING_EFFORT,
    instructions,
    messages
  );
}

function createDefaultManagerPlan() {
  return {
    name: MANAGER_AGENT.name,
    model: MANAGER_MODEL,
    reasoningEffort: MANAGER_REASONING_EFFORT,
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
    model: MANAGER_MODEL,
    reasoningEffort: MANAGER_REASONING_EFFORT,
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
    "    {",
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
  const result = await callOpenAiTextWithProfile(
    openAiApiKey,
    MANAGER_MODEL,
    MANAGER_REASONING_EFFORT,
    createManagerInstructions(),
    messages
  );

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

function createWorkerLeadInstructions(worker, assignment, managerPlan) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${worker.name}.`,
    `Specialization: ${worker.role}.`,
    `Manager steering summary: ${managerPlan.brief}`,
    formatManagerAssignment(assignment),
    worker.prompt,
    "You supervise the following internal subagents:",
    ...WORKER_SUBAGENTS.map((subagent) => `- ${subagent.key}: ${subagent.name} (${subagent.role})`),
    ...WORKER_SUBAGENTS.map((subagent) => `  ${subagent.name} brief: ${subagent.prompt}`),
    "Have those subagents do their internal work, then synthesize them into your branch result.",
    "Keep the subagent outputs and the branch output compact so the overall request stays responsive.",
    "Return JSON only with this exact shape:",
    "{",
    '  "subagents": [',
    "    {",
    '      "key": "pathfinder",',
    '      "name": "Pathfinder Subagent",',
    '      "role": "Push toward the strongest useful angle",',
    '      "output": "what this subagent found"',
    "    }",
    "  ],",
    '  "branch_output": "the synthesized worker result"',
    "}",
    "Include every listed subagent exactly once."
  ].join("\n\n");
}

function normalizeWorkerSubagents(rawSubagents) {
  const items = Array.isArray(rawSubagents) ? rawSubagents : [];

  return WORKER_SUBAGENTS.map((subagent) => {
    const planned = items.find((item) => item && item.key === subagent.key) || {};
    const output = sanitizeText(planned.output);

    return {
      key: subagent.key,
      name: subagent.name,
      role: subagent.role,
      status: output ? "completed" : "missing",
      output: output || "No explicit subagent output was returned."
    };
  });
}

async function requestBranchReply(openAiApiKey, messages, worker, assignment, managerPlan) {
  const synthesisResult = await callOpenAiTextWithProfile(
    openAiApiKey,
    WORKER_MODEL,
    WORKER_REASONING_EFFORT,
    createWorkerLeadInstructions(worker, assignment, managerPlan),
    messages
  );

  if (!synthesisResult.ok) {
    return {
      key: worker.key,
      name: worker.name,
      role: worker.role,
      task: assignment.task,
      objective: assignment.objective,
      priority: assignment.priority,
      watchouts: assignment.watchouts,
      model: WORKER_MODEL,
      reasoningEffort: WORKER_REASONING_EFFORT,
      status: "error",
      output: synthesisResult.payload.error,
      error: synthesisResult.payload.error,
      subagents: normalizeWorkerSubagents([])
    };
  }

  const parsed = extractJsonObject(synthesisResult.payload.reply);
  const subagents = normalizeWorkerSubagents(parsed?.subagents);
  const branchOutput = sanitizeText(parsed?.branch_output) || synthesisResult.payload.reply;

  return {
    key: worker.key,
    name: worker.name,
    role: worker.role,
    task: assignment.task,
    objective: assignment.objective,
    priority: assignment.priority,
    watchouts: assignment.watchouts,
    model: WORKER_MODEL,
    reasoningEffort: WORKER_REASONING_EFFORT,
    status: "completed",
    output: branchOutput,
    subagents
  };
}

function formatBranchOutputs(branches) {
  return branches
    .map((branch, index) =>
      [
        `Worker ${index + 1}: ${branch.name}`,
        `Role: ${branch.role}`,
        `Task: ${branch.task}`,
        `Priority: ${branch.priority}`,
        `Status: ${branch.status}`,
        branch.output
      ].join("\n")
    )
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
    "Return plain assistant text, not JSON, unless the user explicitly asked for JSON.",
    "If the user asked for an exact literal string or token, return that literal output exactly.",
    "Resolve conflicts where possible and mention uncertainty only when it materially affects the answer.",
    "Do not mention the internal manager/worker/subagent process unless the user explicitly asked for it."
  ].join("\n\n");
}

export async function requestReply(openAiApiKey, messages) {
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
      model: WORKER_MODEL,
      reasoningEffort: WORKER_REASONING_EFFORT,
      status: "error",
      output: "Worker execution failed.",
      error: result.reason instanceof Error ? result.reason.message : "Worker execution failed.",
      subagents: []
    };
  });

  const usableBranches = branches.filter(
    (branch) => branch.status === "completed" || branch.status === "partial"
  );

  const assembly = {
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    strategy: ORCHESTRATION_STRATEGY
  };

  if (usableBranches.length === 0) {
    return {
      ok: false,
      status: 502,
      payload: {
        error: "All manager-directed worker branches failed.",
        manager: managerPlan,
        branches,
        assembly
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
        assembly
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
      assembly
    }
  };
}
