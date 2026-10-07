import {
  randomToken,
  hashToken,
  verifySecret
} from "./crypto.js";

import {
  COOKIE_NAMES,
  ADMIN_SECONDS,
  readCookie,
  makeCookie,
  clearCookie
} from "./http.js";

const encoder = new TextEncoder();

function requireAdminConfig(env) {
  if (
    typeof env.ADMIN_PASSWORD !== "string" ||
    env.ADMIN_PASSWORD.length < 20 ||
    env.ADMIN_PASSWORD.length > 1024 ||
    typeof env.AUTH_SECRET !== "string" ||
    env.AUTH_SECRET.length < 32
  ) {
    throw new Error("ADMIN_CONFIG_INVALID");
  }
}

function toHex(buffer) {
  return Array.from(
    new Uint8Array(buffer),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

function signatureBytes(value) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(32);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(
      value.slice(index * 2, index * 2 + 2),
      16
    );
  }

  return bytes;
}

async function signingKey(env, usage) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    [usage]
  );
}

async function signatureMessage(
  env,
  origin,
  expiresAt,
  nonce
) {
  const fingerprint = await hashToken(env.ADMIN_PASSWORD);

  return encoder.encode(JSON.stringify([
    "rabbit-admin-v1",
    origin,
    expiresAt,
    nonce,
    fingerprint
  ]));
}

export async function verifyAdminPassword(
  env,
  suppliedPassword
) {
  requireAdminConfig(env);

  return verifySecret(
    suppliedPassword,
    env.ADMIN_PASSWORD
  );
}

export async function createAdminCookie(
  request,
  env
) {
  requireAdminConfig(env);

  const origin = new URL(request.url).origin;
  const expiresAt =
    Math.floor(Date.now() / 1000) + ADMIN_SECONDS;
  const nonce = randomToken();

  const key = await signingKey(env, "sign");
  const message = await signatureMessage(
    env,
    origin,
    expiresAt,
    nonce
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    message
  );

  const token = [
    String(expiresAt),
    nonce,
    toHex(signature)
  ].join(".");

  return makeCookie(
    COOKIE_NAMES.admin,
    token,
    ADMIN_SECONDS
  );
}

export async function verifyAdminSession(
  request,
  env
) {
  requireAdminConfig(env);

  const token = readCookie(
    request,
    COOKIE_NAMES.admin
  );

  if (!token || token.length > 160) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [expiresText, nonce, signatureText] = parts;

  if (
    !/^[1-9][0-9]{0,11}$/.test(expiresText) ||
    !/^[0-9a-f]{64}$/.test(nonce)
  ) {
    return false;
  }

  const expiresAt = Number(expiresText);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + ADMIN_SECONDS
  ) {
    return false;
  }

  const signature = signatureBytes(signatureText);

  if (!signature) {
    return false;
  }

  const key = await signingKey(env, "verify");
  const message = await signatureMessage(
    env,
    new URL(request.url).origin,
    expiresAt,
    nonce
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    message
  );
}

export function clearAdminCookie() {
  return clearCookie(COOKIE_NAMES.admin);
}
