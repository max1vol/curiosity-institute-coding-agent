import { redirect } from "@sveltejs/kit";
import { clearAllAccessCookies } from "$lib/server/access";

export async function POST({ cookies, url }) {
  clearAllAccessCookies(cookies, url.protocol === "https:");
  throw redirect(303, "/");
}
