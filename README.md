# curiosity-institute-coding-agent

SvelteKit chat app wired to OpenAI `gpt-5.4` through `@ljoukov/llm`, with secure email OTP login and admin-managed email access.

Each user turn is first planned by a manager GPT, then delegated to specialized worker GPTs that each use their own subagents, and only then merged by a final assembly pass.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Set `SESSION_TOKEN_SECRET`.
4. Set `EMAIL_AUTH_ADMINS` to one or more bootstrap admin emails, comma-separated.
   Example: `EMAIL_AUTH_ADMINS=max1.volovich@gmail.com`
5. Configure email delivery:

```bash
SMTP_URL=
SMTP_FROM=
```

Or set the explicit SMTP fields:

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

6. For local development, the allowlist store defaults to `AUTH_STORE_FILE=.data/email-access-store.json`.
7. For Vercel, add Blob storage so `BLOB_READ_WRITE_TOKEN` is available, or set it manually if the store lives in another project. `AUTH_STORE_BLOB_PATHNAME` is optional.
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

- The frontend lives in `src/routes/+page.svelte`.
- The chat API remains at `/api/chat`, implemented by `src/routes/api/chat/+server.js`.
- Secure login uses one-time email codes requested through `src/routes/api/auth/request-code/+server.js` and verified through `src/routes/api/auth/verify-code/+server.js`.
- The latest issued code replaces older pending codes for the same email, and successful verification consumes the server-side challenge so it cannot be reused.
- Authorized emails and roles are persisted through `src/lib/server/access-store.js`.
- Email delivery is handled by `src/lib/server/mailer.js`.
- Admin users can add or remove authorized emails through `src/routes/api/admin/users/+server.js`.
- Session and OTP cookies are signed, `HttpOnly`, and `SameSite=Strict`.
- The shared orchestration lives in `src/lib/server/chat.js`.
- OpenAI web search is enabled only on the final assembly pass when the prompt looks freshness-sensitive; internal planning and worker stages stay tool-free for speed.
- `@ljoukov/llm@7` requires Node `22`, so local dev and Vercel builds need to stay on that runtime.
