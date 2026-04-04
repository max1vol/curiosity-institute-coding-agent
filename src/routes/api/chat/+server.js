import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { createAccessState, createNoStoreHeaders } from "$lib/server/access";
import { normalizeMessages, requestReply } from "$lib/server/chat";

export const config = {
  split: true,
  maxDuration: 300
};

function createGateErrorResponse(accessState, headers) {
  const gateState = {
    googleConfigured: accessState.googleConfigured,
    voucherConfigured: accessState.voucherConfigured,
    verificationConfigured: accessState.verificationConfigured,
    googleAuthenticated: accessState.googleAuthenticated,
    voucherActivated: accessState.voucherActivated,
    verified: accessState.verified,
    readyForChat: accessState.readyForChat
  };

  if (!accessState.googleConfigured) {
    return json(
      {
        error: "Google authentication is not configured. Set PUBLIC_GOOGLE_CLIENT_ID first.",
        gate: gateState
      },
      { status: 503, headers }
    );
  }

  if (!accessState.voucherConfigured) {
    return json(
      { error: "Voucher activation is not configured. Set CHAT_VOUCHERS first.", gate: gateState },
      { status: 503, headers }
    );
  }

  if (!accessState.verificationConfigured) {
    return json(
      {
        error: "CHAT_ACCESS_CODE is not set. Configure verification before using the chat.",
        gate: gateState
      },
      { status: 503, headers }
    );
  }

  if (!accessState.googleAuthenticated) {
    return json(
      { error: "Google sign-in required before using the chat.", gate: gateState },
      { status: 401, headers }
    );
  }

  if (!accessState.voucherActivated) {
    return json(
      { error: "Activate a voucher before using the chat.", gate: gateState },
      { status: 401, headers }
    );
  }

  return json(
    {
      error: "Verification required after Google sign-in and voucher activation.",
      gate: gateState
    },
    { status: 401, headers }
  );
}

export async function POST({ request, cookies }) {
  const headers = createNoStoreHeaders();
  const accessState = createAccessState(cookies, {
    accessCode: privateEnv.CHAT_ACCESS_CODE,
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID,
    allowedGoogleEmails: privateEnv.GOOGLE_ALLOWED_EMAILS,
    voucherCatalogValue: privateEnv.CHAT_VOUCHERS
  });

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
