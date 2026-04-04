import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { createAccessState, createNoStoreHeaders } from "$lib/server/access";

export function load({ cookies, setHeaders, url }) {
  setHeaders(createNoStoreHeaders());

  const accessState = createAccessState(cookies, {
    accessCode: privateEnv.CHAT_ACCESS_CODE,
    sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
    googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID,
    allowedGoogleEmails: privateEnv.GOOGLE_ALLOWED_EMAILS,
    voucherCatalogValue: privateEnv.CHAT_VOUCHERS
  });

  return {
    googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID || "",
    googleError: url.searchParams.get("googleError"),
    voucherError: url.searchParams.get("voucherError"),
    verificationError: url.searchParams.get("verificationError"),
    googleAuthConfigured: accessState.googleConfigured,
    voucherActivationConfigured: accessState.voucherConfigured,
    verificationConfigured: accessState.verificationConfigured,
    googleConfigured: accessState.googleConfigured,
    voucherConfigured: accessState.voucherConfigured,
    googleAuthenticated: accessState.googleAuthenticated,
    googleEmail: accessState.googleSession?.email || "",
    googleName: accessState.googleSession?.name || "",
    googlePicture: accessState.googleSession?.picture || "",
    voucherActivated: accessState.voucherActivated,
    voucherId: accessState.voucherSession?.voucherId || "",
    verified: accessState.verified,
    readyForVerification: accessState.readyForVerification,
    readyForChat: accessState.readyForChat,
    chatUnlocked: accessState.readyForChat
  };
}
