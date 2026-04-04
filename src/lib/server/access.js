import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const EMAIL_AUTH_COOKIE_NAME = "curiosity_email_auth";
export const EMAIL_CHALLENGE_COOKIE_NAME = "curiosity_email_challenge";
export const LEGACY_VERIFICATION_COOKIE_NAME = "curiosity_chat_verified";
export const LEGACY_GOOGLE_AUTH_COOKIE_NAME = "curiosity_google_auth";
export const LEGACY_VOUCHER_COOKIE_NAME = "curiosity_chat_voucher";

const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const EMAIL_CHALLENGE_TTL_SECONDS = 60 * 10;
const EMAIL_CHALLENGE_ATTEMPT_LIMIT = 5;
const HMAC_CONTEXT = "curiosity-chat-email-auth";
const SIGNED_TOKEN_VERSION = "v1";

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEmail(value) {
  return normalizeValue(value).toLowerCase();
}

export function normalizeRole(value) {
  return normalizeValue(value) === "admin" ? "admin" : "member";
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignedToken(type, payload, sessionSecret, ttlSeconds) {
  const normalizedSecret = normalizeValue(sessionSecret);

  if (!normalizedSecret) {
    return "";
  }

  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const digest = createHmac("sha256", `${HMAC_CONTEXT}:${type}:${normalizedSecret}`)
    .update(`${SIGNED_TOKEN_VERSION}:${expiresAt}:${encodedPayload}`)
    .digest("hex");

  return `${SIGNED_TOKEN_VERSION}.${expiresAt}.${encodedPayload}.${digest}`;
}

function parseSignedToken(type, cookieValue, sessionSecret) {
  const normalizedSecret = normalizeValue(sessionSecret);

  if (!normalizedSecret || typeof cookieValue !== "string") {
    return null;
  }

  const [version, expiresAtRaw, encodedPayload, digest] = cookieValue.split(".");
  const expiresAt = Number.parseInt(expiresAtRaw, 10);

  if (
    version !== SIGNED_TOKEN_VERSION ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !encodedPayload ||
    !digest
  ) {
    return null;
  }

  const expectedDigest = createHmac("sha256", `${HMAC_CONTEXT}:${type}:${normalizedSecret}`)
    .update(`${SIGNED_TOKEN_VERSION}:${expiresAt}:${encodedPayload}`)
    .digest("hex");

  if (!safeEqual(digest, expectedDigest)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function createEmailOtpDigest(code, email, challengeId, salt, sessionSecret) {
  return createHmac("sha256", `${HMAC_CONTEXT}:otp:${normalizeValue(sessionSecret)}`)
    .update(`${normalizeEmail(email)}:${normalizeValue(challengeId)}:${normalizeValue(salt)}:${normalizeValue(code)}`)
    .digest("hex");
}

export function parseAdminEmails(value) {
  return Array.from(
    new Set(
      normalizeValue(value)
        .split(/[\n,]/)
        .map((item) => normalizeEmail(item))
        .filter((item) => isValidEmail(item))
    )
  );
}

export function createEmailChallenge(email, role, sessionSecret) {
  const challengeId = randomBytes(16).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = Math.floor(Date.now() / 1000) + EMAIL_CHALLENGE_TTL_SECONDS;

  return {
    code,
    challenge: {
      challengeId,
      email: normalizeEmail(email),
      role: normalizeRole(role),
      salt,
      codeHash: createEmailOtpDigest(code, email, challengeId, salt, sessionSecret),
      expiresAt,
      attemptsRemaining: EMAIL_CHALLENGE_ATTEMPT_LIMIT
    }
  };
}

function normalizeChallengePayload(payload) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const email = normalizeEmail(payload.email);
  const challengeId = normalizeValue(payload.challengeId);
  const expiresAt = Number.parseInt(String(payload.expiresAt || ""), 10);

  if (
    !isValidEmail(email) ||
    !challengeId ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return {
    challengeId,
    email,
    expiresAt
  };
}

export function readEmailChallenge(cookieValue, sessionSecret) {
  return normalizeChallengePayload(
    parseSignedToken("email-challenge", cookieValue, sessionSecret)
  );
}

export function verifyEmailChallengeCode(challenge, submittedCode, sessionSecret) {
  const normalizedCode = normalizeValue(submittedCode);

  if (!challenge || !normalizedCode) {
    return false;
  }

  return safeEqual(
    challenge.codeHash,
    createEmailOtpDigest(
      normalizedCode,
      challenge.email,
      challenge.challengeId,
      challenge.salt,
      sessionSecret
    )
  );
}

export function consumeEmailChallengeAttempt(challenge) {
  return {
    ...challenge,
    attemptsRemaining: Math.max(0, Number(challenge?.attemptsRemaining || 0) - 1)
  };
}

export function setEmailChallengeCookie(cookies, sessionSecret, secure, challenge) {
  cookies.set(
    EMAIL_CHALLENGE_COOKIE_NAME,
    createSignedToken(
      "email-challenge",
      {
        challengeId: normalizeValue(challenge?.challengeId),
        email: normalizeEmail(challenge?.email),
        expiresAt: Number(challenge?.expiresAt || 0)
      },
      sessionSecret,
      EMAIL_CHALLENGE_TTL_SECONDS
    ),
    {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: EMAIL_CHALLENGE_TTL_SECONDS
    }
  );
}

export function clearEmailChallengeCookie(cookies, secure) {
  cookies.delete(EMAIL_CHALLENGE_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure
  });
}

function normalizeAuthSession(payload) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const email = normalizeEmail(payload.email);

  if (!isValidEmail(email)) {
    return null;
  }

  return {
    email,
    role: normalizeRole(payload.role)
  };
}

export function readEmailAuthSession(cookieValue, sessionSecret) {
  return normalizeAuthSession(parseSignedToken("email-auth", cookieValue, sessionSecret));
}

export function setEmailAuthCookie(cookies, sessionSecret, secure, user) {
  cookies.set(
    EMAIL_AUTH_COOKIE_NAME,
    createSignedToken(
      "email-auth",
      {
        email: normalizeEmail(user?.email),
        role: normalizeRole(user?.role)
      },
      sessionSecret,
      AUTH_SESSION_TTL_SECONDS
    ),
    {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: AUTH_SESSION_TTL_SECONDS
    }
  );
}

export function clearEmailAuthCookie(cookies, secure) {
  cookies.delete(EMAIL_AUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure
  });
}

