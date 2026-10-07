const encoder = new TextEncoder();

const RULES = Object.freeze({
  visitor: {
    limit: 20,
    windowSeconds: 600
  },
  admin: {
    limit: 5,
    windowSeconds: 900
  }
});

function requireConfig(env) {
  if (
    !env.DB ||
    typeof env.AUTH_SECRET !== "string" ||
    env.AUTH_SECRET.length < 32
  ) {
    throw new Error("RATE_LIMIT_CONFIG_INVALID");
  }
}

async function makeBucketKey(
  env,
  scope,
  origin,
  ip,
  windowStart
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const message = JSON.stringify([
    "rabbit-rate-limit-v1",
    scope,
    origin,
    ip,
    windowStart
  ]);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return Array.from(
    new Uint8Array(signature),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function checkLoginRateLimit(
  request,
  env,
  scope
) {
  requireConfig(env);

  if (!Object.prototype.hasOwnProperty.call(RULES, scope)) {
    throw new Error("INVALID_RATE_LIMIT_SCOPE");
  }

  const ip = request.headers.get("CF-Connecting-IP");

  if (!ip || ip.length > 64) {
    throw new Error("CLIENT_IP_UNAVAILABLE");
  }

  const rule = RULES[scope];
  const now = Math.floor(Date.now() / 1000);
  const windowStart =
    Math.floor(now / rule.windowSeconds) *
    rule.windowSeconds;
  const expiresAt = windowStart + rule.windowSeconds;

  const bucketKey = await makeBucketKey(
    env,
    scope,
    new URL(request.url).origin,
    ip,
    windowStart
  );

  const row = await env.DB.prepare(`
    INSERT INTO login_rate_limits (
      bucket_key,
      attempts,
      expires_at
    )
    VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = login_rate_limits.attempts + 1
    RETURNING attempts
  `).bind(
    bucketKey,
    expiresAt
  ).first();

  if (!row) {
    throw new Error("RATE_LIMIT_WRITE_FAILED");
  }

  return {
    allowed: Number(row.attempts) <= rule.limit,
    retryAfter: Math.max(1, expiresAt - now)
  };
}

export async function cleanupLoginRateLimits(env) {
  requireConfig(env);

  await env.DB.prepare(`
    DELETE FROM login_rate_limits
    WHERE bucket_key IN (
      SELECT bucket_key
      FROM login_rate_limits
      WHERE expires_at <= unixepoch()
      ORDER BY expires_at
      LIMIT 100
    )
  `).run();
}
