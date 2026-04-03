<script>
  import BranchPanel from "$lib/components/BranchPanel.svelte";

  export let message;
</script>

<article
  class={`message ${message.role}${message.loading ? " loading" : ""}${message.error ? " error" : ""}`}
  data-role={message.role}
>
  {#if message?.role === "assistant"}
    <div class="message-body">
      <div class="message-reply">{message.content}</div>

      {#if (message?.manager && typeof message.manager === "object") || (Array.isArray(message?.branches) && message.branches.length > 0)}
        <BranchPanel
          manager={message.manager && typeof message.manager === "object" ? message.manager : null}
          branches={Array.isArray(message.branches) ? message.branches : []}
          assembly={message.assembly && typeof message.assembly === "object" ? message.assembly : null}
        />
      {/if}
    </div>
  {:else}
    <div class="message-text">{message.content}</div>
  {/if}
</article>
