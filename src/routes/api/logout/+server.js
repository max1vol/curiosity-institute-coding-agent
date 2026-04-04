import { json } from "@sveltejs/kit";
import { clearAllAccessCookies, createNoStoreHeaders } from "$lib/server/access";

export const config = {
  split: true
};

export async function POST({ cookies, url }) {
  clearAllAccessCookies(cookies, url.protocol === "https:");
  return json({ ok: true }, { headers: createNoStoreHeaders() });
}
