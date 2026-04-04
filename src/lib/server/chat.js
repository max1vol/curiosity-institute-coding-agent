import { generateText } from "@ljoukov/llm";

export const MODEL = "gpt-5.4";
export const REASONING_EFFORT = "high";
export const MANAGER_MODEL = "gpt-5.4-mini";
export const MANAGER_REASONING_EFFORT = "medium";
export const WORKER_MODEL = "gpt-5.4-mini";
export const WORKER_REASONING_EFFORT = "medium";
export const BRANCH_MODIFIER_MODEL = "gpt-5.4-nano";
export const BRANCH_MODIFIER_REASONING_EFFORT = "low";
export const BRANCH_GRADER_MODEL = "gpt-5.4-nano";
export const BRANCH_GRADER_REASONING_EFFORT = "low";
export const MANAGER_AGENT = {
  key: "manager",
  name: "Manager GPT",
  role: "Steer and brief the worker leads"
};
export const MANAGED_BRANCH_AGENT = {
  key: "managed",
  name: "Managed GPT",
  role: "Answer one adapted branch prompt"
};
export const BRANCH_MODIFIER_AGENT = {
  key: "modifier",
  name: "Branch Modifier GPT",
  role: "Adapt one branch prompt before a managed run"
};
export const BRANCH_GRADER_AGENT = {
  key: "grader",
  name: "Branch Grader GPT",
  role: "Pick the stronger branch candidate in a pair"
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
const MAX_CONTEXT_MESSAGES = 6;
const MAX_CONTEXT_CHARS = 320;
const OPENAI_TIMEOUT_MS = 45000;
const INTERNAL_STAGE_TIMEOUT_MS = 20000;
const BRANCH_MODIFIER_LIMIT = 8;
const TARGET_USABLE_BRANCH_CANDIDATES = 3;
const ORCHESTRATION_STRATEGY = "manager-modifier-managed-grader-v4";
const WEB_SEARCH_TOOLS = [{ type: "web-search", mode: "live" }];
const NO_TOOLS = [];
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

function truncateText(value, maxLength = MAX_CONTEXT_CHARS) {
  const text = sanitizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function formatCompactConversationContext(messages) {
  return messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message, index) => `Message ${index + 1} [${message.role}]: ${truncateText(message.content)}`)
    .join("\n");
}

