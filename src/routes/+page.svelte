<script>
  import { onMount, tick } from "svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";

  export let data;

  const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
  const INITIAL_ASSISTANT_MESSAGE =
    "I'm ready. Each turn is steered by a manager GPT, delegated to worker subagents, then reassembled into one final answer.";
  const CLEARED_ASSISTANT_MESSAGE =
    "Conversation cleared. Send a new prompt and I'll start a fresh manager-led subagent run.";
  const LOCKED_ASSISTANT_MESSAGE =
    "Access gate required again. Sign in with Google, activate a voucher, and verify to continue.";

  let nextMessageId = 1;
  let verified = data.verified;
  let googleConfigured = data.googleConfigured;
  let googleAuthenticated = data.googleAuthenticated;
  let googleClientId = data.googleClientId;
  let googleEmail = data.googleEmail;
  let googleName = data.googleName;
  let googlePicture = data.googlePicture;
  let voucherConfigured = data.voucherConfigured;
  let voucherActivated = data.voucherActivated;
  let voucherId = data.voucherId;
  let verificationConfigured = data.verificationConfigured;
  let readyForVerification = data.readyForVerification;
  let chatUnlocked = data.readyForChat;
  let googleErrorMessage = getGoogleErrorMessage(data.googleError);
  let voucherErrorMessage = getVoucherErrorMessage(data.voucherError);
  let verificationErrorMessage = getVerificationErrorMessage(data.verificationError);
  let messages = [createMessage("assistant", INITIAL_ASSISTANT_MESSAGE, { localOnly: true })];
  let isSending = false;
  let isGoogleAuthenticating = false;
  let isVoucherActivating = false;
  let isVerifying = false;
  let prompt = "";
  let voucherCode = "";
  let accessCode = "";
  let statusText = "";
  let statusMode = "locked";
  let connectionPill = "";
  let promptEl;
  let voucherInputEl;
  let verificationInputEl;
  let googleButtonEl;
  let messagesEl;
  let shouldAutoScroll = true;
  let lastMessageCount = messages.length;
  let googleScriptPromise;

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

  function isNearBottom() {
    if (!messagesEl) {
      return true;
    }

    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  }

  function handleMessagesScroll() {
    shouldAutoScroll = isNearBottom();
  }

  function getGoogleErrorMessage(value) {
    switch (value) {
      case "google-missing":
        return "Google authentication is not configured on the server yet.";
      case "google-required":
        return "Sign in with Google before continuing.";
      default:
        return "";
    }
  }

  function getVoucherErrorMessage(value) {
    switch (value) {
      case "google-missing":
        return "Google authentication is not configured on the server yet.";
      case "google-required":
        return "Sign in with Google before activating a voucher.";
      case "missing":
      case "voucher-missing":
        return "Voucher activation is not configured on the server yet.";
      case "invalid":
        return "Invalid voucher code.";
      case "voucher-required":
        return "Activate a voucher before continuing.";
      default:
        return "";
    }
  }

  function getVerificationErrorMessage(value) {
    switch (value) {
      case "invalid":
        return "Invalid access code.";
      case "missing":
        return "CHAT_ACCESS_CODE is not configured on the server yet.";
      case "google-missing":
        return "Google authentication is not configured on the server yet.";
      case "google-required":
        return "Sign in with Google before verification.";
      case "voucher-missing":
        return "Voucher activation is not configured on the server yet.";
      case "voucher-required":
        return "Activate a voucher before verification.";
      default:
        return "";
    }
  }

  function getStepState(active, configured, complete) {
    if (!configured) {
      return "missing";
    }

    if (complete) {
      return "done";
    }

    return active ? "active" : "pending";
  }

  function applyGateState(gate) {
    if (!gate || typeof gate !== "object") {
      return;
    }

    if (typeof gate.googleConfigured === "boolean") {
      googleConfigured = gate.googleConfigured;
    }

    if (typeof gate.voucherConfigured === "boolean") {
      voucherConfigured = gate.voucherConfigured;
    }

    if (typeof gate.verificationConfigured === "boolean") {
      verificationConfigured = gate.verificationConfigured;
    }

    if (typeof gate.googleAuthenticated === "boolean") {
      googleAuthenticated = gate.googleAuthenticated;
    }

    if (typeof gate.voucherActivated === "boolean") {
      voucherActivated = gate.voucherActivated;
    }

    if (typeof gate.verified === "boolean") {
      verified = gate.verified;
    }
  }

  function clearGateErrors() {
    googleErrorMessage = "";
    voucherErrorMessage = "";
    verificationErrorMessage = "";
  }

  function routeGateError(message, gate) {
    clearGateErrors();

    if (!message) {
      return;
    }

    if (!gate || typeof gate !== "object") {
      verificationErrorMessage = message;
      return;
    }

    if (!gate.googleConfigured || !gate.googleAuthenticated) {
      googleErrorMessage = message;
      return;
    }

    if (!gate.voucherConfigured || !gate.voucherActivated) {
      voucherErrorMessage = message;
      return;
    }

    verificationErrorMessage = message;
  }

  async function focusPrompt() {
    await tick();
    resizePrompt();
    promptEl?.focus();
  }

  async function focusActiveGateControl() {
    await tick();

    if (chatUnlocked) {
      void focusPrompt();
      return;
    }

    if (googleAuthenticated && !voucherActivated) {
      voucherInputEl?.focus();
      return;
    }

    if (readyForVerification) {
      verificationInputEl?.focus();
    }
  }

  async function ensureGoogleScript() {
    if (typeof window === "undefined") {
      return null;
    }

    if (window.google?.accounts?.id) {
      return window.google;
    }

    if (!googleScriptPromise) {
      googleScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`);

        if (existing) {
          existing.addEventListener("load", () => resolve(window.google), { once: true });
          existing.addEventListener("error", () => reject(new Error("Google script failed to load.")), {
            once: true
          });
          return;
        }

        const script = document.createElement("script");
        script.src = GOOGLE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(window.google);
        script.onerror = () => reject(new Error("Google script failed to load."));
        document.head.appendChild(script);
      });
    }

    return googleScriptPromise;
  }

  async function handleGoogleCredentialResponse(response) {
    const credential = typeof response?.credential === "string" ? response.credential.trim() : "";

    if (!credential || isGoogleAuthenticating) {
      return;
    }

    isGoogleAuthenticating = true;
    googleErrorMessage = "";
    setStatus("Verifying Google sign-in", "busy");

    try {
      const response = await fetch("/api/google-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ credential })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || `Google sign-in failed with status ${response.status}.`);
      }

      googleAuthenticated = true;
      googleEmail = payload?.googleUser?.email || "";
      googleName = payload?.googleUser?.name || googleEmail;
      googlePicture = payload?.googleUser?.picture || "";
      voucherActivated = false;
      voucherId = "";
      voucherCode = "";
      accessCode = "";
      verified = false;
      voucherErrorMessage = "";
      verificationErrorMessage = "";
    } catch (error) {
      googleErrorMessage = error instanceof Error ? error.message : "Google sign-in failed.";
    } finally {
      isGoogleAuthenticating = false;
      void focusActiveGateControl();
    }
  }

  async function renderGoogleButton() {
    if (!googleConfigured || !googleClientId || googleAuthenticated || !googleButtonEl) {
      return;
    }

    try {
      const google = await ensureGoogleScript();

      if (!google?.accounts?.id || !googleButtonEl) {
        return;
      }

      if (googleButtonEl.dataset.clientId === googleClientId) {
        return;
      }

      googleButtonEl.innerHTML = "";
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      google.accounts.id.renderButton(googleButtonEl, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "pill",
        width: 280
      });
      googleButtonEl.dataset.clientId = googleClientId;
    } catch (error) {
      googleErrorMessage =
        error instanceof Error ? error.message : "Unable to load Google sign-in right now.";
    }
  }

  async function activateVoucher(event) {
    event.preventDefault();

    const trimmedVoucherCode = voucherCode.trim();

    if (!googleAuthenticated || !trimmedVoucherCode || isVoucherActivating) {
      return;
    }

    isVoucherActivating = true;
    voucherErrorMessage = "";
    setStatus("Activating voucher", "busy");

    try {
      const response = await fetch("/api/voucher/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          voucherCode: trimmedVoucherCode
        })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          applyGateState(payload?.gate);
        }

        throw new Error(payload?.error || `Voucher activation failed with status ${response.status}.`);
      }

      voucherActivated = true;
      voucherId = payload?.voucher?.id || "";
      voucherCode = "";
      accessCode = "";
      verified = false;
      verificationErrorMessage = "";
    } catch (error) {
      voucherErrorMessage = error instanceof Error ? error.message : "Voucher activation failed.";
    } finally {
      isVoucherActivating = false;
      void focusActiveGateControl();
    }
  }

  async function verifyAccess(event) {
    event.preventDefault();

    const trimmedAccessCode = accessCode.trim();

    if (!readyForVerification || !trimmedAccessCode || isVerifying) {
      return;
    }

    isVerifying = true;
    verificationErrorMessage = "";
    setStatus("Checking access code", "busy");

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accessCode: trimmedAccessCode
        })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401 || response.status === 503) {
          applyGateState(payload?.gate);
          routeGateError(payload?.error || "Verification failed.", payload?.gate);
          return;
        }

        throw new Error(payload?.error || `Verification failed with status ${response.status}.`);
      }

      verified = true;
      accessCode = "";
      verificationErrorMessage = "";
      void focusPrompt();
    } catch (error) {
      verificationErrorMessage = error instanceof Error ? error.message : "Verification failed.";
    } finally {
      isVerifying = false;
      if (!chatUnlocked) {
        void focusActiveGateControl();
      }
    }
  }

  async function sendMessage() {
    const trimmed = prompt.trim();

    if (!chatUnlocked || !trimmed || isSending) {
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
            .filter((message) => !message.loading && !message.error && !message.localOnly)
            .map(({ role, content }) => ({ role, content }))
        })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          removeMessage(loadingMessage.id);
          applyGateState(payload?.gate);
          messages = [createMessage("assistant", LOCKED_ASSISTANT_MESSAGE, { localOnly: true })];
          prompt = "";
          resizePrompt();
          routeGateError(payload?.error || "Access gate required again.", payload?.gate);
          void focusActiveGateControl();
          return;
        }

        if (payload && typeof payload.error === "string") {
          removeMessage(loadingMessage.id);
          messages = [
            ...messages,
            createMessage("assistant", payload.error, {
              error: true,
              manager: payload.manager && typeof payload.manager === "object" ? payload.manager : null,
              branches: Array.isArray(payload.branches) ? payload.branches : [],
              assembly: payload.assembly && typeof payload.assembly === "object" ? payload.assembly : null
            })
          ];
          setStatus("Request returned diagnostics", "error");
          connectionPill = "Backend returned an error";
          return;
        }

        throw new Error(`Request failed with status ${response.status}`);
      }

      if (!payload || typeof payload.reply !== "string") {
        throw new Error("Invalid response format. Expected { reply: string }.");
      }

      replaceMessage(loadingMessage.id, {
        content: payload.reply,
        loading: false,
        manager: payload.manager && typeof payload.manager === "object" ? payload.manager : null,
        branches: Array.isArray(payload.branches) ? payload.branches : [],
        assembly: payload.assembly && typeof payload.assembly === "object" ? payload.assembly : null
      });
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
      if (chatUnlocked) {
        void focusPrompt();
      } else {
        void focusActiveGateControl();
      }
    }
  }

  function clearConversation() {
    if (!chatUnlocked || isSending) {
      return;
    }

    messages = [createMessage("assistant", CLEARED_ASSISTANT_MESSAGE, { localOnly: true })];
    setStatus("Ready", "idle");
    connectionPill = "Connecting to /api/chat";
    void focusPrompt();
  }

  function handleComposerSubmit(event) {
    event.preventDefault();
    void sendMessage();
  }

  function handlePromptKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  onMount(() => {
    resizePrompt();
    void focusActiveGateControl();
    void renderGoogleButton();
  });

  $: if (messages.length !== lastMessageCount) {
    const shouldScroll = shouldAutoScroll;
    lastMessageCount = messages.length;

    void tick().then(() => {
      if (messagesEl && shouldScroll) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }

  $: readyForVerification =
    verificationConfigured &&
    googleConfigured &&
    voucherConfigured &&
    googleAuthenticated &&
    voucherActivated;

  $: chatUnlocked = readyForVerification && verified;

  $: if (!googleAuthenticated) {
    googleEmail = "";
    googleName = "";
    googlePicture = "";
    voucherActivated = false;
    voucherId = "";
    accessCode = "";
  }

  $: if (!chatUnlocked && googleConfigured && googleClientId && !googleAuthenticated) {
    void tick().then(renderGoogleButton);
  }

  $: if (!isSending && !isGoogleAuthenticating && !isVoucherActivating) {
    if (chatUnlocked) {
      setStatus("Ready", "idle");
      connectionPill = "All access gates passed";
    } else if (!googleConfigured) {
      setStatus("Google authentication not configured", "error");
      connectionPill = "Google sign-in unavailable";
    } else if (!googleAuthenticated) {
      setStatus("Google sign-in required", googleErrorMessage ? "error" : "locked");
      connectionPill = "Google sign-in required";
    } else if (!voucherConfigured) {
      setStatus("Voucher activation not configured", "error");
      connectionPill = "Voucher activation unavailable";
    } else if (!voucherActivated) {
      setStatus("Voucher activation required", voucherErrorMessage ? "error" : "locked");
      connectionPill = "Voucher activation required";
    } else if (!verificationConfigured) {
      setStatus("Verification not configured", "error");
      connectionPill = "Access code unavailable";
    } else if (!verified) {
      setStatus("Verification required", verificationErrorMessage ? "error" : "locked");
      connectionPill = "Verification required";
    }
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
        {#if chatUnlocked}
          Google + voucher + verification active
        {:else if !googleAuthenticated}
          Step 1 of 3: Google sign-in
        {:else if !voucherActivated}
          Step 2 of 3: Voucher activation
        {:else}
          Step 3 of 3: Verification
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
        {#if chatUnlocked}
          <button class="ghost-button" type="button" on:click={clearConversation} disabled={isSending}>
            Clear
          </button>
        {/if}

        {#if googleAuthenticated || voucherActivated || verified}
          <form method="POST" action="/logout">
            <button
              class="ghost-button"
              type="submit"
              disabled={isSending || isGoogleAuthenticating || isVoucherActivating}
            >
              Lock
            </button>
          </form>
        {/if}
      </div>
    </div>

    {#if chatUnlocked}
      <div
        class="messages"
        bind:this={messagesEl}
        aria-live="polite"
        aria-relevant="additions text"
        on:scroll={handleMessagesScroll}
      >
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
          <div class="gate-kicker">Access Gate</div>
          <h2 class="gate-heading">Google, voucher, then verification</h2>
          <p class="gate-text">
            This chat now unlocks only after a Google sign-in, an activated voucher, and the
            existing server-side verification check. All three states are enforced by HttpOnly cookies.
          </p>
        </div>

        <div class="gate-steps" aria-label="Access steps">
          <div class="gate-step" data-state={getStepState(!googleAuthenticated, googleConfigured, googleAuthenticated)}>
            <span class="gate-step-index">1</span>
            <div>
              <div class="gate-step-title">Google sign-in</div>
              <div class="gate-step-text">
                {#if !googleConfigured}
                  Missing configuration
                {:else if googleAuthenticated}
                  Signed in as {googleEmail}
                {:else}
                  Required before anything else
                {/if}
              </div>
            </div>
          </div>

          <div
            class="gate-step"
            data-state={getStepState(
              googleAuthenticated && !voucherActivated,
              voucherConfigured,
              voucherActivated
            )}
          >
            <span class="gate-step-index">2</span>
            <div>
              <div class="gate-step-title">Voucher activation</div>
              <div class="gate-step-text">
                {#if !voucherConfigured}
                  Missing configuration
                {:else if voucherActivated}
                  Activated for this Google session
                {:else}
                  Required after Google sign-in
                {/if}
              </div>
            </div>
          </div>

          <div
            class="gate-step"
            data-state={getStepState(
              readyForVerification && !verified,
              verificationConfigured,
              verified
            )}
          >
            <span class="gate-step-index">3</span>
            <div>
              <div class="gate-step-title">Verification</div>
              <div class="gate-step-text">
                {#if !verificationConfigured}
                  Missing configuration
                {:else if verified}
                  Verified session active
                {:else}
                  Required after voucher activation
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="gate-grid">
          <section class="gate-card">
            <div class="gate-card-header">
              <div>
                <div class="gate-kicker">Step 1</div>
                <h3 class="gate-card-title">Sign in with Google</h3>
              </div>

              <span class="gate-badge" data-state={googleAuthenticated ? "done" : "pending"}>
                {googleAuthenticated ? "Connected" : "Required"}
              </span>
            </div>

            {#if googleAuthenticated}
              <div class="gate-identity">
                {#if googlePicture}
                  <img class="gate-avatar" src={googlePicture} alt="" />
                {/if}
                <div>
                  <div class="gate-identity-name">{googleName || googleEmail}</div>
                  <div class="gate-identity-email">{googleEmail}</div>
                </div>
              </div>
            {:else if googleConfigured}
              <div class="gate-google-slot" bind:this={googleButtonEl}></div>
            {:else}
              <div class="gate-error">
                PUBLIC_GOOGLE_CLIENT_ID is not configured, so Google sign-in cannot start.
              </div>
            {/if}

            {#if googleErrorMessage}
              <div class="gate-error">{googleErrorMessage}</div>
            {/if}
          </section>

          <section class="gate-card">
            <div class="gate-card-header">
              <div>
                <div class="gate-kicker">Step 2</div>
                <h3 class="gate-card-title">Activate a voucher</h3>
              </div>

              <span class="gate-badge" data-state={voucherActivated ? "done" : "pending"}>
                {voucherActivated ? "Activated" : "Required"}
              </span>
            </div>

            {#if voucherActivated}
              <div class="gate-note">
                Voucher activated for this Google session.
                {#if voucherId}
                  Session token: <code>{voucherId.slice(0, 12)}</code>
                {/if}
              </div>
            {/if}

            <form class="gate-form" on:submit|preventDefault={activateVoucher}>
              <label class="sr-only" for="voucher-code">Voucher code</label>
              <input
                id="voucher-code"
                class="gate-input"
                type="password"
                name="voucherCode"
                bind:this={voucherInputEl}
                bind:value={voucherCode}
                placeholder="Enter voucher code"
                autocomplete="one-time-code"
                spellcheck="false"
                disabled={!googleAuthenticated || !voucherConfigured || isVoucherActivating}
              />
              <button
                class="gate-button"
                type="submit"
                disabled={!googleAuthenticated || !voucherConfigured || !voucherCode.trim() || isVoucherActivating}
              >
                {isVoucherActivating ? "Activating..." : "Activate"}
              </button>
            </form>

            {#if !googleAuthenticated}
              <div class="gate-note">Sign in with Google before activating a voucher.</div>
            {:else if !voucherConfigured}
              <div class="gate-error">
                CHAT_VOUCHERS is not configured on the server yet, so voucher activation cannot succeed.
              </div>
            {/if}

            {#if voucherErrorMessage}
              <div class="gate-error">{voucherErrorMessage}</div>
            {/if}
          </section>

          <section class="gate-card">
            <div class="gate-card-header">
              <div>
                <div class="gate-kicker">Step 3</div>
                <h3 class="gate-card-title">Pass verification</h3>
              </div>

              <span class="gate-badge" data-state={verified ? "done" : "pending"}>
                {verified ? "Verified" : "Required"}
              </span>
            </div>

            {#if verificationConfigured}
              <form class="gate-form" on:submit={verifyAccess}>
                <label class="sr-only" for="verification-code">Access code</label>
                <input
                  id="verification-code"
                  class="gate-input"
                  type="password"
                  name="accessCode"
                  bind:this={verificationInputEl}
                  bind:value={accessCode}
                  placeholder="Enter access code"
                  autocomplete="current-password"
                  spellcheck="false"
                  disabled={!readyForVerification || isVerifying}
                />
                <button
                  class="gate-button"
                  type="submit"
                  disabled={!readyForVerification || !accessCode.trim() || isVerifying}
                >
                  {isVerifying ? "Verifying..." : "Verify"}
                </button>
              </form>
            {:else}
              <div class="gate-error">
                CHAT_ACCESS_CODE is not configured on the server yet, so verification cannot succeed.
              </div>
            {/if}

            {#if !readyForVerification && verificationConfigured}
              <div class="gate-note">
                Finish Google sign-in and voucher activation before submitting the access code.
              </div>
            {/if}

            {#if verificationErrorMessage}
              <div class="gate-error">{verificationErrorMessage}</div>
            {/if}
          </section>
        </div>
      </div>
    {/if}
  </section>
</main>
