import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { normalizeMessages, requestReply } from "$lib/server/chat";

export const config = {
  split: true,
  maxDuration: 300
};

export async function POST({ request }) {
  let parsed;

  try {
    parsed = await request.json();
  } catch {
    return json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  let messages;

  try {
    messages = normalizeMessages(parsed.messages);
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }

  const result = await requestReply(env.OPENAI_API_KEY, messages);
  return json(result.payload, { status: result.status });
}