async function callOpenAiTextWithProfile(
  openAiApiKey,
  model,
  reasoningEffort,
  instructions,
  messages,
  tools = WEB_SEARCH_TOOLS,
  timeoutMs = OPENAI_TIMEOUT_MS
) {
  if (!process.env.OPENAI_API_KEY && openAiApiKey) {
    process.env.OPENAI_API_KEY = openAiApiKey;
  }

  try {
    const request = {
      model,
      instructions,
      input: messages,
      thinkingLevel: toThinkingLevel(reasoningEffort),
      signal: AbortSignal.timeout(timeoutMs)
    };

    if (Array.isArray(tools) && tools.length > 0) {
      request.tools = tools;
    }

    const result = await generateText(request);
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

async function callOpenAiText(openAiApiKey, instructions, messages, tools = WEB_SEARCH_TOOLS) {
  return callOpenAiTextWithProfile(
    openAiApiKey,
    MODEL,
    REASONING_EFFORT,
    instructions,
    messages,
    tools,
    OPENAI_TIMEOUT_MS
  );
}

function createDefaultManagerPlan() {
  return {
    name: MANAGER_AGENT.name,
    model: MANAGER_MODEL,
    reasoningEffort: MANAGER_REASONING_EFFORT,
    strategy: ORCHESTRATION_STRATEGY,
    brief:
      "Coordinate specialized worker leads, let each branch modifier evolve candidates, then assemble the strongest branch winners.",
    workers: BRANCH_WORKERS.map((worker, index) => ({
      key: worker.key,
      name: worker.name,
      role: worker.role,
      objective: worker.role,
      task: worker.prompt,
      watchouts: "Stay concrete and avoid unnecessary speculation.",
      priority: index + 1,
      successCriteria: "Produce a concise, useful branch result that clearly helps answer the user.",
      graderCriteria:
        "Prefer candidates that are clearer, more directly useful, and more faithful to the branch objective and watchouts.",
      modifierSeed: "Sharpen the branch task without drifting away from the original objective."
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
          : fallback.priority,
      successCriteria: sanitizeText(planned.success_criteria) || fallback.successCriteria,
      graderCriteria: sanitizeText(planned.grader_criteria) || fallback.graderCriteria,
      modifierSeed: sanitizeText(planned.modifier_seed) || fallback.modifierSeed
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
    "Each branch will later be evolved by a branch modifier, answered by a managed GPT, and reduced by a pairwise grader.",
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
    '      "priority": 1,',
    '      "success_criteria": "how this branch will be judged",',
    '      "grader_criteria": "how a pairwise grader should choose between branch candidates",',
    '      "modifier_seed": "how the branch modifier should start adapting the branch task"',
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
    messages,
    NO_TOOLS,
    INTERNAL_STAGE_TIMEOUT_MS
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
    `Success criteria: ${assignment.successCriteria}`,
    `Grader criteria: ${assignment.graderCriteria}`,
    `Modifier seed: ${assignment.modifierSeed}`,
    `Priority: ${assignment.priority}`,
    `Watchouts: ${assignment.watchouts}`
  ].join("\n");
}

function formatPriorAttemptsForModifier(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "No prior branch candidates yet.";
  }

  return candidates
    .slice(-4)
    .map((candidate) =>
      [
        `Attempt ${candidate.attempt}`,
        `Status: ${candidate.status}`,
        `Modifier summary: ${candidate.modifier.summary}`,
        `Output: ${truncateText(candidate.output, 220)}`
      ].join("\n")
    )
    .join("\n\n");
}

function createBranchModifierInstructions(worker, assignment, managerPlan, candidates, attempt) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${BRANCH_MODIFIER_AGENT.name}.`,
    `Branch: ${worker.name} (${worker.role}).`,
    `Attempt ${attempt} of ${BRANCH_MODIFIER_LIMIT}.`,
    `Manager steering summary: ${managerPlan.brief}`,
    formatManagerAssignment(assignment),
    "You adapt one branch prompt before it is sent to Managed GPT.",
    "Look at the compact conversation context and prior attempts, then produce the next adapted task.",
    "Stop adapting when another pass is unlikely to improve the branch result materially.",
    "Return JSON only with this exact shape:",
    "{",
    '  "summary": "short note about what changed or why no change is needed",',
    '  "adapted_task": "the exact task to hand to Managed GPT next",',
    '  "changed": true,',
    '  "stop": false',
    "}",
    "If the branch is already strong enough, set stop to true."
  ].join("\n\n");
}

function normalizeModifierPlan(rawModifier, assignment, candidates, attempt) {
  const previousTask = candidates.at(-1)?.modifier?.adaptedTask || assignment.task;
  const adaptedTask = sanitizeText(rawModifier?.adapted_task) || previousTask;
  const summary =
    sanitizeText(rawModifier?.summary) ||
    (attempt === 1 ? "Started from the manager's branch task." : "Reused the strongest prior task.");
  const changed =
    typeof rawModifier?.changed === "boolean" ? rawModifier.changed : adaptedTask !== previousTask;
  const stop = Boolean(rawModifier?.stop) && candidates.length > 0;

  return {
    summary,
    adaptedTask,
    changed: attempt === 1 ? true : changed,
    stop
  };
}

async function requestBranchModifier(openAiApiKey, messages, worker, assignment, managerPlan, candidates, attempt) {
  const modifierInput = [
    {
      role: "user",
      content: [
        `Conversation context:\n${formatCompactConversationContext(messages)}`,
        `Prior attempts:\n${formatPriorAttemptsForModifier(candidates)}`
      ].join("\n\n")
    }
  ];

  const result = await callOpenAiTextWithProfile(
    openAiApiKey,
    BRANCH_MODIFIER_MODEL,
    BRANCH_MODIFIER_REASONING_EFFORT,
    createBranchModifierInstructions(worker, assignment, managerPlan, candidates, attempt),
    modifierInput,
    NO_TOOLS,
    INTERNAL_STAGE_TIMEOUT_MS
  );

  if (!result.ok) {
    return normalizeModifierPlan(null, assignment, candidates, attempt);
  }

  const parsed = extractJsonObject(result.payload.reply);
  return normalizeModifierPlan(parsed, assignment, candidates, attempt);
}

function createManagedBranchInstructions(worker, assignment, managerPlan, modifierPlan, attempt) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${MANAGED_BRANCH_AGENT.name} supporting ${worker.name}.`,
    `Specialization: ${worker.role}.`,
    `Branch attempt ${attempt} of ${BRANCH_MODIFIER_LIMIT}.`,
    `Manager steering summary: ${managerPlan.brief}`,
    formatManagerAssignment(assignment),
    `Modifier summary: ${modifierPlan.summary}`,
    `Adapted task: ${modifierPlan.adaptedTask}`,
    worker.prompt,
    "You supervise the following internal subagents:",
    ...WORKER_SUBAGENTS.map((subagent) => `- ${subagent.key}: ${subagent.name} (${subagent.role})`),
    ...WORKER_SUBAGENTS.map((subagent) => `  ${subagent.name} brief: ${subagent.prompt}`),
    "Have those subagents do their internal work, then synthesize one branch candidate.",
    "Keep the subagent outputs and the branch output compact and useful.",
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
    '  "branch_output": "the synthesized worker result",',
    '  "done": false,',
    '  "done_reason": "short reason if no more adaptation is likely to help"',
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

function parseManagedBranchPayload(reply) {
  const parsed = extractJsonObject(reply);
  const fallbackOutput = sanitizeText(reply);

  if (!parsed || typeof parsed !== "object") {
    return {
      status: fallbackOutput ? "partial" : "error",
      output: fallbackOutput || "Managed GPT returned no usable text.",
      error: "Managed GPT returned unstructured output.",
      subagents: normalizeWorkerSubagents([]),
      done: false,
      doneReason: "Managed GPT returned unstructured output."
    };
  }

  const subagents = normalizeWorkerSubagents(parsed.subagents);
  const branchOutput = sanitizeText(parsed.branch_output);
  const hasCompletedSubagent = subagents.some((subagent) => subagent.status === "completed");
  const done = Boolean(parsed.done);
  const doneReason = sanitizeText(parsed.done_reason);

  if (!branchOutput) {
    return {
      status: fallbackOutput ? "partial" : "error",
      output: fallbackOutput || "Managed GPT returned no synthesized branch output.",
      error: "Managed GPT omitted branch_output.",
      subagents,
      done,
      doneReason: doneReason || "Managed GPT omitted branch_output."
    };
  }

  return {
    status: hasCompletedSubagent ? "completed" : "partial",
    output: branchOutput,
    error: hasCompletedSubagent ? undefined : "Managed GPT omitted structured subagent outputs.",
    subagents,
    done,
    doneReason
  };
}

async function requestManagedBranchCandidate(
  openAiApiKey,
  messages,
  worker,
  assignment,
  managerPlan,
  modifierPlan,
  attempt
) {
  const result = await callOpenAiTextWithProfile(
    openAiApiKey,
    WORKER_MODEL,
    WORKER_REASONING_EFFORT,
    createManagedBranchInstructions(worker, assignment, managerPlan, modifierPlan, attempt),
    messages,
    NO_TOOLS,
    INTERNAL_STAGE_TIMEOUT_MS
  );

  if (!result.ok) {
    return {
      attempt,
      status: "error",
      output: result.payload.error,
      error: result.payload.error,
      subagents: normalizeWorkerSubagents([]),
      done: false,
      doneReason: result.payload.error,
      modifier: {
        name: BRANCH_MODIFIER_AGENT.name,
        summary: modifierPlan.summary,
        changed: modifierPlan.changed,
        adaptedTask: modifierPlan.adaptedTask
      },
      managed: {
        name: MANAGED_BRANCH_AGENT.name,
        model: WORKER_MODEL,
        reasoningEffort: WORKER_REASONING_EFFORT
      }
    };
  }

  const payload = parseManagedBranchPayload(result.payload.reply);

  return {
    attempt,
    status: payload.status,
    output: payload.output,
    error: payload.error,
    subagents: payload.subagents,
    done: payload.done,
    doneReason: payload.doneReason,
    modifier: {
      name: BRANCH_MODIFIER_AGENT.name,
      summary: modifierPlan.summary,
      changed: modifierPlan.changed,
      adaptedTask: modifierPlan.adaptedTask
    },
    managed: {
      name: MANAGED_BRANCH_AGENT.name,
      model: WORKER_MODEL,
      reasoningEffort: WORKER_REASONING_EFFORT
    }
  };
}

function hasRepeatedBranchOutput(candidates, output) {
  const normalized = sanitizeText(output);
  return Boolean(normalized) && candidates.some((candidate) => sanitizeText(candidate.output) === normalized);
}

async function runManagedBranchCandidates(openAiApiKey, messages, worker, assignment, managerPlan) {
  const candidates = [];
  const modifierAttempts = [];
  let stoppedReason = "Reached the branch modifier adaptation limit.";

  for (let attempt = 1; attempt <= BRANCH_MODIFIER_LIMIT; attempt += 1) {
    const modifierPlan = await requestBranchModifier(
      openAiApiKey,
      messages,
      worker,
      assignment,
      managerPlan,
      candidates,
      attempt
    );

    const modifierAttempt = {
      attempt,
      status: "pending",
      changed: modifierPlan.changed,
      brief: modifierPlan.summary
    };
    modifierAttempts.push(modifierAttempt);

    if (attempt > 1 && modifierPlan.stop) {
      modifierAttempt.status = "stopped";
      stoppedReason = modifierPlan.summary || "Branch modifier stopped adapting the branch task.";
      break;
    }

    const candidate = await requestManagedBranchCandidate(
      openAiApiKey,
      messages,
      worker,
      assignment,
      managerPlan,
      modifierPlan,
      attempt
    );

    modifierAttempt.status = candidate.status;
    const repeatedOutput = hasRepeatedBranchOutput(candidates, candidate.output);
    candidates.push(candidate);
    const usableCandidates = candidates.filter(
      (entry) => entry.status === "completed" || entry.status === "partial"
    );

    if (candidate.done) {
      stoppedReason = candidate.doneReason || "Managed GPT marked this branch as complete.";
      break;
    }

    if (usableCandidates.length >= TARGET_USABLE_BRANCH_CANDIDATES) {
      stoppedReason = "Generated enough branch candidates for pairwise grading.";
      break;
    }

    if (!modifierPlan.changed) {
      stoppedReason = "Branch modifier produced no further prompt changes.";
      break;
    }

    if (repeatedOutput) {
      stoppedReason = "Managed GPT repeated an earlier branch candidate.";
      break;
    }
  }

  if (candidates.length === 0) {
    stoppedReason = "No branch candidates were generated.";
  }

  return {
    candidates,
    modifierAttempts,
    stoppedReason
  };
}

function statusScore(value) {
  if (value === "completed") {
    return 2;
  }

  if (value === "partial") {
    return 1;
  }

  return 0;
}

function countCompletedSubagents(subagents) {
  return (Array.isArray(subagents) ? subagents : []).filter(
    (subagent) => subagent?.status === "completed"
  ).length;
}

function pickFallbackCandidate(leftCandidate, rightCandidate) {
  const scored = [leftCandidate, rightCandidate].sort((left, right) => {
    const statusDelta = statusScore(right.status) - statusScore(left.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const subagentDelta =
      countCompletedSubagents(right.subagents) - countCompletedSubagents(left.subagents);
    if (subagentDelta !== 0) {
      return subagentDelta;
    }

    const outputDelta = sanitizeText(right.output).length - sanitizeText(left.output).length;
    if (outputDelta !== 0) {
      return outputDelta;
    }

    return left.attempt - right.attempt;
  });

  return scored[0];
}

function createBranchGraderInstructions(worker, assignment, managerPlan) {
  return [
    BASE_ASSISTANT_INSTRUCTIONS,
    `You are ${BRANCH_GRADER_AGENT.name}.`,
    `Branch: ${worker.name} (${worker.role}).`,
    `Manager steering summary: ${managerPlan.brief}`,
    formatManagerAssignment(assignment),
    "You are judging two candidate outputs from the same branch.",
    "Choose the candidate that better satisfies the objective, success criteria, grader criteria, and watchouts.",
    "Return JSON only with this exact shape:",
    "{",
    '  "winner": "left",',
    '  "reason": "short reason for the choice"',
    "}",
    'Set winner to either "left" or "right".'
  ].join("\n\n");
}

async function requestBranchGrade(
  openAiApiKey,
  messages,
  worker,
  assignment,
  managerPlan,
  leftCandidate,
  rightCandidate
) {
  const graderMessages = [
    {
      role: "user",
      content: [
        `Conversation context:\n${formatCompactConversationContext(messages)}`,
        `Left candidate (attempt ${leftCandidate.attempt}):\n${truncateText(leftCandidate.output, 500)}`,
        `Right candidate (attempt ${rightCandidate.attempt}):\n${truncateText(rightCandidate.output, 500)}`
      ].join("\n\n")
    }
  ];

  const result = await callOpenAiTextWithProfile(
    openAiApiKey,
    BRANCH_GRADER_MODEL,
    BRANCH_GRADER_REASONING_EFFORT,
    createBranchGraderInstructions(worker, assignment, managerPlan),
    graderMessages,
    NO_TOOLS,
    INTERNAL_STAGE_TIMEOUT_MS
  );

  if (!result.ok) {
    const fallbackWinner = pickFallbackCandidate(leftCandidate, rightCandidate);
    return {
      winner: fallbackWinner,
      reason: result.payload.error || "Grader failed, so a deterministic fallback chose the winner."
    };
  }

  const parsed = extractJsonObject(result.payload.reply);
  const selected = parsed?.winner === "right" ? rightCandidate : leftCandidate;

  return {
    winner: selected,
    reason: sanitizeText(parsed?.reason) || "Grader chose the stronger candidate."
  };
}

async function runBranchTournament(openAiApiKey, messages, worker, assignment, managerPlan, candidates) {
  let active = [...candidates];
  const rounds = [];

  while (active.length > 1) {
    const roundNumber = rounds.length + 1;
    const matches = [];
    const comparisons = [];

    for (let index = 0; index < active.length; index += 2) {
      const leftCandidate = active[index];
      const rightCandidate = active[index + 1];

      if (!rightCandidate) {
        matches.push({
          leftAttempt: leftCandidate.attempt,
          rightAttempt: null,
          winnerAttempt: leftCandidate.attempt,
          reason: "Bye"
        });
        comparisons.push(Promise.resolve(leftCandidate));
        continue;
      }

      comparisons.push(
        requestBranchGrade(
          openAiApiKey,
          messages,
          worker,
          assignment,
          managerPlan,
          leftCandidate,
          rightCandidate
        ).then((result) => {
          matches.push({
            leftAttempt: leftCandidate.attempt,
            rightAttempt: rightCandidate.attempt,
            winnerAttempt: result.winner.attempt,
            reason: result.reason
          });
          return result.winner;
        })
      );
    }

    active = await Promise.all(comparisons);
    rounds.push({
      round: roundNumber,
      matches: matches.sort((left, right) => {
        const leftAttempt = Number(left.leftAttempt) || 0;
        const rightAttempt = Number(right.leftAttempt) || 0;
        return leftAttempt - rightAttempt;
      })
    });
  }

  return {
    winner: active[0],
    rounds
  };
}

function createBranchState(worker, assignment, extra = {}) {
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
    ...extra
  };
}

function summarizeModifierAttempts(modifierAttempts) {
  return (Array.isArray(modifierAttempts) ? modifierAttempts : []).map((attempt) => ({
    attempt: attempt.attempt,
    status: attempt.status,
    changed: attempt.changed,
    brief: attempt.brief
  }));
}

async function requestBranchReply(openAiApiKey, messages, worker, assignment, managerPlan) {
  const { candidates, modifierAttempts, stoppedReason } = await runManagedBranchCandidates(
    openAiApiKey,
    messages,
    worker,
    assignment,
    managerPlan
  );

  const usableCandidates = candidates.filter(
    (candidate) => candidate.status === "completed" || candidate.status === "partial"
  );

  const modifier = {
    name: BRANCH_MODIFIER_AGENT.name,
    model: BRANCH_MODIFIER_MODEL,
    reasoningEffort: BRANCH_MODIFIER_REASONING_EFFORT,
    adaptationLimit: BRANCH_MODIFIER_LIMIT,
    attemptsUsed: modifierAttempts.length,
    stoppedReason,
    attempts: summarizeModifierAttempts(modifierAttempts)
  };

  if (usableCandidates.length === 0) {
    return createBranchState(worker, assignment, {
      status: "error",
      output: "All managed branch candidates failed.",
      error: candidates.at(-1)?.error || "No usable branch candidates were produced.",
      subagents: normalizeWorkerSubagents([]),
      modifier,
      grading: {
        name: BRANCH_GRADER_AGENT.name,
        model: BRANCH_GRADER_MODEL,
        reasoningEffort: BRANCH_GRADER_REASONING_EFFORT,
        winnerAttempt: null,
        rounds: []
      }
    });
  }

  const tournament =
    usableCandidates.length === 1
      ? { winner: usableCandidates[0], rounds: [] }
      : await runBranchTournament(
          openAiApiKey,
          messages,
          worker,
          assignment,
          managerPlan,
          usableCandidates
        );

  const winner = tournament.winner;

  return createBranchState(worker, assignment, {
    status: winner.status,
    output: winner.output,
    error: winner.error,
    subagents: winner.subagents,
    modifier,
    managed: winner.managed,
    grading: {
      name: BRANCH_GRADER_AGENT.name,
      model: BRANCH_GRADER_MODEL,
      reasoningEffort: BRANCH_GRADER_REASONING_EFFORT,
      winnerAttempt: winner.attempt,
      rounds: tournament.rounds
    }
  });
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
        `Modifier attempts: ${branch.modifier?.attemptsUsed || 0}/${branch.modifier?.adaptationLimit || BRANCH_MODIFIER_LIMIT}`,
        `Winner attempt: ${branch.grading?.winnerAttempt || "n/a"}`,
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
    "Each branch has already been evolved by a branch modifier, answered by Managed GPT, and reduced by a pairwise grader.",
    `Winning branch outputs:\n\n${formatBranchOutputs(branches)}`,
    "Merge the strongest points into one final answer for the user.",
    "Return plain assistant text, not JSON, unless the user explicitly asked for JSON.",
    "If the user asked for an exact literal string or token, return that literal output exactly.",
    "Resolve conflicts where possible and mention uncertainty only when it materially affects the answer.",
    "Do not mention the internal manager/modifier/grader process unless the user explicitly asked for it."
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

    return createBranchState(worker, assignment, {
      status: "error",
      output: "Worker execution failed.",
      error: result.reason instanceof Error ? result.reason.message : "Worker execution failed.",
      subagents: [],
      modifier: {
        name: BRANCH_MODIFIER_AGENT.name,
        model: BRANCH_MODIFIER_MODEL,
        reasoningEffort: BRANCH_MODIFIER_REASONING_EFFORT,
        adaptationLimit: BRANCH_MODIFIER_LIMIT,
        attemptsUsed: 0,
        stoppedReason: "Branch execution failed before any adapted candidates were produced.",
        attempts: []
      },
      grading: {
        name: BRANCH_GRADER_AGENT.name,
        model: BRANCH_GRADER_MODEL,
        reasoningEffort: BRANCH_GRADER_REASONING_EFFORT,
        winnerAttempt: null,
        rounds: []
      }
    });
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
    const fallback = usableBranches[0]?.output;

    if (fallback) {
      return {
        ok: true,
        status: 200,
        payload: {
          reply: fallback,
          model: MODEL,
          reasoningEffort: REASONING_EFFORT,
          manager: managerPlan,
          branches,
          assembly
        }
      };
    }

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
