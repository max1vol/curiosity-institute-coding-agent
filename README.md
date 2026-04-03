# curiosity-institute-coding-agent

SvelteKit chat app wired to OpenAI `gpt-5.4` with final reasoning effort set to `xhigh`, runnable locally and deployable to Vercel.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

5. Open `http://localhost:3000`.

## Notes

- The frontend is now a SvelteKit app in `src/routes/+page.svelte`.
- The chat API remains at `/api/chat`, now implemented by `src/routes/api/chat/+server.js`.
- The shared orchestration lives in `src/lib/server/chat.js`.
- Chat requests use the Responses API with `model: "gpt-5.4"` and `reasoning.effort: "xhigh"` for the final assembly pass.
- OpenAI web search is enabled through the Responses API `tools` array, so the manager, workers, and final answer can search the web when the model decides it is useful.
- `Manager GPT` steers the run, assigning work to `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`.
- Each worker lead runs its own subagents before producing its branch output for the final assembly step.
- The app uses the Vercel adapter for SvelteKit; do not keep root-level `api/*` functions alongside it.
- Set `OPENAI_API_KEY` in the Vercel project environment before expecting production chat requests to work.
