import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import {
  clearVerificationCookie,
  clearVoucherCookie,
  createNoStoreHeaders,
  isGoogleAuthConfigured,
  isGoogleEmailAllowed,
  setGoogleAuthCookie
} from "$lib/server/access";
import { verifyGoogleCredential } from "$lib/server/google";

export const config = {
  split: true
};

export async function POST({ request, cookies, url }) {
  const headers = createNoStoreHeaders();
  const googleClientId = publicEnv.PUBLIC_GOOGLE_CLIENT_ID;

  if (!isGoogleAuthConfigured(googleClientId)) {
    return json(
      { error: "Google authentication is not configured. Set PUBLIC_GOOGLE_CLIENT_ID first." },
      { status: 503, headers }
    );
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  let identity;

  try {
    identity = await verifyGoogleCredential(parsed?.credential, googleClientId);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Google sign-in failed." },
      { status: 401, headers }
    );
  }

  if (!isGoogleEmailAllowed(identity.email, privateEnv.GOOGLE_ALLOWED_EMAILS)) {
    return json(
      { error: "This Google account is not allowed to use the chat." },
      { status: 403, headers }
    );
  }

  const secure = url.protocol === "https:";
  clearVoucherCookie(cookies, secure);
  clearVerificationCookie(cookies, secure);
  setGoogleAuthCookie(
    cookies,
    privateEnv.SESSION_TOKEN_SECRET,
    privateEnv.CHAT_ACCESS_CODE,
    secure,
    identity
  );

  return json(
    {
      ok: true,
      googleUser: {
        email: identity.email,
        name: identity.name,
        picture: identity.picture
      }
    },
    { headers }
  );
}
