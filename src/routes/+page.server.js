import { env as privateEnv } from "$env/dynamic/private";
import { createAccessState, createNoStoreHeaders } from "$lib/server/access";
import {
  createAccessStoreConfig,
  isAccessStoreConfigured,
  listAuthorizedUsers,
  validateAuthorizedSession
} from "$lib/server/access-store";
import { createMailConfig, isMailConfigured } from "$lib/server/mailer";

export async function load({ cookies, setHeaders }) {
  setHeaders(createNoStoreHeaders());

  const storeConfig = createAccessStoreConfig(privateEnv);
  const mailConfig = createMailConfig(privateEnv);
  const accessState = await validateAuthorizedSession(
    createAccessState(cookies, {
      sessionSecret: privateEnv.SESSION_TOKEN_SECRET,
      adminEmailsValue: privateEnv.EMAIL_AUTH_ADMINS,
      mailConfigured: isMailConfigured(mailConfig),
      storeConfigured: isAccessStoreConfigured(storeConfig)
    }),
    storeConfig,
    privateEnv.EMAIL_AUTH_ADMINS
  );

  return {
    authConfigured: accessState.authConfigured,
    sessionSecretConfigured: accessState.sessionSecretConfigured,
    mailConfigured: accessState.mailConfigured,
    storeConfigured: accessState.storeConfigured,
    adminBootstrapConfigured: accessState.adminBootstrapConfigured,
    authenticated: accessState.authenticated,
    challengeActive: accessState.challengeActive,
    challengeEmail: accessState.challenge?.email || "",
    userEmail: accessState.user?.email || "",
    userRole: accessState.user?.role || "",
    isAdmin: accessState.isAdmin,
    readyForChat: accessState.readyForChat,
    authorizedUsers: accessState.isAdmin
      ? await listAuthorizedUsers(storeConfig, privateEnv.EMAIL_AUTH_ADMINS)
      : []
  };
}
