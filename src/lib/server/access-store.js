import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import {
  consumeEmailChallengeAttempt,
  isValidEmail,
  normalizeEmail,
  normalizeRole,
  parseAdminEmails,
  verifyEmailChallengeCode
} from "$lib/server/access";

const DEFAULT_LOCAL_STORE_PATH = ".data/email-access-store.json";
const DEFAULT_BLOB_PATHNAME = "chat-access/email-access-store.json";
const OTP_COOLDOWN_SECONDS = 60;
const OTP_WINDOW_SECONDS = 60 * 60;
const OTP_WINDOW_LIMIT = 6;

let mutationQueue = Promise.resolve();

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmptyStore() {
  return {
    users: {},
    otpRateLimits: {},
    otpChallenges: {}
  };
}

function normalizeOtpChallengeRecord(challengeId, record) {
  const normalizedChallengeId = normalizeValue(record?.challengeId) || normalizeValue(challengeId);
  const email = normalizeEmail(record?.email);
  const role = normalizeRole(record?.role);
  const salt = normalizeValue(record?.salt);
  const codeHash = normalizeValue(record?.codeHash);
  const expiresAt = Number.parseInt(String(record?.expiresAt || ""), 10);
  const attemptsRemaining = Number.parseInt(String(record?.attemptsRemaining || ""), 10);

  if (
    !normalizedChallengeId ||
    !isValidEmail(email) ||
    !salt ||
    !codeHash ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !Number.isFinite(attemptsRemaining) ||
    attemptsRemaining <= 0
  ) {
    return null;
  }

  return {
    challengeId: normalizedChallengeId,
    email,
    role,
    salt,
    codeHash,
    expiresAt,
    attemptsRemaining
  };
}

function normalizeStore(raw) {
  const base = createEmptyStore();

  if (!raw || typeof raw !== "object") {
    return base;
  }

  const users = typeof raw.users === "object" && raw.users !== null ? raw.users : {};
  const otpRateLimits =
    typeof raw.otpRateLimits === "object" && raw.otpRateLimits !== null ? raw.otpRateLimits : {};
  const otpChallenges =
    typeof raw.otpChallenges === "object" && raw.otpChallenges !== null ? raw.otpChallenges : {};

  for (const [email, record] of Object.entries(users)) {
    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(normalizedEmail)) {
      continue;
    }

    base.users[normalizedEmail] = {
      email: normalizedEmail,
      role: normalizeRole(record?.role),
      addedAt: normalizeValue(record?.addedAt) || new Date().toISOString(),
      addedBy: normalizeEmail(record?.addedBy) || "admin"
    };
  }

  const cutoff = Math.floor(Date.now() / 1000) - OTP_WINDOW_SECONDS;

  for (const [email, record] of Object.entries(otpRateLimits)) {
    const normalizedEmail = normalizeEmail(email);
    const lastRequestedAt = Number.parseInt(String(record?.lastRequestedAt || ""), 10);
    const windowStartedAt = Number.parseInt(String(record?.windowStartedAt || ""), 10);
    const requestCount = Number.parseInt(String(record?.requestCount || ""), 10);

    if (
      !isValidEmail(normalizedEmail) ||
      !Number.isFinite(lastRequestedAt) ||
      !Number.isFinite(windowStartedAt) ||
      !Number.isFinite(requestCount) ||
      windowStartedAt < cutoff
    ) {
      continue;
    }

    base.otpRateLimits[normalizedEmail] = {
      lastRequestedAt,
      windowStartedAt,
      requestCount
    };
  }

  for (const [challengeId, record] of Object.entries(otpChallenges)) {
    const challenge = normalizeOtpChallengeRecord(challengeId, record);

    if (!challenge) {
      continue;
    }

    base.otpChallenges[challenge.challengeId] = challenge;
  }

  return base;
}

