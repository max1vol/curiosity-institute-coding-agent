<script>
  import { onMount, tick } from "svelte";
  import ChatMessage from "$lib/components/ChatMessage.svelte";

  export let data;

  const INITIAL_ASSISTANT_MESSAGE =
    "I'm ready. Each turn is steered by a manager GPT, delegated to worker subagents, then reassembled into one final answer.";
  const CLEARED_ASSISTANT_MESSAGE =
    "Conversation cleared. Send a new prompt and I'll start a fresh manager-led subagent run.";
  const LOCKED_ASSISTANT_MESSAGE =
    "Access is locked again. Sign in with your approved email to continue.";
  const CHAT_STORAGE_KEY = "curiosity-chat-state-v2";
  const MAX_PERSISTED_MESSAGES = 20;

  let nextMessageId = 1;
  let authConfigured = data.authConfigured;
  let sessionSecretConfigured = data.sessionSecretConfigured;
  let mailConfigured = data.mailConfigured;
  let storeConfigured = data.storeConfigured;
  let adminBootstrapConfigured = data.adminBootstrapConfigured;
  let authenticated = data.authenticated;
  let challengeActive = data.challengeActive;
  let challengeEmail = data.challengeEmail || "";
  let userEmail = data.userEmail || "";
  let userRole = data.userRole || "member";
  let isAdmin = data.isAdmin;
  let chatUnlocked = data.readyForChat;
  let authorizedUsers = Array.isArray(data.authorizedUsers) ? data.authorizedUsers : [];

  let messages = createInitialMessages();
  let prompt = "";
  let authEmail = userEmail || challengeEmail || "";
  let loginCode = "";
  let manageEmail = "";
  let manageRole = "member";

  let statusText = "";
  let statusMode = "locked";
  let connectionPill = "";
  let emailErrorMessage = data.emailError || "";
  let emailStatusMessage = "";
  let manageErrorMessage = "";
  let manageStatusMessage = "";

  let isSending = false;
  let isSendingCode = false;
  let isVerifyingCode = false;
  let isLoadingUsers = false;
  let isSavingUser = false;
  let removingEmail = "";
  let requestController = null;
  let lastFailedRequestMessages = null;
  let hasMounted = false;

  let promptEl;
  let emailInputEl;
  let codeInputEl;
  let messagesEl;
  let shouldAutoScroll = true;
  let lastMessageCount = messages.length;

  function createInitialMessages() {
    return [createMessage("assistant", INITIAL_ASSISTANT_MESSAGE, { localOnly: true })];
  }

  function createMessage(role, content, extra = {}) {
    return {
      id: `${role}-${nextMessageId++}`,
      role,
      content,
      ...extra
    };
  }

  function createLoadingMessage(content = "Manager GPT is briefing worker subagents") {
    return createMessage("assistant", content, { loading: true });
  }

  function buildChatRequestMessages(sourceMessages) {
    return sourceMessages
      .filter((message) => !message.loading && !message.error && !message.localOnly)
      .map(({ role, content }) => ({ role, content }));
  }

  function serializeMessage(message) {
    return {
      role: message.role,
      content: message.content,
      error: Boolean(message.error),
      localOnly: Boolean(message.localOnly),
      manager: message.manager || null,
      branches: Array.isArray(message.branches) ? message.branches : [],
      assembly: message.assembly || null
    };
  }

  function hydrateMessage(rawMessage) {
    return createMessage(rawMessage.role, rawMessage.content, {
      error: Boolean(rawMessage.error),
      localOnly: Boolean(rawMessage.localOnly),
      manager: rawMessage.manager && typeof rawMessage.manager === "object" ? rawMessage.manager : null,
      branches: Array.isArray(rawMessage.branches) ? rawMessage.branches : [],
      assembly: rawMessage.assembly && typeof rawMessage.assembly === "object" ? rawMessage.assembly : null
    });
  }

  function persistChatState() {
    if (typeof sessionStorage === "undefined") {
      return;
    }

    const persistedMessages = messages
      .filter((message) => !message.loading)
      .slice(-MAX_PERSISTED_MESSAGES)
      .map(serializeMessage);

    sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: persistedMessages,
        prompt,
        authEmail
      })
    );
  }

  function restoreChatState() {
    if (typeof sessionStorage === "undefined") {
      return;
    }

    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);

    if (!raw) {
      messages = createInitialMessages();
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const restoredMessages = Array.isArray(parsed?.messages)
        ? parsed.messages
            .filter(
              (message) =>
                message &&
                (message.role === "assistant" || message.role === "user" || message.role === "system") &&
                typeof message.content === "string" &&
                message.content.trim().length > 0
            )
            .map(hydrateMessage)
        : [];

      messages = restoredMessages.length > 0 ? restoredMessages : createInitialMessages();

      if (typeof parsed?.prompt === "string") {
        prompt = parsed.prompt;
      }

      if (!authenticated && typeof parsed?.authEmail === "string" && parsed.authEmail.trim()) {
        authEmail = parsed.authEmail.trim().toLowerCase();
      }
    } catch {
      messages = createInitialMessages();
    }
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

  function applyGate(gate) {
    if (!gate || typeof gate !== "object") {
      return;
    }

    if (typeof gate.authConfigured === "boolean") {
      authConfigured = gate.authConfigured;
    }

    if (typeof gate.sessionSecretConfigured === "boolean") {
      sessionSecretConfigured = gate.sessionSecretConfigured;
    }

    if (typeof gate.mailConfigured === "boolean") {
      mailConfigured = gate.mailConfigured;
    }

    if (typeof gate.storeConfigured === "boolean") {
      storeConfigured = gate.storeConfigured;
    }

    if (typeof gate.adminBootstrapConfigured === "boolean") {
      adminBootstrapConfigured = gate.adminBootstrapConfigured;
    }

    if (typeof gate.authenticated === "boolean") {
      authenticated = gate.authenticated;
    }

    if (typeof gate.challengeActive === "boolean") {
      challengeActive = gate.challengeActive;
    }

    if (typeof gate.isAdmin === "boolean") {
      isAdmin = gate.isAdmin;
    }

    if (!authenticated) {
      userEmail = "";
      userRole = "member";
      chatUnlocked = false;
      authorizedUsers = [];
    }
  }

  async function focusPrompt() {
    await tick();
    resizePrompt();
    promptEl?.focus();
  }

  async function focusActiveControl() {
    await tick();

    if (chatUnlocked) {
      void focusPrompt();
      return;
    }

    if (challengeActive) {
      codeInputEl?.focus();
      return;
    }

    emailInputEl?.focus();
  }

  async function loadAuthorizedUsers() {
    if (!authenticated || !isAdmin) {
      authorizedUsers = [];
      return;
    }

    isLoadingUsers = true;
    manageErrorMessage = "";

    try {
      const response = await fetch("/api/admin/users");
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load users with status ${response.status}.`);
      }

      authorizedUsers = Array.isArray(payload?.users) ? payload.users : [];
    } catch (error) {
      manageErrorMessage = error instanceof Error ? error.message : "Failed to load allowed emails.";
    } finally {
      isLoadingUsers = false;
    }
  }

  async function requestLoginCode(event) {
    event.preventDefault();

    const email = authEmail.trim().toLowerCase();

    if (!email || isSendingCode) {
      return;
    }

    isSendingCode = true;
    emailErrorMessage = "";
    emailStatusMessage = "";
    setStatus("Sending one-time code", "busy");

    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        applyGate(payload?.gate);
        throw new Error(payload?.error || `Failed to request code with status ${response.status}.`);
      }

      challengeActive = true;
      challengeEmail = email;
      emailStatusMessage =
        payload?.message || "If this email has access, a one-time login code has been sent.";
      loginCode = "";
      await focusActiveControl();
    } catch (error) {
      emailErrorMessage = error instanceof Error ? error.message : "Failed to send sign-in code.";
    } finally {
      isSendingCode = false;
    }
  }

  async function verifyLoginCode(event) {
    event.preventDefault();

    const code = loginCode.trim().toUpperCase();

    if (!code || isVerifyingCode) {
      return;
    }

    isVerifyingCode = true;
    emailErrorMessage = "";
    emailStatusMessage = "";
    setStatus("Verifying email code", "busy");

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ code })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        applyGate(payload?.gate);
        throw new Error(payload?.error || `Failed to verify code with status ${response.status}.`);
      }

      authenticated = true;
      chatUnlocked = true;
      challengeActive = false;
      challengeEmail = "";
      userEmail = payload?.user?.email || authEmail.trim().toLowerCase();
      userRole = payload?.user?.role || "member";
      isAdmin = userRole === "admin";
      loginCode = "";
      authEmail = userEmail;
      emailStatusMessage = `Signed in as ${userEmail}.`;

      if (isAdmin) {
        await loadAuthorizedUsers();
      }

      void focusPrompt();
    } catch (error) {
      emailErrorMessage = error instanceof Error ? error.message : "Failed to verify sign-in code.";
    } finally {
      isVerifyingCode = false;
      if (!chatUnlocked) {
        void focusActiveControl();
      }
    }
  }

  async function saveAuthorizedUser(event) {
    event.preventDefault();

    const email = manageEmail.trim().toLowerCase();

    if (!email || isSavingUser) {
      return;
    }

    isSavingUser = true;
    manageErrorMessage = "";
    manageStatusMessage = "";

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          role: manageRole
        })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        applyGate(payload?.gate);
        throw new Error(payload?.error || `Failed to save email with status ${response.status}.`);
      }

      authorizedUsers = Array.isArray(payload?.users) ? payload.users : authorizedUsers;
      manageEmail = "";
      manageRole = "member";
      manageStatusMessage = `Saved ${email}.`;
    } catch (error) {
      manageErrorMessage = error instanceof Error ? error.message : "Failed to save allowed email.";
    } finally {
      isSavingUser = false;
    }
  }

  async function removeAuthorizedUser(email) {
    if (!email || removingEmail) {
      return;
    }

    removingEmail = email;
    manageErrorMessage = "";
    manageStatusMessage = "";

    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        applyGate(payload?.gate);
        throw new Error(payload?.error || `Failed to remove email with status ${response.status}.`);
      }

      authorizedUsers = Array.isArray(payload?.users) ? payload.users : authorizedUsers;
      manageStatusMessage = `Removed ${email}.`;
    } catch (error) {
      manageErrorMessage = error instanceof Error ? error.message : "Failed to remove allowed email.";
    } finally {
      removingEmail = "";
    }
  }

  async function submitChatRequest(requestPayloadMessages, loadingMessage) {
    const controller = new AbortController();
    requestController = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages: requestPayloadMessages }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        lastFailedRequestMessages = requestPayloadMessages;

        if (response.status === 401 || response.status === 503) {
          applyGate(payload?.gate);
          replaceMessage(loadingMessage.id, {
            content: LOCKED_ASSISTANT_MESSAGE,
            loading: false,
            error: true,
            localOnly: true,
            retryable: true
          });
          emailErrorMessage = payload?.error || "Email login required again.";
          setStatus("Chat locked until you sign in again", "error");
          connectionPill = "Email login required";
          void focusActiveControl();
          return;
        }

        if (payload && typeof payload.error === "string") {
          replaceMessage(loadingMessage.id, {
            content: payload.error,
            loading: false,
            error: true,
            retryable: true,
            manager: payload.manager && typeof payload.manager === "object" ? payload.manager : null,
            branches: Array.isArray(payload.branches) ? payload.branches : [],
            assembly: payload.assembly && typeof payload.assembly === "object" ? payload.assembly : null
          });
          setStatus("Request returned diagnostics", "error");
          connectionPill = "Backend returned an error";
          return;
        }

        throw new Error(`Request failed with status ${response.status}`);
      }

      if (!payload || typeof payload.reply !== "string") {
        throw new Error("Invalid response format. Expected { reply: string }.");
      }

      lastFailedRequestMessages = null;
      replaceMessage(loadingMessage.id, {
        content: payload.reply,
        loading: false,
        error: false,
        retryable: false,
        manager: payload.manager && typeof payload.manager === "object" ? payload.manager : null,
        branches: Array.isArray(payload.branches) ? payload.branches : [],
        assembly: payload.assembly && typeof payload.assembly === "object" ? payload.assembly : null
      });
    } catch (error) {
      const wasAborted = error instanceof Error && error.name === "AbortError";

      lastFailedRequestMessages = requestPayloadMessages;
      replaceMessage(loadingMessage.id, {
        content: wasAborted
          ? "Response stopped before completion. Retry when ready."
          : `Request failed. ${error instanceof Error ? error.message : "Unknown error."}`,
        loading: false,
        error: true,
        localOnly: wasAborted,
        retryable: true
      });
      setStatus(wasAborted ? "Request stopped" : "Error talking to /api/chat", "error");
      connectionPill = wasAborted ? "Request stopped" : "Backend unavailable";

      if (!wasAborted) {
        console.error(error);
      }
    } finally {
      if (requestController === controller) {
        requestController = null;
      }

      isSending = false;
      if (chatUnlocked) {
        void focusPrompt();
      } else {
        void focusActiveControl();
      }
    }
  }

  async function sendMessage() {
    const trimmed = prompt.trim();

    if (!chatUnlocked || !trimmed || isSending) {
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus("You are offline", "error");
      connectionPill = "Network unavailable";
      return;
    }

    isSending = true;
    lastFailedRequestMessages = null;
    setStatus("Sending request to /api/chat", "busy");

    const userMessage = createMessage("user", trimmed);
    const loadingMessage = createLoadingMessage();
    const requestMessages = [...messages, userMessage];
    const requestPayloadMessages = buildChatRequestMessages(requestMessages);

    messages = [...requestMessages, loadingMessage];
    prompt = "";
    await tick();
    resizePrompt();

    await submitChatRequest(requestPayloadMessages, loadingMessage);
  }

  async function retryLastRequest() {
    if (!chatUnlocked || isSending || !Array.isArray(lastFailedRequestMessages)) {
      return;
    }

    if (messages.at(-1)?.retryable) {
      messages = messages.slice(0, -1);
    }

    isSending = true;
    setStatus("Retrying the last request", "busy");

    const loadingMessage = createLoadingMessage("Retrying the last request");
    messages = [...messages, loadingMessage];
    await tick();

    await submitChatRequest(lastFailedRequestMessages, loadingMessage);
  }

  function stopRequest() {
    requestController?.abort();
  }

  function clearConversation() {
    if (!chatUnlocked || isSending) {
      return;
    }

    messages = [createMessage("assistant", CLEARED_ASSISTANT_MESSAGE, { localOnly: true })];
    lastFailedRequestMessages = null;
    setStatus("Ready", "idle");
    connectionPill = "Connected to /api/chat";
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
    restoreChatState();
    hasMounted = true;
    resizePrompt();
    void focusActiveControl();

    if (authenticated && isAdmin && authorizedUsers.length === 0) {
      void loadAuthorizedUsers();
    }

    return () => {
      requestController?.abort();
    };
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

  $: chatUnlocked = authenticated;

  $: if (authenticated) {
    challengeActive = false;
    challengeEmail = "";
    authEmail = userEmail;
  }

  $: if (hasMounted) {
    messages;
    prompt;
    authEmail;
    persistChatState();
  }

  $: if (!isSending && !isSendingCode && !isVerifyingCode) {
    if (chatUnlocked && Array.isArray(lastFailedRequestMessages)) {
      setStatus("Last request did not complete. Retry when ready.", "error");
      connectionPill = "Retry available";
    } else if (chatUnlocked) {
      setStatus("Ready", "idle");
      connectionPill = userRole === "admin" ? "Admin session active" : "Approved email session active";
    } else if (!sessionSecretConfigured) {
      setStatus("SESSION_TOKEN_SECRET not configured", "error");
      connectionPill = "Email login unavailable";
    } else if (!adminBootstrapConfigured) {
      setStatus("EMAIL_AUTH_ADMINS not configured", "error");
      connectionPill = "Admin bootstrap missing";
    } else if (!storeConfigured) {
      setStatus("Access storage not configured", "error");
      connectionPill = "Email access storage unavailable";
    } else if (!mailConfigured) {
      setStatus("Email delivery not configured", "error");
      connectionPill = "SMTP not configured";
    } else if (challengeActive) {
      setStatus(
        "Enter the one-time code if it arrives in the approved inbox",
        emailErrorMessage ? "error" : "locked"
      );
      connectionPill = "Waiting for email code";
    } else {
      setStatus("Approved email login required", emailErrorMessage ? "error" : "locked");
      connectionPill = "Email login required";
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
      A SvelteKit browser chat wired to a manager-led GPT pipeline. Access is now gated by
      approved-email sign-in with one-time codes, and admin users can authorize additional emails.
    </p>
    <div class="hero-meta">
      <span class="pill">{connectionPill}</span>
      <span class="pill subtle">
        {#if authenticated}
          {userRole === "admin" ? "Admin email session" : "Approved email session"}
        {:else if challengeActive}
          Waiting for email code
        {:else}
          Approved email required
        {/if}
      </span>
    </div>
  </section>

  {#if authenticated && isAdmin}
    <section class="card admin-panel">
      <div class="chat-topbar">
        <div>
          <div class="chat-title">Admin Access</div>
          <div class="chat-status" data-mode={manageErrorMessage ? "error" : "idle"} aria-live="polite">
            {manageErrorMessage || manageStatusMessage || "Manage who can request email login codes."}
          </div>
        </div>

        <button class="ghost-button" type="button" on:click={loadAuthorizedUsers} disabled={isLoadingUsers}>
          {isLoadingUsers ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div class="admin-grid">
        <form class="gate-card admin-card" on:submit={saveAuthorizedUser}>
          <div class="gate-card-header">
            <div>
              <div class="gate-kicker">Admin</div>
              <h3 class="gate-card-title">Authorize an email</h3>
            </div>

            <span class="gate-badge" data-state="done">Admin</span>
          </div>

          <label class="sr-only" for="manage-email">Email</label>
          <input
            id="manage-email"
            class="gate-input"
            type="email"
            bind:value={manageEmail}
            placeholder="person@example.com"
            autocomplete="email"
            spellcheck="false"
            disabled={isSavingUser}
          />

          <label class="sr-only" for="manage-role">Role</label>
          <select id="manage-role" class="gate-select" bind:value={manageRole} disabled={isSavingUser}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>

          <button class="gate-button" type="submit" disabled={!manageEmail.trim() || isSavingUser}>
            {isSavingUser ? "Saving..." : "Save access"}
          </button>
        </form>

        <div class="gate-card admin-card">
          <div class="gate-card-header">
            <div>
              <div class="gate-kicker">Allowed Emails</div>
              <h3 class="gate-card-title">Current access list</h3>
            </div>

            <span class="gate-badge" data-state={authorizedUsers.length > 0 ? "done" : "pending"}>
              {authorizedUsers.length}
            </span>
          </div>

          <div class="admin-user-list">
            {#each authorizedUsers as authorizedUser (authorizedUser.email)}
              <div class="admin-user">
                <div>
                  <div class="admin-user-email">{authorizedUser.email}</div>
                  <div class="admin-meta">
                    {authorizedUser.source === "bootstrap"
                      ? "Bootstrap admin from env"
                      : `Added by ${authorizedUser.addedBy || "admin"}`}
                  </div>
                </div>

                <div class="admin-user-actions">
                  <span class="admin-role-chip" data-role={authorizedUser.role}>{authorizedUser.role}</span>

                  {#if authorizedUser.source !== "bootstrap"}
                    <button
                      class="ghost-button admin-remove"
                      type="button"
                      disabled={removingEmail === authorizedUser.email}
                      on:click={() => removeAuthorizedUser(authorizedUser.email)}
                    >
                      {removingEmail === authorizedUser.email ? "Removing..." : "Remove"}
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </section>
  {/if}

  <section class="chat card" aria-label="Chat">
    <div class="chat-topbar">
      <div>
        <div class="chat-title">Conversation</div>
        <div class="chat-status" data-mode={statusMode} aria-live="polite">{statusText}</div>
      </div>

      <div class="toolbar-actions">
        {#if chatUnlocked}
          {#if Array.isArray(lastFailedRequestMessages) && !isSending}
            <button class="ghost-button" type="button" on:click={retryLastRequest}>
              Retry
            </button>
          {/if}

          {#if isSending}
            <button class="ghost-button" type="button" on:click={stopRequest}>
              Stop
            </button>
          {/if}

          <button class="ghost-button" type="button" on:click={clearConversation} disabled={isSending}>
            Clear
          </button>
        {/if}

        {#if authenticated || challengeActive}
          <form method="POST" action="/logout">
            <button
              class="ghost-button"
              type="submit"
              disabled={isSending || isSendingCode || isVerifyingCode}
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
          <div class="gate-kicker">Secure Access</div>
          <h2 class="gate-heading">Approved email sign-in</h2>
          <p class="gate-text">
            Enter an approved email address. If that address has access, the server sends a one-time
            code that can be used once to unlock the chat.
          </p>
        </div>

        <section class="gate-card">
          <div class="gate-card-header">
            <div>
              <div class="gate-kicker">Step 1</div>
              <h3 class="gate-card-title">Request a login code</h3>
            </div>

            <span class="gate-badge" data-state={authenticated ? "done" : challengeActive ? "active" : "pending"}>
              {authenticated ? "Connected" : challengeActive ? "Check inbox" : "Required"}
            </span>
          </div>

          {#if authenticated}
            <div class="gate-identity">
              <div>
                <div class="gate-identity-name">{userEmail}</div>
                <div class="gate-identity-email">{userRole}</div>
              </div>
            </div>
          {:else}
            <form class="gate-form" on:submit={requestLoginCode}>
              <label class="sr-only" for="auth-email">Approved email</label>
              <input
                id="auth-email"
                class="gate-input"
                type="email"
                bind:this={emailInputEl}
                bind:value={authEmail}
                placeholder="you@example.com"
                autocomplete="email"
                spellcheck="false"
                disabled={isSendingCode || !sessionSecretConfigured || !mailConfigured || !storeConfigured || !adminBootstrapConfigured}
              />
              <button
                class="gate-button"
                type="submit"
                disabled={!authEmail.trim() || isSendingCode || !sessionSecretConfigured || !mailConfigured || !storeConfigured || !adminBootstrapConfigured}
              >
                {isSendingCode ? "Sending..." : "Send code"}
              </button>
            </form>

            {#if challengeActive}
              <form class="gate-form" on:submit={verifyLoginCode}>
                <label class="sr-only" for="login-code">Login code</label>
                <input
                  id="login-code"
                  class="gate-input"
                  type="text"
                  bind:this={codeInputEl}
                  bind:value={loginCode}
                  placeholder="Enter one-time code"
                  autocomplete="one-time-code"
                  spellcheck="false"
                  disabled={isVerifyingCode}
                />
                <button class="gate-button" type="submit" disabled={!loginCode.trim() || isVerifyingCode}>
                  {isVerifyingCode ? "Verifying..." : "Verify code"}
                </button>
              </form>
            {/if}
          {/if}

          {#if challengeActive && challengeEmail}
            <div class="gate-note">
              If {challengeEmail} has access, use the one-time code from that inbox.
            </div>
          {/if}

          {#if emailStatusMessage}
            <div class="gate-note">{emailStatusMessage}</div>
          {/if}

          {#if !sessionSecretConfigured}
            <div class="gate-error">SESSION_TOKEN_SECRET is not configured.</div>
          {:else if !adminBootstrapConfigured}
            <div class="gate-error">EMAIL_AUTH_ADMINS is not configured.</div>
          {:else if !storeConfigured}
            <div class="gate-error">
              Durable email access storage is not configured. Set `BLOB_READ_WRITE_TOKEN` in production.
            </div>
          {:else if !mailConfigured}
            <div class="gate-error">
              Email delivery is not configured. Set `SMTP_URL` and `SMTP_FROM`, or SMTP host/user/pass settings.
            </div>
          {/if}

          {#if emailErrorMessage}
            <div class="gate-error">{emailErrorMessage}</div>
          {/if}
        </section>
      </div>
    {/if}
  </section>
</main>
