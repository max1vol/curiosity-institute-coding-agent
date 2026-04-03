# curiosity-institute-coding-agent

Minimal browser chat app wired to OpenAI `gpt-5.4` with reasoning effort set to `xhigh`, runnable locally and deployable to Vercel.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`.

## Notes

- `server.js` loads `.env` automatically, so you do not need extra tooling to inject env vars.
- The browser never sees your OpenAI API key. Requests go through `server.js`.
- Chat requests use the Responses API with `model: "gpt-5.4"` and `reasoning.effort: "xhigh"`.
- OpenAI web search is enabled through the Responses API `tools` array, so the manager, workers, and final answer can search the web when the model decides it is useful.
- `Manager GPT` steers the run, assigning work to `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`.
- Each worker lead runs its own subagents before producing its branch output for the final assembly step.
- Vercel uses the serverless entrypoint in `api/chat.js` and the root static files `index.html`, `app.js`, and `styles.css`.
- Set `OPENAI_API_KEY` in the Vercel project environment before expecting production chat requests to work.
