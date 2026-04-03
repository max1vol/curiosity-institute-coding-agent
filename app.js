(function () {
  const messagesEl = document.getElementById("messages");
  const composerEl = document.getElementById("composer");
  const promptEl = document.getElementById("prompt");
  const sendButton = document.getElementById("send-button");
  const clearButton = document.getElementById("clear-button");
  const statusEl = document.getElementById("status");
  const connectionPill = document.getElementById("connection-pill");

  const state = {
    messages: [
      {
        role: "assistant",
        content:
          "I’m ready. Each turn is steered by a manager GPT, delegated to worker subagents, then reassembled into one final answer."
      }
    ],
    isSending: false
  };

  function setStatus(text, mode = "idle") {
    statusEl.textContent = text;
    statusEl.dataset.mode = mode;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function createTextBlock(className, text) {
    const element = document.createElement("div");
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function formatAssemblyMeta(assembly) {
    if (!assembly || typeof assembly !== "object") {
      return "";
    }

    const parts = [];
    if (assembly.model) {
      parts.push(assembly.model);
    }
    if (assembly.reasoningEffort) {
      parts.push(assembly.reasoningEffort);
    }
    if (assembly.strategy) {
      parts.push(assembly.strategy);
    }

    return parts.join(" · ");
  }

  function formatManagerMeta(manager) {
    if (!manager || typeof manager !== "object") {
      return "";
    }

    const parts = [];
    if (manager.name) {
      parts.push(manager.name);
    }
    if (manager.model) {
      parts.push(manager.model);
    }
    if (manager.reasoningEffort) {
      parts.push(manager.reasoningEffort);
    }
    if (manager.strategy) {
      parts.push(manager.strategy);
    }

    return parts.join(" · ");
  }

  function createManagerStrip(manager) {
    const strip = document.createElement("section");
    strip.className = "manager-strip";

    const header = document.createElement("div");
    header.className = "manager-strip-header";

    const title = document.createElement("span");
    title.className = "manager-strip-title";
    title.textContent = "Manager brief";

    const meta = document.createElement("span");
    meta.className = "manager-strip-meta";
    meta.textContent = formatManagerMeta(manager);

    header.append(title, meta);
    strip.appendChild(header);

    const brief = document.createElement("div");
    brief.className = "manager-strip-brief";
    brief.textContent = typeof manager?.brief === "string" ? manager.brief : "";
    strip.appendChild(brief);

    return strip;
  }

  function createBranchCard(branch, index) {
    const card = document.createElement("article");
    card.className = "branch-card";

    const header = document.createElement("div");
    header.className = "branch-card-header";

    const identity = document.createElement("div");
    identity.className = "branch-card-identity";

    const key = document.createElement("span");
    key.className = "branch-key";
    key.textContent = branch?.key || `branch-${index + 1}`;

    const name = document.createElement("span");
    name.className = "branch-name";
    name.textContent = branch?.name || `Branch ${index + 1}`;

    identity.append(key, name);

    const meta = document.createElement("span");
    meta.className = "branch-meta";
    meta.textContent = [branch?.model, branch?.reasoningEffort].filter(Boolean).join(" · ");

    header.append(identity, meta);

    card.appendChild(header);

    if (branch?.role) {
      card.appendChild(createTextBlock("branch-role", branch.role));
    }

    if (branch?.task) {
      card.appendChild(createTextBlock("branch-task", branch.task));
    }

    if (Array.isArray(branch?.subagents) && branch.subagents.length > 0) {
      card.appendChild(
        createTextBlock(
          "branch-subagents",
          `Subagents: ${branch.subagents.map((subagent) => subagent.name).join(", ")}`
        )
      );
    }

    card.appendChild(
      createTextBlock("branch-output", typeof branch?.output === "string" ? branch.output : "")
    );

    return card;
  }

  function createAssistantBody(message) {
    const body = document.createElement("div");
    body.className = "message-body";

    body.appendChild(createTextBlock("message-reply", message.content));

    if (
      (message.manager && typeof message.manager === "object") ||
      (Array.isArray(message.branches) && message.branches.length > 0)
    ) {
      const panel = document.createElement("details");
      panel.className = "branch-panel";
      panel.open = true;

      const summary = document.createElement("summary");
      summary.className = "branch-panel-summary";

      const title = document.createElement("span");
      title.className = "branch-panel-title";
      title.textContent = Array.isArray(message.branches)
        ? `Parallel branches (${message.branches.length})`
        : "Parallel branches";

      const assembly = document.createElement("span");
      assembly.className = "branch-panel-assembly";
      assembly.textContent = formatAssemblyMeta(message.assembly);

      summary.append(title, assembly);
      panel.appendChild(summary);

      if (message.manager && typeof message.manager === "object") {
        panel.appendChild(createManagerStrip(message.manager));
      }

      if (Array.isArray(message.branches) && message.branches.length > 0) {
        const grid = document.createElement("div");
        grid.className = "branch-grid";

        message.branches.forEach((branch, index) => {
          grid.appendChild(createBranchCard(branch, index));
        });

        panel.appendChild(grid);
      }

      body.appendChild(panel);
    }

    return body;
  }

  function createMessageElement(message) {
    const el = document.createElement("article");
    el.className = `message ${message.role}${message.loading ? " loading" : ""}${message.error ? " error" : ""}`;
    el.setAttribute("data-role", message.role);
    if (message.id) {
      el.dataset.id = message.id;
    }

    if (message.role === "assistant") {
      el.appendChild(createAssistantBody(message));
      return el;
    }

    el.appendChild(createTextBlock("message-text", message.content));
    return el;
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    for (const message of state.messages) {
      messagesEl.appendChild(createMessageElement(message));
    }
    scrollToBottom();
  }

  function updateComposerState() {
    sendButton.disabled = state.isSending;
    promptEl.disabled = state.isSending;
    clearButton.disabled = state.isSending;
    promptEl.style.height = "auto";
    promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
  }

  function addMessage(role, content, extra = {}) {
    const message = {
      id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content,
      ...extra
    };
    state.messages.push(message);
    const el = createMessageElement(message);
    messagesEl.appendChild(el);
    scrollToBottom();
    return message;
  }

  function replaceMessage(id, next) {
    const index = state.messages.findIndex((message) => message.id === id);
    if (index === -1) {
      return;
    }

    state.messages[index] = {
      ...state.messages[index],
      ...next
    };

    const currentEl = messagesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (currentEl) {
      const nextEl = createMessageElement(state.messages[index]);
      messagesEl.replaceChild(nextEl, currentEl);
    }
    scrollToBottom();
  }

  function removeMessage(id) {
    state.messages = state.messages.filter((message) => message.id !== id);
    const el = messagesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.remove();
    }
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || state.isSending) {
      return;
    }

    state.isSending = true;
    setStatus("Sending request to /api/chat", "busy");
    updateComposerState();

    addMessage("user", trimmed);
    const loadingMessage = addMessage(
      "assistant",
      "Manager GPT is briefing worker subagents",
      { loading: true }
    );

    promptEl.value = "";
    promptEl.style.height = "auto";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: state.messages
            .filter((message) => !message.loading && !message.error)
            .map(({ role, content }) => ({ role, content }))
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (data && typeof data.error === "string") {
          removeMessage(loadingMessage.id);
          addMessage("assistant", data.error, {
            error: true,
            manager: data.manager && typeof data.manager === "object" ? data.manager : null,
            branches: Array.isArray(data.branches) ? data.branches : [],
            assembly: data.assembly && typeof data.assembly === "object" ? data.assembly : null
          });
          setStatus("Request returned diagnostics", "error");
          connectionPill.textContent = "Backend returned an error";
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
      connectionPill.textContent = "Connected to /api/chat";
    } catch (error) {
      removeMessage(loadingMessage.id);
      addMessage(
        "system",
        `Request failed. ${error instanceof Error ? error.message : "Unknown error."}`,
        { error: true }
      );
      setStatus("Error talking to /api/chat", "error");
      connectionPill.textContent = "Backend unavailable";
      console.error(error);
    } finally {
      state.isSending = false;
      updateComposerState();
      promptEl.focus();
    }
  }

  composerEl.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(promptEl.value);
  });

  promptEl.addEventListener("input", updateComposerState);
  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composerEl.requestSubmit();
    }
  });

  clearButton.addEventListener("click", () => {
    if (state.isSending) {
      return;
    }
    state.messages = [
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content:
          "Conversation cleared. Send a new prompt and I’ll start a fresh manager-led subagent run."
      }
    ];
    renderMessages();
    setStatus("Ready", "idle");
    connectionPill.textContent = "Connecting to /api/chat";
    promptEl.focus();
  });

  renderMessages();
  updateComposerState();
  setStatus("Ready", "idle");
  promptEl.focus();
})();