export function createAccessStoreConfig(env = {}) {
  const blobToken = normalizeValue(env.BLOB_READ_WRITE_TOKEN);
  const blobPathname = normalizeValue(env.AUTH_STORE_BLOB_PATHNAME) || DEFAULT_BLOB_PATHNAME;
  const localPath = normalizeValue(env.AUTH_STORE_FILE) || DEFAULT_LOCAL_STORE_PATH;
  const production = normalizeValue(env.NODE_ENV) === "production" || normalizeValue(env.VERCEL) === "1";

  return {
    blobToken,
    blobPathname,
    localPath: path.resolve(process.cwd(), localPath),
    production
  };
}

export function isAccessStoreConfigured(config) {
  return Boolean(normalizeValue(config?.blobToken) || !config?.production);
}

async function readLocalStore(config) {
  try {
    const contents = await readFile(config.localPath, "utf8");
    return normalizeStore(JSON.parse(contents));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

async function writeLocalStore(config, store) {
  await mkdir(path.dirname(config.localPath), { recursive: true });
  await writeFile(config.localPath, JSON.stringify(store, null, 2), "utf8");
}

async function readBlobStore(config) {
  let metadata;

  try {
    metadata = await head(config.blobPathname, {
      token: config.blobToken
    });
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return createEmptyStore();
    }

    throw error;
  }

  const response = await fetch(metadata.downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download auth store from Blob with status ${response.status}.`);
  }

  const text = await response.text();
  return normalizeStore(JSON.parse(text));
}

async function writeBlobStore(config, store) {
  await put(config.blobPathname, JSON.stringify(store, null, 2), {
    access: "private",
    token: config.blobToken,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

export async function readAccessStore(config) {
  if (normalizeValue(config?.blobToken)) {
    return readBlobStore(config);
  }

  if (!config?.production) {
    return readLocalStore(config);
  }

  return createEmptyStore();
}

async function writeAccessStore(config, store) {
  if (normalizeValue(config?.blobToken)) {
    await writeBlobStore(config, store);
    return;
  }

  if (!config?.production) {
    await writeLocalStore(config, store);
  }
}

export async function updateAccessStore(config, updater) {
  const run = mutationQueue.then(async () => {
    const store = await readAccessStore(config);
    const value = await updater(store);
    await writeAccessStore(config, normalizeStore(store));
    return value;
  });

  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

export function listAuthorizedUsersFromStore(store, adminEmailsValue) {
  const merged = new Map();

  for (const email of parseAdminEmails(adminEmailsValue)) {
    merged.set(email, {
      email,
      role: "admin",
      source: "bootstrap",
      addedAt: "",
      addedBy: ""
    });
  }

  for (const record of Object.values(store?.users || {})) {
    const email = normalizeEmail(record?.email);

    if (!isValidEmail(email)) {
      continue;
    }

    merged.set(email, {
      email,
      role: merged.get(email)?.role === "admin" ? "admin" : normalizeRole(record?.role),
      source: merged.has(email) ? "bootstrap" : "store",
      addedAt: normalizeValue(record?.addedAt),
      addedBy: normalizeEmail(record?.addedBy)
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.email.localeCompare(right.email));
}

export async function listAuthorizedUsers(config, adminEmailsValue) {
  return listAuthorizedUsersFromStore(await readAccessStore(config), adminEmailsValue);
}

export async function resolveAuthorizedUser(config, email, adminEmailsValue) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    return null;
  }

  const users = await listAuthorizedUsers(config, adminEmailsValue);
  const match = users.find((record) => record.email === normalizedEmail);

  return match
    ? {
        email: match.email,
        role: normalizeRole(match.role)
      }
    : null;
}

export async function validateAuthorizedSession(accessState, config, adminEmailsValue) {
  if (!accessState?.user?.email) {
    return accessState;
  }

  const authorizedUser = await resolveAuthorizedUser(
    config,
    accessState.user.email,
    adminEmailsValue
  );

  if (!authorizedUser) {
    return {
      ...accessState,
      authenticated: false,
      readyForChat: false,
      isAdmin: false,
      user: null
    };
  }

  return {
    ...accessState,
    authenticated: true,
    readyForChat: true,
    isAdmin: authorizedUser.role === "admin",
    user: authorizedUser
  };
}

export async function replaceOtpChallenge(config, challenge) {
  const normalizedChallenge = normalizeOtpChallengeRecord(challenge?.challengeId, challenge);

  if (!normalizedChallenge) {
    throw new Error("Invalid login challenge.");
  }

  return updateAccessStore(config, (store) => {
    for (const [challengeId, record] of Object.entries(store.otpChallenges)) {
      if (normalizeEmail(record?.email) === normalizedChallenge.email) {
        delete store.otpChallenges[challengeId];
      }
    }

    store.otpChallenges[normalizedChallenge.challengeId] = normalizedChallenge;
    return normalizedChallenge;
  });
}

export async function consumeOtpChallenge(config, challengeReference, submittedCode, sessionSecret) {
  const challengeId = normalizeValue(challengeReference?.challengeId);
  const challengeEmail = normalizeEmail(challengeReference?.email);

  if (!challengeId || !challengeEmail) {
    return { status: "missing" };
  }

  return updateAccessStore(config, (store) => {
    const challenge = normalizeOtpChallengeRecord(challengeId, store.otpChallenges[challengeId]);

    if (!challenge || challenge.email !== challengeEmail) {
      delete store.otpChallenges[challengeId];
      return { status: "missing" };
    }

    if (!verifyEmailChallengeCode(challenge, submittedCode, sessionSecret)) {
      const nextChallenge = consumeEmailChallengeAttempt(challenge);

      if (nextChallenge.attemptsRemaining <= 0) {
        delete store.otpChallenges[challengeId];
        return {
          status: "invalid",
          attemptsRemaining: 0
        };
      }

      store.otpChallenges[challengeId] = nextChallenge;
      return {
        status: "invalid",
        attemptsRemaining: nextChallenge.attemptsRemaining
      };
    }

    delete store.otpChallenges[challengeId];
    return {
      status: "verified",
      user: {
        email: challenge.email,
        role: challenge.role
      }
    };
  });
}

export async function upsertAuthorizedUser(config, email, role, addedBy, adminEmailsValue) {
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }

  return updateAccessStore(config, (store) => {
    store.users[normalizedEmail] = {
      email: normalizedEmail,
      role: normalizeRole(role),
      addedAt: new Date().toISOString(),
      addedBy: normalizeEmail(addedBy) || "admin"
    };

    return listAuthorizedUsersFromStore(store, adminEmailsValue);
  });
}

export async function removeAuthorizedUser(config, email, adminEmailsValue) {
  const normalizedEmail = normalizeEmail(email);

  if (parseAdminEmails(adminEmailsValue).includes(normalizedEmail)) {
    throw new Error("Bootstrap admin emails cannot be removed from the app.");
  }

  return updateAccessStore(config, (store) => {
    delete store.users[normalizedEmail];
    return listAuthorizedUsersFromStore(store, adminEmailsValue);
  });
}

export async function consumeOtpQuota(config, email) {
  const normalizedEmail = normalizeEmail(email);
  const now = Math.floor(Date.now() / 1000);

  return updateAccessStore(config, (store) => {
    const existing = store.otpRateLimits[normalizedEmail];
    const withinWindow =
      existing &&
      Number.isFinite(existing.windowStartedAt) &&
      now - existing.windowStartedAt < OTP_WINDOW_SECONDS;
    const withinCooldown =
      existing &&
      Number.isFinite(existing.lastRequestedAt) &&
      now - existing.lastRequestedAt < OTP_COOLDOWN_SECONDS;

    if (withinCooldown) {
      return {
        allowed: false,
        retryAfterSeconds: OTP_COOLDOWN_SECONDS - (now - existing.lastRequestedAt)
      };
    }

    const requestCount = withinWindow ? existing.requestCount : 0;

    if (requestCount >= OTP_WINDOW_LIMIT) {
      return {
        allowed: false,
        retryAfterSeconds: OTP_WINDOW_SECONDS - (now - existing.windowStartedAt)
      };
    }

    store.otpRateLimits[normalizedEmail] = {
      lastRequestedAt: now,
      windowStartedAt: withinWindow ? existing.windowStartedAt : now,
      requestCount: requestCount + 1
    };

    return {
      allowed: true,
      retryAfterSeconds: 0
    };
  });
}
