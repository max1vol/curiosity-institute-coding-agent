import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import {
  clearEmailAuthCookie,
  createAccessState,
  createNoStoreHeaders,
  isValidEmail,
  normalizeEmail,
  normalizeRole
} from "$lib/server/access";
import {
  createAccessStoreConfig,
  isAccessStoreConfigured,
  listAuthorizedUsers,
  removeAuthorizedUser,
  upsertAuthorizedUser,
  validateAuthorizedSession
} from "$lib/server/access-store";
import { createMailConfig, isMailConfigured } from "$lib/server/mailer";

export const config = {
  split: true
};

function createGate(accessState) {
  return {
    authConfigured: accessState.authConfigured,
    authenticated: accessState.authenticated,
    isAdmin: accessState.isAdmin,
    readyForChat: accessState.readyForChat
  };
}

function createAdminErrorResponse(accessState, headers) {
  if (
    !accessState.sessionSecretConfigured ||
    !accessState.adminBootstrapConfigured ||
    !accessState.storeConfigured
  ) {
    return json(
      {
        error:
          "Admin access is not fully configured. Set SESSION_TOKEN_SECRET, EMAIL_AUTH_ADMINS, and durable auth storage.",
        gate: createGate(accessState)
      },
      { status: 503, headers }
    );
  }

  if (!accessState.authenticated) {
    return json(
      { error: "Email login required.", gate: createGate(accessState) },
      { status: 401, headers }
    );
  }

  return json(
    { error: "Admin role required.", gate: createGate(accessState) },
    { status: 403, headers }
  );
}

function getAccessState(cookies) {
  const storeConfig = createAccessStoreConfig(privateEnv);
  const mailConfig = createMailConfig(privateEnv);
  const accessState = createAccessState(cookies, {
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    adminEmailsValue: privateEnv.EMAIL_AUTH_ADMINS,
    mailConfigured: isMailConfigured(mailConfig),
    storeConfigured: isAccessStoreConfigured(storeConfig)
  });

  return {
    storeConfig,
    accessState
  };
}

export async function GET({ cookies, request }) {
  const headers = createNoStoreHeaders();
  const { storeConfig, accessState } = getAccessState(cookies);
  const validatedState = await validateAuthorizedSession(
    accessState,
    storeConfig,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  if (accessState.authenticated && !validatedState.authenticated) {
    clearEmailAuthCookie(cookies, request.url.startsWith("https:"));
  }

  if (
    !validatedState.sessionSecretConfigured ||
    !validatedState.adminBootstrapConfigured ||
    !validatedState.storeConfigured ||
    !validatedState.authenticated ||
    !validatedState.isAdmin
  ) {
    return createAdminErrorResponse(validatedState, headers);
  }

  return json(
    {
      users: await listAuthorizedUsers(storeConfig, privateEnv.EMAIL_AUTH_ADMINS)
    },
    { headers }
  );
}

export async function POST({ request, cookies }) {
  const headers = createNoStoreHeaders();
  const { storeConfig, accessState } = getAccessState(cookies);
  const validatedState = await validateAuthorizedSession(
    accessState,
    storeConfig,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  if (accessState.authenticated && !validatedState.authenticated) {
    clearEmailAuthCookie(cookies, request.url.startsWith("https:"));
  }

  if (
    !validatedState.sessionSecretConfigured ||
    !validatedState.adminBootstrapConfigured ||
    !validatedState.storeConfigured ||
    !validatedState.authenticated ||
    !validatedState.isAdmin
  ) {
    return createAdminErrorResponse(validatedState, headers);
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  const email = normalizeEmail(parsed?.email);
  const role = normalizeRole(parsed?.role);

  if (!isValidEmail(email)) {
    return json({ error: "Enter a valid email address." }, { status: 400, headers });
  }

  try {
    const users = await upsertAuthorizedUser(
      storeConfig,
      email,
      role,
      validatedState.user?.email,
      privateEnv.EMAIL_AUTH_ADMINS
    );

    return json({ ok: true, users }, { headers });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Failed to save authorized user." },
      { status: 400, headers }
    );
  }
}

export async function DELETE({ request, cookies }) {
  const headers = createNoStoreHeaders();
  const { storeConfig, accessState } = getAccessState(cookies);
  const validatedState = await validateAuthorizedSession(
    accessState,
    storeConfig,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  if (accessState.authenticated && !validatedState.authenticated) {
    clearEmailAuthCookie(cookies, request.url.startsWith("https:"));
  }

  if (
    !validatedState.sessionSecretConfigured ||
    !validatedState.adminBootstrapConfigured ||
    !validatedState.storeConfigured ||
    !validatedState.authenticated ||
    !validatedState.isAdmin
  ) {
    return createAdminErrorResponse(validatedState, headers);
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

  try {
    const users = await removeAuthorizedUser(
      storeConfig,
      email,
      privateEnv.EMAIL_AUTH_ADMINS
    );

    return json({ ok: true, users }, { headers });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Failed to remove authorized user." },
      { status: 400, headers }
    );
  }
}
