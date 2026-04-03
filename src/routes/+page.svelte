<script>
  import { onMount, tick } from "svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";

  export let data;
  const INITIAL_ASSISTANT_MESSAGE =
    "I'm ready. Each turn is steered by a manager GPT, delegated to worker subagents, then reassembled into one final answer.";
  const CLEARED_ASSISTANT_MESSAGE =
    "Conversation cleared. Send a new prompt and I'll start a fresh manager-led subagent run.";
  const LOCKED_ASSISTANT_MESSAGE =
    "Session locked. Verify again to use the chat.";

  let nextMessageId = 1;
  let messages = [createMessage("assistant", INITIAL_ASSISTANT_MESSAGE)];
  let isSending = false;
  let prompt = "";
  let statusText = data.verified
    ? "Ready"
    : data.verificationError
      ? "Verification failed"
      : "Verification required";
  let statusMode = data.verified
    ? "idle"
    : data.verificationError
      ? "error"
      : "locked";
  let connectionPill = data.verified
    ? "Verified session active"
    : data.verificationConfigured
      ? data.verificationError
        ? "Verification failed"
        : "Verification required"
      : "CHAT_ACCESS_CODE is not configured";
  let promptEl;
  let verificationInputEl;
  let messagesEl;

  function createMessage(role, content, extra = {}) {
    return {
      id: `${role}-${nextMessageId++}`,
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

  async function focusVerificationInput() {
    await tick();
    verificationInputEl?.focus();
  }

  async function sendMessage() {
    const trimmed = prompt.trim();
    if (!data.verified || !trimmed || isSending) {
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
        if (response.status === 401) {
          removeMessage(loadingMessage.id);
          window.location.reload();
          void focusVerificationInput();
          return;
        }

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
    if (!data.verified || isSending) {
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
    if (data.verified) {
      promptEl?.focus();
    } else {
      verificationInputEl?.focus();
    }
  });

  $: if (data.verified) {
    void focusPrompt();
  } else if (data.verificationConfigured) {
    void focusVerificationInput();
  }
</script>

<svelte:head>
  <title>Curiosity Chat</title>
  <meta
    name="description"
    content="A focused browser chat connected to GPT-5.4 through @ljoukov/llm and a SvelteKit backend."
  />
</svelte:head>

<div class="backdrop backdrop-one"></div>
<div class="backdrop backdrop-two"></div>

<main class="shell">
  <section class="hero card">
    <div class="eyebrow">Curiosity Institute</div>
    <h1>Chat with GPT-5.4</h1>
    <p>
      A SvelteKit browser chat wired to a manager-led GPT pipeline. Each turn is steered by
      a manager GPT, delegated to worker leads with their own subagents, then assembled into
      one final answer with web search available when useful.
    </p>
    <div class="hero-meta">
      <span class="pill">{connectionPill}</span>
      <span class="pill subtle">
        {#if data.verified}
          Verified session - manager + worker subagents + web search
        {:else}
          Access code required before chat is enabled
        {/if}
      </span>
    </div>
  </section>

  <section class="chat card" aria-label="Chat">
    <div class="chat-topbar">
      <div>
        <div class="chat-title">Conversation</div>
        <div class="chat-status" data-mode={statusMode} aria-live="polite">{statusText}</div>
      </div>

      <div class="toolbar-actions">
        {#if data.verified}
          <button class="ghost-button" type="button" on:click={clearConversation} disabled={isSending}>
            Clear
          </button>
          <form method="POST" action="/logout">
            <button class="ghost-button" type="submit" disabled={isSending}>Lock</button>
          </form>
        {/if}
      </div>
    </div>

    {#if data.verified}
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
    {:else}
      <div class="gate">
        <div class="gate-copy">
          <div class="gate-kicker">Verification</div>
          <h2 class="gate-heading">Access code required</h2>
          <p class="gate-text">
            Only verified sessions can use this chat right now. The access code is checked
            server-side and the verified state is stored in an HttpOnly cookie.
          </p>
        </div>

        {#if data.verificationConfigured}
          <form class="gate-form" method="POST" action="/verify">
            <label class="sr-only" for="verification-code">Access code</label>
            <input
              id="verification-code"
              class="gate-input"
              type="password"
              name="accessCode"
              bind:this={verificationInputEl}
              placeholder="Enter access code"
              autocomplete="current-password"
              spellcheck="false"
            />
            <button class="gate-button" type="submit">Verify</button>
          </form>
        {:else}
          <div class="gate-error">
            CHAT_ACCESS_CODE is not configured on the server yet, so verification cannot succeed.
          </div>
        {/if}

        {#if data.verificationError === "invalid"}
          <div class="gate-error">Invalid access code.</div>
        {:else if data.verificationError === "missing"}
          <div class="gate-error">CHAT_ACCESS_CODE is not configured on the server yet.</div>
        {/if}
      </div>
    {/if}
  </section>
</main>
