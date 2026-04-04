import { createHmac, timingSafeEqual } from "node:crypto";

export const VERIFICATION_COOKIE_NAME = "curiosity_chat_verified";

const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const HMAC_CONTEXT = "curiosity-chat-verification";
const TOKEN_VERSION = "v2";

function normalizeAccessCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createVerificationToken(accessCode) {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const digest = createVerificationDigest(accessCode, expiresAt);

  return `${TOKEN_VERSION}.${expiresAt}.${digest}`;
}

function createVerificationDigest(accessCode, expiresAt) {
  const normalizedAccessCode = normalizeAccessCode(accessCode);
  return createHmac("sha256", `${HMAC_CONTEXT}:${normalizedAccessCode}`)
    .update(`${TOKEN_VERSION}:${expiresAt}`)
    .digest("hex");
}

function parseVerificationToken(cookieValue) {
  if (typeof cookieValue !== "string") {
    return null;
  }

  const [version, expiresAtRaw, digest] = cookieValue.split(".");
  const expiresAt = Number.parseInt(expiresAtRaw, 10);

  if (version !== TOKEN_VERSION || !Number.isFinite(expiresAt) || !digest) {
    return null;
  }

  return {
    expiresAt,
    digest
  };
}

export function isAccessCodeConfigured(accessCode) {
  return normalizeAccessCode(accessCode).length > 0;
}

export function isSubmittedAccessCodeValid(submittedAccessCode, configuredAccessCode) {
  const normalizedSubmitted = normalizeAccessCode(submittedAccessCode);
  const normalizedConfigured = normalizeAccessCode(configuredAccessCode);

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

  if (!token || token.expiresAt <= Math.floor(Date.now() / 1000)) {
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

export function createNoStoreHeaders() {
  return {
    "cache-control": "private, no-store"
  };
}
