import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { clearEmailAuthCookie, createAccessState, createNoStoreHeaders } from "$lib/server/access";
import {
  createAccessStoreConfig,
  isAccessStoreConfigured,
  validateAuthorizedSession
} from "$lib/server/access-store";
import { normalizeMessages, requestReply } from "$lib/server/chat";
import { createMailConfig, isMailConfigured } from "$lib/server/mailer";

export const config = {
  split: true,
  maxDuration: 300
};

function createGate(accessState) {
  return {
    authConfigured: accessState.authConfigured,
    sessionSecretConfigured: accessState.sessionSecretConfigured,
    mailConfigured: accessState.mailConfigured,
    storeConfigured: accessState.storeConfigured,
    adminBootstrapConfigured: accessState.adminBootstrapConfigured,
    authenticated: accessState.authenticated,
    challengeActive: accessState.challengeActive,
    readyForChat: accessState.readyForChat,
    isAdmin: accessState.isAdmin
  };
}

function createGateErrorResponse(accessState, headers) {
  const gate = createGate(accessState);

  if (!accessState.sessionSecretConfigured) {
    return json(
      { error: "SESSION_TOKEN_SECRET is not configured.", gate },
      { status: 503, headers }
    );
  }

  if (!accessState.adminBootstrapConfigured) {
    return json(
      { error: "EMAIL_AUTH_ADMINS is not configured.", gate },
      { status: 503, headers }
    );
  }

  if (!accessState.storeConfigured) {
    return json(
      {
        error:
          "Durable email access storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel or use local file storage in development.",
        gate
      },
      { status: 503, headers }
    );
  }

  if (!accessState.mailConfigured) {
    return json(
      {
        error:
          "Email delivery is not configured. Set SMTP_URL and SMTP_FROM, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM.",
        gate
      },
      { status: 503, headers }
    );
  }

  return json(
    { error: "Email login required before using the chat.", gate },
    { status: 401, headers }
  );
}

export async function POST({ request, cookies }) {
  const headers = createNoStoreHeaders();
  const storeConfig = createAccessStoreConfig(privateEnv);
  const mailConfig = createMailConfig(privateEnv);
  const initialAccessState = createAccessState(cookies, {
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    adminEmailsValue: privateEnv.EMAIL_AUTH_ADMINS,
    mailConfigured: isMailConfigured(mailConfig),
    storeConfigured: isAccessStoreConfigured(storeConfig)
  });
  const accessState = await validateAuthorizedSession(
    initialAccessState,
    storeConfig,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  if (initialAccessState.authenticated && !accessState.authenticated) {
    clearEmailAuthCookie(cookies, request.url.startsWith("https:"));
  }

  if (!accessState.readyForChat) {
    return createGateErrorResponse(accessState, headers);
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  let messages;

  try {
    messages = normalizeMessages(parsed.messages);
  } catch (error) {
    return json({ error: error.message }, { status: 400, headers });
  }

  const result = await requestReply(privateEnv.OPENAI_API_KEY, messages);
  return json(result.payload, { status: result.status, headers });
}
