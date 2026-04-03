# curiosity-institute-coding-agent

SvelteKit chat app wired to OpenAI `gpt-5.4` with final reasoning effort set to `xhigh`, runnable locally and deployable to Vercel.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Set `CHAT_ACCESS_CODE` to a secret value only you know.
4. Install dependencies:

```bash
npm install
```

5. Start the app:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Notes

- The frontend is now a SvelteKit app in `src/routes/+page.svelte`.
- The chat API remains at `/api/chat`, now implemented by `src/routes/api/chat/+server.js`.
- Verification is handled by `src/routes/api/verify/+server.js` and enforced server-side before `/api/chat` will respond.
- The shared orchestration lives in `src/lib/server/chat.js`.
- Verified sessions are tracked with an `HttpOnly` cookie, so the browser never gets direct access to the verification token.
- Chat requests use the Responses API with `model: "gpt-5.4"` and `reasoning.effort: "xhigh"` for the final assembly pass.
- OpenAI web search is enabled through the Responses API `tools` array, so the manager, workers, and final answer can search the web when the model decides it is useful.
- `Manager GPT` steers the run, assigning work to `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`.
- Each worker lead runs its own subagents before producing its branch output for the final assembly step.
- The app uses the Vercel adapter for SvelteKit; do not keep root-level `api/*` functions alongside it.
- Set both `OPENAI_API_KEY` and `CHAT_ACCESS_CODE` in the Vercel project environment before expecting production chat requests to work.
