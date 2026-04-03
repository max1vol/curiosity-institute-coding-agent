import { redirect } from "@sveltejs/kit";
import { clearVerificationCookie } from "$lib/server/access";

export async function POST({ cookies, url }) {
  clearVerificationCookie(cookies, url.protocol === "https:");
  throw redirect(303, "/");
}
