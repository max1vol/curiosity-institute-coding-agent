<script>
  export let branch;
  export let index = 0;
</script>

<article class="branch-card">
  <div class="branch-card-header">
    <div class="branch-card-identity">
      <span class="branch-key">{branch?.key || `branch-${index + 1}`}</span>
      <span class="branch-name">{branch?.name || `Branch ${index + 1}`}</span>
    </div>

    <span class="branch-meta">
      {[branch?.model, branch?.reasoningEffort].filter(Boolean).join(" - ")}
    </span>
  </div>

  {#if branch?.role}
    <div class="branch-role">{branch.role}</div>
  {/if}

  {#if branch?.task}
    <div class="branch-task">{branch.task}</div>
  {/if}

  {#if Array.isArray(branch?.subagents) && branch.subagents.length > 0}
    <div class="branch-subagents">
      Subagents: {branch.subagents.map((subagent) => subagent.name).join(", ")}
    </div>
  {/if}

  {#if branch?.modifier}
    <div class="branch-subagents">
      Modifier: {branch.modifier.attemptsUsed}/{branch.modifier.adaptationLimit} attempts
      {#if branch.modifier.stoppedReason}
        - {branch.modifier.stoppedReason}
      {/if}
    </div>
  {/if}

  {#if branch?.grading}
    <div class="branch-subagents">
      Grader: winner attempt {branch.grading.winnerAttempt || "n/a"}
      {#if Array.isArray(branch.grading.rounds) && branch.grading.rounds.length > 0}
        - {branch.grading.rounds.length} rounds
      {/if}
    </div>
  {/if}

  <div class="branch-output">{typeof branch?.output === "string" ? branch.output : ""}</div>
</article>
