import {
  randomToken,
  createPasswordRecord,
  verifyPasswordRecord
} from "./crypto.js";

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  return env.DB;
}

function normalizeLabel(value) {
  const label = String(value || "").trim();

  if (!label || label.length > 80) {
    throw new Error("INVALID_LABEL");
  }

  return label;
}

function normalizeLimit(value) {
  const limit = Number(value);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error("INVALID_BROWSER_LIMIT");
  }

  return limit;
}

function parseAccessPassword(value) {
  if (
    typeof value !== "string" ||
    value.length > 256
  ) {
    return null;
  }

  const password = value.trim();

  const match = password.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})$/
  );

  if (!match) {
    return null;
  }

  return {
    id: match[1],
    secret: match[2]
  };
}

export async function createAccessCode(
  env,
  label,
  maxBrowsers = 2
) {
  const db = requireDatabase(env);
  const safeLabel = normalizeLabel(label);
  const limit = normalizeLimit(maxBrowsers);
  const id = crypto.randomUUID();
  const secret = randomToken();
  const record = await createPasswordRecord(secret);

  const result = await db.prepare(`
    INSERT INTO access_codes (
      id,
      label,
      password_hash,
      password_salt,
      password_iterations,
      max_browsers
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    safeLabel,
    record.password_hash,
    record.password_salt,
    record.password_iterations,
    limit
  ).run();

  if (!result.success) {
    throw new Error("ACCESS_CODE_WRITE_FAILED");
  }

  return {
    id,
    label: safeLabel,
    maxBrowsers: limit,
    password: `${id}.${secret}`
  };
}

export async function verifyAccessCode(env, password) {
  const parsed = parseAccessPassword(password);

  if (!parsed) {
    return null;
  }

  const db = requireDatabase(env);

  const record = await db.prepare(`
    SELECT
      id,
      label,
      password_hash,
      password_salt,
      password_iterations,
      max_browsers,
      enabled
    FROM access_codes
    WHERE id = ?
    LIMIT 1
  `).bind(parsed.id).first();

  if (!record || record.enabled !== 1) {
    return null;
  }

  const correct = await verifyPasswordRecord(
    parsed.secret,
    record
  );

  if (!correct) {
    return null;
  }

  return {
    id: record.id,
    label: record.label,
    maxBrowsers: record.max_browsers
  };
}

export async function listAccessCodes(
  env,
  page = 1
) {
  const db = requireDatabase(env);
  const pageNumber = Number(page);

  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 1000000
  ) {
    throw new Error("INVALID_PAGE");
  }

  const pageSize = 50;
  const offset = (pageNumber - 1) * pageSize;

  const result = await db.prepare(`
    SELECT
      a.id,
      a.label,
      a.max_browsers,
      a.enabled,
      a.created_at,
      (
        SELECT COUNT(*)
        FROM browser_bindings AS b
        WHERE b.access_code_id = a.id
          AND b.revoked_at IS NULL
      ) AS bound_browsers
    FROM access_codes AS a
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all();

  return result.results || [];
}

export async function updateAccessCodeLabel(
  env,
  accessCodeId,
  label
) {
  const db = requireDatabase(env);
  const safeLabel = normalizeLabel(label);

  const result = await db.prepare(`
    UPDATE access_codes
    SET label = ?
    WHERE id = ?
  `).bind(safeLabel, accessCodeId).run();

  return Number(result.meta?.changes) === 1;
}

export async function updateBrowserLimit(
  env,
  accessCodeId,
  maxBrowsers
) {
  const db = requireDatabase(env);
  const limit = normalizeLimit(maxBrowsers);

  const result = await db.prepare(`
    UPDATE access_codes
    SET max_browsers = ?
    WHERE id = ?
      AND (
        SELECT COUNT(*)
        FROM browser_bindings AS b
        WHERE b.access_code_id = access_codes.id
          AND b.revoked_at IS NULL
      ) <= ?
  `).bind(
    limit,
    accessCodeId,
    limit
  ).run();

  return Number(result.meta?.changes) === 1;
}

export async function disableAccessCode(
  env,
  accessCodeId
) {
  const db = requireDatabase(env);

  await db.batch([
    db.prepare(`
      UPDATE access_codes
      SET enabled = 0
      WHERE id = ?
    `).bind(accessCodeId),

    db.prepare(`
      UPDATE login_sessions
      SET revoked_at = unixepoch()
      WHERE browser_binding_id IN (
        SELECT id
        FROM browser_bindings
        WHERE access_code_id = ?
      )
        AND revoked_at IS NULL
    `).bind(accessCodeId)
  ]);
}

export async function enableAccessCode(
  env,
  accessCodeId
) {
  const db = requireDatabase(env);

  const result = await db.prepare(`
    UPDATE access_codes
    SET enabled = 1
    WHERE id = ?
  `).bind(accessCodeId).run();

  return Number(result.meta?.changes) === 1;
}
