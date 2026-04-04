import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import {
  clearEmailChallengeCookie,
  createAccessState,
  createNoStoreHeaders,
  normalizeEmail,
  setEmailAuthCookie
} from "$lib/server/access";
import {
  consumeOtpChallenge,
  createAccessStoreConfig,
  isAccessStoreConfigured,
  resolveAuthorizedUser
} from "$lib/server/access-store";
import { createMailConfig, isMailConfigured } from "$lib/server/mailer";

export const config = {
  split: true
};

function createGate(accessState) {
  return {
    authConfigured: accessState.authConfigured,
    sessionSecretConfigured: accessState.sessionSecretConfigured,
    adminBootstrapConfigured: accessState.adminBootstrapConfigured,
    mailConfigured: accessState.mailConfigured,
    storeConfigured: accessState.storeConfigured,
    authenticated: accessState.authenticated,
    challengeActive: accessState.challengeActive,
    readyForChat: accessState.readyForChat,
    isAdmin: accessState.isAdmin
  };
}

export async function POST({ request, cookies, url }) {
  const headers = createNoStoreHeaders();
  const storeConfig = createAccessStoreConfig(privateEnv);
  const mailConfig = createMailConfig(privateEnv);
  const accessState = createAccessState(cookies, {
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    adminEmailsValue: privateEnv.EMAIL_AUTH_ADMINS,
    mailConfigured: isMailConfigured(mailConfig),
    storeConfigured: isAccessStoreConfigured(storeConfig)
  });

  if (
    !accessState.sessionSecretConfigured ||
    !accessState.adminBootstrapConfigured ||
    !accessState.storeConfigured
  ) {
    return json(
      {
        error:
          "Email login verification is not fully configured. Set SESSION_TOKEN_SECRET, EMAIL_AUTH_ADMINS, and durable auth storage.",
        gate: createGate(accessState)
      },
      { status: 503, headers }
    );
  }

  if (!accessState.challengeActive || !accessState.challenge) {
    return json(
      { error: "Request a new login code first.", gate: createGate(accessState) },
      { status: 401, headers }
    );
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  const submittedCode = typeof parsed?.code === "string" ? parsed.code.trim() : "";

  if (!submittedCode) {
    return json({ error: "Enter the one-time login code." }, { status: 400, headers });
  }

  const secure = url.protocol === "https:";
  const challengeResult = await consumeOtpChallenge(
    storeConfig,
    accessState.challenge,
    submittedCode,
    privateEnv.SESSION_TOKEN_SECRET
  );

  if (challengeResult.status === "missing") {
    clearEmailChallengeCookie(cookies, secure);
    return json(
      { error: "Request a new login code first.", gate: createGate(accessState) },
      { status: 401, headers }
    );
  }

  if (challengeResult.status === "invalid") {
    if (challengeResult.attemptsRemaining <= 0) {
      clearEmailChallengeCookie(cookies, secure);
      return json(
        { error: "Too many invalid attempts. Request a new login code.", gate: createGate(accessState) },
        { status: 401, headers }
      );
    }

    return json(
      {
        error: `Invalid login code. ${challengeResult.attemptsRemaining} attempt${challengeResult.attemptsRemaining === 1 ? "" : "s"} remaining.`,
        gate: createGate(accessState)
      },
      { status: 401, headers }
    );
  }

  const authorizedUser = await resolveAuthorizedUser(
    storeConfig,
    challengeResult.user.email,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  clearEmailChallengeCookie(cookies, secure);

  if (!authorizedUser) {
    return json(
      { error: "Request a new login code first.", gate: createGate(accessState) },
      { status: 401, headers }
    );
  }

  setEmailAuthCookie(cookies, privateEnv.SESSION_TOKEN_SECRET, secure, {
    email: normalizeEmail(authorizedUser.email),
    role: authorizedUser.role
  });

  return json(
    {
      ok: true,
      user: {
        email: normalizeEmail(authorizedUser.email),
        role: authorizedUser.role
      }
    },
    { headers }
  );
}
