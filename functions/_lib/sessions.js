import {
  randomToken,
  hashToken
} from "./crypto.js";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  return env.DB;
}

function validToken(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{64}$/.test(value)
  );
}

export async function createLoginSession(
  env,
  bindingId,
  deviceToken
) {
  if (!validToken(deviceToken)) {
    return null;
  }

  const db = requireDatabase(env);
  const sessionId = crypto.randomUUID();
  const sessionToken = randomToken();

  const [sessionHash, deviceHash] = await Promise.all([
    hashToken(sessionToken),
    hashToken(deviceToken)
  ]);

  const expiresAt =
    Math.floor(Date.now() / 1000) + SESSION_SECONDS;

  const result = await db.prepare(`
    INSERT INTO login_sessions (
      id,
      browser_binding_id,
      session_token_hash,
      expires_at
    )
    SELECT ?, b.id, ?, ?
    FROM browser_bindings AS b
    JOIN access_codes AS a
      ON a.id = b.access_code_id
    WHERE b.id = ?
      AND b.device_token_hash = ?
      AND b.revoked_at IS NULL
      AND a.enabled = 1
  `).bind(
    sessionId,
    sessionHash,
    expiresAt,
    bindingId,
    deviceHash
  ).run();

  if (!result.success) {
    throw new Error("SESSION_WRITE_FAILED");
  }

  if (Number(result.meta?.changes) !== 1) {
    return null;
  }

  return {
    sessionToken,
    expiresAt
  };
}

export async function verifyLoginSession(
  env,
  sessionToken,
  deviceToken
) {
  if (
    !validToken(sessionToken) ||
    !validToken(deviceToken)
  ) {
    return null;
  }

  const db = requireDatabase(env);

  const [sessionHash, deviceHash] = await Promise.all([
    hashToken(sessionToken),
    hashToken(deviceToken)
  ]);

  return db.prepare(`
    SELECT
      s.id AS session_id,
      s.expires_at,
      b.id AS binding_id,
      b.browser_label,
      a.id AS access_code_id,
      a.label AS access_code_label
    FROM login_sessions AS s
    JOIN browser_bindings AS b
      ON b.id = s.browser_binding_id
    JOIN access_codes AS a
      ON a.id = b.access_code_id
    WHERE s.session_token_hash = ?
      AND b.device_token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > unixepoch()
      AND b.revoked_at IS NULL
      AND a.enabled = 1
    LIMIT 1
  `).bind(
    sessionHash,
    deviceHash
  ).first();
}

export async function touchBrowserBinding(
  env,
  bindingId
) {
  const db = requireDatabase(env);

  await db.prepare(`
    UPDATE browser_bindings
    SET last_verified_at = unixepoch()
    WHERE id = ?
      AND revoked_at IS NULL
      AND last_verified_at < unixepoch() - 3600
  `).bind(bindingId).run();
}

export async function revokeLoginSession(
  env,
  sessionToken
) {
  if (!validToken(sessionToken)) {
    return;
  }

  const db = requireDatabase(env);
  const sessionHash = await hashToken(sessionToken);

  await db.prepare(`
    UPDATE login_sessions
    SET revoked_at = unixepoch()
    WHERE session_token_hash = ?
      AND revoked_at IS NULL
  `).bind(sessionHash).run();
}

export async function revokeAccessCodeSessions(
  env,
  accessCodeId
) {
  const db = requireDatabase(env);

  await db.prepare(`
    UPDATE login_sessions
    SET revoked_at = unixepoch()
    WHERE browser_binding_id IN (
      SELECT id
      FROM browser_bindings
      WHERE access_code_id = ?
    )
      AND revoked_at IS NULL
  `).bind(accessCodeId).run();
}

export async function cleanupExpiredSessions(env) {
  const db = requireDatabase(env);

  await db.prepare(`
    DELETE FROM login_sessions
    WHERE id IN (
      SELECT id
      FROM login_sessions
      WHERE expires_at <= unixepoch()
      LIMIT 100
    )
  `).run();
}
