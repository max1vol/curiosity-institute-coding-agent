import { json } from "@sveltejs/kit";
import { clearVerificationCookie, createNoStoreHeaders } from "$lib/server/access";

export const config = {
  split: true
};

export async function POST({ cookies, url }) {
  clearVerificationCookie(cookies, url.protocol === "https:");
  return json({ ok: true }, { headers: createNoStoreHeaders() });
}
