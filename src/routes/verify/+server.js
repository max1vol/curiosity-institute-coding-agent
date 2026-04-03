import { env } from "$env/dynamic/private";
import { redirect } from "@sveltejs/kit";
import {
  isAccessCodeConfigured,
  isSubmittedAccessCodeValid,
  setVerificationCookie
} from "$lib/server/access";

export async function POST({ request, cookies, url }) {
  const accessCode = env.CHAT_ACCESS_CODE;

  if (!isAccessCodeConfigured(accessCode)) {
    throw redirect(303, "/?verificationError=missing");
  }

  const formData = await request.formData();
  const submittedAccessCode = formData.get("accessCode");

  if (!isSubmittedAccessCodeValid(submittedAccessCode, accessCode)) {
    throw redirect(303, "/?verificationError=invalid");
  }

  setVerificationCookie(cookies, accessCode, url.protocol === "https:");
  throw redirect(303, "/");
}
