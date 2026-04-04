import { OAuth2Client } from "google-auth-library";

const clients = new Map();

function getClient(clientId) {
  if (!clients.has(clientId)) {
    clients.set(clientId, new OAuth2Client(clientId));
  }

  return clients.get(clientId);
}

export async function verifyGoogleCredential(credential, clientId) {
  if (typeof credential !== "string" || credential.trim().length === 0) {
    throw new Error("Google credential is missing.");
  }

  if (typeof clientId !== "string" || clientId.trim().length === 0) {
    throw new Error("PUBLIC_GOOGLE_CLIENT_ID is not configured.");
  }

  const ticket = await getClient(clientId).verifyIdToken({
    idToken: credential,
    audience: clientId
  });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload?.email || !payload.email_verified) {
    throw new Error("Google identity payload is missing required verified fields.");
  }

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : ""
  };
}
