# curiosity-institute-coding-agent

SvelteKit chat app wired to OpenAI `gpt-5.4` through `@ljoukov/llm`, runnable locally and deployable to Vercel.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Set `CHAT_ACCESS_CODE` to a secret value only you know.
4. Use Node `22.x`.
5. Install dependencies:

```bash
npm install
```

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Notes

- The frontend is now a SvelteKit app in `src/routes/+page.svelte`.
- The chat API remains at `/api/chat`, now implemented by `src/routes/api/chat/+server.js`.
- Verification is handled by `src/routes/api/verify/+server.js` and enforced server-side before `/api/chat` will respond.
- The shared orchestration lives in `src/lib/server/chat.js`.
- Verified sessions are tracked with an `HttpOnly` cookie, so the browser never gets direct access to the verification token.
- Chat transport now goes through `@ljoukov/llm` `generateText()` with `model: "gpt-5.4"` and the library's highest `thinkingLevel` for the final assembly pass.
- OpenAI web search is enabled through `@ljoukov/llm` provider-native tools, so the manager, workers, and final answer can search the web when the model decides it is useful.
- `Manager GPT` steers the run, assigning work to `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`.
- Each worker lead runs its own subagents before producing its branch output for the final assembly step.
- The app uses the Vercel adapter for SvelteKit; do not keep root-level `api/*` functions alongside it.
- Set both `OPENAI_API_KEY` and `CHAT_ACCESS_CODE` in the Vercel project environment before expecting production chat requests to work.
- `@ljoukov/llm@7` requires Node `22`, so local dev and Vercel builds need to stay on that runtime.
