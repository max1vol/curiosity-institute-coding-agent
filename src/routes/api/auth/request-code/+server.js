import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import {
  clearEmailChallengeCookie,
  parseAdminEmails,
  createEmailChallenge,
  createNoStoreHeaders,
  isValidEmail,
  normalizeEmail,
  setEmailChallengeCookie
} from "$lib/server/access";
import {
  consumeOtpQuota,
  createAccessStoreConfig,
  isAccessStoreConfigured,
  replaceOtpChallenge,
  resolveAuthorizedUser
} from "$lib/server/access-store";
import { createMailConfig, isMailConfigured, sendLoginCode } from "$lib/server/mailer";

export const config = {
  split: true,
  maxDuration: 60
};

const GENERIC_SUCCESS_MESSAGE =
  "If this email has access, a one-time login code has been sent.";

function createConfigState(sessionSecretConfigured, adminBootstrapConfigured, mailConfigured, storeConfigured) {
  return {
    sessionSecretConfigured,
    adminBootstrapConfigured,
    mailConfigured,
    storeConfigured
  };
}

export async function POST({ request, cookies, url }) {
  const headers = createNoStoreHeaders();
  const storeConfig = createAccessStoreConfig(privateEnv);
  const mailConfig = createMailConfig(privateEnv);
  const sessionSecretConfigured = Boolean(privateEnv.SESSION_TOKEN_SECRET?.trim());
  const adminBootstrapConfigured = parseAdminEmails(privateEnv.EMAIL_AUTH_ADMINS).length > 0;
  const mailConfigured = isMailConfigured(mailConfig);
  const storeConfigured = isAccessStoreConfigured(storeConfig);

  if (!sessionSecretConfigured || !adminBootstrapConfigured || !mailConfigured || !storeConfigured) {
    return json(
      {
        error:
          "Email login is not fully configured. Set SESSION_TOKEN_SECRET, EMAIL_AUTH_ADMINS, SMTP settings, and durable auth storage.",
        gate: createConfigState(
          sessionSecretConfigured,
          adminBootstrapConfigured,
          mailConfigured,
          storeConfigured
        )
      },
      { status: 503, headers }
    );
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  const email = normalizeEmail(parsed?.email);

  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, { status: 400, headers });
  }

  const secure = url.protocol === "https:";
  const authorizedUser = await resolveAuthorizedUser(storeConfig, email, privateEnv.EMAIL_AUTH_ADMINS);
  const quota = await consumeOtpQuota(storeConfig, email);
  const { code, challenge } = createEmailChallenge(
    email,
    authorizedUser?.role || "member",
    privateEnv.SESSION_TOKEN_SECRET
  );

  if (authorizedUser && quota.allowed) {
    try {
      await sendLoginCode(mailConfig, {
        to: authorizedUser.email,
        code,
        expiresAt: challenge.expiresAt
      });
    } catch (error) {
      console.error("Failed to send login code", error);
    }
  }

  try {
    await replaceOtpChallenge(storeConfig, challenge);
    setEmailChallengeCookie(cookies, privateEnv.SESSION_TOKEN_SECRET, secure, challenge);
  } catch (error) {
    clearEmailChallengeCookie(cookies, secure);
    console.error("Failed to persist login challenge", error);
  }

  return json(
    {
      ok: true,
      message: GENERIC_SUCCESS_MESSAGE
    },
    { headers }
  );
}
