import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const VERIFICATION_COOKIE_NAME = "curiosity_chat_verified";
export const GOOGLE_AUTH_COOKIE_NAME = "curiosity_google_auth";
export const VOUCHER_COOKIE_NAME = "curiosity_chat_voucher";

const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const HMAC_CONTEXT = "curiosity-chat-access";
const VERIFICATION_TOKEN_VERSION = "v2";
const SESSION_TOKEN_VERSION = "v1";

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return normalizeValue(value).toLowerCase();
}

function normalizeVoucherCode(value) {
  return normalizeValue(value).toUpperCase();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionSigningSecret(sessionSecret, accessCode) {
  return normalizeValue(sessionSecret) || normalizeValue(accessCode);
}

function createVerificationDigest(accessCode, expiresAt) {
  const normalizedAccessCode = normalizeValue(accessCode);

  return createHmac("sha256", `${HMAC_CONTEXT}:verification:${normalizedAccessCode}`)
    .update(`${VERIFICATION_TOKEN_VERSION}:${expiresAt}`)
    .digest("hex");
}

function createVerificationToken(accessCode) {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const digest = createVerificationDigest(accessCode, expiresAt);

  return `${VERIFICATION_TOKEN_VERSION}.${expiresAt}.${digest}`;
}

function parseVerificationToken(cookieValue) {
  if (typeof cookieValue !== "string") {
    return null;
  }

  const [version, expiresAtRaw, digest] = cookieValue.split(".");
  const expiresAt = Number.parseInt(expiresAtRaw, 10);

  if (version !== VERIFICATION_TOKEN_VERSION || !Number.isFinite(expiresAt) || !digest) {
    return null;
  }

  return {
    expiresAt,
    digest
  };
}

function encodeSessionPayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSessionPayload(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function createSignedSessionToken(type, payload, sessionSecret, accessCode) {
  const signingSecret = getSessionSigningSecret(sessionSecret, accessCode);

  if (!signingSecret) {
    return "";
  }

  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const encodedPayload = encodeSessionPayload(payload);
  const digest = createHmac("sha256", `${HMAC_CONTEXT}:${type}:${signingSecret}`)
    .update(`${SESSION_TOKEN_VERSION}:${expiresAt}:${encodedPayload}`)
    .digest("hex");

  return `${SESSION_TOKEN_VERSION}.${expiresAt}.${encodedPayload}.${digest}`;
}

function parseSignedSessionToken(type, cookieValue, sessionSecret, accessCode) {
  const signingSecret = getSessionSigningSecret(sessionSecret, accessCode);

  if (!signingSecret || typeof cookieValue !== "string") {
    return null;
  }

  const [version, expiresAtRaw, encodedPayload, digest] = cookieValue.split(".");
  const expiresAt = Number.parseInt(expiresAtRaw, 10);

  if (
    version !== SESSION_TOKEN_VERSION ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !encodedPayload ||
    !digest
  ) {
    return null;
  }

  const expectedDigest = createHmac("sha256", `${HMAC_CONTEXT}:${type}:${signingSecret}`)
    .update(`${SESSION_TOKEN_VERSION}:${expiresAt}:${encodedPayload}`)
    .digest("hex");

  if (!safeEqual(digest, expectedDigest)) {
    return null;
  }

  return decodeSessionPayload(encodedPayload);
}

function createVoucherId(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isAccessCodeConfigured(accessCode) {
  return normalizeValue(accessCode).length > 0;
}

export function isGoogleAuthConfigured(googleClientId) {
  return normalizeValue(googleClientId).length > 0;
}

export function parseAllowedGoogleEmails(value) {
  return Array.from(
    new Set(
      normalizeValue(value)
        .split(/[\n,]/)
        .map((item) => normalizeEmail(item))
        .filter(Boolean)
    )
  );
}

export function isGoogleEmailAllowed(email, allowedEmailsValue) {
  const normalizedEmail = normalizeEmail(email);
  const allowedEmails = parseAllowedGoogleEmails(allowedEmailsValue);

  if (!normalizedEmail) {
    return false;
  }

  return allowedEmails.length === 0 || allowedEmails.includes(normalizedEmail);
}

export function parseVoucherCatalog(value) {
  return Array.from(
    new Map(
      normalizeValue(value)
        .split(/[\n,]/)
        .map((item) => normalizeVoucherCode(item))
        .filter(Boolean)
        .map((code) => [code, { code, id: createVoucherId(code) }])
    ).values()
  );
}

export function isVoucherConfigured(voucherCatalogValue) {
  return parseVoucherCatalog(voucherCatalogValue).length > 0;
}

export function findVoucherRecord(submittedVoucherCode, voucherCatalogValue) {
  const normalizedSubmitted = normalizeVoucherCode(submittedVoucherCode);

  if (!normalizedSubmitted) {
    return null;
  }

  return (
    parseVoucherCatalog(voucherCatalogValue).find((record) => safeEqual(record.code, normalizedSubmitted)) ||
    null
  );
}

export function isSubmittedAccessCodeValid(submittedAccessCode, configuredAccessCode) {
  const normalizedSubmitted = normalizeValue(submittedAccessCode);
  const normalizedConfigured = normalizeValue(configuredAccessCode);

  if (!normalizedSubmitted || !normalizedConfigured) {
    return false;
  }

  return safeEqual(normalizedSubmitted, normalizedConfigured);
}

export function hasValidVerificationCookie(cookieValue, configuredAccessCode) {
  if (!isAccessCodeConfigured(configuredAccessCode)) {
    return false;
  }

  const token = parseVerificationToken(cookieValue);

  if (!token) {
    return false;
  }

  return safeEqual(token.digest, createVerificationDigest(configuredAccessCode, token.expiresAt));
}

export function setVerificationCookie(cookies, configuredAccessCode, secure) {
  cookies.set(VERIFICATION_COOKIE_NAME, createVerificationToken(configuredAccessCode), {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: COOKIE_TTL_SECONDS
  });
}

export function clearVerificationCookie(cookies, secure) {
  cookies.delete(VERIFICATION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure
  });
}

export function readGoogleAuthSession(cookieValue, sessionSecret, accessCode, allowedEmailsValue) {
  const payload = parseSignedSessionToken("google-auth", cookieValue, sessionSecret, accessCode);

  if (!payload?.sub || !payload?.email) {
    return null;
  }

  if (!isGoogleEmailAllowed(payload.email, allowedEmailsValue)) {
    return null;
  }

  return {
    sub: normalizeValue(payload.sub),
    email: normalizeEmail(payload.email),
    name: normalizeValue(payload.name) || normalizeEmail(payload.email),
    picture: normalizeValue(payload.picture)
  };
}

export function setGoogleAuthCookie(cookies, sessionSecret, accessCode, secure, identity) {
  cookies.set(
    GOOGLE_AUTH_COOKIE_NAME,
    createSignedSessionToken(
      "google-auth",
      {
        sub: normalizeValue(identity?.sub),
        email: normalizeEmail(identity?.email),
        name: normalizeValue(identity?.name),
        picture: normalizeValue(identity?.picture)
      },
      sessionSecret,
      accessCode
    ),
    {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: COOKIE_TTL_SECONDS
    }
  );
}

export function clearGoogleAuthCookie(cookies, secure) {
  cookies.delete(GOOGLE_AUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure
  });
}

export function readVoucherSession(cookieValue, sessionSecret, accessCode, googleSession, voucherCatalogValue) {
  const payload = parseSignedSessionToken("voucher", cookieValue, sessionSecret, accessCode);

  if (!payload?.sub || !payload?.voucherId || !googleSession?.sub) {
    return null;
  }

  if (!safeEqual(normalizeValue(payload.sub), normalizeValue(googleSession.sub))) {
    return null;
  }

  const voucherRecord = parseVoucherCatalog(voucherCatalogValue).find(
    (record) => record.id === normalizeValue(payload.voucherId)
  );

  if (!voucherRecord) {
    return null;
  }

  return {
    sub: normalizeValue(payload.sub),
    voucherId: voucherRecord.id
  };
}

export function setVoucherCookie(
  cookies,
  sessionSecret,
  accessCode,
  secure,
  googleSession,
  voucherRecord
) {
  cookies.set(
    VOUCHER_COOKIE_NAME,
    createSignedSessionToken(
      "voucher",
      {
        sub: normalizeValue(googleSession?.sub),
        voucherId: normalizeValue(voucherRecord?.id)
      },
      sessionSecret,
      accessCode
    ),
    {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: COOKIE_TTL_SECONDS
    }
  );
}

export function clearVoucherCookie(cookies, secure) {
  cookies.delete(VOUCHER_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure
  });
}