export function clearAllAccessCookies(cookies, secure) {
  clearEmailAuthCookie(cookies, secure);
  clearEmailChallengeCookie(cookies, secure);

  for (const cookieName of [
    LEGACY_VERIFICATION_COOKIE_NAME,
    LEGACY_GOOGLE_AUTH_COOKIE_NAME,
    LEGACY_VOUCHER_COOKIE_NAME
  ]) {
    cookies.delete(cookieName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure
    });
  }
}

export function createAccessState(cookies, config) {
  const sessionSecret = normalizeValue(config.sessionSecret);
  const adminBootstrapConfigured = parseAdminEmails(config.adminEmailsValue).length > 0;
  const mailConfigured = Boolean(config.mailConfigured);
  const storeConfigured = Boolean(config.storeConfigured);
  const authConfigured =
    Boolean(sessionSecret) &&
    adminBootstrapConfigured &&
    mailConfigured &&
    storeConfigured;
  const user = sessionSecret
    ? readEmailAuthSession(cookies.get(EMAIL_AUTH_COOKIE_NAME), sessionSecret)
    : null;
  const challenge = sessionSecret
    ? readEmailChallenge(cookies.get(EMAIL_CHALLENGE_COOKIE_NAME), sessionSecret)
    : null;

  return {
    sessionSecretConfigured: Boolean(sessionSecret),
    adminBootstrapConfigured,
    mailConfigured,
    storeConfigured,
    authConfigured,
    authenticated: Boolean(user),
    readyForChat: Boolean(user),
    challengeActive: Boolean(challenge),
    isAdmin: user?.role === "admin",
    user,
    challenge
  };
}

export function createNoStoreHeaders() {
  return {
    "cache-control": "private, no-store"
  };
}
