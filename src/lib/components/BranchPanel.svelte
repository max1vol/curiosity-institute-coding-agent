<script>
  import BranchCard from "$lib/components/BranchCard.svelte";

  export let manager = null;
  export let branches = [];
  export let assembly = null;

  function formatAssemblyMeta(value) {
    if (!value || typeof value !== "object") {
      return "";
    }

    return [value.model, value.reasoningEffort, value.strategy].filter(Boolean).join(" - ");
  }

  function formatManagerMeta(value) {
    if (!value || typeof value !== "object") {
      return "";
    }

    return [value.name, value.model, value.reasoningEffort, value.strategy]
      .filter(Boolean)
      .join(" - ");
  }
</script>

<details class="branch-panel" open>
  <summary class="branch-panel-summary">
    <span class="branch-panel-title">Parallel branches ({branches.length})</span>
    <span class="branch-panel-assembly">{formatAssemblyMeta(assembly)}</span>
  </summary>

  {#if manager && typeof manager === "object"}
    <section class="manager-strip">
      <div class="manager-strip-header">
        <span class="manager-strip-title">Manager brief</span>
        <span class="manager-strip-meta">{formatManagerMeta(manager)}</span>
      </div>

      <div class="manager-strip-brief">{typeof manager.brief === "string" ? manager.brief : ""}</div>
    </section>
  {/if}

  {#if Array.isArray(branches) && branches.length > 0}
    <div class="branch-grid">
      {#each branches as branch, index (branch?.key || index)}
        <BranchCard {branch} {index} />
      {/each}
    </div>
  {/if}
</details>
