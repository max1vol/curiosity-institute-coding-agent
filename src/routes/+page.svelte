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

  let messages = [createMessage("assistant", INITIAL_ASSISTANT_MESSAGE)];
  let isVerified = data.verified;
  let verificationConfigured = data.verificationConfigured;
  let verificationCode = "";
  let verificationError = "";
  let isVerifying = false;
  let isSending = false;
  let prompt = "";
  let statusText = isVerified ? "Ready" : "Verification required";
  let statusMode = isVerified ? "idle" : "locked";
  let connectionPill = isVerified
    ? "Verified session active"
    : verificationConfigured
      ? "Verification required"
      : "CHAT_ACCESS_CODE is not configured";
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

  async function verifyAccess(event) {
    event.preventDefault();

    if (!verificationConfigured || isVerifying || isSending) {
      return;
    }

    const trimmed = verificationCode.trim();
    if (!trimmed) {
      verificationError = "Enter the access code.";
      setStatus("Verification required", "locked");
      return;
    }

    isVerifying = true;
    verificationError = "";
    setStatus("Verifying access", "busy");
    connectionPill = "Checking verification";

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accessCode: trimmed
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        verificationError =
          data && typeof data.error === "string"
            ? data.error
            : `Verification failed with status ${response.status}.`;
        setStatus("Verification failed", "error");
        connectionPill = "Verification failed";
        return;
      }

      isVerified = true;
      verificationCode = "";
      setStatus("Ready", "idle");
      connectionPill = "Verified session active";
      await focusPrompt();
    } catch (error) {
      verificationError =
        error instanceof Error ? error.message : "Failed to reach the verification endpoint.";
      setStatus("Verification unavailable", "error");
      connectionPill = "Verification unavailable";
    } finally {
      isVerifying = false;
    }
  }

  async function lockSession() {
    if (isVerifying || isSending) {
      return;
    }

    try {
      await fetch("/api/logout", {
        method: "POST"
      });
    } catch (error) {
      console.error(error);
    }

    isVerified = false;
    verificationError = "";
    verificationCode = "";
    messages = [createMessage("assistant", LOCKED_ASSISTANT_MESSAGE)];
    setStatus("Verification required", "locked");
    connectionPill = verificationConfigured ? "Verification required" : "Verification unavailable";
  }

  async function sendMessage() {
    const trimmed = prompt.trim();
    if (!isVerified || !trimmed || isSending) {
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
          isVerified = false;
          verificationError =
            data && typeof data.error === "string"
              ? data.error
              : "Verification required before using the chat.";
          messages = [createMessage("assistant", LOCKED_ASSISTANT_MESSAGE)];
          setStatus("Verification required", "locked");
          connectionPill = "Verification required";
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
    if (!isVerified || isSending) {
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
    if (isVerified) {
      promptEl?.focus();
    }
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
      <span class="pill subtle">
        {#if isVerified}
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
        {#if isVerified}
          <button class="ghost-button" type="button" on:click={clearConversation} disabled={isSending}>
            Clear
          </button>
          <button class="ghost-button" type="button" on:click={lockSession} disabled={isSending}>
            Lock
          </button>
        {/if}
      </div>
    </div>

    {#if isVerified}
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

        {#if verificationConfigured}
          <form class="gate-form" on:submit={verifyAccess}>
            <label class="sr-only" for="verification-code">Access code</label>
            <input
              id="verification-code"
              class="gate-input"
              type="password"
              bind:value={verificationCode}
              placeholder="Enter access code"
              autocomplete="current-password"
              spellcheck="false"
              disabled={isVerifying}
            />
            <button class="gate-button" type="submit" disabled={isVerifying}>
              {isVerifying ? "Verifying..." : "Verify"}
            </button>
          </form>
        {:else}
          <div class="gate-error">
            CHAT_ACCESS_CODE is not configured on the server yet, so verification cannot succeed.
          </div>
        {/if}

        {#if verificationError}
          <div class="gate-error">{verificationError}</div>
        {/if}
      </div>
    {/if}
  </section>
</main>
