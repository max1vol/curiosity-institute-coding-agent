import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  VERIFICATION_COOKIE_NAME,
  createNoStoreHeaders,
  hasValidVerificationCookie,
  isAccessCodeConfigured
} from "$lib/server/access";
import { normalizeMessages, requestReply } from "$lib/server/chat";

export const config = {
  split: true,
  maxDuration: 300
};

export async function POST({ request, cookies }) {
  const accessCode = env.CHAT_ACCESS_CODE;
  const headers = createNoStoreHeaders();

  if (!isAccessCodeConfigured(accessCode)) {
    return json(
      { error: "CHAT_ACCESS_CODE is not set. Configure verification before using the chat." },
      { status: 503, headers }
    );
  }

  if (!hasValidVerificationCookie(cookies.get(VERIFICATION_COOKIE_NAME), accessCode)) {
    return json({ error: "Verification required before using the chat." }, { status: 401, headers });
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

  const result = await requestReply(env.OPENAI_API_KEY, messages);
  return json(result.payload, { status: result.status, headers });
}
