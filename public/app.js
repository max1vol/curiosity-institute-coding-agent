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
          "I’m ready. Send a message and I’ll keep the full conversation history in the request payload.",
      },
    ],
    isSending: false,
  };

  function setStatus(text, mode = "idle") {
    statusEl.textContent = text;
    statusEl.dataset.mode = mode;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createMessageElement(message) {
    const el = document.createElement("article");
    el.className = `message ${message.role}${message.loading ? " loading" : ""}${message.error ? " error" : ""}`;
    el.setAttribute("data-role", message.role);
    if (message.id) {
      el.dataset.id = message.id;
    }
    el.innerHTML = escapeHtml(message.content);
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
      ...extra,
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
      ...next,
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

    const userMessage = addMessage("user", trimmed);
    const loadingMessage = addMessage("assistant", "Thinking", { loading: true });

    promptEl.value = "";
    promptEl.style.height = "auto";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: state.messages
            .filter((message) => !message.loading && !message.error)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || typeof data.reply !== "string") {
        throw new Error("Invalid response format. Expected { reply: string }.");
      }

      replaceMessage(loadingMessage.id, {
        content: data.reply,
        loading: false,
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
          "Conversation cleared. Send a new prompt and I’ll start from scratch.",
      },
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
