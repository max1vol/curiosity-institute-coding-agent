import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { redirect } from "@sveltejs/kit";
import {
  clearVerificationCookie,
  createAccessState,
  findVoucherRecord,
  setVoucherCookie
} from "$lib/server/access";

export async function POST({ request, cookies, url }) {
  const secure = url.protocol === "https:";
  const accessState = createAccessState(cookies, {
    accessCode: privateEnv.CHAT_ACCESS_CODE,
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID,
    allowedGoogleEmails: privateEnv.GOOGLE_ALLOWED_EMAILS,
    voucherCatalogValue: privateEnv.CHAT_VOUCHERS
  });

  if (!accessState.googleConfigured) {
    throw redirect(303, "/?voucherError=google-missing");
  }

  if (!accessState.googleAuthenticated) {
    throw redirect(303, "/?voucherError=google-required");
  }

  if (!accessState.voucherConfigured) {
    throw redirect(303, "/?voucherError=missing");
  }

  const formData = await request.formData();
  const voucherRecord = findVoucherRecord(formData.get("voucherCode"), privateEnv.CHAT_VOUCHERS);

  if (!voucherRecord) {
    throw redirect(303, "/?voucherError=invalid");
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
  throw redirect(303, "/");
}
