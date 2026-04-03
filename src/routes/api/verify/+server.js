import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  createNoStoreHeaders,
  isAccessCodeConfigured,
  isSubmittedAccessCodeValid,
  setVerificationCookie
} from "$lib/server/access";

export const config = {
  split: true
};

export async function POST({ request, cookies, url }) {
  const accessCode = env.CHAT_ACCESS_CODE;
  const headers = createNoStoreHeaders();

  if (!isAccessCodeConfigured(accessCode)) {
    return json(
      { error: "CHAT_ACCESS_CODE is not set. Configure it before using verification." },
      { status: 503, headers }
    );
  }

  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400, headers });
  }

  if (!isSubmittedAccessCodeValid(parsed?.accessCode, accessCode)) {
    return json({ error: "Invalid access code." }, { status: 401, headers });
  }

  setVerificationCookie(cookies, accessCode, url.protocol === "https:");
  return json({ ok: true }, { headers });
}
