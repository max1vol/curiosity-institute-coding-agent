import { env } from "$env/dynamic/private";
import {
  VERIFICATION_COOKIE_NAME,
  createNoStoreHeaders,
  hasValidVerificationCookie,
  isAccessCodeConfigured
} from "$lib/server/access";

export function load({ cookies, setHeaders }) {
  setHeaders(createNoStoreHeaders());

  const accessCode = env.CHAT_ACCESS_CODE;
  const verificationConfigured = isAccessCodeConfigured(accessCode);
  const verified =
    verificationConfigured &&
    hasValidVerificationCookie(cookies.get(VERIFICATION_COOKIE_NAME), accessCode);

  return {
    verificationConfigured,
    verified
  };
}
