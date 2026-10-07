import {
  randomToken,
  hashToken
} from "./crypto.js";

function requireDatabase(env) {
  if (!env.DB) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  return env.DB;
}

function validToken(token) {
  return (
    typeof token === "string" &&
    /^[0-9a-f]{64}$/.test(token)
  );
}

function browserLabel(userAgent = "") {
  const value = String(userAgent);

  let platform = "设备";

  if (/iPad/i.test(value)) {
    platform = "iPad";
  } else if (/iPhone/i.test(value)) {
    platform = "iPhone";
  } else if (/Android/i.test(value)) {
    platform = "Android";
  } else if (/Windows/i.test(value)) {
    platform = "Windows";
  } else if (/Macintosh/i.test(value)) {
    platform = "Mac";
  }

  let browser = "浏览器";

  if (/MicroMessenger/i.test(value)) {
    browser = "微信";
  } else if (/Edg|EdgiOS|EdgA/i.test(value)) {
    browser = "Edge";
  } else if (/Firefox|FxiOS/i.test(value)) {
    browser = "Firefox";
  } else if (/Chrome|CriOS/i.test(value)) {
    browser = "Chrome";
  } else if (/Safari/i.test(value)) {
    browser = "Safari";
  }

  return `${platform} · ${browser}`;
}

export async function findBrowserBinding(
  env,
  accessCodeId,
  deviceToken
) {
  if (!validToken(deviceToken)) {
    return null;
  }

  const db = requireDatabase(env);
  const tokenHash = await hashToken(deviceToken);

  return db.prepare(`
    SELECT
      b.id,
      b.access_code_id,
      b.browser_label,
      b.created_at,
      b.last_verified_at
    FROM browser_bindings AS b
    JOIN access_codes AS a
      ON a.id = b.access_code_id
    WHERE b.access_code_id = ?
      AND b.device_token_hash = ?
      AND b.revoked_at IS NULL
      AND a.enabled = 1
    LIMIT 1
  `).bind(
    accessCodeId,
    tokenHash
  ).first();
}

export async function createBrowserBinding(
  env,
  accessCodeId,
  userAgent
) {
  const db = requireDatabase(env);
  const bindingId = crypto.randomUUID();
  const deviceToken = randomToken();
  const tokenHash = await hashToken(deviceToken);
  const label = browserLabel(userAgent);

  let result;

  try {
    result = await db.prepare(`
      INSERT INTO browser_bindings (
        id,
        access_code_id,
        device_token_hash,
        browser_label
      )
      SELECT ?, a.id, ?, ?
      FROM access_codes AS a
      WHERE a.id = ?
        AND a.enabled = 1
        AND (
          SELECT COUNT(*)
          FROM browser_bindings AS b
          WHERE b.access_code_id = a.id
            AND b.revoked_at IS NULL
        ) < a.max_browsers
    `).bind(
      bindingId,
      tokenHash,
      label,
      accessCodeId
    ).run();
  } catch (error) {
    const message = String(error?.message || "");

    if (message.includes("BROWSER_LIMIT_REACHED")) {
      return {
        ok: false,
        reason: "BROWSER_LIMIT_REACHED"
      };
    }

    if (message.includes("ACCESS_CODE_UNAVAILABLE")) {
      return {
        ok: false,
        reason: "ACCESS_CODE_UNAVAILABLE"
      };
    }

    throw error;
  }

  if (!result.success) {
    throw new Error("BINDING_WRITE_FAILED");
  }

  if (Number(result.meta?.changes) === 1) {
    return {
      ok: true,
      bindingId,
      deviceToken,
      browserLabel: label
    };
  }

  const accessCode = await db.prepare(`
    SELECT enabled
    FROM access_codes
    WHERE id = ?
    LIMIT 1
  `).bind(accessCodeId).first();

  if (!accessCode || accessCode.enabled !== 1) {
    return {
      ok: false,
      reason: "ACCESS_CODE_UNAVAILABLE"
    };
  }

  return {
    ok: false,
    reason: "BROWSER_LIMIT_REACHED"
  };
}

export async function listBrowserBindings(
  env,
  accessCodeId
) {
  const db = requireDatabase(env);

  const result = await db.prepare(`
    SELECT
      id,
      browser_label,
      created_at,
      last_verified_at
    FROM browser_bindings
    WHERE access_code_id = ?
      AND revoked_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).bind(accessCodeId).all();

  return result.results || [];
}

export async function revokeBrowserBinding(
  env,
  accessCodeId,
  bindingId
) {
  const db = requireDatabase(env);

  await db.batch([
    db.prepare(`
      UPDATE browser_bindings
      SET revoked_at = unixepoch()
      WHERE id = ?
        AND access_code_id = ?
        AND revoked_at IS NULL
    `).bind(bindingId, accessCodeId),

    db.prepare(`
      UPDATE login_sessions
      SET revoked_at = unixepoch()
      WHERE browser_binding_id IN (
        SELECT id
        FROM browser_bindings
        WHERE id = ?
          AND access_code_id = ?
      )
        AND revoked_at IS NULL
    `).bind(bindingId, accessCodeId)
  ]);
}