export function clearAllAccessCookies(cookies, secure) {
  clearGoogleAuthCookie(cookies, secure);
  clearVoucherCookie(cookies, secure);
  clearVerificationCookie(cookies, secure);
}

export function createAccessState(cookies, config) {
  const accessCode = config.accessCode;
  const sessionSecret = config.sessionSecret;
  const googleClientId = config.googleClientId;
  const allowedGoogleEmails = config.allowedGoogleEmails;
  const voucherCatalogValue = config.voucherCatalogValue;

  const verificationConfigured = isAccessCodeConfigured(accessCode);
  const googleConfigured = isGoogleAuthConfigured(googleClientId);
  const voucherConfigured = isVoucherConfigured(voucherCatalogValue);
  const googleSession = googleConfigured
    ? readGoogleAuthSession(
        cookies.get(GOOGLE_AUTH_COOKIE_NAME),
        sessionSecret,
        accessCode,
        allowedGoogleEmails
      )
    : null;
  const voucherSession =
    googleSession && voucherConfigured
      ? readVoucherSession(
          cookies.get(VOUCHER_COOKIE_NAME),
          sessionSecret,
          accessCode,
          googleSession,
          voucherCatalogValue
        )
      : null;
  const verified =
    verificationConfigured &&
    hasValidVerificationCookie(cookies.get(VERIFICATION_COOKIE_NAME), accessCode);

  return {
    verificationConfigured,
    googleConfigured,
    voucherConfigured,
    googleAuthenticated: Boolean(googleSession),
    voucherActivated: Boolean(voucherSession),
    verified,
    readyForVerification:
      verificationConfigured && googleConfigured && voucherConfigured && Boolean(googleSession && voucherSession),
    readyForChat:
      verificationConfigured &&
      googleConfigured &&
      voucherConfigured &&
      Boolean(googleSession && voucherSession && verified),
    googleSession,
    voucherSession
  };
}

export function createNoStoreHeaders() {
  return {
    "cache-control": "private, no-store"
  };
}
