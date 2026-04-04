# curiosity-institute-coding-agent

SvelteKit chat app wired to OpenAI `gpt-5.4` through `@ljoukov/llm`, runnable locally and deployable to Vercel.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Set `PUBLIC_GOOGLE_CLIENT_ID` to your Google web client ID.
4. Optionally set `GOOGLE_ALLOWED_EMAILS` to a comma-separated allowlist. If left blank, any verified Google account can sign in.
5. Set `CHAT_VOUCHERS` to a comma-separated list of voucher codes that can activate access.
6. Set `CHAT_ACCESS_CODE` to the final verification code.
7. Optionally set `SESSION_TOKEN_SECRET`. If omitted, signed auth cookies fall back to `CHAT_ACCESS_CODE` as their HMAC key.
8. Use Node `22.x`.
9. Install dependencies:

```bash
npm install
```

10. Start the app:

```bash
npm run dev
```

11. Open `http://localhost:3000`.

## Notes

- The frontend is now a SvelteKit app in `src/routes/+page.svelte`.
- The chat API remains at `/api/chat`, now implemented by `src/routes/api/chat/+server.js`.
- Access is now a 3-step gate: Google sign-in, voucher activation, then final verification.
- Google sign-in is verified server-side in `src/routes/api/google-auth/+server.js` using `google-auth-library`.
- Voucher activation is handled by `src/routes/voucher/+server.js` for native form posts and `src/routes/api/voucher/activate/+server.js` for the in-page activation flow.
- Final verification is handled by `src/routes/api/verify/+server.js` and `src/routes/verify/+server.js`.
- `/api/chat` will only respond after all three gates pass.
- The shared orchestration lives in `src/lib/server/chat.js`.
- Google auth, voucher activation, and verification are all tracked with `HttpOnly` cookies, so the browser never gets direct access to the signed session tokens.
- Chat transport now goes through `@ljoukov/llm` `generateText()` with `model: "gpt-5.4"` and the library's highest `thinkingLevel` for the final assembly pass.
- OpenAI web search is enabled through `@ljoukov/llm` provider-native tools on the final assembly pass when the prompt looks freshness-sensitive; internal planning and worker stages stay tool-free for speed.
- `Manager GPT` steers the run, assigning work to `Mapper GPT`, `Solver GPT`, and `Skeptic GPT`.
- Each worker lead runs its own subagents before producing its branch output for the final assembly step.
- The app uses the Vercel adapter for SvelteKit; do not keep root-level `api/*` functions alongside it.
- Set `OPENAI_API_KEY`, `PUBLIC_GOOGLE_CLIENT_ID`, `CHAT_VOUCHERS`, and `CHAT_ACCESS_CODE` in the Vercel project environment before expecting production chat requests to work.
- If you want to restrict access to only your own Google account, set `GOOGLE_ALLOWED_EMAILS` in Vercel to your email address.
- `@ljoukov/llm@7` requires Node `22`, so local dev and Vercel builds need to stay on that runtime.
