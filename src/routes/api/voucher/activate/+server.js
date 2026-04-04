import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import {
  clearVerificationCookie,
  createAccessState,
  createNoStoreHeaders,
  findVoucherRecord,
  setVoucherCookie
} from "$lib/server/access";

export const config = {
  split: true
};

function createGate(accessState) {
  return {
    googleConfigured: accessState.googleConfigured,
    voucherConfigured: accessState.voucherConfigured,
    verificationConfigured: accessState.verificationConfigured,
    googleAuthenticated: accessState.googleAuthenticated,
    voucherActivated: accessState.voucherActivated,
    verified: accessState.verified,
    readyForVerification: accessState.readyForVerification,
    readyForChat: accessState.readyForChat
  };
}

export async function POST({ request, cookies, url }) {
  const headers = createNoStoreHeaders();
  const secure = url.protocol === "https:";
  const accessState = createAccessState(cookies, {
    accessCode: privateEnv.CHAT_ACCESS_CODE,
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID,
    allowedGoogleEmails: privateEnv.GOOGLE_ALLOWED_EMAILS,
    voucherCatalogValue: privateEnv.CHAT_VOUCHERS
  });

  if (!accessState.googleConfigured) {
    return json(
      {
        error: "Google authentication is not configured. Set PUBLIC_GOOGLE_CLIENT_ID first.",
        gate: createGate(accessState)
      },
      { status: 503, headers }
    );
  }

  if (!accessState.googleAuthenticated) {
    return json(
      { error: "Google sign-in required before voucher activation.", gate: createGate(accessState) },
      { status: 401, headers }
    );
  }

  if (!accessState.voucherConfigured) {
    return json(
      { error: "Voucher activation is not configured. Set CHAT_VOUCHERS first.", gate: createGate(accessState) },
      { status: 503, headers }
    );
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  const voucherRecord = findVoucherRecord(parsed?.voucherCode, privateEnv.CHAT_VOUCHERS);

  if (!voucherRecord) {
    return json({ error: "Invalid voucher code.", gate: createGate(accessState) }, { status: 401, headers });
  }

  setVoucherCookie(
    cookies,
    privateEnv.SESSION_TOKEN_SECRET,
    privateEnv.CHAT_ACCESS_CODE,
    secure,
    accessState.googleSession,
    voucherRecord
  );
  clearVerificationCookie(cookies, secure);

  return json(
    {
      ok: true,
      voucher: {
        id: voucherRecord.id
      }
    },
    { headers }
  );
}
