<script>
  import { onMount, tick } from "svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";

  const INITIAL_ASSISTANT_MESSAGE =
    "I'm ready. Each turn is steered by a manager GPT, delegated to worker subagents, then reassembled into one final answer.";
  const CLEARED_ASSISTANT_MESSAGE =
    "Conversation cleared. Send a new prompt and I'll start a fresh manager-led subagent run.";

  let messages = [createMessage("assistant", INITIAL_ASSISTANT_MESSAGE)];
  let isSending = false;
  let prompt = "";
  let statusText = "Ready";
  let statusMode = "idle";
  let connectionPill = "Connecting to /api/chat";
  let promptEl;
  let messagesEl;

  function createMessage(role, content, extra = {}) {
    return {
      id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content,
      ...extra
    };
  }

  function setStatus(text, mode = "idle") {
    statusText = text;
    statusMode = mode;
  }

  function resizePrompt() {
    if (!promptEl) {
      return;
    }

    promptEl.style.height = "auto";
    promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
  }

  function replaceMessage(id, next) {
    messages = messages.map((message) => (message.id === id ? { ...message, ...next } : message));
  }

  function removeMessage(id) {
    messages = messages.filter((message) => message.id !== id);
  }

  async function focusPrompt() {
    await tick();
    resizePrompt();
    promptEl?.focus();
  }

  async function sendMessage() {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) {
      return;
    }

    isSending = true;
    setStatus("Sending request to /api/chat", "busy");

    const userMessage = createMessage("user", trimmed);
    const loadingMessage = createMessage(
      "assistant",
      "Manager GPT is briefing worker subagents",
      { loading: true }
    );
    const requestMessages = [...messages, userMessage];

    messages = [...requestMessages, loadingMessage];
    prompt = "";
    await tick();
    resizePrompt();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: requestMessages
            .filter((message) => !message.loading && !message.error)
            .map(({ role, content }) => ({ role, content }))
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (data && typeof data.error === "string") {
          removeMessage(loadingMessage.id);
          messages = [
            ...messages,
            createMessage("assistant", data.error, {
              error: true,
              manager: data.manager && typeof data.manager === "object" ? data.manager : null,
              branches: Array.isArray(data.branches) ? data.branches : [],
              assembly: data.assembly && typeof data.assembly === "object" ? data.assembly : null
            })
          ];
          setStatus("Request returned diagnostics", "error");
          connectionPill = "Backend returned an error";
          return;
        }

        throw new Error(`Request failed with status ${response.status}`);
      }

      if (!data || typeof data.reply !== "string") {
        throw new Error("Invalid response format. Expected { reply: string }.");
      }

      replaceMessage(loadingMessage.id, {
        content: data.reply,
        loading: false,
        manager: data.manager && typeof data.manager === "object" ? data.manager : null,
        branches: Array.isArray(data.branches) ? data.branches : [],
        assembly: data.assembly && typeof data.assembly === "object" ? data.assembly : null
      });

      setStatus("Ready", "idle");
      connectionPill = "Connected to /api/chat";
    } catch (error) {
      removeMessage(loadingMessage.id);
      messages = [
        ...messages,
        createMessage(
          "system",
          `Request failed. ${error instanceof Error ? error.message : "Unknown error."}`,
          { error: true }
        )
      ];
      setStatus("Error talking to /api/chat", "error");
      connectionPill = "Backend unavailable";
      console.error(error);
    } finally {
      isSending = false;
      void focusPrompt();
    }
  }

  function clearConversation() {
    if (isSending) {
      return;
    }

    messages = [createMessage("assistant", CLEARED_ASSISTANT_MESSAGE)];
    setStatus("Ready", "idle");
    connectionPill = "Connecting to /api/chat";
    void focusPrompt();
  }

  function handleComposerSubmit(event) {
    event.preventDefault();
    void sendMessage();
  }

  function handlePromptKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  $: if (messages.length) {
    tick().then(() => {
      if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }

  onMount(() => {
    resizePrompt();
    promptEl?.focus();
  });
</script>

<svelte:head>
  <title>Curiosity Chat</title>
  <meta
    name="description"
    content="A focused browser chat connected to GPT-5.4 xhigh through a SvelteKit backend."
  />
</svelte:head>

<div class="backdrop backdrop-one"></div>
<div class="backdrop backdrop-two"></div>

<main class="shell">
  <section class="hero card">
    <div class="eyebrow">Curiosity Institute</div>
    <h1>Chat with GPT-5.4 xhigh</h1>
    <p>
      A SvelteKit browser chat wired to a manager-led GPT pipeline. Each turn is steered by
      a manager GPT, delegated to worker leads with their own subagents, then assembled into
      one final answer with web search available when useful.
    </p>
    <div class="hero-meta">
      <span class="pill">{connectionPill}</span>
      <span class="pill subtle">SvelteKit + manager + worker subagents + web search</span>
    </div>
  </section>

  <section class="chat card" aria-label="Chat">
    <div class="chat-topbar">
      <div>
        <div class="chat-title">Conversation</div>
        <div class="chat-status" data-mode={statusMode} aria-live="polite">{statusText}</div>
      </div>

      <button class="ghost-button" type="button" on:click={clearConversation} disabled={isSending}>
        Clear
      </button>
    </div>

    <div class="messages" bind:this={messagesEl} aria-live="polite" aria-relevant="additions text">
      {#each messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
    </div>

    <form class="composer" on:submit={handleComposerSubmit}>
      <label class="sr-only" for="prompt">Message</label>
      <textarea
        id="prompt"
        name="prompt"
        rows="1"
        bind:this={promptEl}
        bind:value={prompt}
        placeholder="Ask something, outline a task, or continue the thread..."
        autocomplete="off"
        spellcheck="true"
        on:input={resizePrompt}
        on:keydown={handlePromptKeydown}
        disabled={isSending}
      ></textarea>

      <button type="submit" disabled={isSending}>Send</button>
    </form>
  </section>
</main>
