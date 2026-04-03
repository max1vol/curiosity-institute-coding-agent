# curiosity-institute-coding-agent

Minimal browser chat app wired to OpenAI `gpt-5.4` with reasoning effort set to `xhigh`, runnable locally and deployable to Vercel.

Each user turn is fanned out into several specialized GPT branches running in parallel, then a final assembly pass merges those branch outputs into one assistant reply.

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
- The current branch workers are `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`, all running in parallel before the final assembly step.
- Vercel uses the serverless entrypoint in `api/chat.js` and the root static files `index.html`, `app.js`, and `styles.css`.
- Set `OPENAI_API_KEY` in the Vercel project environment before expecting production chat requests to work.
