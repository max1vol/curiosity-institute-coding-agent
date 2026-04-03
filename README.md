# curiosity-institute-coding-agent

Minimal browser chat app wired to OpenAI `gpt-5.4` with reasoning effort set to `xhigh`, runnable locally and deployable to Vercel.

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
- Vercel can use the serverless entrypoint in `api/chat.js` while still serving the static files from `public/`.
